import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus, Pencil, Trash2, Save, X, ClipboardList, Layers,
} from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../../api';
import { lerOpcoesLocais } from '../../offline/inspecoes';
import ModalConfirmacao from '../ModalConfirmacao';
import { ROTULOS_TIPO_RESPOSTA, TIPO_RESPOSTA_PADRAO } from './comum';

const CLASSE_INPUT =
  'w-full min-h-10 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100';

function novoModeloEditor() {
  return {
    id: null,
    atividade_id: '',
    nome: '',
    descricao: '',
    tipo_resposta: TIPO_RESPOSTA_PADRAO,
    tipo_servico: '',
    ativo: true,
    grupos: [
      {
        ordem: 1,
        nome: 'Etapa 1',
        itens: [
          {
            grupo_ordem: 1,
            grupo_nome: 'Etapa 1',
            ordem: 1,
            classificacao: '1.1',
            pergunta: '',
            exige_foto: false,
          },
        ],
      },
    ],
  };
}

function modeloParaEditor(modelo, grupos = [], itens = []) {
  const gruposOrdenados = [...grupos].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  return {
    id: modelo?.id || null,
    atividade_id: modelo?.atividade_id ? String(modelo.atividade_id) : '',
    nome: modelo?.nome || '',
    descricao: modelo?.descricao || '',
    tipo_resposta: modelo?.tipo_resposta || TIPO_RESPOSTA_PADRAO,
    tipo_servico: modelo?.tipo_servico || '',
    ativo: modelo?.ativo !== false,
    grupos: gruposOrdenados.map((grupo) => ({
      ordem: grupo.ordem || 1,
      nome: grupo.nome || '',
      itens: itens
        .filter((item) => Number(item.grupo_id) === Number(grupo.id))
        .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
        .map((item) => ({
          grupo_ordem: grupo.ordem || 1,
          grupo_nome: grupo.nome || '',
          ordem: item.ordem || 1,
          classificacao: item.classificacao || '',
          pergunta: item.pergunta || '',
          exige_foto: !!item.exige_foto,
        })),
    })),
  };
}

