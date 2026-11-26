import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, RefreshCw, ClipboardCheck, Clock, CheckCircle2, AlertTriangle,
  Wifi, WifiOff, FileDown, Trash2, Search, X, Settings2, MapPin,
  Calendar, User, CloudOff, Database,
} from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';
import { abrirPdfAutenticado } from '../utils/abrirPdf';
import { testarConexao, estaEmWifi } from '../offline/offline';
import {
  contarPendentesInspecoes,
  criarInspecaoLocal,
  descartarPendenciaInspecao,
  excluirInspecaoLocal,
  listarInspecoesLocais,
  listarPendentesInspecoes,
  lerOpcoesLocais,
  obterInspecaoLocal,
  prepararPacoteInspecoes,
  salvarInspecaoServidor,
  infoPacoteInspecoes,
} from '../offline/inspecoes';
import { sincronizarInspecoes } from '../offline/syncInspecoes';
import FormularioNovaInspecao from '../components/inspecoes/FormularioNovaInspecao';
import EditorInspecao from '../components/inspecoes/EditorInspecao';
import ModelosInspecao from '../components/inspecoes/ModelosInspecao';
import ModalPendenciasInspecoes from '../components/inspecoes/ModalPendenciasInspecoes';
import PaginacaoControle from '../components/PaginacaoControle';
import ModalConfirmacao from '../components/ModalConfirmacao';
import { usePaginacao } from '../hooks/usePaginacao';
import {
  ROTULO_STATUS, CORES_STATUS, formatarData, formatarDataHora,
} from '../components/inspecoes/comum';

const CLASSE_INPUT =
  'w-full min-h-10 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100';

function BadgePendente({ children }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">
      <CloudOff size={10} />
      {children}
    </span>
  );
}

