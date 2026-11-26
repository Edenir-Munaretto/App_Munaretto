// Motor de sincronização do módulo Inspeções.
//
// Para cada inspeção local pendente:
//   1. cria no servidor (idempotente por dispositivo + id_local);
//   2. envia as respostas/metadados atuais (salvar_inspecao);
//   3. sobe as fotos pendentes (idempotentes por id_local);
//   4. finaliza no servidor quando o status local é "concluida".
//
// Falhas de rede mantêm tudo no dispositivo; conflitos 4xx ficam registrados
// na inspeção/foto para revisão no modal de pendências.

import { API_URL, apiFetch, erroDaResposta } from '../api';
import { dbGet, dbGetAll } from './db';
import { dispositivoId } from './offline';
import { ehConflito } from './sync';
import {
  marcarFotoEnviada,
  marcarFotoErro,
  marcarInspecaoSincronizada,
  salvarErroSync,
} from './inspecoes';

let sincronizacaoEmAndamento = null;

function novoId(prefixo) {
  const aleatorio =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefixo}-${aleatorio}`;
}

function payloadCriacao(registro) {
  return {
    atividade_id: registro.atividade_id,
    modelo_id: registro.modelo_id,
    tipo_resposta: registro.tipo_resposta || 'conforme_nao_conforme_na',
    tipo_servico: registro.tipo_servico || null,
    obra_id: registro.obra_id,
    funcionario_id: registro.funcionario_id,
    equipe_id: registro.equipe_id,
    encarregado: registro.encarregado,
    veiculo: registro.veiculo,
    setor: registro.setor,
    local_inspecao: registro.local_inspecao,
    data_inspecao: registro.data_inspecao,
    iniciada_em: registro.iniciada_em,
    inspetor_nome: registro.inspetor_nome,
    observacoes: registro.observacoes,
    assinantes: (registro.assinantes || []).map((a) => ({
      funcionario_id: a.funcionario_id,
      nome: a.nome,
      cargo: a.cargo,
      ordem: a.ordem,
    })),
    itens: (registro.itens || []).map((item) => ({
      item_local_id: item.item_local_id,
      modelo_item_id: item.modelo_item_id,
      grupo_ordem: item.grupo_ordem,
      grupo_nome: item.grupo_nome,
      ordem: item.ordem,
      classificacao: item.classificacao,
      pergunta: item.pergunta,
      exige_foto: !!item.exige_foto,
      resposta: item.resposta || null,
      observacao: item.observacao || null,
      geolocalizacao: item.geolocalizacao || null,
    })),
  };
}

function payloadSalvar(registro) {
  return {
    local_inspecao: registro.local_inspecao,
    observacoes: registro.observacoes,
    encarregado: registro.encarregado,
    veiculo: registro.veiculo,
    setor: registro.setor,
    tipo_servico: registro.tipo_servico || null,
    inspetor_nome: registro.inspetor_nome,
    itens: (registro.itens || [])
      .filter((item) => item.resposta)
      .map((item) => ({
        classificacao: item.classificacao,
        resposta: item.resposta,
        observacao: item.observacao || null,
        geolocalizacao: item.geolocalizacao || null,
      })),
  };
}

async function enviarOperacao(operacao, dispositivo) {
  const res = await apiFetch(`${API_URL}/inspecoes/sincronizar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ operacoes: [operacao], dispositivo }),
  });
  const dados = await res.json().catch(() => null);
  if (res.status === 401) {
    const erro = new Error('Sessão expirada durante a sincronização.');
    erro.status = 401;
    throw erro;
  }
  if (!res.ok || !dados?.resultados?.[0]) {
    const erro = new Error(erroDaResposta(dados, 'Falha ao sincronizar a inspeção.'));
    erro.status = res.status;
    throw erro;
  }
  return dados.resultados[0];
}

