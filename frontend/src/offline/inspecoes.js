// Domínio offline do módulo Inspeções.
//
// O técnico cria uma inspeção local (IndexedDB) já com o snapshot do checklist.
// A sincronização (./syncInspecoes.js) envia a criação, as respostas, as fotos
// e a finalização quando houver Wi-Fi. O pacote de consulta baixa atividades,
// modelos, obras, funcionários, equipes e as inspeções do usuário.

import { API_URL, apiFetch, erroDaResposta } from '../api';
import { dbClearStore, dbDel, dbGet, dbGetAll, dbPut } from './db';
import { dispositivoId } from './offline';

const LIMITE_LISTA = 100;
const MAX_FOTOS_CACHE_POR_INSP = 40;
const MAX_FOTOS_CACHE_TOTAL = 300;
const TTL_FOTOS_CACHE_MS = 14 * 24 * 60 * 60 * 1000;

export const TIPO_RESPOSTA_PADRAO = 'conforme_nao_conforme_na';
export const RESPOSTAS_POR_TIPO = {
  conforme_nao_conforme_na: ['conforme', 'nao_conforme', 'na'],
  sim_nao_na: ['sim', 'nao', 'na'],
};
const LABEL_RESPOSTA = {
  conforme: 'Conforme',
  nao_conforme: 'Não Conforme',
  sim: 'Sim',
  nao: 'Não',
  na: 'N/A',
};

