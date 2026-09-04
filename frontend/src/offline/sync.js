// Motor de sincronização do Modo Campo.
//
// Ordem de envio:
//   1. FOTOS pendentes (uma a uma, via endpoint de foto do checklist);
//      cada upload devolve o id no servidor. Fotos de item do checklist saem
//      da fila assim que sobem; fotos de IMPEDIMENTO (que operações de status
//      referenciam em fotos_ids) são mantidas com `id_servidor` até as
//      operações que as usam saírem da fila — o lote nunca chega sem o mapa.
//   2. OPERAÇÕES pendentes em LOTE de até TAMANHO_LOTE por requisição
//      (POST /api/os/sincronizar) com o mapa de fotos e o id do dispositivo.
//      O servidor deduplica por (dispositivo, id_local): se a resposta de um
//      lote se perder, o reenvio devolve a resposta já gravada (idempotente).
//
// Cada item com falha DEFINITIVA (4xx) permanece na fila marcado como
// `classificacao: 'conflito'` para revisão/descarte consciente; falhas de
// rede ou 5xx ficam apenas como `erro` e são reenviadas na próxima tentativa.

import { API_URL, apiFetch, erroDaResposta } from '../api';
import { dbDel, dbGetAll, dbPut } from './db';
import { contarPendentes, dispositivoId } from './offline';

const TAMANHO_LOTE = 200;

function ehConflito(status) {
  return status === 400 || status === 409 || status === 422;
}

// 1) Fotos pendentes (filtradas pelo seletor, se informado).
async function enviarFotos(fotos, resumo, mapaFotos, onProgress) {
  for (const foto of fotos) {
    try {
      // Foto que já subiu numa execução anterior (id_servidor persistido):
      // reaproveita o mapeamento sem reenviar o arquivo.
      if (foto.status === 'enviada' && foto.id_servidor) {
        mapaFotos[foto.id_local] = foto.id_servidor;
        resumo.fotosEnviadas += 1;
        onProgress?.(resumo);
        continue;
      }
      const fd = new FormData();
      fd.append('arquivo', foto.arquivo.blob, foto.arquivo.nome);
      const qs = foto.geolocalizacao ? `?geolocalizacao=${encodeURIComponent(foto.geolocalizacao)}` : '';
      // Evidências de item do checklist usam o endpoint do item; as do
      // impedimento (sem item) usam o endpoint genérico de fotos da O.S.
      const url = foto.checklist_item_id
        ? `${API_URL}/os/${foto.os_id}/checklist/${foto.checklist_item_id}/foto${qs}`
        : `${API_URL}/os/${foto.os_id}/fotos${qs}`;
      const res = await apiFetch(url, { method: 'POST', body: fd, signal: AbortSignal.timeout(60000) });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.id) {
        mapaFotos[foto.id_local] = data.id;
        resumo.fotosEnviadas += 1;
        if (foto.checklist_item_id == null) {
          // Impedimento: mantém o registro com o id do servidor até a(s)
          // operação(ões) que referenciam esta evidência serem confirmadas.
          await dbPut('fotos', { ...foto, status: 'enviada', id_servidor: data.id, erro: null, tentativas: 0 });
        } else {
          // Foto de item: nenhuma operação a referencia — pode sair da fila.
          await dbDel('fotos', foto.id_local);
        }
      } else {
        const erro = erroDaResposta(data, 'Erro no envio da foto.');
        const conflito = ehConflito(res?.status);
        const falha = { id_local: foto.id_local, tipo: 'foto', erro };
        resumo.falhas.push(falha);
        if (conflito) resumo.conflitos.push(falha);
        await dbPut('fotos', {
          ...foto,
          status: 'erro',
          erro,
          classificacao: conflito ? 'conflito' : null,
          tentativas: (foto.tentativas || 0) + 1,
        });
      }
    } catch {
      const erro = 'Sem conexão durante o envio da foto.';
      resumo.falhas.push({ id_local: foto.id_local, tipo: 'foto', erro });
      await dbPut('fotos', {
        ...foto,
        status: 'erro',
        erro,
        classificacao: null,
        tentativas: (foto.tentativas || 0) + 1,
      });
      onProgress?.(resumo);
      return false; // sem internet: interrompe e aguarda nova tentativa
    }
    onProgress?.(resumo);
  }
  return true;
}

