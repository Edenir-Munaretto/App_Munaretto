import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Play, Calendar, User, MapPin, Building2, Users, Truck, Briefcase,
  ClipboardList, ChevronDown,
} from 'lucide-react';
import { hojeISO } from './comum';
import ObraAutocomplete from './ObraAutocomplete';

function Campo({ rotulo, icone: Icone, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="flex items-center gap-1.5 text-xs font-bold text-slate-600 mb-1">
        {Icone && <Icone size={13} className="text-slate-400" />}
        {rotulo}
      </span>
      {children}
    </label>
  );
}

const CLASSE_INPUT =
  'w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100';

export default function FormularioNovaInspecao({
  aberto,
  onFechar,
  onCriar,
  opcoes,
  usuarioAtual,
  gestor,
}) {
  const atividades = useMemo(
    () => (opcoes?.atividades || []).filter((a) => a.ativo !== false),
    [opcoes],
  );
  const funcionarios = useMemo(
    () => (opcoes?.funcionarios || []).slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome))),
    [opcoes],
  );
  const equipes = useMemo(
    () => (opcoes?.equipes || []).filter((e) => e.ativa !== false),
    [opcoes],
  );
  const obras = useMemo(
    () => (opcoes?.obras || []).slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome))),
    [opcoes],
  );

  const [atividadeId, setAtividadeId] = useState('');
  const [modeloId, setModeloId] = useState('');
  const [obraId, setObraId] = useState('');
  const [local, setLocal] = useState('');
  const [data, setData] = useState(hojeISO());
  const [funcionarioId, setFuncionarioId] = useState('');
  const [equipeId, setEquipeId] = useState('');
  const [encarregado, setEncarregado] = useState('');
  const [veiculo, setVeiculo] = useState('');
  const [setor, setSetor] = useState('');
  const [inspetor, setInspetor] = useState(usuarioAtual?.nome || '');
  const [observacoes, setObservacoes] = useState('');
  const [assinantesIds, setAssinantesIds] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!aberto) return;
    const primeira = atividades[0];
    setAtividadeId(primeira ? String(primeira.id) : '');
    const primeiroModelo = (opcoes?.modelos || []).find(
      (m) => m.ativo !== false && String(m.atividade_id) === String(primeira?.id),
    );
    setModeloId(primeiroModelo ? String(primeiroModelo.id) : '');
    setObraId('');
    setLocal('');
    setData(hojeISO());
    setFuncionarioId('');
    setEquipeId('');
    setEncarregado('');
    setVeiculo('');
    setSetor('');
    setInspetor(usuarioAtual?.nome || '');
    setObservacoes('');
    setAssinantesIds([]);
    setErro('');
  }, [aberto, atividades, opcoes, usuarioAtual?.nome]);

  const modelos = useMemo(
    () =>
      (opcoes?.modelos || []).filter(
        (m) =>
          m.ativo !== false
          && String(m.atividade_id) === String(atividadeId)
          && (m.itens || []).length > 0,
      ),
    [opcoes, atividadeId],
  );

  useEffect(() => {
    if (!modelos.length) {
      setModeloId('');
      return;
    }
    if (!modelos.some((m) => String(m.id) === String(modeloId))) {
      setModeloId(String(modelos[0].id));
    }
  }, [modelos, modeloId]);

  if (!aberto) return null;

  const modeloSelecionado = modelos.find((m) => String(m.id) === String(modeloId));
  const equipeSelecionada = equipes.find((e) => String(e.id) === String(equipeId));
  const atividadeSelecionada = atividades.find((a) => String(a.id) === String(atividadeId));

  const selecionarObra = (obra) => {
    setObraId(obra ? String(obra.id) : '');
    if (obra) {
      const endereco = [obra.endereco, obra.cidade].filter(Boolean).join(' - ');
      if (endereco) setLocal(endereco);
    }
  };

  const selecionarEquipe = (valor) => {
    setEquipeId(valor);
    const equipe = equipes.find((e) => String(e.id) === String(valor));
    if (!equipe) {
      setAssinantesIds([]);
      return;
    }
    const lider = (equipe.membros || []).find((m) => m.lider);
    if (lider?.nome) setEncarregado(lider.nome);
    setAssinantesIds((equipe.membros || []).map((m) => m.funcionario_id).filter(Boolean));
  };

  const alternarAssinante = (id) => {
    setAssinantesIds((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );
  };

  const enviar = async (evento) => {
    evento.preventDefault();
    setErro('');
    if (!atividadeSelecionada) return setErro('Selecione a atividade.');
    if (!modeloSelecionado) return setErro('Selecione o tipo de inspeção.');
    if (!local.trim()) return setErro('Informe o local da inspeção.');
    if (!inspetor.trim()) return setErro('Informe o inspetor.');
    const funcionario = funcionarios.find((f) => String(f.id) === String(funcionarioId)) || null;
    const assinantes = funcionarios
      .filter((f) => assinantesIds.includes(f.id))
      .map((f) => ({ funcionario_id: f.id, nome: f.nome, cargo: f.cargo || null }));
    setEnviando(true);
    try {
      await onCriar({
        atividade: atividadeSelecionada,
        modelo: modeloSelecionado,
        obra: obras.find((o) => String(o.id) === String(obraId)) || null,
        funcionario,
        equipe: equipeSelecionada || null,
        local_inspecao: local.trim(),
        data_inspecao: data,
        inspetor_nome: inspetor.trim(),
        encarregado: encarregado.trim() || null,
        veiculo: veiculo.trim() || null,
        setor: setor.trim() || null,
        observacoes: observacoes.trim() || null,
        assinantes,
        usuarioId: usuarioAtual?.id ?? null,
      });
    } catch (e) {
      setErro(e?.message || 'Não foi possível iniciar a inspeção.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <form
        onSubmit={enviar}
        className="w-full sm:max-w-2xl max-h-[95dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl border border-slate-200"
      >
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center">
              <ClipboardList size={18} />
            </span>
            <div>
              <h2 className="text-base font-extrabold text-slate-800">Nova Inspeção</h2>
              <p className="text-[11px] text-slate-400">Preencha a identificação antes de iniciar.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onFechar}
            className="w-11 h-11 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100"
            title="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Data" icone={Calendar}>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={CLASSE_INPUT} />
            </Campo>
            <Campo rotulo="Inspetor" icone={User}>
              <input
                value={inspetor}
                onChange={(e) => setInspetor(e.target.value)}
                readOnly={!gestor}
                className={`${CLASSE_INPUT} ${!gestor ? 'bg-slate-50 text-slate-500' : ''}`}
                placeholder="Nome do inspetor"
              />
            </Campo>
          </div>

          <Campo rotulo="Obra (opcional)" icone={Building2}>
            <ObraAutocomplete obras={obras} value={obraId} onChange={selecionarObra} />
            <p className="mt-1 text-[10px] text-slate-400">
              Digite o nome/Nota PS ou o cliente. Deixe vazio para não vincular.
            </p>
          </Campo>

          <Campo rotulo="Local da Inspeção" icone={MapPin}>
            <input
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              className={CLASSE_INPUT}
              placeholder="Ex.: Concórdia - Rua Comandante Caleffi"
            />
          </Campo>

          <Campo rotulo="Atividade" icone={ClipboardList}>
            <div className="relative">
              <select
                value={atividadeId}
                onChange={(e) => setAtividadeId(e.target.value)}
                className={`${CLASSE_INPUT} appearance-none pr-9`}
              >
                <option value="">Selecione...</option>
                {atividades.map((atividade) => (
                  <option key={atividade.id} value={atividade.id}>{atividade.nome}</option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </Campo>

          <Campo rotulo="Tipo de Inspeção" icone={ClipboardList}>
            <div className="relative">
              <select
                value={modeloId}
                onChange={(e) => setModeloId(e.target.value)}
                className={`${CLASSE_INPUT} appearance-none pr-9`}
                disabled={!modelos.length}
              >
                <option value="">{modelos.length ? 'Selecione...' : 'Nenhum modelo para a atividade'}</option>
                {modelos.map((modelo) => (
                  <option key={modelo.id} value={modelo.id}>
                    {modelo.nome} ({(modelo.itens || []).length} itens)
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </Campo>

          <Campo rotulo="Funcionário (opcional)" icone={User}>
            <select value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)} className={CLASSE_INPUT}>
              <option value="">Sem funcionário específico</option>
              {funcionarios.map((funcionario) => (
                <option key={funcionario.id} value={funcionario.id}>
                  {funcionario.nome}{funcionario.cargo ? ` - ${funcionario.cargo}` : ''}
                </option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Equipe (opcional)" icone={Users}>
            <div className="flex gap-2">
              <select
                value={equipeId}
                onChange={(e) => selecionarEquipe(e.target.value)}
                className={CLASSE_INPUT}
              >
                <option value="">Sem equipe específica</option>
                {equipes.map((equipe) => (
                  <option key={equipe.id} value={equipe.id}>
                    {equipe.numero ? `${equipe.numero} - ` : ''}{equipe.nome}
                  </option>
                ))}
              </select>
              <div className="min-h-11 px-3 rounded-xl bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-500 flex items-center whitespace-nowrap">
                {(equipeSelecionada?.membros || []).length} membro(s)
              </div>
            </div>
          </Campo>

          <Campo rotulo="Encarregado" icone={User}>
            <input
              value={encarregado}
              onChange={(e) => setEncarregado(e.target.value)}
              className={CLASSE_INPUT}
              placeholder="Preenchido pelo líder da equipe"
            />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Veículo" icone={Truck}>
              <input value={veiculo} onChange={(e) => setVeiculo(e.target.value)} className={CLASSE_INPUT} placeholder="Texto livre" />
            </Campo>
            <Campo rotulo="Setor" icone={Briefcase}>
              <input value={setor} onChange={(e) => setSetor(e.target.value)} className={CLASSE_INPUT} placeholder="Texto livre" />
            </Campo>
          </div>

          <Campo rotulo="Observações gerais">
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={2}
              className={CLASSE_INPUT}
              placeholder="Opcional"
            />
          </Campo>

          <details className="rounded-xl border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer px-3 py-2.5 text-xs font-bold text-slate-600 select-none">
              Assinantes do relatório ({assinantesIds.length} selecionado(s))
            </summary>
            <div className="max-h-52 overflow-y-auto px-3 pb-3 space-y-1">
              {funcionarios.length === 0 ? (
                <p className="text-xs text-slate-400 py-2">Nenhum funcionário ativo cadastrado.</p>
              ) : funcionarios.map((funcionario) => (
                <label key={funcionario.id} className="flex items-center gap-2 py-1.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assinantesIds.includes(funcionario.id)}
                    onChange={() => alternarAssinante(funcionario.id)}
                    className="w-4 h-4 accent-primary-600"
                  />
                  <span className="font-semibold">{funcionario.nome}</span>
                  {funcionario.cargo && <span className="text-slate-400">- {funcionario.cargo}</span>}
                </label>
              ))}
            </div>
          </details>

          {erro && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {erro}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-100 px-4 sm:px-6 py-3 flex gap-2">
          <button
            type="button"
            onClick={onFechar}
            className="flex-1 min-h-11 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={enviando || !modeloSelecionado}
            className="flex-[2] min-h-11 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-extrabold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {enviando ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Play size={16} />
            )}
            Iniciar inspeção
          </button>
        </div>
      </form>
    </div>
  );
}