function novoId(prefixo) {
  const aleatorio =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefixo}-${aleatorio}`;
}

function dataLocalISO(data = new Date()) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function _nomeObra(obra) {
  if (!obra) return '';
  return obra.nome || '';
}

// ---------------------------------------------------------------------------
// Fotos locais: URLs de objeto reutilizadas enquanto a página está aberta.
// ---------------------------------------------------------------------------

const _urlsFotos = new Map();

function _urlFotoLocal(foto) {
  if (!foto?.arquivo?.blob) return '';
  const chave = `local:${foto.id_local}`;
  let url = _urlsFotos.get(chave);
  if (!url) {
    try {
      url = URL.createObjectURL(foto.arquivo.blob);
      _urlsFotos.set(chave, url);
    } catch {
      return '';
    }
  }
  return url;
}

function _revogarFotoLocal(idLocal) {
  const chave = `local:${idLocal}`;
  const url = _urlsFotos.get(chave);
  if (url) {
    _urlsFotos.delete(chave);
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
  }
}

const _urlsCache = new Map();

function _urlFotoCache(cache) {
  if (!cache?.blob) return '';
  let url = _urlsCache.get(cache.chave);
  if (!url) {
    try {
      url = URL.createObjectURL(cache.blob);
      _urlsCache.set(cache.chave, url);
    } catch {
      return '';
    }
  }
  return url;
}

// ---------------------------------------------------------------------------
// Opções / pacote
// ---------------------------------------------------------------------------

export async function lerOpcoesLocais() {
  const [atividades, modelos, obras, funcionarios, equipes] = await Promise.all([
    dbGetAll('insp_atividades'),
    dbGetAll('insp_modelos'),
    dbGetAll('insp_obras'),
    dbGetAll('insp_funcionarios'),
    dbGetAll('insp_equipes'),
  ]);
  atividades.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
  modelos.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
  obras.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
  funcionarios.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
  equipes.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
  return { atividades, modelos, obras, funcionarios, equipes };
}

export async function infoPacoteInspecoes() {
  return dbGet('meta', 'insp_pacote');
}

export async function salvarOpcoesLocais(opcoes) {
  await dbClearStore('insp_atividades');
  await dbClearStore('insp_modelos');
  await dbClearStore('insp_obras');
  await dbClearStore('insp_funcionarios');
  await dbClearStore('insp_equipes');
  for (const atividade of opcoes.atividades || []) await dbPut('insp_atividades', atividade);
  for (const modelo of opcoes.modelos || []) await dbPut('insp_modelos', modelo);
  for (const obra of opcoes.obras || []) await dbPut('insp_obras', obra);
  for (const funcionario of opcoes.funcionarios || []) await dbPut('insp_funcionarios', funcionario);
  for (const equipe of opcoes.equipes || []) await dbPut('insp_equipes', equipe);
}

async function _podarFotosCache() {
  try {
    const todas = await dbGetAll('insp_fotos_cache');
    if (!todas.length) return;
    const agora = Date.now();
    const validas = [];
    for (const foto of todas) {
      if (foto.em && agora - Number(foto.em) > TTL_FOTOS_CACHE_MS) {
        const url = _urlsCache.get(foto.chave);
        if (url) {
          _urlsCache.delete(foto.chave);
          try { URL.revokeObjectURL(url); } catch { /* noop */ }
        }
        await dbDel('insp_fotos_cache', foto.chave);
      } else {
        validas.push(foto);
      }
    }
    if (validas.length <= MAX_FOTOS_CACHE_TOTAL) return;
    validas.sort((a, b) => Number(a.em || 0) - Number(b.em || 0));
    for (const foto of validas.slice(0, validas.length - MAX_FOTOS_CACHE_TOTAL)) {
      const url = _urlsCache.get(foto.chave);
      if (url) {
        _urlsCache.delete(foto.chave);
        try { URL.revokeObjectURL(url); } catch { /* noop */ }
      }
      await dbDel('insp_fotos_cache', foto.chave);
    }
  } catch {
    /* best-effort */
  }
}

async function _cachearFotosDoDetalhe(detalhe) {
  const insp = detalhe?.inspecao || detalhe;
  if (!insp?.id) return;
  await _podarFotosCache();
  let restantes = MAX_FOTOS_CACHE_POR_INSP;
  for (const item of detalhe.itens || []) {
    for (const foto of item.fotos || []) {
      if (restantes <= 0) return;
      if (foto?.id == null) continue;
      const chave = `${insp.id}:${foto.id}`;
      const existente = await dbGet('insp_fotos_cache', chave).catch(() => null);
      if (existente) continue;
      restantes -= 1;
      try {
        const res = await apiFetch(`${API_URL}/inspecoes/${insp.id}/fotos/${foto.id}/arquivo`, {
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) continue;
        const blob = await res.blob();
        await dbPut('insp_fotos_cache', {
          chave,
          inspecao_id: insp.id,
          foto_id: foto.id,
          blob,
          mime_type: foto.mime_type || blob.type || 'image/jpeg',
          em: Date.now(),
        });
      } catch {
        /* best-effort: foto continua disponível online */
      }
    }
  }
}

export function adaptarInspecaoServidor(detalhe) {
  const insp = detalhe.inspecao || detalhe;
  const itens = (detalhe.itens || insp.itens || []).map((item) => ({
    item_local_id: item.origem_item_id || `srv-${item.id}`,
    id_servidor: item.id,
    grupo_ordem: item.grupo_ordem || 1,
    grupo_nome: item.grupo_nome || 'Checklist',
    ordem: item.ordem || 1,
    classificacao: item.classificacao,
    pergunta: item.pergunta,
    exige_foto: !!item.exige_foto,
    resposta: (item.resposta || {}).resposta || null,
    observacao: (item.resposta || {}).observacao || null,
    geolocalizacao: (item.resposta || {}).geolocalizacao || null,
    fotos: (item.fotos || []).map((foto) => ({
      id: foto.id,
      id_servidor: foto.id,
      cache_key: `${insp.id}:${foto.id}`,
      nome_original: foto.nome_original,
      url_temporaria: foto.url_temporaria || null,
      capturado_em: foto.capturado_em,
      created_at: foto.created_at,
      geolocalizacao: foto.geolocalizacao,
      pendente: false,
    })),
  }));
  return {
    id_local: `srv-${insp.id}`,
    id_servidor: insp.id,
    codigo: insp.codigo,
    usuario_id: insp.usuario_id,
    status: insp.status,
    atividade_id: insp.atividade_id,
    atividade_nome: insp.atividade_nome,
    modelo_id: insp.modelo_id,
    modelo_nome: insp.modelo_nome,
    tipo_resposta: insp.tipo_resposta || TIPO_RESPOSTA_PADRAO,
    tipo_servico: insp.tipo_servico || '',
    obra_id: insp.obra_id,
    obra_nome: insp.obra_nome || detalhe.obra?.nome || '',
    local_inspecao: insp.local_inspecao || '',
    data_inspecao: insp.data_inspecao,
    iniciada_em: insp.iniciada_em,
    finalizada_em: insp.finalizada_em,
    inspetor_nome: insp.inspetor_nome,
    funcionario_id: insp.funcionario_id,
    funcionario_nome: insp.funcionario_nome,
    funcionario_cargo: insp.funcionario_cargo,
    equipe_id: insp.equipe_id,
    equipe_nome: insp.equipe_nome,
    equipe_numero: insp.equipe_numero,
    encarregado: insp.encarregado,
    veiculo: insp.veiculo,
    setor: insp.setor,
    observacoes: insp.observacoes,
    motivo_cancelamento: insp.motivo_cancelamento,
    itens,
    assinantes: detalhe.assinantes || [],
    importada_servidor: true,
    pendente_sync: false,
    sync_estado: 'sincronizada',
    sync_erro: null,
    criado_em: insp.created_at,
    atualizado_em: insp.updated_at,
  };
}

export async function salvarInspecaoServidor(detalhe) {
  const adaptada = adaptarInspecaoServidor(detalhe);
  const existente = (await dbGetAll('insp_inspecoes')).find(
    (r) => Number(r.id_servidor) === Number(adaptada.id_servidor),
  );
  if (existente?.pendente_sync) return existente;
  if (existente) {
    await dbPut('insp_inspecoes', {
      ...adaptada,
      id_local: existente.id_local,
      fotos_sincronizadas: existente.fotos_sincronizadas || [],
    });
    return { ...adaptada, id_local: existente.id_local };
  }
  await dbPut('insp_inspecoes', adaptada);
  return adaptada;
}

export async function prepararPacoteInspecoes() {
  const [resOpcoes, resLista] = await Promise.all([
    apiFetch(`${API_URL}/inspecoes/opcoes`, { signal: AbortSignal.timeout(45000) }),
    apiFetch(`${API_URL}/inspecoes/?limit=${LIMITE_LISTA}`, { signal: AbortSignal.timeout(45000) }),
  ]);
  if (!resOpcoes.ok) {
    throw new Error(erroDaResposta(await resOpcoes.json().catch(() => null), 'Falha ao baixar as opções de inspeção.'));
  }
  const opcoes = await resOpcoes.json();
  await salvarOpcoesLocais(opcoes);
  if (!resLista.ok) {
    throw new Error(erroDaResposta(await resLista.json().catch(() => null), 'Falha ao baixar as inspeções.'));
  }
  const lista = await resLista.json();
  const idsServidor = new Set((lista || []).map((linha) => Number(linha.id)));
  // Poda cópias importadas que saíram da lista do servidor (sem pendência).
  for (const registro of await dbGetAll('insp_inspecoes')) {
    if (!registro.importada_servidor || registro.pendente_sync || registro.id_servidor == null) continue;
    if (idsServidor.has(Number(registro.id_servidor))) continue;
    for (const cache of await dbGetAll('insp_fotos_cache')) {
      if (String(cache.chave).startsWith(`${registro.id_servidor}:`)) {
        const url = _urlsCache.get(cache.chave);
        if (url) {
          _urlsCache.delete(cache.chave);
          try { URL.revokeObjectURL(url); } catch { /* noop */ }
        }
        await dbDel('insp_fotos_cache', cache.chave);
      }
    }
    await dbDel('insp_inspecoes', registro.id_local);
  }
  let importadas = 0;
  for (const linha of (lista || []).slice(0, LIMITE_LISTA)) {
    if (linha?.id == null) continue;
    try {
      const res = await apiFetch(`${API_URL}/inspecoes/${linha.id}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) continue;
      const detalhe = await res.json();
      await salvarInspecaoServidor(detalhe);
      await _cachearFotosDoDetalhe(detalhe);
      importadas += 1;
    } catch {
      /* segue para a próxima; o pacote é best-effort */
    }
  }
  await dbPut('meta', {
    chave: 'insp_pacote',
    preparado_em: new Date().toISOString(),
    quantidade: importadas,
  });
  return { quantidade: importadas, opcoes };
}