// 2) Operações pendentes, em lotes de até TAMANHO_LOTE (o backend rejeita
//    lotes acima de 500 — um 422 derrubaria a fila inteira sem processar).
async function enviarOperacoes(ops, mapaFotos, resumo, onProgress) {
  const dispositivo = await dispositivoId();
  for (let i = 0; i < ops.length; i += TAMANHO_LOTE) {
    const fatia = ops.slice(i, i + TAMANHO_LOTE);
    try {
      const res = await apiFetch(`${API_URL}/os/sincronizar`, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacoes: fatia.map(op => ({
            id_local: op.id_local,
            tipo: op.tipo,
            os_id: op.os_id,
            criado_em: op.criado_em,
            payload: op.payload,
          })),
          mapa_fotos: mapaFotos,
          dispositivo,
        }),
      });
      const dados = await res.json().catch(() => null);
      if (!res.ok || !dados?.resultados) {
        // Lote inteiro recusado (validação/erro): marca os itens para não
        // perdê-los e encerra os lotes seguintes desta execução.
        const erro = erroDaResposta(dados, 'Falha ao sincronizar operações.');
        for (const op of fatia) {
          resumo.falhas.push({ id_local: op.id_local, tipo: 'operacao', erro });
          await dbPut('fila', { ...op, status: 'erro', erro, tentativas: (op.tentativas || 0) + 1 });
        }
        return false;
      }
      for (const r of dados.resultados) {
        if (r.ok) {
          resumo.operacoesEnviadas += 1;
          await dbDel('fila', r.id_local);
        } else {
          const erro = r.erro || 'Erro ao aplicar operação.';
          const falha = { id_local: r.id_local, tipo: 'operacao', erro };
          resumo.falhas.push(falha);
          if (ehConflito(r.status)) resumo.conflitos.push(falha);
          const opOriginal = ops.find(op => op.id_local === r.id_local);
          await dbPut('fila', {
            ...opOriginal,
            status: 'erro',
            erro,
            classificacao: ehConflito(r.status) ? 'conflito' : null,
            tentativas: (opOriginal?.tentativas || 0) + 1,
          });
        }
      }
    } catch (e) {
      resumo.falhas.push({ id_local: 'lote', tipo: 'operacao', erro: e?.message || 'Erro de conexão.' });
      return false; // rede caiu: para os próximos lotes desta execução
    }
    onProgress?.(resumo);
  }
  return true;
}

// Remove fotos de impedimento já enviadas cuja operação saiu da fila
// (confirmada ou descartada) — não podem ficar guardadas para sempre.
async function limparFotosSemUso() {
  const [fotos, ops] = await Promise.all([dbGetAll('fotos'), dbGetAll('fila')]);
  const referenciadas = new Set(
    ops.flatMap(op => (op.payload?.fotos_ids || []).map(String)),
  );
  for (const foto of fotos) {
    if (foto.checklist_item_id == null && foto.status === 'enviada' && !referenciadas.has(String(foto.id_local))) {
      await dbDel('fotos', foto.id_local);
    }
  }
}

// `seletor` (opcional) restringe o envio a itens específicos — usado no
// reenvio individual da tela de pendências:
//   { fotos: [id_local, ...], operacoes: [id_local, ...] }
export async function sincronizar(onProgress, seletor = null) {
  const resumo = {
    fotosEnviadas: 0,
    operacoesEnviadas: 0,
    falhas: [],
    conflitos: [],
  };
  const mapaFotos = {};

  let fotos = await dbGetAll('fotos');
  if (seletor?.fotos?.length) {
    fotos = fotos.filter(f => seletor.fotos.includes(f.id_local));
  }
  const fotosOk = await enviarFotos(fotos, resumo, mapaFotos, onProgress);
  if (!fotosOk) return resumo;

  let ops = await dbGetAll('fila');
  if (seletor?.operacoes?.length) {
    ops = ops.filter(op => seletor.operacoes.includes(op.id_local));
  }
  if (ops.length) {
    const opsOk = await enviarOperacoes(ops, mapaFotos, resumo, onProgress);
    if (opsOk) await limparFotosSemUso();
  }

  return resumo;
}

/** Remove do dispositivo o que foi sincronizado com sucesso (limpeza). */
export async function pendentes() {
  return contarPendentes();
}