export default function Inspecoes({ usuarioAtual }) {
  const permissoes = usuarioAtual?.permissoes || [];
  const gestor = permissoes.includes('inspecoes');

  const [aba, setAba] = useState('lista');
  const [opcoes, setOpcoes] = useState({ atividades: [], modelos: [], obras: [], funcionarios: [], equipes: [] });
  const [listaServidor, setListaServidor] = useState([]);
  const [listaLocal, setListaLocal] = useState([]);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [preparandoOffline, setPreparandoOffline] = useState(false);
  const [pacoteInfo, setPacoteInfo] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [pendentes, setPendentes] = useState({ inspecoes: 0, fotos: 0, total: 0, revisao: 0 });
  const [pendentesDetalhe, setPendentesDetalhe] = useState({ inspecoes: [], fotos: [] });
  const [mostrarPendencias, setMostrarPendencias] = useState(false);
  const [mostrarNova, setMostrarNova] = useState(false);
  const [aberta, setAberta] = useState(null);
  const [busca, setBusca] = useState('');
  const [filtroObra, setFiltroObra] = useState('');
  const [filtroAtividade, setFiltroAtividade] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [toast, setToast] = useState(null);
  const [confirmar, setConfirmar] = useState(null);
  const toastTimer = useRef(null);
  const autoSyncRef = useRef(0);
  const pacoteEmAndamento = useRef(false);

  const mostrarToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 8000 : 3000);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const carregarLocal = useCallback(async () => {
    try {
      const [locais, contagem, detalhe, pacote] = await Promise.all([
        listarInspecoesLocais(),
        contarPendentesInspecoes(),
        listarPendentesInspecoes(),
        infoPacoteInspecoes(),
      ]);
      setListaLocal(locais);
      setPendentes(contagem);
      setPendentesDetalhe(detalhe);
      setPacoteInfo(pacote);
    } catch {
      /* IndexedDB bloqueado/corrompido: mantém o que já está em tela */
    }
  }, []);

  const carregarOpcoesLocais = useCallback(async () => {
    try {
      const locais = await lerOpcoesLocais();
      if ((locais.atividades || []).length || (locais.modelos || []).length) setOpcoes(locais);
    } catch {
      /* sem pacote local */
    }
  }, []);

  const carregarOnline = useCallback(async () => {
    if (!online) return;
    try {
      const [resOpcoes, resLista] = await Promise.all([
        apiFetch(`${API_URL}/inspecoes/opcoes`),
        apiFetch(`${API_URL}/inspecoes/`),
      ]);
      if (!resOpcoes.ok) throw new Error(erroDaResposta(await resOpcoes.json().catch(() => null), 'Falha ao carregar opções.'));
      if (!resLista.ok) throw new Error(erroDaResposta(await resLista.json().catch(() => null), 'Falha ao carregar inspeções.'));
      setOpcoes(await resOpcoes.json());
      setListaServidor(await resLista.json());
      setErro('');
    } catch (e) {
      setErro(e.message || 'Falha de conexão ao carregar as inspeções.');
    }
  }, [online]);

  const verificarConexao = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setOnline(false);
      return;
    }
    const ok = await testarConexao();
    setOnline(ok);
  }, []);

  const recarregarTudo = useCallback(async () => {
    await carregarLocal();
    await carregarOnline();
  }, [carregarLocal, carregarOnline]);

  // Carga inicial: dados locais primeiro (offline); servidor em seguida.
  useEffect(() => {
    let ativo = true;
    (async () => {
      setCarregando(true);
      await carregarLocal();
      await carregarOpcoesLocais();
      if (ativo) setCarregando(false);
      if (online) {
        await carregarOnline();
        if (!gestor) {
          setPreparandoOffline(true);
          try {
            await prepararPacoteInspecoes();
            await carregarLocal();
          } catch {
            /* pacote é best-effort */
          } finally {
            if (ativo) setPreparandoOffline(false);
          }
        }
      }
    })();
    return () => { ativo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Monitor de conectividade real (Wi-Fi sem internet engana o navigator.onLine).
  useEffect(() => {
    let ativo = true;
    const atualizar = () => { if (ativo) verificarConexao(); };
    window.addEventListener('online', atualizar);
    window.addEventListener('offline', atualizar);
    const intervalo = setInterval(atualizar, 30000);
    return () => {
      ativo = false;
      window.removeEventListener('online', atualizar);
      window.removeEventListener('offline', atualizar);
      clearInterval(intervalo);
    };
  }, [verificarConexao]);

  // Ao reconectar, recarrega servidor e tenta sincronizar (Wi-Fi).
  useEffect(() => {
    if (!online) return;
    carregarOnline();
  }, [online, carregarOnline]);

  const prepararPacote = useCallback(async () => {
    if (!online || pacoteEmAndamento.current) return;
    pacoteEmAndamento.current = true;
    setPreparandoOffline(true);
    try {
      await prepararPacoteInspecoes();
      await carregarLocal();
      mostrarToast('Consulta offline atualizada.');
    } catch {
      /* best-effort */
    } finally {
      pacoteEmAndamento.current = false;
      setPreparandoOffline(false);
    }
  }, [online, carregarLocal, mostrarToast]);

  const sincronizarAgora = useCallback(async (silencioso = false) => {
    if (sincronizando) return;
    if (!online) {
      if (!silencioso) mostrarToast('Sem conexão — a inspeção fica salva no aparelho.', 'error');
      return;
    }
    if (!estaEmWifi()) {
      if (!silencioso) mostrarToast('Conecte-se ao Wi-Fi para sincronizar as fotos.', 'error');
      return;
    }
    setSincronizando(true);
    try {
      const resumo = await sincronizarInspecoes();
      await carregarLocal();
      if (online) await carregarOnline();
      if (!silencioso || resumo.falhas.length) {
        const enviadas = resumo.inspecoes + resumo.fotos;
        const partes = [];
        if (enviadas) partes.push(`${enviadas} item(ns) enviado(s)`);
        if (resumo.falhas.length) partes.push(`${resumo.falhas.length} com erro`);
        mostrarToast(partes.join('; ') || 'Nada pendente para sincronizar.', resumo.falhas.length ? 'error' : 'success');
      }
      if (resumo.falhas.length) setMostrarPendencias(true);
      if (!gestor) prepararPacote();
    } catch (e) {
      mostrarToast(e.message || 'Falha ao sincronizar as inspeções.', 'error');
    } finally {
      setSincronizando(false);
    }
  }, [sincronizando, online, mostrarToast, carregarLocal, carregarOnline, gestor, prepararPacote]);

  // Mantém o editor aberto em dia após a sincronização (código e id do
  // servidor) sem precisar fechar/reabrir a inspeção.
  useEffect(() => {
    if (!aberta) return;
    const atual = listaLocal.find((r) => r.id_local === aberta.id_local);
    if (!atual) return;
    if (String(atual.id_servidor || '') === String(aberta.id_servidor || '')
      && Boolean(atual.pendente_sync) === Boolean(aberta.pendente_sync)) {
      return;
    }
    obterInspecaoLocal(aberta.id_local).then((local) => {
      if (local) setAberta(local);
    });
  }, [listaLocal, aberta]);

  // Sincronização automática somente em Wi-Fi, com throttle.
  useEffect(() => {
    if (!online || !pendentes.total || sincronizando) return;
    if (!estaEmWifi()) return;
    const agora = Date.now();
    if (agora - autoSyncRef.current < 60000) return;
    autoSyncRef.current = agora;
    sincronizarAgora(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, pendentes.total, sincronizando]);

  const abrirInspecao = useCallback(async (item) => {
    try {
      const idLocal = item.id_local || (item.id_servidor ? `srv-${item.id_servidor}` : null);
      // Cópia local em edição/pendente (ou qualquer cópia sem internet): abre
      // direto. Cópias importadas sem pendência são revalidadas no servidor.
      const temPendenciaLocal = item.pendente_sync || item.sync_erro;
      const localPrioritario = !online
        || (item._origem === 'local' && (temPendenciaLocal || !item.id_servidor));
      if (idLocal && localPrioritario) {
        const local = await obterInspecaoLocal(idLocal);
        if (local) {
          setAberta(local);
          return;
        }
      }
      if (online) {
        const res = await apiFetch(`${API_URL}/inspecoes/${item.id_servidor || item.id}`);
        const dados = await res.json().catch(() => null);
        if (!res.ok) throw new Error(erroDaResposta(dados, 'Falha ao abrir a inspeção.'));
        const importada = await salvarInspecaoServidor(dados);
        const local = await obterInspecaoLocal(importada.id_local);
        setAberta(local || importada);
      } else {
        mostrarToast('Esta inspeção não está disponível offline.', 'error');
      }
    } catch (e) {
      // Servidor indisponível: usa a cópia do pacote offline, se existir.
      const idLocal = item.id_local || (item.id_servidor ? `srv-${item.id_servidor}` : null);
      if (idLocal) {
        const local = await obterInspecaoLocal(idLocal);
        if (local) {
          setAberta(local);
          return;
        }
      }
      mostrarToast(e.message, 'error');
    }
  }, [online, mostrarToast]);

  const criar = async (form) => {
    try {
      const registro = await criarInspecaoLocal(form);
      setMostrarNova(false);
      await carregarLocal();
      const local = await obterInspecaoLocal(registro.id_local);
      setAberta(local);
      if (online && estaEmWifi()) sincronizarAgora(true);
    } catch (e) {
      mostrarToast(e.message, 'error');
      throw e;
    }
  };

  const excluir = async (item) => {
    try {
      if (item.id_servidor) {
        if (!online) throw new Error('Conecte-se para excluir uma inspeção já enviada.');
        const res = await apiFetch(`${API_URL}/inspecoes/${item.id_servidor}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(erroDaResposta(await res.json().catch(() => null), 'Falha ao excluir.'));
      } else {
        await excluirInspecaoLocal(item.id_local);
      }
      if (aberta?.id_local === item.id_local) setAberta(null);
      await recarregarTudo();
      mostrarToast('Inspeção excluída.');
    } catch (e) {
      mostrarToast(e.message, 'error');
    } finally {
      setConfirmar(null);
    }
  };

  const imprimir = async (item) => {
    const id = item.id_servidor || aberta?.id_servidor;
    if (!id) {
      mostrarToast('Sincronize a inspeção antes de gerar o PDF.', 'error');
      return;
    }
    await abrirPdfAutenticado(`/inspecoes/${id}/pdf`, mostrarToast);
  };

  const descartarPendencia = async (tipo, id) => {
    try {
      await descartarPendenciaInspecao(tipo, id);
      await carregarLocal();
      if (aberta && (aberta.id_local === id || tipo === 'foto')) {
        const local = await obterInspecaoLocal(aberta.id_local);
        setAberta(local);
      }
      setMostrarPendencias(false);
      mostrarToast('Pendência descartada.');
    } catch (e) {
      mostrarToast(e.message, 'error');
    }
  };

  const todos = useMemo(() => {
    const locaisPorServidor = new Map(
      listaLocal.filter((l) => l.id_servidor).map((l) => [String(l.id_servidor), l]),
    );
    const vistos = new Set();
    const resultado = [];
    for (const servidor of listaServidor) {
      const local = locaisPorServidor.get(String(servidor.id));
      if (local) {
        resultado.push({ ...servidor, ...local, id: servidor.id, id_servidor: servidor.id, _origem: 'local' });
        vistos.add(String(servidor.id));
      } else {
        resultado.push({ ...servidor, id_servidor: servidor.id, _origem: 'servidor' });
      }
    }
    for (const local of listaLocal) {
      if (local.id_servidor && vistos.has(String(local.id_servidor))) continue;
      resultado.push({ ...local, _origem: 'local' });
    }
    return resultado.sort((a, b) => {
      const dataA = a.data_inspecao || a.criado_em || '';
      const dataB = b.data_inspecao || b.criado_em || '';
      return String(dataB).localeCompare(String(dataA));
    });
  }, [listaServidor, listaLocal]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return todos.filter((item) => {
      if (filtroStatus !== 'todos' && item.status !== filtroStatus) return false;
      if (filtroObra && String(item.obra_id) !== String(filtroObra)) return false;
      if (filtroAtividade && String(item.atividade_id) !== String(filtroAtividade)) return false;
      if (!termo) return true;
      return [item.codigo, item.local_inspecao, item.modelo_nome, item.atividade_nome, item.obra_nome, item.inspetor_nome]
        .filter(Boolean)
        .some((valor) => String(valor).toLowerCase().includes(termo));
    });
  }, [todos, busca, filtroStatus, filtroObra, filtroAtividade]);

  const {
    setPaginaAtual, totalPaginas, paginaAtualSegura, itensPagina,
  } = usePaginacao(filtrados, 20, [busca, filtroObra, filtroAtividade, filtroStatus]);

  const total = todos.length;
  const rascunhos = todos.filter((i) => i.status === 'rascunho').length;
  const concluidas = todos.filter((i) => i.status === 'concluida').length;
  const podeEditar = (item) => item.status === 'rascunho'
    && (Number(item.usuario_id) === Number(usuarioAtual?.id) || !item.usuario_id);

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <span className="inline-block w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          <p className="mt-3 text-sm font-semibold text-slate-500">Carregando inspeções...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
            <ClipboardCheck size={22} className="text-primary-600" /> Inspeções
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Checklists de campo, fotos, assinaturas e sincronização em Wi-Fi.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={async () => { await verificarConexao(); await recarregarTudo(); }}
            className="min-h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
          >
            <RefreshCw size={14} className={sincronizando ? 'animate-spin' : ''} /> Atualizar
          </button>
          {pendentes.total > 0 && (
            <button
              type="button"
              onClick={() => setMostrarPendencias(true)}
              className="min-h-10 px-3 rounded-xl border border-amber-200 bg-amber-50 text-xs font-extrabold text-amber-700 flex items-center gap-1.5"
            >
              <AlertTriangle size={14} /> Pendências ({pendentes.total})
            </button>
          )}
          <button
            type="button"
            onClick={() => sincronizarAgora()}
            disabled={sincronizando}
            className="min-h-10 px-3 rounded-xl bg-slate-900 text-white text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw size={14} className={sincronizando ? 'animate-spin' : ''} />
            {sincronizando ? 'Sincronizando...' : 'Sincronizar'}
          </button>
          <button
            type="button"
            onClick={() => setMostrarNova(true)}
            className="min-h-10 px-3 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-extrabold flex items-center gap-1.5"
          >
            <Plus size={15} /> Nova Inspeção
          </button>
        </div>
      </div>

      <div className={`rounded-2xl border px-3.5 py-2.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold ${
        online ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'
      }`}>
        {online ? <Wifi size={14} /> : <WifiOff size={14} />}
        <span>
          {online
            ? (estaEmWifi() ? 'Conectado no Wi-Fi — sincronização disponível.' : 'Conectado por dados móveis — a sincronização será liberada no Wi-Fi.')
            : 'Sem conexão — as inspeções e fotos ficam salvas neste aparelho.'}
        </span>
        {preparandoOffline && (
          <span className="inline-flex items-center gap-1 text-primary-700">
            <Database size={12} /> preparando consulta offline...
          </span>
        )}
        {pacoteInfo?.preparado_em && (
          <span className="text-slate-400 font-medium">
            Consulta offline: {formatarDataHora(pacoteInfo.preparado_em)}
          </span>
        )}
        {pendentes.total > 0 && (
          <span className="ml-auto rounded-full bg-white/70 border border-current px-2 py-0.5">
            {pendentes.inspecoes} inspeção(ões) · {pendentes.fotos} foto(s) pendente(s)
          </span>
        )}
      </div>

      {gestor && (
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          <button
            type="button"
            onClick={() => setAba('lista')}
            className={`px-3 py-1.5 rounded-lg text-xs font-extrabold ${aba === 'lista' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
          >
            Inspeções
          </button>
          <button
            type="button"
            onClick={() => setAba('modelos')}
            className={`px-3 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1 ${aba === 'modelos' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
          >
            <Settings2 size={13} /> Modelos e atividades
          </button>
        </div>
      )}

      {erro && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {erro}
        </div>
      )}

      {aba === 'modelos' && gestor ? (
        <ModelosInspecao
          gestor={gestor}
          online={online}
          mostrarToast={mostrarToast}
          onAtualizar={async () => { await carregarOnline(); await carregarLocal(); }}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { rotulo: 'Total', valor: total, cor: 'text-slate-800', icone: ClipboardCheck },
              { rotulo: 'Rascunhos', valor: rascunhos, cor: 'text-amber-700', icone: Clock },
              { rotulo: 'Concluídas', valor: concluidas, cor: 'text-emerald-700', icone: CheckCircle2 },
              { rotulo: 'Pendentes de envio', valor: pendentes.total, cor: 'text-rose-700', icone: CloudOff },
            ].map(({ rotulo, valor, cor, icone: Icone }) => (
              <div key={rotulo} className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{rotulo}</p>
                  <Icone size={15} className="text-slate-300" />
                </div>
                <p className={`text-2xl font-black leading-tight ${cor}`}>{valor}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="grid sm:grid-cols-4 gap-2">
              <div className="relative sm:col-span-2">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className={`${CLASSE_INPUT} pl-8`}
                  placeholder="Buscar por código, local, modelo, obra ou inspetor..."
                />
              </div>
              <select value={filtroObra} onChange={(e) => setFiltroObra(e.target.value)} className={CLASSE_INPUT}>
                <option value="">Todas as obras</option>
                {opcoes.obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.nome}</option>)}
              </select>
              <select value={filtroAtividade} onChange={(e) => setFiltroAtividade(e.target.value)} className={CLASSE_INPUT}>
                <option value="">Todas as atividades</option>
                {opcoes.atividades.map((atividade) => <option key={atividade.id} value={atividade.id}>{atividade.nome}</option>)}
              </select>
              <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className={CLASSE_INPUT}>
                <option value="todos">Todos os status</option>
                <option value="rascunho">Rascunhos</option>
                <option value="concluida">Concluídas</option>
                <option value="cancelada">Canceladas</option>
              </select>
              {(busca || filtroObra || filtroAtividade || filtroStatus !== 'todos') && (
                <button
                  type="button"
                  onClick={() => { setBusca(''); setFiltroObra(''); setFiltroAtividade(''); setFiltroStatus('todos'); }}
                  className="min-h-10 px-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 flex items-center justify-center gap-1"
                >
                  <X size={13} /> Limpar filtros
                </button>
              )}
            </div>
          </div>

          {itensPagina.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <ClipboardCheck size={34} className="mx-auto text-slate-300" />
              <p className="mt-3 text-sm font-extrabold text-slate-700">Nenhuma inspeção encontrada</p>
              <p className="text-xs text-slate-400 mt-1">
                {opcoes.modelos?.length
                  ? 'Toque em "Nova Inspeção" para começar.'
                  : 'O administrador ainda não cadastrou tipos de inspeção.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {itensPagina.map((item) => {
                const chave = item.id_local || `srv-${item.id_servidor || item.id}`;
                const pendente = item.pendente_sync || item.sync_erro || (item.status === 'concluida' && !item.id_servidor);
                return (
                  <div key={chave} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-extrabold text-slate-800">
                            {item.codigo || 'Rascunho local'}
                          </p>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${CORES_STATUS[item.status] || CORES_STATUS.rascunho}`}>
                            {ROTULO_STATUS[item.status] || item.status}
                          </span>
                          {pendente && <BadgePendente>{item.sync_erro ? 'Erro de envio' : 'Não sincronizada'}</BadgePendente>}
                        </div>
                        <p className="text-xs font-semibold text-slate-600 mt-1">
                          {item.modelo_nome || 'Tipo de inspeção'}{item.atividade_nome ? ` · ${item.atividade_nome}` : ''}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                          <span className="inline-flex items-center gap-1"><Calendar size={11} /> {formatarData(item.data_inspecao)}</span>
                          <span className="inline-flex items-center gap-1"><MapPin size={11} /> {item.local_inspecao || 'Sem local'}</span>
                          <span className="inline-flex items-center gap-1"><User size={11} /> {item.inspetor_nome || 'Inspetor'}</span>
                          {item.obra_nome && <span className="inline-flex items-center gap-1 text-primary-700 font-semibold">{item.obra_nome}</span>}
                        </div>
                        {item.sync_erro && (
                          <p className="mt-2 rounded-lg bg-rose-50 border border-rose-100 px-2 py-1 text-[10px] font-semibold text-rose-700">
                            {item.sync_erro}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => abrirInspecao(item)}
                          className="min-h-9 px-3 rounded-xl bg-slate-900 text-white text-[11px] font-extrabold hover:bg-slate-800"
                        >
                          Abrir
                        </button>
                        <button
                          type="button"
                          onClick={() => imprimir(item)}
                          disabled={!item.id_servidor}
                          className="w-9 h-9 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center disabled:opacity-30"
                          title="PDF"
                        >
                          <FileDown size={14} />
                        </button>
                        {(item._origem === 'local' || gestor) && (
                          <button
                            type="button"
                            onClick={() => setConfirmar({
                              titulo: 'Excluir inspeção',
                              mensagem: `Excluir a inspeção ${item.codigo || 'local'}? Esta ação não pode ser desfeita.`,
                              onConfirmar: () => excluir(item),
                            })}
                            className="w-9 h-9 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 flex items-center justify-center"
                            title="Excluir"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {totalPaginas > 1 && (
            <PaginacaoControle
              paginaAtualSegura={paginaAtualSegura}
              totalPaginas={totalPaginas}
              onAnterior={() => setPaginaAtual((p) => Math.max(1, p - 1))}
              onProximo={() => setPaginaAtual((p) => Math.min(totalPaginas, p + 1))}
            />
          )}
        </>
      )}

      <FormularioNovaInspecao
        aberto={mostrarNova}
        onFechar={() => setMostrarNova(false)}
        onCriar={criar}
        opcoes={opcoes}
        usuarioAtual={usuarioAtual}
        gestor={gestor}
      />

      {aberta && (
        <EditorInspecao
          inspecao={aberta}
          onFechar={() => { setAberta(null); recarregarTudo(); }}
          onAtualizado={() => { carregarLocal(); }}
          onSincronizar={() => sincronizarAgora()}
          onImprimir={() => imprimir(aberta)}
          onExcluir={(item) => setConfirmar({
            titulo: 'Excluir inspeção',
            mensagem: `Excluir a inspeção ${item.codigo || 'local'}? Esta ação não pode ser desfeita.`,
            onConfirmar: () => excluir(item),
          })}
          podeEditar={podeEditar(aberta)}
          sincronizando={sincronizando}
          mostrarToast={mostrarToast}
        />
      )}

      <ModalPendenciasInspecoes
        aberto={mostrarPendencias}
        onFechar={() => setMostrarPendencias(false)}
        pendentes={pendentesDetalhe}
        sincronizando={sincronizando}
        onSincronizar={() => sincronizarAgora()}
        onDescartar={descartarPendencia}
      />

      <ModalConfirmacao
        aberto={confirmar != null}
        titulo={confirmar?.titulo || 'Confirmar'}
        mensagem={confirmar?.mensagem || ''}
        perigo
        onConfirmar={() => confirmar?.onConfirmar?.()}
        onCancelar={() => setConfirmar(null)}
      />

      {toast && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] max-w-[92vw] rounded-xl px-4 py-2.5 text-xs font-bold shadow-2xl ${
          toast.type === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