// ---------------------------------------------------------------------------
// Inspeções locais
// ---------------------------------------------------------------------------

export async function listarFotosLocaisDaInspecao(idLocal) {
  const fotos = await dbGetAll('insp_fotos');
  return fotos
    .filter((f) => f.inspecao_id_local === idLocal)
    .sort((a, b) => String(a.criado_em || '').localeCompare(String(b.criado_em || '')));
}

async function _inspecaoCompletaLocal(registro) {
  const fotos = await listarFotosLocaisDaInspecao(registro.id_local);
  const cache = await dbGetAll('insp_fotos_cache').catch(() => []);
  const cachePorChave = new Map(cache.map((c) => [c.chave, c]));
  const fotosPorClassificacao = new Map();
  for (const foto of fotos) {
    const entrada = {
      ...foto,
      pendente: foto.status !== 'enviada',
      url_temporaria: _urlFotoLocal(foto),
    };
    const lista = fotosPorClassificacao.get(foto.classificacao) || [];
    lista.push(entrada);
    fotosPorClassificacao.set(foto.classificacao, lista);
  }
  const itens = (registro.itens || []).map((item) => {
    const locais = fotosPorClassificacao.get(item.classificacao) || [];
    const servidor = (item.fotos || []).map((foto) => {
      const cached = foto.cache_key ? cachePorChave.get(foto.cache_key) : null;
      return { ...foto, url_cache: cached ? _urlFotoCache(cached) : '' };
    });
    return { ...item, fotos: [...servidor, ...locais] };
  });
  return { ...registro, itens };
}

