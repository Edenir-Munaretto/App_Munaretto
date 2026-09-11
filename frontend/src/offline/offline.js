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
import { gravarLocal, lerLocal, removerLocal, storageDisponivel } from '../utils/storage';
import { dbClearStore, dbDel, dbGet, dbGetAll, dbPut } from './db';

const CHAVE_MODO_CAMPO = 'modo_campo';

// ---------------------------------------------------------------------------
// Estado do dispositivo
// ---------------------------------------------------------------------------

export function isModoCampo() {
  return lerLocal(CHAVE_MODO_CAMPO) === '1';
}

export function setModoCampo(ativo) {
  if (ativo) gravarLocal(CHAVE_MODO_CAMPO, '1');
  else removerLocal(CHAVE_MODO_CAMPO);
}

/**
 * O aparelho consegue guardar dados offline (localStorage + IndexedDB)?
 * Navegador com cookies/dados do site bloqueados nega os dois — sem isso o
 * Modo Campo não funciona e a sessão nem é mantida ao recarregar.
 */
export function armazenamentoOfflineDisponivel() {
  try {
    return storageDisponivel() && typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
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
 * - Modo Campo: SEMPRE (bolha local — leitura e escrita 100% no pacote até a
 *   sincronização manual; conectividade só habilita o sync/botões);
 * - Fora do Modo Campo: apenas quando o navegador confirma a queda (sem
 *   pacote local, o usuário deve ver erros de conexão, não dados vazios).
 */
export function usarLocal() {
  if (isModoCampo()) return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

// ---------------------------------------------------------------------------
// Pacote de campo (download na base, com internet)
// ---------------------------------------------------------------------------

async function _baixarDetalheOs(id) {
  const dRes = await apiFetch(`${API_URL}/os/${id}`, { signal: AbortSignal.timeout(30000) });
  if (!dRes.ok) return false;
  await salvarDetalheLocal(await dRes.json());
  return true;
}

async function _baixarChecklistOs(id) {
  try {
    const cRes = await apiFetch(`${API_URL}/os/${id}/checklist`, { signal: AbortSignal.timeout(30000) });
    if (!cRes.ok) return false;
    const dados = await cRes.json();
    await salvarChecklistLocal(id, dados);
    // Cache das fotos de evidência (best-effort): permite visualizá-las offline.
    await cachearFotosChecklist(id, dados.itens || []);
    return true;
  } catch {
    return false;
  }
}

/** Teto de fotos cacheadas por O.S e no total (evita pacote gigante). */
const MAX_FOTOS_CACHE_POR_OS = 60;
const MAX_FOTOS_CACHE_TOTAL = 300;
const TTL_FOTOS_CACHE_MS = 14 * 24 * 60 * 60 * 1000; // 14 dias

/** Poda o cache global: remove expiradas (TTL) e o excedente mais antigo. */
async function _podarFotosCache() {
  try {
    const todas = await dbGetAll('fotos_cache');
    if (!todas.length) return;
    const agora = Date.now();
    const validas = [];
    for (const f of todas) {
      const em = Number(f.em) || 0;
      if (em && agora - em > TTL_FOTOS_CACHE_MS) {
        _revogarUrlFotoCache(f.id);
        await dbDel('fotos_cache', f.id);
      } else {
        validas.push(f);
      }
    }
    if (validas.length <= MAX_FOTOS_CACHE_TOTAL) return;
    validas.sort((a, b) => (Number(a.em) || 0) - (Number(b.em) || 0));
    for (const f of validas.slice(0, validas.length - MAX_FOTOS_CACHE_TOTAL)) {
      _revogarUrlFotoCache(f.id);
      await dbDel('fotos_cache', f.id);
    }
  } catch {
    /* best-effort: poda nunca derruba o pacote */
  }
}

/** Baixa e guarda no dispositivo as fotos de evidência dos itens do checklist
 * (via proxy autenticado do backend — não depende de CORS do bucket). */
export async function cachearFotosChecklist(osId, itens) {
  await _podarFotosCache();
  let restantes = MAX_FOTOS_CACHE_POR_OS;
  for (const item of itens) {
    for (const foto of item.fotos || []) {
      if (restantes <= 0) return;
      if (foto?.id == null) continue;
      try {
        if (await dbGet('fotos_cache', foto.id)) continue; // já em cache
      } catch {
        continue;
      }
      restantes -= 1;
      try {
        const res = await apiFetch(`${API_URL}/os/${osId}/fotos/${foto.id}/arquivo`, {
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) continue;
        const blob = await res.blob();
        await dbPut('fotos_cache', {
          id: foto.id,
          os_id: Number(osId),
          blob,
          mime_type: foto.mime_type || blob.type || 'image/jpeg',
          nome_original: foto.nome_original || 'foto',
          em: Date.now(),
        });
      } catch {
        /* best-effort: a foto segue disponível online */
      }
    }
  }
}

/** Baixa detalhe (+ checklist) de uma O.S com 1 nova tentativa.
 *
 * `pularSePendente` (refresh contínuo): se a O.S ganhar pendência local
 * (fila/fotos) durante o download, NÃO sobrescreve detalhe/checklist — uma
 * resposta recém-feita no dispositivo prevalece sobre a cópia do servidor.
 */
async function _baixarOsCompleta(id, { pularSePendente = false } = {}) {
  if (pularSePendente && (await _idsComPendenciaLocal()).has(Number(id))) return false;
  let ok = false;
  for (let tentativa = 0; tentativa < 2 && !ok; tentativa += 1) {
    try {
      ok = await _baixarDetalheOs(id);
    } catch {
      ok = false;
    }
  }
  if (pularSePendente && (await _idsComPendenciaLocal()).has(Number(id))) return ok;
  try {
    await _baixarChecklistOs(id);
  } catch {
    /* checklist é complementar; não bloqueia o detalhe */
  }
  return ok;
}

/** Baixa várias O.S com concorrência limitada (não sobrecarrega o servidor). */
async function _baixarEmParalelo(ids, limite = 5, opcoes = {}) {
  let indice = 0;
  const trabalhadores = Array.from({ length: limite }, async () => {
    while (indice < ids.length) {
      const id = ids[indice];
      indice += 1;
      try {
        await _baixarOsCompleta(id, opcoes);
      } catch {
        /* segue para a próxima */
      }
    }
  });
  await Promise.all(trabalhadores);
}

/** Teto de O.S ativas baixadas por vez (o PostgREST também limita ~1000). */
const LIMITE_LISTA_CAMPO = 500;

/** Busca a lista de O.S com retry (falhas de rede/5xx são transitórias). */
async function _buscarListaOs() {
  let ultimoErro = null;
  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    try {
      const res = await apiFetch(`${API_URL}/os/?limit=${LIMITE_LISTA_CAMPO}`, { signal: AbortSignal.timeout(45000) });
      if (res.ok) return await res.json();
      ultimoErro = erroDaResposta(await res.json().catch(() => null), 'Falha ao baixar a lista de O.S.');
    } catch (e) {
      ultimoErro = e?.name === 'TimeoutError' || e?.name === 'AbortError'
        ? 'Tempo esgotado ao baixar a lista de O.S. Tente novamente.'
        : (e?.message || 'Falha de conexão ao baixar a lista de O.S.');
    }
    if (tentativa < 2) await new Promise(r => setTimeout(r, 800 * (tentativa + 1)));
  }
  throw new Error(ultimoErro || 'Falha ao baixar a lista de O.S.');
}

async function _atualizarMetaPacote(lista) {
  const ids = lista.map(os => os.id);
  const faltantes = [];
  for (const id of ids) {
    const tem = await dbGet('os', Number(id));
    if (!tem) faltantes.push(id);
  }
  await dbPut('meta', {
    chave: 'pacote',
    preparado_em: new Date().toISOString(),
    quantidade: ids.length,
    faltantes,
  });
  return faltantes;
}

/** Baixa o catálogo de serviços (lançamento de materiais offline). */
async function _baixarCatalogo() {
  try {
    const resP = await apiFetch(`${API_URL}/os/produtos`, { signal: AbortSignal.timeout(30000) });
    if (!resP.ok) return false;
    await dbClearStore('produtos');
    const catalogo = await resP.json();
    for (const p of catalogo) await dbPut('produtos', p);
    return true;
  } catch {
    return false; // falha no catálogo não impede o restante do pacote
  }
}

/** O.S com pendência local (fila ou fotos não enviadas): não podem ser
 * sobrescritas nem podadas — o estado otimista do dispositivo prevalece. */
async function _idsComPendenciaLocal() {
  const [ops, fotos] = await Promise.all([dbGetAll('fila'), dbGetAll('fotos')]);
  const ids = new Set();
  for (const op of ops) {
    if (op && typeof op === 'object' && op.os_id != null) ids.add(Number(op.os_id));
  }
  for (const f of fotos) {
    if (f && typeof f === 'object' && f.status !== 'enviada' && f.os_id != null) ids.add(Number(f.os_id));
  }
  return ids;
}

export async function prepararPacoteCampo() {
  const lista = await _buscarListaOs();
  await dbClearStore('os_lista');
  await dbClearStore('os');
  await dbClearStore('checklist');

  // Catálogo de serviços (lançamento de materiais) também vai para o tablet.
  await _baixarCatalogo();

  // Lista vai primeiro (a O.S aparece mesmo que o detalhe precise de retry).
  // IMPORTANTE: a store `os_lista` usa keyPath `os_id` — o item cru da
  // listagem só tem `id`; sem o mapeamento o put falharia (e a lista local
  // ficaria vazia offline).
  for (const os of lista) await dbPut('os_lista', { ...os, os_id: Number(os.id) });

  // Detalhe + checklist de cada O.S (concorrência limitada, 1 retry por O.S).
  const ids = lista.map(os => os.id);
  await _baixarEmParalelo(ids);
  // Segunda passada: tenta de novo as O.S que ainda faltam (rede instável).
  let faltantes = await _atualizarMetaPacote(lista);
  if (faltantes.length) {
    await _baixarEmParalelo(faltantes);
    faltantes = await _atualizarMetaPacote(lista);
  }
  return { quantidade: lista.length, faltantes };
}

export async function infoPacote() {
  return dbGet('meta', 'pacote');
}

/** Dono do pacote local (usuário que preparou/usa o Modo Campo). */
export async function salvarDonoPacote(usuario) {
  if (!usuario) return;
  await dbPut('meta', {
    chave: 'dono',
    usuario_id: usuario.id ?? null,
    usuario_email: usuario.email || null,
    usuario_nome: usuario.nome || null,
  });
}

export async function donoPacote() {
  return dbGet('meta', 'dono');
}

/**
 * Atualiza o pacote do Modo Campo com a lista atual do servidor:
 *  - adiciona O.S novas;
 *  - atualiza lista/detalhe/checklist das existentes SEM pendência local;
 *  - poda O.S que saíram da lista ativa (concluídas/canceladas em outro
 *    aparelho) quando não têm pendência;
 *  - atualiza o catálogo de serviços e re-tenta detalhes faltantes.
 *
 * Nunca sobrescreve nem remove O.S com pendência (fila/fotos) — protege o
 * estado otimista do dispositivo.
 *
 * `completo = false` (refresh automático): baixa detalhe/checklist apenas das
 * novas, das que mudaram no resumo e das faltantes — econômico em dados
 * móveis. `completo = true` (botão "Atualizar O.S"): re-baixa também as
 * existentes sem pendência (pega mudanças de checklist feitas em outro
 * aparelho).
 */
export async function atualizarPacoteCampo({ completo = false } = {}) {
  const metaAnterior = await infoPacote();
  const faltantesAntigos = (metaAnterior?.faltantes || []).filter(Boolean);
  const comPendencia = await _idsComPendenciaLocal();

  const lista = await _buscarListaOs();
  const locais = await getListaLocal();
  const locaisPorId = new Map(locais.map(os => [Number(os.id), os]));
  const idsLocais = new Set(locais.map(os => Number(os.id)));
  const idsServidor = new Set((lista || []).map(os => Number(os.id)));

  const novas = (lista || []).filter(os => os?.id != null && !idsLocais.has(Number(os.id)));
  const existentes = (lista || []).filter(os => os?.id != null && idsLocais.has(Number(os.id)));

  // 1) Lista: novas + resumo das existentes sem pendência. `atualizadas` e
  //    `mudou` consideram só as que realmente mudaram no resumo.
  for (const os of novas) await dbPut('os_lista', { ...os, os_id: Number(os.id) });
  let atualizadas = 0;
  const mudou = new Set();
  for (const os of existentes) {
    const id = Number(os.id);
    if (comPendencia.has(id)) continue;
    const localLimpo = { ...(locaisPorId.get(id) || {}) };
    delete localLimpo.os_id;
    if (JSON.stringify(localLimpo) !== JSON.stringify(os)) {
      atualizadas += 1;
      mudou.add(id);
    }
    await dbPut('os_lista', { ...os, os_id: id });
  }

  // 2) Detalhe + checklist: novos, alterados, faltantes e (no refresh manual)
  //    todos os existentes sem pendência.
  const baixar = new Set();
  for (const os of novas) baixar.add(Number(os.id));
  for (const os of existentes) {
    const id = Number(os.id);
    if (comPendencia.has(id)) continue;
    if (completo || mudou.has(id)) baixar.add(id);
  }
  for (const id of faltantesAntigos) {
    if (idsServidor.has(Number(id))) baixar.add(Number(id));
  }
  if (baixar.size) await _baixarEmParalelo([...baixar], 5, { pularSePendente: true });

  // 3) Poda: O.S que saíram da lista ativa e não têm pendência local.
  //    Só quando a lista veio completa — o teto de LIMITE_LISTA_CAMPO pode
  //    truncar a resposta e "sumir" com O.S válidas do pacote.
  const listaCompleta = (lista || []).length < LIMITE_LISTA_CAMPO;
  let removidas = 0;
  if (listaCompleta) {
    for (const id of idsLocais) {
      if (idsServidor.has(id) || comPendencia.has(id)) continue;
      await dbDel('os_lista', id);
      await dbDel('os', id);
      await dbDel('checklist', id);
      await _removerFotosCacheDoOs(id);
      removidas += 1;
    }
  }

  // 4) Catálogo de serviços (materiais offline) — best-effort.
  await _baixarCatalogo();

  const faltantes = [];
  for (const id of baixar) {
    if (!(await dbGet('os', Number(id)))) faltantes.push(id);
  }
  await dbPut('meta', {
    ...(metaAnterior || {}),
    chave: 'pacote',
    preparado_em: new Date().toISOString(),
    quantidade: (await getListaLocal()).length,
    faltantes,
  });
  return { novas: novas.length, atualizadas, removidas, faltantes };
}

export async function limparPacote() {
  await dbClearStore('os_lista');
  await dbClearStore('os');
  await dbClearStore('checklist');
  await dbClearStore('produtos');
  await dbClearStore('fotos_cache');
  _revogarTodasUrlsCache();
  // Limpeza total (card de recuperação/troca de usuário): a fila e as fotos
  // pendentes saem junto para não vazarem para o próximo usuário do aparelho.
  await dbClearStore('fila');
  await dbClearStore('fotos');
  await dbDel('meta', 'pacote');
  await dbDel('meta', 'responsavel');
  await dbDel('meta', 'dono');
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
  // Defensivo: registros corrompidos/parciais não podem derrubar a tela do
  // Modo Campo (os dados locais já passaram por várias versões do app).
  const validos = lista.filter(os =>
    os && typeof os === 'object' && os.id != null && (os.codigo || os.obras?.nome),
  );
  return validos.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
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
  dados.resumo = recalcularResumo(dados.itens, dados.resumo);
  await dbPut('checklist', dados);
  // Reflete o resumo também no detalhe da O.S (banners/gates locais).
  const detalhe = await dbGet('os', Number(osId));
  if (detalhe) {
    detalhe.checklist = dados.resumo;
    await dbPut('os', detalhe);
  }
}

export function recalcularResumo(itens, resumoAnterior = null) {
  // Nomes preservados POR NÚMERO de grupo (não por posição): se a ordem dos
  // grupos mudar no servidor, os rótulos continuam corretos offline.
  const nomePorGrupo = {};
  for (const g of resumoAnterior?.grupos || []) nomePorGrupo[g.grupo] = g.nome;
  const numeros = Array.from(
    new Set([...itens.map(i => i.grupo), ...Object.keys(nomePorGrupo).map(Number)]),
  ).sort((a, b) => a - b);

  // Só conta como respondido o que a UI mostra como marcado (sim/nao/na):
  // um objeto de resposta vazio/inválido não pode "completar" grupo/checklist.
  const temResposta = (i) => ['sim', 'nao', 'na'].includes(i?.resposta?.resposta);

  const grupos = numeros.map(g => {
    const doGrupo = itens.filter(i => i.grupo === g);
    const resp = doGrupo.filter(temResposta);
    return {
      grupo: g,
      nome: nomePorGrupo[g] || `Grupo ${g}`,
      total: doGrupo.length,
      respondidos: resp.length,
      completo: doGrupo.length > 0 && resp.length === doGrupo.length,
    };
  });
  const total = itens.length;
  const respondidos = itens.filter(temResposta).length;
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

function _revogarUrlFotoPendente(foto) {
  const chave = `${foto.checklist_item_id}:${foto.id_local}`;
  const url = _urlsFotosPendentes.get(chave);
  if (url) {
    _urlsFotosPendentes.delete(chave);
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
  }
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

// ---------------------------------------------------------------------------
// Cache das fotos do servidor (visualização offline)
// ---------------------------------------------------------------------------

const _urlsFotosCache = new Map();

function _urlFotoCache(foto) {
  let url = _urlsFotosCache.get(foto.id);
  if (!url && foto.blob) {
    url = URL.createObjectURL(foto.blob);
    _urlsFotosCache.set(foto.id, url);
  }
  return url || '';
}

function _revogarUrlFotoCache(id) {
  const url = _urlsFotosCache.get(id);
  if (url) {
    _urlsFotosCache.delete(id);
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
  }
}

/** Revoga todas as URLs de objeto do cache (fotos do servidor e pendentes). */
function _revogarTodasUrlsCache() {
  for (const id of [..._urlsFotosCache.keys()]) _revogarUrlFotoCache(id);
  for (const [chave, url] of [..._urlsFotosPendentes.entries()]) {
    _urlsFotosPendentes.delete(chave);
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
  }
}

/** Aplica as fotos do servidor em cache (URL de objeto) nos itens do
 * checklist local — as fotos de item capturadas offline já vêm via
 * `hidratarFotosPendentes`. */
export async function hidratarFotosCache(dados) {
  if (!dados?.itens?.length) return dados;
  let cache = [];
  try {
    cache = await dbGetAll('fotos_cache');
  } catch {
    return dados;
  }
  if (!cache.length) return dados;
  const porId = new Map(cache.map(f => [f.id, f]));
  const itens = dados.itens.map(item => {
    const fotos = item.fotos || [];
    if (!fotos.length) return item;
    const atualizadas = fotos.map(f => {
      if (f?.pendente) return f;
      const cached = porId.get(f.id);
      if (!cached) return f;
      const url = _urlFotoCache(cached);
      return url ? { ...f, url_temporaria: url } : f;
    });
    return { ...item, fotos: atualizadas };
  });
  return { ...dados, itens };
}

/** Fotos do servidor em cache no dispositivo (com URL de objeto) — usado pela
 * aba Evidências no Modo Campo. */
export async function getFotosCacheLocal(osId) {
  const todas = await dbGetAll('fotos_cache');
  return todas
    .filter(f => Number(f.os_id) === Number(osId))
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(f => ({
      id: f.id,
      nome_original: f.nome_original,
      mime_type: f.mime_type,
      url_temporaria: _urlFotoCache(f),
    }));
}

/** Remove do cache as fotos de uma O.S (poda/troca de pacote). */
async function _removerFotosCacheDoOs(osId) {
  try {
    const todas = await dbGetAll('fotos_cache');
    for (const f of todas) {
      if (Number(f.os_id) === Number(osId)) {
        _revogarUrlFotoCache(f.id);
        await dbDel('fotos_cache', f.id);
      }
    }
  } catch {
    /* best-effort */
  }
}

export async function contarPendentes() {
  const [ops, fotos] = await Promise.all([dbGetAll('fila'), dbGetAll('fotos')]);
  const valido = r => r && typeof r === 'object' && r.id_local != null;
  const operacoes = ops.filter(valido);
  const fotosPendentes = fotos.filter(f => valido(f) && f.status !== 'enviada');
  // Itens com erro/conflito (o servidor recusou) — não se resolvem no sync;
  // exigem revisão/descarte na tela de pendências.
  const revisao = operacoes.filter(op => op.status === 'erro').length
    + fotosPendentes.filter(f => f.status === 'erro').length;
  return { operacoes: operacoes.length, fotos: fotosPendentes.length, total: operacoes.length + fotosPendentes.length, revisao };
}

export async function listarPendentes() {
  const [ops, fotos] = await Promise.all([dbGetAll('fila'), dbGetAll('fotos')]);
  // Registros inválidos (sem objeto/chave) não são pendências: filtrá-los
  // evita crash na tela e envios corrompidos (mantidos no disco, porém).
  const valido = r => r && typeof r === 'object' && r.id_local != null;
  // Fotos já enviadas (id_servidor persistido) não são pendências: ficam
  // apenas como apoio do mapa id_local -> id até a operação sair da fila.
  return {
    operacoes: ops.filter(valido),
    fotos: fotos.filter(f => valido(f) && f.status !== 'enviada'),
  };
}

/** Operações de lançamento de serviço (material) ainda na fila de uma O.S —
 * apoio à visão local-first do Modo Campo conectado (merge sobre o servidor). */
export async function lancamentosPendentesDaFila(osId) {
  osId = Number(osId);
  const ops = await dbGetAll('fila');
  return ops.filter(op => op && typeof op === 'object' && op.os_id === osId && op.tipo === 'material');
}

/** Remove do dispositivo um item pendente (foto ou operação) sem enviar. */
export async function descartarPendente(tipo, idLocal) {
  if (idLocal == null) return false;
  if (tipo === 'foto') {
    const foto = await dbGet('fotos', idLocal);
    _revogarUrlFotoPendente(foto || { checklist_item_id: null, id_local: idLocal });
    return dbDel('fotos', idLocal);
  }
  return dbDel('fila', idLocal);
}

// ---------------------------------------------------------------------------
// Responsável local (quem preparou/sincronizou no aparelho)
// ---------------------------------------------------------------------------

export async function salvarResponsavelLocal(nome) {
  await dbPut('meta', { chave: 'responsavel', nome, em: new Date().toISOString() });
}

export async function responsavelLocal() {
  return dbGet('meta', 'responsavel');
}

/** Guarda o resumo da última sincronização (diagnóstico no aparelho). */
export async function salvarUltimoSync(resumo) {
  await dbPut('meta', { chave: 'ultimo_sync', em: new Date().toISOString(), resumo });
}

export async function ultimoSync() {
  return dbGet('meta', 'ultimo_sync');
}

// ---------------------------------------------------------------------------
// Identidade do dispositivo (idempotência do sync)
// ---------------------------------------------------------------------------
// UUID persistido no IndexedDB. Junto com o id_local da operação forma a
// chave (dispositivo, id_local) usada pelo servidor para deduplicar reenvios.

let _dispositivoId = null;

export async function dispositivoId() {
  if (_dispositivoId) return _dispositivoId;
  const reg = await dbGet('meta', 'dispositivo_id');
  if (reg?.valor) {
    _dispositivoId = reg.valor;
    return reg.valor;
  }
  const novo =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  await dbPut('meta', { chave: 'dispositivo_id', valor: novo, em: new Date().toISOString() });
  _dispositivoId = novo;
  return novo;
}

// ---------------------------------------------------------------------------
// Cronômetro H.H. derivado da fila (espelho local offline)
// ---------------------------------------------------------------------------
// Enquanto a ÚLTIMA operação de H.H. pendente da O.S for um play, o
// cronômetro está rodando (início = criado_em do play); se for um pause
// (ou não houver operação), está parado. Derivar da fila dispensa um
// "espelho" gravado: descarte/reenvio/confirmação refletem sozinhos e o
// botão nunca permite dois plays pendentes da mesma sessão.

export async function cronometroDerivadoDaFila(osId) {
  osId = Number(osId);
  const ops = (await dbGetAll('fila')).filter(
    op => op.os_id === osId && (op.tipo === 'apontamento_play' || op.tipo === 'apontamento_pause'),
  );
  if (!ops.length) return null;
  ops.sort((a, b) => String(a.criado_em || '').localeCompare(String(b.criado_em || '')));
  const ultima = ops[ops.length - 1];
  if (ultima.tipo === 'apontamento_play') {
    return { aberto: true, inicio: ultima.criado_em };
  }
  return { aberto: false, inicio: null };
}
