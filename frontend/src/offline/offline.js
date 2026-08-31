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

export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Deve-se operar com os dados locais (sem internet). */
export function usarLocal() {
  return isOffline();
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
  await dbDel('meta', 'pacote');
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