export async function obterInspecaoLocal(idLocal) {
  const registro = await dbGet('insp_inspecoes', idLocal);
  if (!registro) return null;
  return _inspecaoCompletaLocal(registro);
}

export async function listarInspecoesLocais() {
  const [registros, fotos] = await Promise.all([dbGetAll('insp_inspecoes'), dbGetAll('insp_fotos')]);
  const pendentesPorInsp = new Map();
  for (const foto of fotos) {
    if (foto.inspecao_id_local) {
      pendentesPorInsp.set(
        foto.inspecao_id_local,
        (pendentesPorInsp.get(foto.inspecao_id_local) || 0) + (foto.status === 'enviada' ? 0 : 1),
      );
    }
  }
  return registros
    .map((registro) => ({
      ...registro,
      fotos_pendentes: pendentesPorInsp.get(registro.id_local) || 0,
    }))
    .sort((a, b) => String(b.data_inspecao || b.criado_em || '').localeCompare(String(a.data_inspecao || a.criado_em || '')));
}

export async function criarInspecaoLocal(form) {
  const modelo = form.modelo;
  if (!modelo) throw new Error('Selecione o tipo de inspeção.');
  const itensModelo = (modelo.itens || [])
    .filter((item) => item.ativo !== false)
    .sort((a, b) => (a.grupo_ordem || 0) - (b.grupo_ordem || 0) || (a.ordem || 0) - (b.ordem || 0));
  if (!itensModelo.length) throw new Error('O modelo selecionado não possui itens ativos.');
  const agora = new Date();
  const idLocal = novoId('insp');
  const equipe = form.equipe || null;
  const assinantes = (form.assinantes || []).map((a, indice) => ({
    funcionario_id: a.funcionario_id ?? null,
    nome: a.nome,
    cargo: a.cargo || null,
    ordem: indice + 1,
  }));
  const registro = {
    id_local: idLocal,
    id_servidor: null,
    codigo: null,
    usuario_id: form.usuarioId ?? null,
    status: 'rascunho',
    sync_estado: 'pendente',
    pendente_sync: true,
    sync_erro: null,
    atividade_id: form.atividade?.id ?? modelo.atividade_id,
    atividade_nome: form.atividade?.nome || '',
    modelo_id: modelo.id,
    modelo_nome: modelo.nome,
    tipo_resposta: modelo.tipo_resposta || TIPO_RESPOSTA_PADRAO,
    tipo_servico: (form.tipo_servico || modelo.tipo_servico || '').trim() || null,
    obra_id: form.obra?.id ?? null,
    obra_nome: _nomeObra(form.obra),
    local_inspecao: form.local_inspecao,
    data_inspecao: form.data_inspecao || dataLocalISO(agora),
    iniciada_em: agora.toISOString(),
    inspetor_nome: form.inspetor_nome,
    funcionario_id: form.funcionario?.id ?? null,
    funcionario_nome: form.funcionario?.nome || null,
    funcionario_cargo: form.funcionario?.cargo || null,
    equipe_id: equipe?.id ?? null,
    equipe_nome: equipe?.nome || null,
    equipe_numero: equipe?.numero || null,
    encarregado: form.encarregado || null,
    veiculo: form.veiculo || null,
    setor: form.setor || null,
    observacoes: form.observacoes || null,
    itens: itensModelo.map((item) => ({
      item_local_id: novoId('item'),
      modelo_item_id: item.id ?? null,
      grupo_ordem: item.grupo_ordem || 1,
      grupo_nome: item.grupo_nome || 'Checklist',
      ordem: item.ordem || 1,
      classificacao: item.classificacao,
      pergunta: item.pergunta,
      exige_foto: !!item.exige_foto,
      resposta: null,
      observacao: null,
      geolocalizacao: null,
      fotos: [],
    })),
    assinantes,
    criado_em: agora.toISOString(),
    atualizado_em: agora.toISOString(),
  };
  await dbPut('insp_inspecoes', registro);
  return registro;
}

