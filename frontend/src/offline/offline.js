// Modo Campo — domínio offline do módulo de O.S.
//
// Fluxo:
//   1. Na base (online), o líder baixa o "pacote de campo" (O.S da equipe +
//      detalhes + checklist) para o dispositivo via `prepararPacoteCampo`.
//   2. No campo (sem internet), o app usa os dados locais e toda ação vira
//      uma operação na fila (`enfileirar*`) com timestamp real.
//   3. Ao voltar, o motor de sincronização (`./sync.js`) envia fotos e depois
//      o lote de operações; o servidor revalida cada uma.

import { API_URL, apiFetch, erroDaResposta } from '../api';
import { dbClearStore, dbDel, dbGet, dbGetAll, dbPut } from './db';

const CHAVE_MODO_CAMPO = 'modo_campo';

// ---------------------------------------------------------------------------
// Estado do dispositivo
// ---------------------------------------------------------------------------

export function isModoCampo() {
  return localStorage.getItem(CHAVE_MODO_CAMPO) === '1';
}

export function setModoCampo(ativo) {
  if (ativo) localStorage.setItem(CHAVE_MODO_CAMPO, '1');
  else localStorage.removeItem(CHAVE_MODO_CAMPO);
}

// ---------------------------------------------------------------------------
// Conectividade real (sonda)
// ---------------------------------------------------------------------------
// `navigator.onLine` sozinho engana: no campo o tablet costuma estar num WiFi
// SEM internet (roteador do canteiro/hotspot), e o navegador reporta online.
// Por isso mantemos uma sonda HTTP com timeout curto — só erro de rede/timeout
// marca como desconectado; qualquer resposta HTTP (401/500 inclusive) = online.

let _conectividade = true;

export function setConectividade(ok) {
  _conectividade = !!ok;
}

/** Marca como desconectado após uma falha de rede real (failover imediato). */
export function registrarFalhaDeRede() {
  _conectividade = false;
}

export function conectividadeOk() {
  return _conectividade;
}

/** Sonda leve no servidor (endpoint barato já usado pela página). */
export async function testarConexao() {
  try {
    await fetch(`${API_URL}/os/transicoes`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    _conectividade = true;
    return true;
  } catch {
    _conectividade = false;
    return false;
  }
}

export function isOffline() {
  return (typeof navigator !== 'undefined' && navigator.onLine === false) || _conectividade === false;
}

/**
 * Está conectado por Wi-Fi/ethernet (e não dados móveis)?
 *
 * Sincronizações (uploads de fotos) ficam lentas/travam em 3G/4G — por isso a
 * sincronização automática e o "Finalizar Modo Campo" só rodam no Wi-Fi.
 * O `type` da Network Information API distingue; quando a API não existe
 * (ex.: iOS Safari), assume que pode sincronizar.
 */
export function estaEmWifi() {
  if (typeof navigator === 'undefined') return true;
  const conexao = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conexao || !conexao.type) return true;
  const tipo = conexao.type.toLowerCase();
  return tipo !== 'cellular' && tipo !== 'bluetooth' && tipo !== 'none';
}

/**
 * Deve-se operar com os dados locais.
 * - Modo Campo: sempre que houver indicação de falta de internet — sonda HTTP
 *   falhou (WiFi sem internet) OU navegador detectou queda de rede;
 * - Fora do Modo Campo: apenas quando o navegador confirma a queda (sem
 *   pacote local, o usuário deve ver erros de conexão, não dados vazios).
 */