export default function ModelosInspecao({ online, mostrarToast, onAtualizar }) {
  const [atividades, setAtividades] = useState([]);
  const [modelos, setModelos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [novaAtividade, setNovaAtividade] = useState('');
  const [salvandoAtividade, setSalvandoAtividade] = useState(false);
  const [editor, setEditor] = useState(null);
  const [salvandoModelo, setSalvandoModelo] = useState(false);
  const [confirmar, setConfirmar] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      if (!online) {
        const locais = await lerOpcoesLocais();
        setAtividades(locais.atividades || []);
        setModelos(locais.modelos || []);
        return;
      }
      const [resAtividades, resModelos] = await Promise.all([
        apiFetch(`${API_URL}/inspecoes/atividades?incluir_inativas=true`),
        apiFetch(`${API_URL}/inspecoes/modelos?incluir_inativos=true`),
      ]);
      if (!resAtividades.ok) throw new Error(erroDaResposta(await resAtividades.json().catch(() => null), 'Falha ao carregar atividades.'));
      if (!resModelos.ok) throw new Error(erroDaResposta(await resModelos.json().catch(() => null), 'Falha ao carregar modelos.'));
      setAtividades(await resAtividades.json());
      setModelos(await resModelos.json());
    } catch (e) {
      setErro(e.message || 'Falha ao carregar os cadastros.');
    } finally {
      setCarregando(false);
    }
  }, [online]);

  useEffect(() => { carregar(); }, [carregar]);

  const criarAtividade = async (evento) => {
    evento.preventDefault();
    if (!novaAtividade.trim() || !online) return;
    setSalvandoAtividade(true);
    try {
      const res = await apiFetch(`${API_URL}/inspecoes/atividades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: novaAtividade.trim(), ativo: true }),
      });
      const dados = await res.json().catch(() => null);
      if (!res.ok) throw new Error(erroDaResposta(dados, 'Falha ao criar atividade.'));
      setNovaAtividade('');
      await carregar();
      onAtualizar?.();
    } catch (e) {
      mostrarToast?.(e.message, 'error');
    } finally {
      setSalvandoAtividade(false);
    }
  };

  const alternarAtividade = async (atividade) => {
    if (!online) return;
    try {
      const res = await apiFetch(`${API_URL}/inspecoes/atividades/${atividade.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: atividade.nome, ativo: !atividade.ativo }),
      });
      if (!res.ok) throw new Error(erroDaResposta(await res.json().catch(() => null), 'Falha ao atualizar atividade.'));
      await carregar();
      onAtualizar?.();
    } catch (e) {
      mostrarToast?.(e.message, 'error');
    }
  };

  const excluirAtividade = async (atividade) => {
    if (!online) return;
    try {
      const res = await apiFetch(`${API_URL}/inspecoes/atividades/${atividade.id}`, { method: 'DELETE' });
      const dados = await res.json().catch(() => null);
      if (!res.ok) throw new Error(erroDaResposta(dados, 'Falha ao excluir atividade.'));
      mostrarToast?.(dados?.message || 'Atividade processada.');
      await carregar();
      onAtualizar?.();
    } catch (e) {
      mostrarToast?.(e.message, 'error');
    } finally {
      setConfirmar(null);
    }
  };

  const editarModelo = async (modelo) => {
    if (!online) return;
    try {
      const res = await apiFetch(`${API_URL}/inspecoes/modelos/${modelo.id}`);
      const dados = await res.json().catch(() => null);
      if (!res.ok) throw new Error(erroDaResposta(dados, 'Falha ao abrir o modelo.'));
      setEditor(modeloParaEditor(dados.modelo, dados.grupos, dados.itens));
    } catch (e) {
      mostrarToast?.(e.message, 'error');
    }
  };

  const excluirModelo = async (modelo) => {
    if (!online) return;
    try {
      const res = await apiFetch(`${API_URL}/inspecoes/modelos/${modelo.id}`, { method: 'DELETE' });
      const dados = await res.json().catch(() => null);
      if (!res.ok) throw new Error(erroDaResposta(dados, 'Falha ao excluir modelo.'));
      mostrarToast?.(dados?.message || 'Modelo processado.');
      await carregar();
      onAtualizar?.();
    } catch (e) {
      mostrarToast?.(e.message, 'error');
    } finally {
      setConfirmar(null);
    }
  };

  const renomearGrupo = (indice, valor) => {
    setEditor((atual) => {
      const grupos = [...atual.grupos];
      grupos[indice] = { ...grupos[indice], nome: valor };
      grupos[indice].itens = grupos[indice].itens.map((item) => ({
        ...item,
        grupo_nome: valor,
        grupo_ordem: grupos[indice].ordem,
      }));
      return { ...atual, grupos };
    });
  };

  const alterarItem = (grupoIndice, itemIndice, campo, valor) => {
    setEditor((atual) => {
      const grupos = [...atual.grupos];
      const itens = [...grupos[grupoIndice].itens];
      itens[itemIndice] = { ...itens[itemIndice], [campo]: valor };
      grupos[grupoIndice] = { ...grupos[grupoIndice], itens };
      return { ...atual, grupos };
    });
  };

  const adicionarGrupo = () => {
    setEditor((atual) => {
      const grupos = [...atual.grupos];
      const ordem = grupos.length + 1;
      grupos.push({ ordem, nome: `Etapa ${ordem}`, itens: [] });
      return { ...atual, grupos };
    });
  };

  const removerGrupo = (indice) => {
    setEditor((atual) => ({ ...atual, grupos: atual.grupos.filter((_, i) => i !== indice) }));
  };

  const adicionarItem = (grupoIndice) => {
    setEditor((atual) => {
      const grupos = [...atual.grupos];
      const grupo = grupos[grupoIndice];
      const itens = [...grupo.itens];
      const numero = `${grupo.ordem}.${itens.length + 1}`;
      itens.push({
        grupo_ordem: grupo.ordem,
        grupo_nome: grupo.nome,
        ordem: itens.length + 1,
        classificacao: numero,
        pergunta: '',
        exige_foto: false,
      });
      grupos[grupoIndice] = { ...grupo, itens };
      return { ...atual, grupos };
    });
  };

  const removerItem = (grupoIndice, itemIndice) => {
    setEditor((atual) => {
      const grupos = [...atual.grupos];
      const itens = grupos[grupoIndice].itens.filter((_, i) => i !== itemIndice);
      grupos[grupoIndice] = { ...grupos[grupoIndice], itens };
      return { ...atual, grupos };
    });
  };

  const salvarModelo = async (evento) => {
    evento.preventDefault();
    if (!editor) return;
    if (!editor.atividade_id) return mostrarToast?.('Selecione a atividade.', 'error');
    if (!editor.nome.trim()) return mostrarToast?.('Informe o nome do modelo.', 'error');
    const grupos = editor.grupos
      .map((grupo, indice) => ({
        ordem: indice + 1,
        nome: grupo.nome.trim(),
        itens: grupo.itens.map((item, itemIndice) => ({
          grupo_ordem: indice + 1,
          grupo_nome: grupo.nome.trim(),
          ordem: itemIndice + 1,
          classificacao: item.classificacao.trim(),
          pergunta: item.pergunta.trim(),
          exige_foto: !!item.exige_foto,
        })),
      }))
      .filter((grupo) => grupo.nome && grupo.itens.length);
    if (!grupos.length) return mostrarToast?.('Adicione ao menos um grupo com itens.', 'error');

    setSalvandoModelo(true);
    try {
      const url = editor.id
        ? `${API_URL}/inspecoes/modelos/${editor.id}`
        : `${API_URL}/inspecoes/modelos`;
      const res = await apiFetch(url, {
        method: editor.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          atividade_id: Number(editor.atividade_id),
          nome: editor.nome.trim(),
          descricao: editor.descricao?.trim() || null,
          tipo_resposta: editor.tipo_resposta || TIPO_RESPOSTA_PADRAO,
          tipo_servico: editor.tipo_servico?.trim() || null,
          ativo: !!editor.ativo,
          grupos,
        }),
      });
      const dados = await res.json().catch(() => null);
      if (!res.ok) throw new Error(erroDaResposta(dados, 'Falha ao salvar o modelo.'));
      mostrarToast?.('Modelo salvo.');
      setEditor(null);
      await carregar();
      onAtualizar?.();
    } catch (e) {
      mostrarToast?.(e.message, 'error');
    } finally {
      setSalvandoModelo(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
              <Layers size={16} className="text-primary-600" /> Atividades
            </h2>
            <p className="text-[11px] text-slate-400">Ex.: Segurança, Meio Ambiente, Qualidade.</p>
          </div>
        </div>
        <form onSubmit={criarAtividade} className="flex gap-2 mb-3">
          <input
            value={novaAtividade}
            onChange={(e) => setNovaAtividade(e.target.value)}
            className={CLASSE_INPUT}
            placeholder="Nova atividade"
            disabled={!online}
          />
          <button
            type="submit"
            disabled={!online || salvandoAtividade || !novaAtividade.trim()}
            className="min-h-10 px-3 rounded-xl bg-primary-600 text-white text-xs font-extrabold disabled:opacity-50 flex items-center gap-1"
          >
            <Plus size={14} /> Adicionar
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          {atividades.map((atividade) => (
            <div
              key={atividade.id}
              className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 ${
                atividade.ativo ? 'border-slate-200 bg-slate-50' : 'border-slate-100 bg-slate-100 opacity-60'
              }`}
            >
              <span className="text-xs font-bold text-slate-700">{atividade.nome}</span>
              <button
                type="button"
                onClick={() => alternarAtividade(atividade)}
                disabled={!online}
                className="text-[10px] font-bold text-primary-700 hover:underline disabled:opacity-50"
              >
                {atividade.ativo ? 'Inativar' : 'Ativar'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmar({
                  titulo: 'Excluir atividade',
                  mensagem: `Excluir/Inativar a atividade "${atividade.nome}"?`,
                  onConfirmar: () => excluirAtividade(atividade),
                })}
                disabled={!online}
                className="w-6 h-6 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center"
                title="Excluir"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {!atividades.length && <p className="text-xs text-slate-400">Nenhuma atividade cadastrada.</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
              <ClipboardList size={16} className="text-primary-600" /> Tipos de inspeção
            </h2>
            <p className="text-[11px] text-slate-400">Cada tipo é um checklist com grupos e perguntas.</p>
          </div>
          <button
            type="button"
            onClick={() => setEditor(novoModeloEditor())}
            disabled={!online || !atividades.length}
            className="min-h-10 px-3 rounded-xl bg-primary-600 text-white text-xs font-extrabold disabled:opacity-50 flex items-center gap-1"
          >
            <Plus size={14} /> Novo tipo
          </button>
        </div>

        {erro && <p className="text-xs font-semibold text-rose-600 mb-2">{erro}</p>}
        {carregando ? (
          <p className="text-xs text-slate-400 py-3">Carregando...</p>
        ) : !modelos.length ? (
          <p className="text-xs text-slate-400 py-3">Nenhum tipo cadastrado.</p>
        ) : (
          <div className="space-y-2">
            {modelos.map((modelo) => {
              const atividade = atividades.find((a) => Number(a.id) === Number(modelo.atividade_id));
              return (
                <div key={modelo.id} className="rounded-xl border border-slate-200 p-3 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-extrabold text-slate-800 truncate">{modelo.nome}</p>
                      {modelo.ativo === false && (
                        <span className="rounded-full bg-slate-100 text-slate-500 text-[9px] font-bold px-2 py-0.5">INATIVO</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {atividade?.nome || 'Atividade removida'} · {(modelo.itens || []).length} item(ns)
                      {' · '}{ROTULOS_TIPO_RESPOSTA[modelo.tipo_resposta] || ROTULOS_TIPO_RESPOSTA[TIPO_RESPOSTA_PADRAO]}
                      {modelo.tipo_servico ? ` · ${modelo.tipo_servico}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => editarModelo(modelo)}
                    disabled={!online}
                    className="w-9 h-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center disabled:opacity-40"
                    title="Editar"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmar({
                      titulo: 'Excluir tipo de inspeção',
                      mensagem: `Excluir/Inativar o modelo "${modelo.nome}"?`,
                      onConfirmar: () => excluirModelo(modelo),
                    })}
                    disabled={!online}
                    className="w-9 h-9 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 flex items-center justify-center disabled:opacity-40"
                    title="Excluir"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {editor && (
        <div className="fixed inset-0 z-[65] bg-slate-900/50 flex items-center justify-center p-2 sm:p-4">
          <form onSubmit={salvarModelo} className="w-full max-w-3xl max-h-[95dvh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-800">
                {editor.id ? 'Editar tipo de inspeção' : 'Novo tipo de inspeção'}
              </h3>
              <button type="button" onClick={() => setEditor(null)} className="w-10 h-10 rounded-xl text-slate-400 hover:bg-slate-100 flex items-center justify-center">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-bold text-slate-600">Atividade</span>
                  <select
                    value={editor.atividade_id}
                    onChange={(e) => setEditor({ ...editor, atividade_id: e.target.value })}
                    className={CLASSE_INPUT}
                  >
                    <option value="">Selecione...</option>
                    {atividades.map((atividade) => (
                      <option key={atividade.id} value={atividade.id}>{atividade.nome}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-slate-600">Nome do tipo</span>
                  <input
                    value={editor.nome}
                    onChange={(e) => setEditor({ ...editor, nome: e.target.value })}
                    className={CLASSE_INPUT}
                    placeholder="Ex.: Inspeção de segurança"
                  />
                </label>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-bold text-slate-600">Formato de resposta</span>
                  <select
                    value={editor.tipo_resposta || TIPO_RESPOSTA_PADRAO}
                    onChange={(e) => setEditor({ ...editor, tipo_resposta: e.target.value })}
                    className={CLASSE_INPUT}
                  >
                    {Object.entries(ROTULOS_TIPO_RESPOSTA).map(([valor, rotulo]) => (
                      <option key={valor} value={valor}>{rotulo}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-slate-600">Tipo de serviço</span>
                  <input
                    value={editor.tipo_servico || ''}
                    onChange={(e) => setEditor({ ...editor, tipo_servico: e.target.value })}
                    className={CLASSE_INPUT}
                    placeholder="Ex.: Guindauto"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-bold text-slate-600">Descrição (opcional)</span>
                <textarea
                  value={editor.descricao}
                  onChange={(e) => setEditor({ ...editor, descricao: e.target.value })}
                  rows={2}
                  className={CLASSE_INPUT}
                />
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={editor.ativo}
                  onChange={(e) => setEditor({ ...editor, ativo: e.target.checked })}
                  className="w-4 h-4 accent-primary-600"
                />
                Modelo ativo
              </label>

              <div className="flex items-center justify-between">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Grupos e perguntas</h4>
                <button type="button" onClick={adicionarGrupo} className="text-xs font-bold text-primary-700 hover:underline flex items-center gap-1">
                  <Plus size={13} /> Adicionar grupo
                </button>
              </div>

              {editor.grupos.map((grupo, grupoIndice) => (
                <div key={`${grupo.ordem}-${grupoIndice}`} className="rounded-xl border border-slate-200 p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={grupo.nome}
                      onChange={(e) => renomearGrupo(grupoIndice, e.target.value)}
                      className={CLASSE_INPUT}
                      placeholder="Nome do grupo"
                    />
                    <button
                      type="button"
                      onClick={() => removerGrupo(grupoIndice)}
                      className="w-10 h-10 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 flex items-center justify-center"
                      title="Remover grupo"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {grupo.itens.map((item, itemIndice) => (
                      <div key={`${grupoIndice}-${itemIndice}`} className="rounded-lg bg-slate-50 border border-slate-100 p-2.5 space-y-2">
                        <div className="flex gap-2">
                          <input
                            value={item.classificacao}
                            onChange={(e) => alterarItem(grupoIndice, itemIndice, 'classificacao', e.target.value)}
                            className="w-20 min-h-9 rounded-lg border border-slate-300 px-2 text-xs font-bold"
                            placeholder="1.1"
                          />
                          <input
                            value={item.pergunta}
                            onChange={(e) => alterarItem(grupoIndice, itemIndice, 'pergunta', e.target.value)}
                            className="flex-1 min-h-9 rounded-lg border border-slate-300 px-2 text-xs"
                            placeholder="Pergunta da inspeção"
                          />
                          <button
                            type="button"
                            onClick={() => removerItem(grupoIndice, itemIndice)}
                            className="w-9 h-9 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center"
                            title="Remover item"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <label className="inline-flex items-center gap-2 text-[11px] font-bold text-slate-500">
                          <input
                            type="checkbox"
                            checked={item.exige_foto}
                            onChange={(e) => alterarItem(grupoIndice, itemIndice, 'exige_foto', e.target.checked)}
                            className="w-3.5 h-3.5 accent-primary-600"
                          />
                          Exige foto
                        </label>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => adicionarItem(grupoIndice)}
                    className="text-xs font-bold text-primary-700 hover:underline flex items-center gap-1"
                  >
                    <Plus size={13} /> Adicionar pergunta
                  </button>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-100 px-4 py-3 flex justify-end gap-2">
              <button type="button" onClick={() => setEditor(null)} className="min-h-10 px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-600">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvandoModelo}
                className="min-h-10 px-4 rounded-xl bg-primary-600 text-white text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-50"
              >
                <Save size={14} />
                {salvandoModelo ? 'Salvando...' : 'Salvar modelo'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ModalConfirmacao
        aberto={confirmar != null}
        titulo={confirmar?.titulo || 'Confirmar'}
        mensagem={confirmar?.mensagem || ''}
        perigo
        onConfirmar={() => confirmar?.onConfirmar?.()}
        onCancelar={() => setConfirmar(null)}
      />
    </div>
  );
}