export async function atualizarMetadadosLocal(idLocal, campos) {
  const registro = await dbGet('insp_inspecoes', idLocal);
  if (!registro) throw new Error('Inspeção local não encontrada.');
  if (registro.status !== 'rascunho') throw new Error('A inspeção já foi encerrada.');
  const atualizado = {
    ...registro,
    ...campos,
    pendente_sync: true,
    sync_estado: 'pendente',
    atualizado_em: new Date().toISOString(),
  };
  await dbPut('insp_inspecoes', atualizado);
  return atualizado;
}

export async function salvarRespostaLocal(idLocal, classificacao, resposta, observacao, geolocalizacao) {
  const registro = await dbGet('insp_inspecoes', idLocal);
  if (!registro) throw new Error('Inspeção local não encontrada.');
  if (registro.status !== 'rascunho') throw new Error('A inspeção já foi encerrada.');
  const tipo = registro.tipo_resposta || TIPO_RESPOSTA_PADRAO;
  if (!RESPOSTAS_POR_TIPO[tipo]?.includes(resposta)) {
    throw new Error(`Resposta inválida para o formato ${tipo}.`);
  }
  const itens = (registro.itens || []).map((item) =>
    item.classificacao === classificacao
      ? {
          ...item,
          resposta,
          observacao: observacao || null,
          geolocalizacao: geolocalizacao || item.geolocalizacao || null,
        }
      : item,
  );
  await dbPut('insp_inspecoes', {
    ...registro,
    itens,
    pendente_sync: true,
    sync_estado: 'pendente',
    atualizado_em: new Date().toISOString(),
  });
}

export async function registrarFotoLocal({ idLocal, classificacao, arquivo, capturado_em, geolocalizacao }) {
  const registro = await dbGet('insp_inspecoes', idLocal);
  if (!registro) throw new Error('Inspeção local não encontrada.');
  if (registro.status !== 'rascunho') throw new Error('A inspeção já foi encerrada.');
  const foto = {
    id_local: novoId('foto'),
    inspecao_id_local: idLocal,
    classificacao,
    arquivo: {
      nome: arquivo?.name || 'foto.jpg',
      tipo: arquivo?.type || 'image/jpeg',
      blob: arquivo,
    },
    capturado_em: capturado_em || new Date().toISOString(),
    geolocalizacao: geolocalizacao || null,
    status: 'pendente',
    id_servidor: null,
    erro: null,
    tentativas: 0,
    criado_em: new Date().toISOString(),
  };
  await dbPut('insp_fotos', foto);
  await dbPut('insp_inspecoes', {
    ...registro,
    pendente_sync: true,
    sync_estado: 'pendente',
    atualizado_em: new Date().toISOString(),
  });
  return { ...foto, url_temporaria: _urlFotoLocal(foto), pendente: true };
}