export function usarLocal() {
  if (isModoCampo()) return isOffline();
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

// ---------------------------------------------------------------------------
// Pacote de campo (download na base, com internet)
// ---------------------------------------------------------------------------

export async function prepararPacoteCampo() {
  const res = await apiFetch(`${API_URL}/os/?limit=500`);
  if (!res.ok) {
    throw new Error(erroDaResposta(await res.json().catch(() => null), 'Falha ao baixar a lista de O.S.'));
  }
  const lista = await res.json();
  await dbClearStore('os_lista');
  await dbClearStore('os');
  await dbClearStore('checklist');

  // Catálogo de serviços (lançamento de materiais) também vai para o tablet.
  try {
    const resP = await apiFetch(`${API_URL}/os/produtos`);
    if (resP.ok) {
      await dbClearStore('produtos');
      const catalogo = await resP.json();
      for (const p of catalogo) await dbPut('produtos', p);
    }
  } catch {
    /* falha no catálogo não impede o restante do pacote */
  }

  for (const os of lista) {
    try {
      await dbPut('os_lista', os);
      const [dRes, cRes] = await Promise.all([
        apiFetch(`${API_URL}/os/${os.id}`),
        apiFetch(`${API_URL}/os/${os.id}/checklist`),
      ]);
      if (dRes.ok) await salvarDetalheLocal(await dRes.json());
      if (cRes.ok) await dbPut('checklist', await cRes.json());
    } catch {
      /* uma O.S que falhar não impede o restante do pacote */
    }
  }
  await dbPut('meta', {
    chave: 'pacote',
    preparado_em: new Date().toISOString(),
    quantidade: lista.length,
  });
  return lista.length;
}

export async function infoPacote() {
  return dbGet('meta', 'pacote');
}

export async function limparPacote() {
  await dbClearStore('os_lista');
  await dbClearStore('os');
  await dbClearStore('checklist');
  await dbClearStore('produtos');
  // Ao sair do Modo Campo o tablet é apagado por completo (é da equipe):
  // fila de operações e fotos pendentes não podem vazar para o próximo usuário.
  await dbClearStore('fila');
  await dbClearStore('fotos');
  await dbDel('meta', 'pacote');
  await dbDel('meta', 'responsavel');
}

// ---------------------------------------------------------------------------
// Leituras locais (modo offline)
// ---------------------------------------------------------------------------

export async function getOSLocal(osId) {
  return dbGet('os', Number(osId));
}

/** Salva (ou atualiza) o detalhe completo da O.S no pacote local. */
export async function salvarDetalheLocal(detalhe) {
  await dbPut('os', { ...detalhe, os_id: Number(detalhe.id) });
}

export async function getChecklistLocal(osId) {
  return dbGet('checklist', Number(osId));
}

/** Salva (ou atualiza) o checklist completo da O.S no pacote local. */
export async function salvarChecklistLocal(osId, dados) {
  await dbPut('checklist', { os_id: Number(osId), itens: dados.itens || [], resumo: dados.resumo });
}

export async function getListaLocal() {
  const lista = await dbGetAll('os_lista');
  return lista.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

/** Catálogo de serviços baixado no pacote de campo (lançamento offline). */
export async function getProdutosLocal() {
  const catalogo = await dbGetAll('produtos');
  return catalogo.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
}

/** Reflete uma mudança de status também no pacote local. */
export async function atualizarStatusLocal(osId, novoStatus) {
  osId = Number(osId);
  const detalhe = await dbGet('os', osId);
  if (detalhe) {
    detalhe.status = novoStatus;
    await dbPut('os', detalhe);
  }
  const item = await dbGet('os_lista', osId);
  if (item) {
    item.status = novoStatus;
    await dbPut('os_lista', item);
  }
}

/** Atualiza o checklist local após uma resposta offline. */
export async function atualizarRespostaLocal(osId, itemId, resposta, justificativa, geolocalizacao) {
  const dados = await dbGet('checklist', Number(osId));
  if (!dados?.itens) return;
  const item = dados.itens.find(i => i.id === itemId);
  if (!item) return;
  item.resposta = {
    item_id: itemId,
    resposta,
    justificativa: justificativa || null,
    geolocalizacao: geolocalizacao || null,
    criado_em: new Date().toISOString(),
    respondido_por: 'dispositivo',
  };
  dados.resumo = recalcularResumo(dados.itens);
  await dbPut('checklist', dados);
  // Reflete o resumo também no detalhe da O.S (banners/gates locais).
  const detalhe = await dbGet('os', Number(osId));
  if (detalhe) {
    detalhe.checklist = dados.resumo;
    await dbPut('os', detalhe);
  }
}

export function recalcularResumo(itens) {
  const grupos = [];
  for (let g = 1; g <= 5; g += 1) {
    const doGrupo = itens.filter(i => i.grupo === g);
    const resp = doGrupo.filter(i => i.resposta);
    grupos.push({
      grupo: g,
      nome: `Grupo ${g}`,
      total: doGrupo.length,
      respondidos: resp.length,
      completo: doGrupo.length > 0 && resp.length === doGrupo.length,
    });
  }
  const total = itens.length;
  const respondidos = itens.filter(i => i.resposta).length;
  const inicio = grupos.find(g => g.grupo === 1);
  return {
    total,
    respondidos,
    completo: total === 0 || respondidos === total,
    inicio_liberado: !inicio || inicio.total === 0 || inicio.completo,
    grupos,
  };
}

// ---------------------------------------------------------------------------
// Fila de operações (escritas offline)
// ---------------------------------------------------------------------------

function novoId(prefixo) {
  const aleatorio =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefixo}-${aleatorio}`;
}

export async function enfileirarOperacao({ tipo, os_id, payload }) {
  const op = {
    id_local: novoId('op'),
    tipo,
    os_id: Number(os_id),
    criado_em: new Date().toISOString(),
    payload,
    status: 'pendente',
    tentativas: 0,
    erro: null,
  };
  await dbPut('fila', op);
  return op;
}

export async function enfileirarFoto({ os_id, checklist_item_id, arquivo, geolocalizacao }) {
  const foto = {
    id_local: novoId('foto'),
    os_id: Number(os_id),
    checklist_item_id: checklist_item_id == null ? null : Number(checklist_item_id),
    arquivo: {
      nome: arquivo.name || 'foto.jpg',
      tipo: arquivo.type || 'image/jpeg',
      blob: arquivo, // File/Blob são armazenáveis no IndexedDB
    },
    geolocalizacao: geolocalizacao || null,
    criado_em: new Date().toISOString(),
    status: 'pendente',
    erro: null,
  };
  await dbPut('fotos', foto);
  return foto;
}

// ---------------------------------------------------------------------------
// Preview local de fotos do checklist (apenas em modo OFFLINE)
// ---------------------------------------------------------------------------
// URLs temporárias das fotos pendentes (chave `item_id:id_local`), reutilizadas
// durante a sessão para não criar uma URL nova a cada recarga do painel.
const _urlsFotosPendentes = new Map();

function _urlFotoPendente(foto) {
  const chave = `${foto.checklist_item_id}:${foto.id_local}`;
  let url = _urlsFotosPendentes.get(chave);
  if (!url && foto.arquivo?.blob) {
    url = URL.createObjectURL(foto.arquivo.blob);
    _urlsFotosPendentes.set(chave, url);
  }
  return url || '';
}

/** Guarda a foto no dispositivo e a anexa ao item do checklist local como
 * PREVIEW (`pendente: true`). Retorna {foto, entrada}. */
export async function registrarFotoItemLocal({ os_id, item_id, arquivo, geolocalizacao }) {
  const foto = await enfileirarFoto({ os_id, checklist_item_id: item_id, arquivo, geolocalizacao });
  const entrada = {
    id: foto.id_local,
    id_local: foto.id_local,
    url_temporaria: _urlFotoPendente(foto),
    nome_original: arquivo.name || 'foto.jpg',
    mime_type: arquivo.type || 'image/jpeg',
    pendente: true,
  };
  await anexarFotoLocalAoItem(os_id, item_id, entrada);
  return { foto, entrada };
}

/** Anexa uma entrada pendente ao item, mantendo as fotos reais do servidor. */
export async function anexarFotoLocalAoItem(osId, itemId, entrada) {
  osId = Number(osId);
  const dados = await dbGet('checklist', osId);
  if (!dados?.itens) return;
  const item = dados.itens.find(i => i.id === itemId);
  if (!item) return;
  const fotosReais = (item.fotos || []).filter(f => !f.pendente);
  item.fotos = [...fotosReais, entrada];
  await dbPut('checklist', dados);
}

/** Reconstrói os previews das fotos pendentes ao ler o checklist local
 * (reabrir o painel / reiniciar o tablet antes de sincronizar). */
export async function hidratarFotosPendentes(dados) {
  const pendentes = (await dbGetAll('fotos')).filter(
    f => f.checklist_item_id != null && f.status === 'pendente' && f.arquivo?.blob,
  );
  if (!pendentes.length) return dados;
  const porItem = new Map();
  for (const p of pendentes) {
    const grupo = porItem.get(p.checklist_item_id) || [];
    grupo.push(p);
    porItem.set(p.checklist_item_id, grupo);
  }
  const itens = (dados.itens || []).map(item => {
    const regs = porItem.get(item.id);
    if (!regs) return item;
    const reais = (item.fotos || []).filter(f => !f.pendente);
    const locais = regs.map(p => ({
      id: p.id_local,
      id_local: p.id_local,
      url_temporaria: _urlFotoPendente(p),
      nome_original: p.arquivo.nome,
      mime_type: p.arquivo.tipo,
      pendente: true,
    }));
    return { ...item, fotos: [...reais, ...locais] };
  });
  return { ...dados, itens };
}

export async function contarPendentes() {
  const [ops, fotos] = await Promise.all([dbGetAll('fila'), dbGetAll('fotos')]);
  return { operacoes: ops.length, fotos: fotos.length, total: ops.length + fotos.length };
}

export async function listarPendentes() {
  const [ops, fotos] = await Promise.all([dbGetAll('fila'), dbGetAll('fotos')]);
  return { operacoes: ops, fotos };
}

/** Remove do dispositivo um item pendente (foto ou operação) sem enviar. */
export async function descartarPendente(tipo, idLocal) {
  if (tipo === 'foto') return dbDel('fotos', idLocal);
  return dbDel('fila', idLocal);
}

// ---------------------------------------------------------------------------
// Responsável local (quem preparou/sincronizou — tablet compartilhado)
// ---------------------------------------------------------------------------

export async function salvarResponsavelLocal(nome) {
  await dbPut('meta', { chave: 'responsavel', nome, em: new Date().toISOString() });
}

export async function responsavelLocal() {
  return dbGet('meta', 'responsavel');
}
