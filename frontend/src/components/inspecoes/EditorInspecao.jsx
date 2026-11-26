import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Camera, CheckCircle2, XCircle, MinusCircle, FileDown,
  RefreshCw, Trash2, MapPin, Calendar, User, Users, Truck, Briefcase,
  Building2, AlertTriangle, Image as ImageIcon, CloudOff, ClipboardList,
} from 'lucide-react';
import { comprimirImagem, mimeFotoPermitido } from '../../utils/imagem';
import { dataCapturaDaFoto } from '../../utils/fotoData';
import {
  TIPO_RESPOSTA_PADRAO,
  atualizarMetadadosLocal,
  finalizarInspecaoLocal,
  obterInspecaoLocal,
  registrarFotoLocal,
  removerFotoLocal,
  salvarRespostaLocal,
} from '../../offline/inspecoes';
import {
  ROTULO_STATUS, CORES_STATUS, formatarData, formatarDataHora, capturarGeolocalizacao,
  respostasDoTipo,
} from './comum';

const ESTILO_RESPOSTA = {
  positivo: {
    ativo: 'bg-emerald-600 text-white border-emerald-600',
    inativo: 'text-emerald-700 border-emerald-200 bg-emerald-50',
  },
  negativo: {
    ativo: 'bg-rose-600 text-white border-rose-600',
    inativo: 'text-rose-700 border-rose-200 bg-rose-50',
  },
  neutro: {
    ativo: 'bg-slate-700 text-white border-slate-700',
    inativo: 'text-slate-600 border-slate-200 bg-slate-50',
  },
};

function iconeDaResposta(opcao) {
  if (opcao.valor === 'conforme' || opcao.valor === 'sim') return CheckCircle2;
  if (opcao.valor === 'nao_conforme' || opcao.valor === 'nao') return XCircle;
  return MinusCircle;
}

function InfoLinha({ icone: Icone, rotulo, valor }) {
  if (!valor) return null;
  return (
    <div className="flex items-start gap-2 min-w-0">
      <Icone size={14} className="text-slate-400 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{rotulo}</p>
        <p className="text-xs font-semibold text-slate-700 break-words">{valor}</p>
      </div>
    </div>
  );
}

