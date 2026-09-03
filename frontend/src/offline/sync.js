// Motor de sincronização do Modo Campo.
//
// Ordem de envio:
//   1. FOTOS pendentes (uma a uma, via endpoint de foto do checklist);
//      cada upload devolve o id no servidor -> monta o mapa id_local->id.
//   2. OPERAÇÕES pendentes em lote (POST /api/os/sincronizar) com o mapa de
//      fotos para operações que referenciam evidências locais (impedida).
//
// Cada item com falha permanece na fila marcado com o erro do servidor para
// revisão/reenvio; itens OK saem da fila.

import { API_URL, apiFetch, erroDaResposta } from '../api';
import { dbDel, dbGetAll, dbPut } from './db';
import { contarPendentes } from './offline';

// `seletor` (opcional) restringe o envio a itens específicos — usado no
// reenvio individual da tela de pendências:
//   { fotos: [id_local, ...], operacoes: [id_local, ...] }
// `apenasNovos` (usado na sincronização AUTOMÁTICA) pula itens que já
// falharam 3+ vezes — eles ficam na fila para revisão/reenvio manual ou no
// "Finalizar Modo Campo" (que envia tudo).
export async function sincronizar(onProgress, seletor = null, apenasNovos = false) {
  const resumo = {
    fotosEnviadas: 0,
    operacoesEnviadas: 0,
    falhas: [],
    conflitos: [],
    descartados: 0,
  };
  const mapaFotos = {};

  // 1) Fotos pendentes (filtradas pelo seletor, se informado)
  let fotos = await dbGetAll('fotos');
  if (seletor?.fotos?.length) {
    fotos = fotos.filter(f => seletor.fotos.includes(f.id_local));
  }
  for (const foto of fotos) {
    if (apenasNovos && (foto.tentativas || 0) >= 3) continue;
    try {
      const fd = new FormData();
      fd.append('arquivo', foto.arquivo.blob, foto.arquivo.nome);
      const qs = foto.geolocalizacao ? `?geolocalizacao=${encodeURIComponent(foto.geolocalizacao)}` : '';
      // Evidências de item do checklist usam o endpoint do item; as do
      // impedimento (sem item) usam o endpoint genérico de fotos da O.S.
      const url = foto.checklist_item_id
        ? `${API_URL}/os/${foto.os_id}/checklist/${foto.checklist_item_id}/foto${qs}`
        : `${API_URL}/os/${foto.os_id}/fotos${qs}`;
      const res = await apiFetch(url, { method: 'POST', body: fd });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.id) {
        mapaFotos[foto.id_local] = data.id;
        resumo.fotosEnviadas += 1;
        await dbDel('fotos', foto.id_local);
      } else if (Number(res.status) >= 400 && Number(res.status) < 500) {
        // Rejeição PERMANENTE do servidor (ex.: O.S já finalizada — o checklist
        // não pode mais receber foto). O item jamais será aceito: remove da
        // fila e conta como descartado para não travar o finalizar.
        resumo.descartados += 1;
        await dbDel('fotos', foto.id_local);
      } else {
        const erro = erroDaResposta(data, 'Erro no envio da foto.');
        resumo.falhas.push({ id_local: foto.id_local, tipo: 'foto', erro });
        await dbPut('fotos', { ...foto, status: 'erro', erro, tentativas: (foto.tentativas || 0) + 1 });
      }
    } catch {
      const erro = 'Sem conexão durante o envio da foto.';
      resumo.falhas.push({ id_local: foto.id_local, tipo: 'foto', erro });
      await dbPut('fotos', { ...foto, status: 'erro', erro, tentativas: (foto.tentativas || 0) + 1 });
      onProgress?.(resumo);
      return resumo; // sem internet: interrompe e aguarda nova tentativa
    }
    onProgress?.(resumo);
  }

  // 2) Operações pendentes (lote), filtradas pelo seletor quando informado
  let ops = await dbGetAll('fila');
  if (seletor?.operacoes?.length) {
    ops = ops.filter(op => seletor.operacoes.includes(op.id_local));
  }
  if (apenasNovos) {
    ops = ops.filter(op => (op.tentativas || 0) < 3);
  }
  if (ops.length) {
    try {
      const res = await apiFetch(`${API_URL}/os/sincronizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacoes: ops.map(op => ({
            id_local: op.id_local,
            tipo: op.tipo,
            os_id: op.os_id,
            criado_em: op.criado_em,
            payload: op.payload,
          })),
          mapa_fotos: mapaFotos,
        }),
      });
      const dados = await res.json().catch(() => null);
      if (!res.ok || !dados?.resultados) {
        throw new Error(erroDaResposta(dados, 'Falha ao sincronizar operações.'));
      }
      for (const r of dados.resultados) {
        if (r.ok) {
          resumo.operacoesEnviadas += 1;
          await dbDel('fila', r.id_local);
        } else if (Number(r.status) >= 400 && Number(r.status) < 500) {
          // Rejeição PERMANENTE do servidor (ex.: checklist de O.S já
          // finalizada — "não pode ser alterado"). Não adianta manter na
          // fila: descarta e conta para o usuário não ficar travado.
          resumo.descartados += 1;
          await dbDel('fila', r.id_local);
        } else {
          const falha = { id_local: r.id_local, tipo: 'operacao', erro: r.erro || 'Erro ao aplicar operação.' };
          resumo.falhas.push(falha);
          if (r.status === 409 || r.status === 422) resumo.conflitos.push(falha);
          await dbPut('fila', {
            ...ops.find(op => op.id_local === r.id_local),
            status: 'erro',
            erro: falha.erro,
            tentativas: (ops.find(op => op.id_local === r.id_local)?.tentativas || 0) + 1,
          });
        }
      }
    } catch (e) {
      resumo.falhas.push({ id_local: 'lote', tipo: 'operacao', erro: e.message || 'Erro de conexão.' });
      return resumo;
    }
  }

  return resumo;
}

/** Remove do dispositivo o que foi sincronizado com sucesso (limpeza). */
export async function pendentes() {
  return contarPendentes();
}