async function enviarFoto(foto, inspecaoServidorId, dispositivo) {
  const fd = new FormData();
  fd.append('arquivo', foto.arquivo.blob, foto.arquivo.nome);
  fd.append('classificacao', foto.classificacao);
  fd.append('id_local', String(foto.id_local));
  fd.append('dispositivo', String(dispositivo));
  if (foto.capturado_em) fd.append('capturado_em', String(foto.capturado_em));
  if (foto.geolocalizacao) fd.append('geolocalizacao', String(foto.geolocalizacao));
  const res = await apiFetch(`${API_URL}/inspecoes/${inspecaoServidorId}/fotos`, {
    method: 'POST',
    body: fd,
    signal: AbortSignal.timeout(60000),
  });
  const dados = await res.json().catch(() => null);
  if (res.status === 401) {
    const erro = new Error('Sessão expirada durante o envio da foto.');
    erro.status = 401;
    throw erro;
  }
  if (res.ok && dados?.id) return { ok: true, id: dados.id };
  return {
    ok: false,
    status: res.status,
    erro: erroDaResposta(dados, 'Erro no envio da foto.'),
    conflito: ehConflito(res.status, erroDaResposta(dados, 'Erro no envio da foto.')),
  };
}

async function processarInspecao(registroInicial, dispositivo, resumo, onProgress) {
  let registro = registroInicial;
  let idServidor = registro.id_servidor;
  const versaoInicial = registroInicial.atualizado_em;

  if (!idServidor) {
    try {
      const resultado = await enviarOperacao(
        {
          id_local: registro.id_local,
          tipo: 'criar_inspecao',
          criado_em: registro.criado_em,
          payload: payloadCriacao(registro),
        },
        dispositivo,
      );
      if (!resultado.ok) {
        resumo.falhas.push({ tipo: 'inspecao', id_local: registro.id_local, erro: resultado.erro });
        if (resultado.status >= 400 && resultado.status < 500) {
          resumo.conflitos.push({ tipo: 'inspecao', id_local: registro.id_local, erro: resultado.erro });
        }
        await salvarErroSync(registro.id_local, resultado.erro || 'Erro ao criar a inspeção.');
        onProgress?.(resumo);
        return;
      }
      idServidor = resultado.inspecao_id;
      // Mantém pendente até o fim desta execução: se o técnico continuar
      // editando durante o envio, a próxima sincronização não perde a mudança.
      await marcarInspecaoSincronizada(registro.id_local, {
        idServidor,
        codigo: resultado.codigo,
        manterPendente: true,
      });
      resumo.inspecoes += 1;
      registro = (await dbGet('insp_inspecoes', registro.id_local)) || { ...registro, id_servidor: idServidor };
      onProgress?.(resumo);
    } catch (erro) {
      if (erro.status === 401) throw erro;
      resumo.falhas.push({ tipo: 'inspecao', id_local: registro.id_local, erro: erro.message });
      await salvarErroSync(registro.id_local, erro.message || 'Erro de conexão ao criar a inspeção.');
      return;
    }
  } else if (registro.pendente_sync) {
    // Importante: envia as respostas ANTES da finalização, mesmo quando a
    // inspeção já está concluída localmente. Isso cobre o caso em que a
    // inspeção foi criada no servidor por um sync anterior e só depois foi
    // preenchida/finalizada no dispositivo.
    try {
      const resultado = await enviarOperacao(
        {
          id_local: `estado-${registro.id_local}-${novoId('s')}`,
          tipo: 'salvar_inspecao',
          inspecao_id: idServidor,
          payload: payloadSalvar(registro),
        },
        dispositivo,
      );
      if (!resultado.ok) {
        const conflito = resultado.status >= 400 && resultado.status < 500;
        resumo.falhas.push({ tipo: 'inspecao', id_local: registro.id_local, erro: resultado.erro });
        if (conflito) resumo.conflitos.push({ tipo: 'inspecao', id_local: registro.id_local, erro: resultado.erro });
        await salvarErroSync(registro.id_local, resultado.erro || 'Erro ao salvar a inspeção.');
        return;
      }
    } catch (erro) {
      if (erro.status === 401) throw erro;
      resumo.falhas.push({ tipo: 'inspecao', id_local: registro.id_local, erro: erro.message });
      await salvarErroSync(registro.id_local, erro.message || 'Erro de conexão ao salvar a inspeção.');
      return;
    }
  }

  // Fotos pendentes desta inspeção.
  const fotos = (await dbGetAll('insp_fotos')).filter(
    (foto) => foto.inspecao_id_local === registro.id_local && foto.status !== 'enviada',
  );
  let falhaFotos = false;
  for (const foto of fotos) {
    try {
      const enviada = await enviarFoto(foto, idServidor, dispositivo);
      if (enviada.ok) {
        await marcarFotoEnviada(foto.id_local, enviada.id);
        resumo.fotos += 1;
      } else {
        falhaFotos = true;
        resumo.falhas.push({ tipo: 'foto', id_local: foto.id_local, erro: enviada.erro });
        if (enviada.conflito) {
          resumo.conflitos.push({ tipo: 'foto', id_local: foto.id_local, erro: enviada.erro });
        }
        await marcarFotoErro(foto.id_local, enviada.erro, enviada.conflito);
      }
    } catch (erro) {
      if (erro.status === 401) throw erro;
      falhaFotos = true;
      resumo.falhas.push({ tipo: 'foto', id_local: foto.id_local, erro: erro.message });
      await marcarFotoErro(foto.id_local, erro.message || 'Erro de conexão.');
      return;
    }
    onProgress?.(resumo);
  }

  const restantes = (await dbGetAll('insp_fotos')).filter(
    (foto) => foto.inspecao_id_local === registro.id_local && foto.status !== 'enviada',
  );
  if (falhaFotos || restantes.length) return;

  if (registro.status === 'concluida') {
    try {
      const resultado = await enviarOperacao(
        {
          id_local: `final-${registro.id_local}-${novoId('f')}`,
          tipo: 'finalizar_inspecao',
          inspecao_id: idServidor,
        },
        dispositivo,
      );
      if (!resultado.ok) {
        const conflito = resultado.status >= 400 && resultado.status < 500;
        resumo.falhas.push({ tipo: 'inspecao', id_local: registro.id_local, erro: resultado.erro });
        if (conflito) resumo.conflitos.push({ tipo: 'inspecao', id_local: registro.id_local, erro: resultado.erro });
        await salvarErroSync(registro.id_local, resultado.erro || 'Erro ao finalizar a inspeção.');
        return;
      }
    } catch (erro) {
      if (erro.status === 401) throw erro;
      resumo.falhas.push({ tipo: 'inspecao', id_local: registro.id_local, erro: erro.message });
      await salvarErroSync(registro.id_local, erro.message || 'Erro de conexão ao finalizar a inspeção.');
      return;
    }
  }

  // Se o registro mudou durante a sincronização, mantém a pendência para o
  // próximo envio (a edição do técnico nunca é engolida pelo sync).
  const atual = await dbGet('insp_inspecoes', registro.id_local);
  const mudou = Boolean(
    atual?.atualizado_em && versaoInicial && atual.atualizado_em !== versaoInicial,
  );
  await marcarInspecaoSincronizada(registro.id_local, { idServidor, manterPendente: mudou });
  onProgress?.(resumo);
}