function ItemChecklist({
  item,
  permitidoEditar,
  permiteObservacao,
  opcoesResposta,
  tipoResposta,
  onResposta,
  onObservacao,
  onFoto,
  onRemoverFoto,
}) {
  const [obs, setObs] = useState(item.observacao || '');
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const inputFoto = useRef(null);

  useEffect(() => {
    setObs(item.observacao || '');
  }, [item.observacao]);

  const escolherArquivo = async (evento) => {
    const arquivo = evento.target.files?.[0];
    evento.target.value = '';
    if (!arquivo) return;
    if (!mimeFotoPermitido(arquivo.type)) return;
    setEnviandoFoto(true);
    try {
      await onFoto(item, arquivo);
    } finally {
      setEnviandoFoto(false);
    }
  };

  const botoes = (opcoesResposta || []).map((opcao) => ({
    ...opcao,
    icone: iconeDaResposta(opcao),
    ...(ESTILO_RESPOSTA[opcao.tom] || ESTILO_RESPOSTA.neutro),
  }));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5 space-y-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <span className="shrink-0 rounded-lg bg-slate-900 text-white text-[10px] font-extrabold px-2 py-1">
            {tipoResposta === 'sim_nao_na' ? item.ordem : item.classificacao}
          </span>
          <p className="text-sm font-semibold text-slate-800 leading-snug">{item.pergunta}</p>
        </div>
        {item.exige_foto && (
          <span className="shrink-0 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[9px] font-extrabold px-2 py-0.5 uppercase tracking-wide">
            Foto
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {botoes.map(({ valor, rotulo, icone: Icone, ativo, inativo }) => (
          <button
            key={valor}
            type="button"
            disabled={!permitidoEditar}
            onClick={() => onResposta(item, valor, obs)}
            className={`min-h-11 rounded-xl border text-[11px] font-extrabold flex items-center justify-center gap-1 transition-all disabled:opacity-60 ${
              item.resposta === valor ? ativo : inativo
            }`}
          >
            <Icone size={14} />
            {rotulo}
          </button>
        ))}
      </div>

      {permiteObservacao && (
        <div>
          <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">
            Observação {item.resposta === 'nao_conforme' ? '(obrigatória)' : '(opcional)'}
          </label>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            onBlur={() => {
              if (permitidoEditar && obs !== (item.observacao || '')) onObservacao(item, obs);
            }}
            readOnly={!permitidoEditar}
            rows={2}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 resize-y"
            placeholder="Descreva a constatação..."
          />
        </div>
      )}

      <div className="space-y-2">
        {(item.fotos || []).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {(item.fotos || []).map((foto) => {
              const url = foto.url_temporaria || foto.url_cache;
              return (
                <div key={foto.id || foto.id_local} className="relative">
                  {url ? (
                    <img
                      src={url}
                      alt={foto.nome_original || 'Evidência'}
                      className="w-20 h-20 rounded-xl object-cover border border-slate-200"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center">
                      <ImageIcon size={20} className="text-slate-300" />
                    </div>
                  )}
                  {foto.pendente && (
                    <span className="absolute bottom-1 left-1 rounded bg-amber-500 text-white text-[8px] font-bold px-1 py-0.5">
                      pendente
                    </span>
                  )}
                  {permitidoEditar && !foto.id_servidor && (
                    <button
                      type="button"
                      onClick={() => onRemoverFoto(foto)}
                      className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-rose-600 text-white flex items-center justify-center shadow"
                      title="Remover foto"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {permitidoEditar && (
          <>
            <input
              ref={inputFoto}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={escolherArquivo}
            />
            <button
              type="button"
              onClick={() => inputFoto.current?.click()}
              disabled={enviandoFoto}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-50"
            >
              {enviandoFoto ? (
                <span className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Camera size={14} />
              )}
              Adicionar foto
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function EditorInspecao({
  inspecao,
  onFechar,
  onAtualizado,
  onSincronizar,
  onImprimir,
  onExcluir,
  podeEditar,
  sincronizando,
  mostrarToast,
}) {
  const [dados, setDados] = useState(inspecao);
  const [finalizando, setFinalizando] = useState(false);
  const [obsGeral, setObsGeral] = useState(inspecao.observacoes || '');

  const recarregar = async () => {
    const local = await obterInspecaoLocal(inspecao.id_local);
    if (local) setDados(local);
    onAtualizado?.(local || null);
  };

  useEffect(() => {
    let ativo = true;
    obterInspecaoLocal(inspecao.id_local).then((local) => {
      if (!ativo || !local) return;
      setDados(local);
      setObsGeral(local.observacoes || '');
    });
    return () => { ativo = false; };
  }, [inspecao.id_local, inspecao.atualizado_em]);

  const itens = useMemo(() => {
    const ordenados = [...(dados.itens || [])].sort(
      (a, b) => (a.grupo_ordem || 0) - (b.grupo_ordem || 0) || (a.ordem || 0) - (b.ordem || 0),
    );
    const grupos = [];
    for (const item of ordenados) {
      const chave = `${item.grupo_ordem}:${item.grupo_nome}`;
      let grupo = grupos.find((g) => g.chave === chave);
      if (!grupo) {
        grupo = { chave, ordem: item.grupo_ordem, nome: item.grupo_nome || 'Checklist', itens: [] };
        grupos.push(grupo);
      }
      grupo.itens.push(item);
    }
    return grupos;
  }, [dados.itens]);

  const total = dados.itens?.length || 0;
  const respondidos = (dados.itens || []).filter((i) => i.resposta).length;
  const naoConformes = (dados.itens || []).filter((i) => i.resposta === 'nao_conforme').length;
  const respostasNao = (dados.itens || []).filter((i) => i.resposta === 'nao').length;
  const editavel = podeEditar && dados.status === 'rascunho';
  const tipoResposta = dados.tipo_resposta || TIPO_RESPOSTA_PADRAO;
  const opcoesResposta = respostasDoTipo(tipoResposta);
  const permiteObservacaoItem = tipoResposta === 'conforme_nao_conforme_na';

  const responder = async (item, resposta, observacao) => {
    try {
      await salvarRespostaLocal(dados.id_local, item.classificacao, resposta, observacao, item.geolocalizacao);
      await recarregar();
    } catch (erro) {
      mostrarToast?.(erro.message || 'Erro ao salvar a resposta.', 'error');
    }
  };

  const salvarObservacao = async (item, observacao) => {
    if (!item.resposta) return;
    try {
      await salvarRespostaLocal(dados.id_local, item.classificacao, item.resposta, observacao, item.geolocalizacao);
      await recarregar();
    } catch (erro) {
      mostrarToast?.(erro.message || 'Erro ao salvar a observação.', 'error');
    }
  };

  const adicionarFoto = async (item, arquivo) => {
    try {
      const capturadoEm = await dataCapturaDaFoto(arquivo);
      const comprimida = await comprimirImagem(arquivo);
      const geolocalizacao = await capturarGeolocalizacao();
      await registrarFotoLocal({
        idLocal: dados.id_local,
        classificacao: item.classificacao,
        arquivo: comprimida,
        capturado_em: capturadoEm,
        geolocalizacao,
      });
      await recarregar();
    } catch (erro) {
      mostrarToast?.(erro.message || 'Erro ao salvar a foto.', 'error');
    }
  };

  const removerFoto = async (foto) => {
    try {
      await removerFotoLocal(foto.id_local);
      await recarregar();
    } catch (erro) {
      mostrarToast?.(erro.message || 'Erro ao remover a foto.', 'error');
    }
  };

  const salvarObservacoes = async () => {
    if (!editavel || obsGeral === (dados.observacoes || '')) return;
    try {
      await atualizarMetadadosLocal(dados.id_local, { observacoes: obsGeral.trim() || null });
      await recarregar();
    } catch (erro) {
      mostrarToast?.(erro.message || 'Erro ao salvar as observações.', 'error');
    }
  };

  const finalizar = async () => {
    if (finalizando) return;
    setFinalizando(true);
    try {
      if (editavel && obsGeral !== (dados.observacoes || '')) {
        await salvarObservacoes();
      }
      await finalizarInspecaoLocal(dados.id_local);
      await recarregar();
      mostrarToast?.('Inspeção finalizada. Sincronize para enviar ao servidor.');
      onSincronizar?.();
    } catch (erro) {
      mostrarToast?.(erro.message || 'Não foi possível finalizar.', 'error');
    } finally {
      setFinalizando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] bg-slate-100 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-3 sm:px-5 py-3 flex items-center gap-2 shrink-0">
        <button
          onClick={onFechar}
          className="w-11 h-11 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600"
          title="Voltar"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm sm:text-base font-extrabold text-slate-800 truncate">
              {dados.codigo || 'Rascunho local'}
            </h1>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${CORES_STATUS[dados.status] || CORES_STATUS.rascunho}`}>
              {ROTULO_STATUS[dados.status] || dados.status}
            </span>
            {dados.pendente_sync && (
              <span className="rounded-full bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 text-[10px] font-extrabold flex items-center gap-1">
                <CloudOff size={10} /> Não sincronizada
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 truncate">
            {dados.atividade_nome} · {dados.modelo_nome} · {formatarData(dados.data_inspecao)}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {dados.id_servidor && (
            <button
              onClick={onImprimir}
              className="h-10 px-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[11px] font-bold flex items-center gap-1"
              title="Gerar PDF"
            >
              <FileDown size={15} /> PDF
            </button>
          )}
          <button
            onClick={onSincronizar}
            disabled={sincronizando}
            className="h-10 px-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-[11px] font-bold flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw size={14} className={sincronizando ? 'animate-spin' : ''} /> Sync
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-3 sm:p-5 space-y-4">
          {dados.sync_erro && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700 flex gap-2">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>Falha na sincronização: {dados.sync_erro}</span>
            </div>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <InfoLinha icone={Calendar} rotulo="Data / hora" valor={formatarDataHora(dados.iniciada_em)} />
              <InfoLinha icone={User} rotulo="Inspetor" valor={dados.inspetor_nome} />
              <InfoLinha icone={Building2} rotulo="Obra" valor={dados.obra_nome || 'Sem vínculo'} />
              <InfoLinha icone={ClipboardList} rotulo="Tipo de serviço" valor={dados.tipo_servico} />
              <InfoLinha icone={MapPin} rotulo="Local" valor={dados.local_inspecao} />
              <InfoLinha icone={User} rotulo="Funcionário" valor={dados.funcionario_nome} />
              <InfoLinha icone={Users} rotulo="Equipe inspecionada" valor={dados.equipe_nome} />
              <InfoLinha icone={User} rotulo="Encarregado" valor={dados.encarregado} />
              <InfoLinha icone={Truck} rotulo="Veículo" valor={dados.veiculo} />
              <InfoLinha icone={Briefcase} rotulo="Setor" valor={dados.setor} />
            </div>
            {dados.observacoes && (
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-xs text-slate-600 whitespace-pre-wrap">
                {dados.observacoes}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-extrabold text-slate-700">Progresso do checklist</p>
              <p className="text-xs font-extrabold text-primary-700">{respondidos}/{total}</p>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-primary-500 transition-all"
                style={{ width: total ? `${Math.round((respondidos / total) * 100)}%` : '0%' }}
              />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              {permiteObservacaoItem
                ? (naoConformes > 0
                  ? `${naoConformes} não conformidade(s) registrada(s).`
                  : 'Nenhuma não conformidade até agora.')
                : `${respostasNao} resposta(s) marcada(s) como “Não”.`}
            </p>
          </section>

          {itens.map((grupo) => (
            <section key={grupo.chave} className="space-y-2">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 px-1">
                {grupo.ordem} - {grupo.nome}
              </h2>
              {grupo.itens.map((item) => (
                <ItemChecklist
                  key={item.item_local_id || `${item.grupo_ordem}-${item.classificacao}`}
                  item={item}
                  permitidoEditar={editavel}
                  permiteObservacao={permiteObservacaoItem}
                  opcoesResposta={opcoesResposta}
                  tipoResposta={tipoResposta}
                  onResposta={responder}
                  onObservacao={salvarObservacao}
                  onFoto={adicionarFoto}
                  onRemoverFoto={removerFoto}
                />
              ))}
            </section>
          ))}

          {total === 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 font-semibold">
              Este modelo não possui itens. Edite o modelo antes de iniciar novas inspeções.
            </div>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2">
              Observações da inspeção
            </label>
            <textarea
              value={obsGeral}
              onChange={(e) => setObsGeral(e.target.value)}
              onBlur={salvarObservacoes}
              readOnly={!editavel}
              rows={4}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 resize-y read-only:opacity-80"
              placeholder="Registre observações, não conformidades e demais informações da inspeção..."
            />
          </section>
        </div>
      </div>

      <footer className="bg-white border-t border-slate-200 px-3 sm:px-5 py-3 shrink-0">
        <div className="max-w-3xl mx-auto flex gap-2">
          {editavel && !dados.id_servidor && (
            <button
              type="button"
              onClick={() => onExcluir?.(dados)}
              className="h-11 px-3 rounded-xl border border-rose-200 text-rose-700 bg-rose-50 text-xs font-bold flex items-center gap-1"
            >
              <Trash2 size={15} /> Excluir
            </button>
          )}
          {editavel && (
            <button
              type="button"
              onClick={finalizar}
              disabled={finalizando}
              className="flex-1 min-h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-extrabold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {finalizando ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <CheckCircle2 size={17} />
              )}
              Finalizar inspeção
            </button>
          )}
          {!editavel && (
            <button
              type="button"
              onClick={onFechar}
              className="flex-1 min-h-11 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-extrabold"
            >
              Fechar
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