export async function removerFotoLocal(idFoto) {
  const foto = await dbGet('insp_fotos', idFoto);
  if (!foto) return;
  _revogarFotoLocal(idFoto);
  await dbDel('insp_fotos', idFoto);
}

export function pendenciasLocais(registro) {
  const tipo = registro.tipo_resposta || TIPO_RESPOSTA_PADRAO;
  const pendencias = [];
  for (const item of registro.itens || []) {
    const rotulo = `${item.classificacao} ${item.pergunta}`.trim();
    if (!item.resposta) {
      pendencias.push(`${rotulo}: sem resposta`);
      continue;
    }
    if (
      tipo === 'conforme_nao_conforme_na'
      && item.resposta === 'nao_conforme'
      && !(item.observacao || '').trim()
    ) {
      pendencias.push(`${rotulo}: observação obrigatória para Não Conforme`);
    }
    if (item.exige_foto && item.resposta !== 'na' && !(item.fotos || []).length) {
      pendencias.push(`${rotulo}: foto obrigatória`);
    }
  }
  return pendencias;
}

export async function finalizarInspecaoLocal(idLocal) {
  const completa = await obterInspecaoLocal(idLocal);
  if (!completa) throw new Error('Inspeção local não encontrada.');
  if (completa.status !== 'rascunho') return completa;
  const pendencias = pendenciasLocais(completa);
  if (pendencias.length) {
    throw new Error(`Checklist incompleto: ${pendencias.slice(0, 6).join('; ')}`);
  }
  const atualizado = {
    ...completa,
    status: 'concluida',
    finalizada_em: new Date().toISOString(),
    pendente_sync: true,
    sync_estado: 'pendente',
    atualizado_em: new Date().toISOString(),
  };
  // Remove as fotos hidratadas (URLs de objeto) antes de gravar o registro.
  delete atualizado.fotos_sincronizadas;
  await dbPut('insp_inspecoes', {
    ...atualizado,
    itens: (completa.itens || []).map((item) => ({
      ...item,
      fotos: (item.fotos || [])
        .filter((f) => f.id_servidor)
        .map(({ url_temporaria, url_cache, ...foto }) => foto),
    })),
  });
  return atualizado;
}

async function _removerInspecaoLocal(idLocal) {
  for (const foto of await listarFotosLocaisDaInspecao(idLocal)) {
    _revogarFotoLocal(foto.id_local);
    await dbDel('insp_fotos', foto.id_local);
  }
  await dbDel('insp_inspecoes', idLocal);
}

async function _removerCacheFotosDaInspecao(idServidor) {
  const prefixo = `${idServidor}:`;
  for (const cache of await dbGetAll('insp_fotos_cache').catch(() => [])) {
    if (!String(cache.chave).startsWith(prefixo)) continue;
    const url = _urlsCache.get(cache.chave);
    if (url) {
      _urlsCache.delete(cache.chave);
      try { URL.revokeObjectURL(url); } catch { /* noop */ }
    }
    await dbDel('insp_fotos_cache', cache.chave);
  }
}

export async function excluirInspecaoLocal(idLocal) {
  const registro = await dbGet('insp_inspecoes', idLocal);
  if (!registro) return;
  if (registro.id_servidor) {
    throw new Error('Esta inspeção já existe no servidor. Exclua-a online.');
  }
  await _removerInspecaoLocal(idLocal);
}

/** Remove a cópia local (e evidências/cache) de uma inspeção já excluída no servidor. */
export async function removerInspecaoLocalPorServidor(idServidor) {
  if (idServidor == null) return;
  const chave = String(idServidor);
  for (const registro of await dbGetAll('insp_inspecoes')) {
    if (String(registro.id_servidor ?? '') !== chave) continue;
    await _removerInspecaoLocal(registro.id_local);
  }
  await _removerCacheFotosDaInspecao(chave);
}

export async function resumoDadosLocaisInspecoes() {
  const [registros, fotos] = await Promise.all([dbGetAll('insp_inspecoes'), dbGetAll('insp_fotos')]);
  return { inspecoes: registros.length, fotos: fotos.length };
}