async function _executar(onProgress) {
  const resumo = {
    inspecoes: 0,
    fotos: 0,
    falhas: [],
    conflitos: [],
  };
  const dispositivo = await dispositivoId();
  const [registros, fotos] = await Promise.all([
    dbGetAll('insp_inspecoes'),
    dbGetAll('insp_fotos'),
  ]);
  const ids = new Set();
  for (const registro of registros) {
    if (registro.status === 'cancelada') continue;
    if (registro.pendente_sync || registro.sync_erro || !registro.id_servidor) ids.add(registro.id_local);
  }
  for (const foto of fotos) {
    if (foto.status !== 'enviada' && foto.inspecao_id_local) ids.add(foto.inspecao_id_local);
  }
  for (const idLocal of ids) {
    const registro = registros.find((r) => r.id_local === idLocal) || (await dbGet('insp_inspecoes', idLocal));
    if (!registro) continue;
    await processarInspecao(registro, dispositivo, resumo, onProgress);
  }
  return resumo;
}

export async function sincronizarInspecoes(onProgress) {
  if (sincronizacaoEmAndamento) return sincronizacaoEmAndamento;
  sincronizacaoEmAndamento = (async () => {
    try {
      return await _executar(onProgress);
    } finally {
      sincronizacaoEmAndamento = null;
    }
  })();
  return sincronizacaoEmAndamento;
}