/** Há inspeções criadas localmente por outro usuário neste aparelho? */
export async function haInspecoesDeOutroUsuario(usuarioId) {
  if (usuarioId == null) return false;
  const registros = await dbGetAll('insp_inspecoes');
  return registros.some(
    (registro) =>
      !registro.importada_servidor
      && registro.usuario_id != null
      && String(registro.usuario_id) !== String(usuarioId),
  );
}

export async function contarPendentesInspecoes() {
  const [registros, fotos] = await Promise.all([dbGetAll('insp_inspecoes'), dbGetAll('insp_fotos')]);
  const inspPendentes = registros.filter((r) => r.pendente_sync || r.sync_erro || r.status === 'concluida' && !r.id_servidor);
  const fotosPendentes = fotos.filter((f) => f.status !== 'enviada');
  const revisao = registros.filter((r) => r.sync_erro).length + fotos.filter((f) => f.erro).length;
  return {
    inspecoes: inspPendentes.length,
    fotos: fotosPendentes.length,
    total: inspPendentes.length + fotosPendentes.length,
    revisao,
  };
}

export async function listarPendentesInspecoes() {
  const [registros, fotos] = await Promise.all([dbGetAll('insp_inspecoes'), dbGetAll('insp_fotos')]);
  return {
    inspecoes: registros.filter((r) => r.pendente_sync || r.sync_erro || (r.status === 'concluida' && !r.id_servidor)),
    fotos: fotos.filter((f) => f.status !== 'enviada'),
  };
}

export async function descartarPendenciaInspecao(tipo, id) {
  if (tipo === 'foto') {
    await removerFotoLocal(id);
    return;
  }
  const registro = await dbGet('insp_inspecoes', id);
  if (!registro) return;
  if (!registro.id_servidor) {
    await excluirInspecaoLocal(id);
    return;
  }
  await dbPut('insp_inspecoes', {
    ...registro,
    pendente_sync: false,
    sync_estado: 'sincronizada',
    sync_erro: null,
  });
}

export async function salvarErroSync(idLocal, erro) {
  const registro = await dbGet('insp_inspecoes', idLocal);
  if (!registro) return;
  await dbPut('insp_inspecoes', {
    ...registro,
    pendente_sync: true,
    sync_estado: 'erro',
    sync_erro: erro,
  });
}

export async function marcarInspecaoSincronizada(idLocal, { idServidor, codigo, manterPendente = false } = {}) {
  const registro = await dbGet('insp_inspecoes', idLocal);
  if (!registro) return;
  await dbPut('insp_inspecoes', {
    ...registro,
    id_servidor: idServidor || registro.id_servidor,
    codigo: codigo || registro.codigo,
    ...(manterPendente
      ? {}
      : {
          pendente_sync: false,
          sync_estado: 'sincronizada',
          sync_erro: null,
          atualizado_em: new Date().toISOString(),
        }),
  });
}

export async function marcarFotosDoItemSincronizadas(idLocal, mapa) {
  const registro = await dbGet('insp_inspecoes', idLocal);
  if (!registro) return;
  const fotos = (registro.itens || []).map((item) => ({
    ...item,
    fotos: (item.fotos || []).map((foto) => {
      const novo = mapa[foto.id_local];
      return novo ? { ...foto, id_servidor: novo, pendente: false } : foto;
    }),
  }));
  await dbPut('insp_inspecoes', { ...registro, itens: fotos });
}

export async function dispositivoAtual() {
  return dispositivoId();
}

export async function marcarFotoEnviada(idLocal, idServidor) {
  const foto = await dbGet('insp_fotos', idLocal);
  if (!foto) return;
  await dbPut('insp_fotos', {
    ...foto,
    status: 'enviada',
    id_servidor: idServidor,
    erro: null,
    tentativas: 0,
  });
}

export async function marcarFotoErro(idLocal, erro, conflito = false) {
  const foto = await dbGet('insp_fotos', idLocal);
  if (!foto) return;
  await dbPut('insp_fotos', {
    ...foto,
    status: 'erro',
    erro,
    classificacao_conflito: conflito ? 'conflito' : null,
    tentativas: (foto.tentativas || 0) + 1,
  });
}

export { LABEL_RESPOSTA };
