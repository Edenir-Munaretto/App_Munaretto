import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  Plus, Search, X, Play, Pause, Camera, Package, ClipboardList, MapPin,
  AlertTriangle, Check, Clock, CalendarClock, FileDown, LayoutGrid,
  FolderKanban, HardHat, Boxes, Trash2, ChevronLeft, Image as ImageIcon,
  Pencil, Building, Printer, ListChecks, RefreshCw, WifiOff, ChevronDown, Archive,
  Upload, FileSpreadsheet,
} from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';
import ModalConfirmacao from '../components/ModalConfirmacao';
import ModalPendenciasSync from '../components/ModalPendenciasSync';
import { comprimirImagem } from '../utils/imagem';
import {
  isModoCampo, setModoCampo, isOffline, usarLocal,
  prepararPacoteCampo, limparPacote, infoPacote,
  getOSLocal, getChecklistLocal, getListaLocal, getProdutosLocal, salvarDetalheLocal, salvarChecklistLocal,
  atualizarStatusLocal, atualizarRespostaLocal, recalcularResumo,
  enfileirarOperacao, enfileirarFoto, contarPendentes,
  salvarResponsavelLocal,
  registrarFalhaDeRede, testarConexao,
} from '../offline/offline';
import { sincronizar } from '../offline/sync';

// ---------------------------------------------------------------------------
// Constantes de domínio (espelham o backend)
// ---------------------------------------------------------------------------

const COLUNAS = [
  { id: 'rascunho', label: 'Rascunho' },
  { id: 'aberta', label: 'Aberta' },
  { id: 'em_andamento', label: 'Em Andamento' },
  { id: 'impedida', label: 'Impedida' },
  { id: 'concluida', label: 'Concluída' },
  { id: 'cancelada', label: 'Cancelada' },
];

// Etapas do "funil ativo" do quadro (exclui o arquivo de encerradas).
const STATUS_PIPELINE = ['rascunho', 'aberta', 'em_andamento', 'impedida'];

const LABEL_STATUS = Object.fromEntries(COLUNAS.map(c => [c.id, c.label]));

// Espelha a máquina de estados do backend — usada como FALLBACK enquanto o
// endpoint /os/transicoes (fonte única) não é carregado.
const TRANSICOES_STATUS = {
  rascunho:    new Set(['aberta', 'cancelada']),
  aberta:      new Set(['em_andamento', 'impedida', 'cancelada']),
  em_andamento: new Set(['impedida', 'concluida', 'cancelada']),
  impedida:    new Set(['em_andamento']),
  concluida:   new Set(),
  cancelada:   new Set(),
};

const LIMITE_PAGINA = 100;

const PRIORIDADES = {
  baixa: { label: 'Baixa', cor: 'bg-slate-100 text-slate-600 border-slate-200' },
  media: { label: 'Média', cor: 'bg-blue-50 text-blue-700 border-blue-200' },
  alta: { label: 'Alta', cor: 'bg-amber-50 text-amber-700 border-amber-300' },
  critica: { label: 'Crítica', cor: 'bg-rose-50 text-rose-700 border-rose-300' },
};

// Semáforo de prazo: vermelho = atrasada, âmbar = vence em <= 3 dias.
function situacaoPrazo(os) {
  if (!os.prazo_entrega || ['concluida', 'cancelada'].includes(os.status)) return null;
  const hoje = new Date();
  const prazo = new Date(`${os.prazo_entrega}T23:59:59`);
  const dias = Math.ceil((prazo - hoje) / 86400000);
  if (dias < 0) return { label: `Atrasada (${Math.abs(dias)}d)`, classe: 'bg-rose-100 text-rose-700 border-rose-200', urgente: true };
  if (dias <= 3) return { label: dias === 0 ? 'Vence hoje' : `Vence em ${dias}d`, classe: 'bg-amber-100 text-amber-800 border-amber-200', urgente: false };
  return null;
}

const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtData = (iso) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
};

// Captura a geolocalização do dispositivo (sem bloqueio por raio).
const capturarGeolocalizacao = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(
    (pos) => resolve(`${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`),
    () => resolve(null),
    { timeout: 8000 },
  );
});

// ---------------------------------------------------------------------------
// Componentes pequenos reutilizáveis
// ---------------------------------------------------------------------------

function BadgePrioridade({ prioridade }) {
  const p = PRIORIDADES[prioridade] || PRIORIDADES.media;
  return (
    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${p.cor}`}>
      {p.label}
    </span>
  );
}

function BadgeStatus({ status }) {
  const cores = {
    rascunho: 'bg-slate-100 text-slate-600',
    aberta: 'bg-sky-100 text-sky-700',
    em_andamento: 'bg-primary-100 text-primary-700',
    impedida: 'bg-orange-100 text-orange-700',
    concluida: 'bg-emerald-100 text-emerald-700',
    cancelada: 'bg-rose-100 text-rose-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${cores[status] || 'bg-slate-100 text-slate-600'}`}>
      {LABEL_STATUS[status] || status}
    </span>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  const cor = toast.type === 'error'
    ? 'bg-rose-50 border-rose-200 text-rose-800'
    : 'bg-emerald-50 border-emerald-200 text-emerald-800';
  const icone = toast.type === 'error' ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600';
  return (
    <div className={`fixed z-[70] rounded-xl shadow-xl border text-sm p-4 flex items-start gap-3 max-w-[calc(100vw-2rem)] sm:max-w-sm animate-in slide-in-from-bottom-4 sm:slide-in-from-top-4 duration-300 ${cor} bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:top-4 sm:bottom-auto`}>
      <div className={`p-1 rounded-full shrink-0 ${icone}`}>
        {toast.type === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold whitespace-pre-line break-words">{toast.message}</p>
        {toast.acao && (
          <button
            onClick={toast.acao.onClick}
            className="mt-1.5 text-xs font-extrabold underline underline-offset-2 hover:opacity-80 cursor-pointer"
          >
            {toast.acao.label}
          </button>
        )}
      </div>
    </div>
  );
}

function BarraMateriais({ os }) {
  const apl = os.total_materiais_aplicado;
  if (!apl) return null;
  return (
    <div className="mt-2 flex justify-between items-center text-[10px] font-semibold text-slate-500">
      <span>Serviços aplicados</span>
      <span>{apl} USC</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card da O.S (usado no Kanban e na lista mobile)
// ---------------------------------------------------------------------------

function CardOS({ os, onClick, draggableProps = {} }) {
  const prazo = situacaoPrazo(os);
  return (
    <div
      {...draggableProps}
      onClick={onClick}
      className={`bg-white rounded-xl border shadow-sm hover:shadow-md transition-all p-3 cursor-pointer ${
        prazo?.urgente ? 'border-l-4 border-l-rose-500 border-y-slate-100 border-r-slate-100' : 'border-slate-100'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-bold text-primary-700">{os.codigo}</span>
        <BadgePrioridade prioridade={os.prioridade} />
      </div>
      <p className="text-sm font-bold text-slate-800 mt-1 truncate">{os.obras?.nome || 'Obra'}</p>
      <p className="text-xs text-slate-400">{os.obras?.clientes?.nome || os.obras?.cliente_celesc || ''}</p>

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {prazo && (
          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold flex items-center gap-1 ${prazo.classe}`}>
            <CalendarClock size={11} />{prazo.label}
          </span>
        )}
        {os.equipes && (
          <span className="px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-[10px] font-semibold text-slate-500 flex items-center gap-1">
            <HardHat size={11} />{os.equipes.nome}
          </span>
        )}
        {os.fotos_count > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-primary-50 border border-primary-200 text-[10px] font-bold text-primary-700 flex items-center gap-1" title={`${os.fotos_count} foto(s) anexada(s)`}>
            <Camera size={11} />{os.fotos_count}
          </span>
        )}
      </div>

      <BarraMateriais os={os} />
    </div>
  );
}

function TabChecklist({ osDetalhe, onAtualizado, mostrarToast, podeEditar }) {
  const [dados, setDados] = useState(null); // {itens, resumo}
  const [carregando, setCarregando] = useState(false);
  const [salvandoItem, setSalvandoItem] = useState(null); // item sendo respondido
  const [enviandoFoto, setEnviandoFoto] = useState(null); // item recebendo foto
  const [fotoAlvo, setFotoAlvo] = useState(null); // item para anexar foto
  const [grupoAberto, setGrupoAberto] = useState(null); // grupo expandido do acordeão
  const inputFotoRef = useRef(null);
  const inicializouGrupo = useRef(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const modoCampo = isModoCampo();

      // 1) No Modo Campo a cópia do dispositivo é a fonte primária de exibição:
      //    renderiza na hora, sem depender de sonda/estado de conexão.
      let localAchado = false;
      if (modoCampo || usarLocal()) {
        const local = await getChecklistLocal(osDetalhe.id);
        if (local) {
          localAchado = true;
          setDados({ itens: local.itens || [], resumo: local.resumo });
        } else if (!modoCampo) {
          mostrarToast('Checklist indisponível offline (baixe o pacote de campo).', 'error');
        }
      }

      // 2) Fora do Modo Campo com conexão: o servidor é a fonte e os erros
      //    continuam visíveis (não mascarar problemas do backend).
      if (!modoCampo) {
        if (!usarLocal()) {
          const res = await apiFetch(`${API_URL}/os/${osDetalhe.id}/checklist`);
          if (res.ok) {
            const dados = await res.json();
            setDados(dados);
          } else {
            mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao carregar checklist.'), 'error');
          }
        }
        return;
      }

      // 3) Modo Campo: atualização em segundo plano e silenciosa. Falha de rede
      //    marca offline imediatamente (failover); erro HTTP do servidor é
      //    ignorado — a tela permanece com a cópia local sem toasts repetidos.
      let okRemoto = false;
      try {
        const res = await apiFetch(`${API_URL}/os/${osDetalhe.id}/checklist`);
        if (res.ok) {
          const dados = await res.json();
          setDados(dados);
          await salvarChecklistLocal(osDetalhe.id, dados);
          okRemoto = true;
        }
      } catch {
        registrarFalhaDeRede();
      }
      if (!localAchado && !okRemoto) {
        mostrarToast('Checklist indisponível offline (baixe o pacote de campo).', 'error');
      }
    } catch {
      if (!isModoCampo()) mostrarToast('Erro de conexão ao carregar checklist.', 'error');
    } finally {
      setCarregando(false);
    }
  }, [osDetalhe.id, mostrarToast]);

  useEffect(() => { carregar(); }, [carregar]);

  // Na primeira carga, abre o primeiro grupo ainda incompleto (ou o primeiro,
  // se todos completos). Depois disso o usuário controla o acordeão.
  useEffect(() => {
    if (!dados || inicializouGrupo.current) return;
    inicializouGrupo.current = true;
    const grupos = (dados.resumo?.grupos || []).filter(g => g.total > 0);
    const alvo = grupos.find(g => g.respondidos < g.total) || grupos[0];
    setGrupoAberto(alvo ? alvo.grupo : null);
  }, [dados]);

  // Reflete uma resposta no pacote local (IndexedDB) e no estado da tela —
  // usado no Modo Campo para a interface não depender do GET /checklist.
  const refletirRespostaLocal = async (item, resposta, gps) => {
    await atualizarRespostaLocal(osDetalhe.id, item.id, resposta, null, gps);
    setDados(prev => {
      if (!prev) return prev;
      const itens = prev.itens.map(i => (i.id === item.id
        ? { ...i, resposta: { item_id: item.id, resposta, justificativa: null, geolocalizacao: gps, criado_em: new Date().toISOString(), respondido_por: 'dispositivo' } }
        : i));
      const resumo = recalcularResumo(itens);
      // Preserva os nomes reais dos grupos vindos do servidor.
      resumo.grupos.forEach((g, i) => {
        const nome = prev.resumo?.grupos?.[i]?.nome;
        if (nome) g.nome = nome;
      });
      return { itens, resumo };
    });
  };

  const responder = async (item, resposta, tentativa = 0) => {
    if (!podeEditar) return;
    setSalvandoItem(item.id);
    const gps = await capturarGeolocalizacao();

    // Offline: grava na fila e reflete localmente.
    if (usarLocal()) {
      try {
        await enfileirarOperacao({
          tipo: 'checklist_resposta',
          os_id: osDetalhe.id,
          payload: { item_id: item.id, resposta, geolocalizacao: gps },
        });
        await refletirRespostaLocal(item, resposta, gps);
        onAtualizado();
        mostrarToast('Resposta salva no dispositivo (será sincronizada).');
      } catch {
        mostrarToast('Falha ao salvar a resposta no dispositivo.', 'error');
      } finally {
        setSalvandoItem(null);
      }
      return;
    }

    try {
      const res = await apiFetch(`${API_URL}/os/${osDetalhe.id}/checklist/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resposta, geolocalizacao: gps }),
      });
      if (res.ok) {
        // No Modo Campo também reflete no pacote local: se o GET do checklist
        // falhar (ex.: problema no servidor), a tela segue consistente.
        if (isModoCampo()) await refletirRespostaLocal(item, resposta, gps);
        carregar();
        onAtualizado();
      } else {
        mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao salvar resposta.'), 'error');
      }
    } catch {
      // Sem internet real (WiFi sem dados): cai para a fila local no Modo Campo.
      if (tentativa === 0 && isModoCampo()) {
        registrarFalhaDeRede();
        return responder(item, resposta, 1);
      }
      mostrarToast('Erro de conexão ao salvar resposta.', 'error');
    } finally {
      setSalvandoItem(null);
    }
  };

  const enviarFoto = async (files, tentativa = 0) => {
    const item = fotoAlvo;
    setFotoAlvo(null);
    if (!item || !files?.length) return;
    setEnviandoFoto(item.id);
    const arquivo = await comprimirImagem(files[0]);
    const gps = await capturarGeolocalizacao();

    // Offline: guarda a foto no dispositivo e enfileira o envio.
    if (usarLocal()) {
      try {
        await enfileirarFoto({ os_id: osDetalhe.id, checklist_item_id: item.id, arquivo, geolocalizacao: gps });
        mostrarToast('Foto salva no dispositivo (será sincronizada).');
        carregar();
        onAtualizado();
      } catch {
        mostrarToast('Falha ao salvar a foto no dispositivo.', 'error');
      } finally {
        setEnviandoFoto(null);
      }
      return;
    }

    const fd = new FormData();
    fd.append('arquivo', arquivo);
    try {
      const qs = gps ? `?geolocalizacao=${encodeURIComponent(gps)}` : '';
      const res = await apiFetch(`${API_URL}/os/${osDetalhe.id}/checklist/${item.id}/foto${qs}`, {
        method: 'POST',
        body: fd,
      });
      if (res.ok) {
        mostrarToast('Foto anexada ao item.');
        carregar();
        onAtualizado();
      } else {
        mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao enviar foto.'), 'error');
      }
    } catch {
      // Sem internet real: guarda no dispositivo (Modo Campo).
      if (tentativa === 0 && isModoCampo()) {
        registrarFalhaDeRede();
        return enviarFoto(files, 1);
      }
      mostrarToast('Erro de conexão ao enviar foto.', 'error');
    } finally {
      setEnviandoFoto(null);
    }
  };

  if (carregando && !dados) {
    return <p className="text-xs text-slate-400 text-center py-8">Carregando checklist...</p>;
  }
  if (!dados) return null;

  const resumo = dados.resumo;
  const itensPorGrupo = {};
  for (const item of dados.itens) {
    (itensPorGrupo[item.grupo] = itensPorGrupo[item.grupo] || []).push(item);
  }

  const marcar = (marcado) => (marcado
    ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50');

  return (
    <div className="space-y-4">
      {/* Resumo geral */}
      <div className={`rounded-xl border px-3 py-2.5 text-xs flex items-center justify-between gap-2 ${
        resumo.inicio_liberado && resumo.completo ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
          : resumo.inicio_liberado ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-rose-50 border-rose-200 text-rose-700'
      }`}>
        <span className="font-bold flex items-center gap-1.5">
          <ListChecks size={14} />
          {resumo.respondidos}/{resumo.total} respondidos
          {!resumo.inicio_liberado && ' · checklist de início pendente'}
          {resumo.inicio_liberado && !resumo.completo && ' · em andamento'}
          {resumo.completo && ' · completo'}
        </span>
        <span className="text-[10px] font-semibold">{resumo.completo ? '✓' : ''}</span>
      </div>

      {!podeEditar && (
        <p className="text-[10px] font-bold text-slate-400 text-center">O checklist desta O.S está encerrado (somente leitura).</p>
      )}

      {dados.itens.length === 0 && (
        <p className="text-xs text-slate-400 text-center py-6">Nenhum item de checklist configurado para esta O.S.</p>
      )}

      {/* Grupos do checklist: cards em linha — clique expande no lugar,
          empurrando os demais cards para baixo (1 grupo aberto por vez) */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100">
        {resumo.grupos.filter(g => g.total > 0).map(grupo => {
          const aberto = grupoAberto === grupo.grupo;
          const completo = grupo.completo;
          const itens = itensPorGrupo[grupo.grupo] || [];
          return (
            <div key={grupo.grupo}>
              <button
                type="button"
                onClick={() => setGrupoAberto(aberto ? null : grupo.grupo)}
                aria-expanded={aberto}
                title={`Grupo ${grupo.grupo} · ${grupo.nome}`}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer transition-colors ${
                  aberto ? 'bg-primary-50' : 'bg-white hover:bg-slate-50'
                }`}
              >
                <span className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-xs font-black transition-colors ${
                  completo ? 'bg-emerald-100 text-emerald-700'
                    : aberto ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                  {completo ? <Check size={16} /> : grupo.grupo}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      <span className="text-sm font-extrabold text-slate-700">Grupo {grupo.grupo}</span>
                      <span className="text-xs font-semibold text-slate-400"> · {grupo.nome}</span>
                    </span>
                    <span className={`shrink-0 text-[10px] font-bold rounded-full px-2 py-0.5 ${
                      completo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {grupo.respondidos}/{grupo.total}
                    </span>
                  </span>
                  <span className="block h-1 mt-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <span className="block h-full bg-primary-500 transition-all"
                      style={{ width: `${grupo.total ? (grupo.respondidos / grupo.total) * 100 : 0}%` }} />
                  </span>
                </span>
                <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${aberto ? 'rotate-180 text-primary-600' : ''}`} />
              </button>
              {aberto && (
                <div className="bg-white border-t border-slate-100 divide-y divide-slate-50">
                  {itens.map(item => {
                    const resp = item.resposta;
                    const resposta = resp?.resposta;
                    const justificativa = resp?.justificativa || '';
                    const temFoto = item.fotos?.length > 0;
                    const botaoFoto = podeEditar && (item.exige_foto || temFoto);
                    return (
                      <div key={item.id} className="px-3 py-2.5">
                        <div className="flex items-start gap-2">
                          <span className="font-mono text-[10px] font-bold text-slate-400 pt-1 w-9 shrink-0">{item.classificacao}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-slate-700 leading-tight">{item.pergunta}</p>
                            {item.exige_foto && (
                              <p className="text-[9px] font-bold text-amber-600 mt-0.5">📷 evidência fotográfica</p>
                            )}
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              {podeEditar ? (
                                <>
                                  {[['sim', 'Sim'], ['nao', 'Não'], ['na', 'N/A']].map(([valor, rotulo]) => (
                                    <button key={valor}
                                      disabled={salvandoItem === item.id}
                                      onClick={() => responder(item, valor)}
                                      className={`px-3 py-1 rounded-lg border text-[11px] font-bold transition-all cursor-pointer disabled:opacity-40 ${marcar(resposta === valor)}`}>
                                      {rotulo}
                                    </button>
                                  ))}
                                  {salvandoItem === item.id && <span className="text-[10px] text-slate-400">salvando...</span>}
                                </>
                              ) : (
                                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                                  resposta === 'sim' ? 'bg-emerald-100 text-emerald-700'
                                    : resposta === 'nao' ? 'bg-rose-100 text-rose-700'
                                    : resposta === 'na' ? 'bg-slate-100 text-slate-500' : 'bg-white text-slate-300 border border-slate-200'
                                }`}>
                                  {resposta ? ({ sim: 'Sim', nao: 'Não', na: 'N/A' })[resposta] : 'Sem resposta'}
                                </span>
                              )}
                              {resposta && (
                                <span className="text-[10px] text-slate-400 font-semibold">
                                  {fmtData(resp.criado_em)} {resp.respondido_por ? `· ${resp.respondido_por}` : ''}
                                </span>
                              )}
                              {botaoFoto && (
                                <button
                                  onClick={() => setFotoAlvo(item)}
                                  disabled={enviandoFoto === item.id}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-primary-200 bg-primary-50 text-primary-700 text-[10px] font-bold hover:bg-primary-100 transition-all cursor-pointer disabled:opacity-40"
                                >
                                  <Camera size={11} />
                                  {enviandoFoto === item.id ? 'Enviando...' : temFoto ? 'Trocar foto' : 'Foto'}
                                </button>
                              )}
                            </div>
                            {resposta === 'nao' && justificativa && (
                              <p className="text-[10px] text-rose-600 font-semibold mt-1">Justificativa: {justificativa}</p>
                            )}
                            {temFoto && (
                              <div className="flex gap-2 mt-1.5">
                                {item.fotos.map(f => (
                                  <a key={f.id} href={f.url_temporaria} target="_blank" rel="noopener noreferrer" title="Abrir foto">
                                    <img src={f.url_temporaria} alt={f.nome_original}
                                      className="w-16 h-16 rounded-lg object-cover border border-slate-200" loading="lazy" />
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <input
        ref={inputFotoRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          if (e.target.files?.length) enviarFoto(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      {fotoAlvo && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center animate-in fade-in zoom-in duration-200">
            <div className="w-12 h-12 mx-auto rounded-full bg-primary-50 border border-primary-100 flex items-center justify-center mb-3">
              <Camera size={22} className="text-primary-600" />
            </div>
            <h4 className="text-sm font-extrabold text-slate-800 mb-1">Evidência fotográfica</h4>
            <p className="text-xs text-slate-500 mb-5">{fotoAlvo.classificacao} {fotoAlvo.pergunta}</p>
            <div className="space-y-2">
              <button onClick={() => inputFotoRef.current?.click()}
                className="w-full py-3 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 cursor-pointer">
                Tirar / Escolher foto
              </button>
              <button onClick={() => setFotoAlvo(null)}
                className="w-full py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 cursor-pointer">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Abas compartilhadas entre o drawer do gestor e a tela de campo (mobile)
// ---------------------------------------------------------------------------

function TabInsumos({ osDetalhe, produtos, onAtualizado, mostrarToast, podeEditar, podeEstornar }) {
  const [buscaProduto, setBuscaProduto] = useState('');
  const [qtd, setQtd] = useState(1);
  const [tipoUsc, setTipoUsc] = useState('normal');
  const [salvando, setSalvando] = useState(false);
  const [estornandoId, setEstornandoId] = useState(null); // ID do lançamento aguardando confirmação

  // Catálogo do CONTRATO da O.S: só serviços do mesmo tipo (ou legados sem tipo).
  const catalogoDoContrato = useMemo(() => {
    const tipoOs = osDetalhe.tipo;
    return produtos.filter(p => !p.tipo || p.tipo === tipoOs);
  }, [produtos, osDetalhe.tipo]);

  // Autocompletar: filtra o catálogo local pelo que foi digitado/bipado
  // (nome, código normal OU código especial).
  const sugestoes = useMemo(() => {
    const termo = buscaProduto.trim().toLowerCase();
    if (!termo) return [];
    return catalogoDoContrato
      .filter(p =>
        p.nome.toLowerCase().includes(termo) ||
        (p.codigo || '').toLowerCase().includes(termo) ||
        (p.codigo_especial || '').toLowerCase().includes(termo)
      )
      .slice(0, 6);
  }, [buscaProduto, catalogoDoContrato]);

  const selecionado = useMemo(
    () => catalogoDoContrato.find(p => p.id === Number(buscaProduto)) || null,
    [buscaProduto, catalogoDoContrato],
  );

  // Ao selecionar uma sugestão, exibe o nome do serviço (o estado guarda o ID).
  const textoBusca = selecionado ? selecionado.nome : buscaProduto;

  // Código vigente conforme o tipo escolhido: bipagem/digitação do código
  // ESPECIAL seleciona o serviço já com "USC especial" (mesma descrição, dois
  // códigos distintos).
  const codigoAtivo = tipoUsc === 'especial'
    ? selecionado?.codigo_especial || selecionado?.codigo
    : selecionado?.codigo || selecionado?.codigo_especial;

  const tipoDaSelecao = (p) => {
    const termo = String(buscaProduto || '').trim().toLowerCase();
    if (p.codigo_especial && termo === String(p.codigo_especial).trim().toLowerCase()) return 'especial';
    return 'normal';
  };

  // Ao digitar/bipar: se o termo for EXATAMENTE o código de um serviço, já
  // seleciona o serviço e define o tipo correspondente (normal/especial).
  const aoBuscar = (texto) => {
    setBuscaProduto(texto);
    const termo = String(texto || '').trim().toLowerCase();
    if (termo.length < 2) return;
    const porEspecial = catalogoDoContrato.find(p =>
      p.codigo_especial && String(p.codigo_especial).trim().toLowerCase() === termo);
    if (porEspecial) {
      setBuscaProduto(String(porEspecial.id));
      setTipoUsc('especial');
      return;
    }
    const porNormal = catalogoDoContrato.find(p =>
      p.codigo && String(p.codigo).trim().toLowerCase() === termo);
    if (porNormal) {
      setBuscaProduto(String(porNormal.id));
      setTipoUsc('normal');
    }
  };

  // Fatores de conversão do cadastro do produto (USC normal / USC especial).
  const uscNormal = Number(selecionado?.preco_unitario || 0);
  const uscEspecial = Number(selecionado?.qtd_usc_especial || 0);
  const temUsc = uscNormal > 0 || uscEspecial > 0;
  const fatorUsc = tipoUsc === 'especial' ? uscEspecial : uscNormal;
  const totalUsc = temUsc && fatorUsc > 0 ? Number((qtd * fatorUsc).toFixed(3)) : qtd;

  const lancar = async () => {
  const produto = selecionado || (sugestoes.length === 1 ? sugestoes[0] : null);
  if (!produto) {
    mostrarToast('Selecione um serviço da lista.', 'error');
    return;
  }
    setSalvando(true);
    try {
      // Offline (Modo Campo): entra na fila e reflete localmente; o servidor
      // revalida e converte na sincronização (mesma lógica USC do gestor).
      if (usarLocal()) {
        await enfileirarOperacao({
          tipo: 'material',
          os_id: osDetalhe.id,
          payload: { produto_id: produto.id, quantidade_usada: qtd, tipo_usc: tipoUsc },
        });
        const local = await getOSLocal(osDetalhe.id);
        if (local) {
          const materiais = local.materiais || { itens: [], total_aplicado: 0 };
          const itens = materiais.itens || [];
          let item = itens.find(i => i.produto_id === produto.id);
          if (!item) {
            item = {
              produto_id: produto.id, nome: produto.nome, unidade: produto.unidade || '-',
              aplicado: 0, aplicado_normal: 0, aplicado_especial: 0,
            };
            itens.push(item);
          }
          item.aplicado = Number((item.aplicado + totalUsc).toFixed(3));
          if (tipoUsc === 'especial') item.aplicado_especial = Number((item.aplicado_especial + totalUsc).toFixed(3));
          else item.aplicado_normal = Number((item.aplicado_normal + totalUsc).toFixed(3));
          materiais.total_aplicado = Number(((materiais.total_aplicado || 0) + totalUsc).toFixed(3));
          local.materiais = materiais;
          local.ultimos_lancamentos = [
            {
              id: Date.now(),
              produto_id: produto.id,
              quantidade_usada: totalUsc,
              quantidade_pecas: qtd,
              fator_usc: temUsc && fatorUsc > 0 ? fatorUsc : 0,
              tipo_usc: tipoUsc,
              codigo_servico: tipoUsc === 'especial'
                ? produto.codigo_especial || produto.codigo || null
                : produto.codigo || produto.codigo_especial || null,
              data_lancamento: new Date().toISOString(),
              produtos: { nome: produto.nome, unidade: produto.unidade || '-' },
            },
            ...(local.ultimos_lancamentos || []),
          ].slice(0, 10);
          await salvarDetalheLocal(local);
        }
        mostrarToast(`Serviço "${produto.nome}" lançado (${totalUsc} USC) — será sincronizado ao reconectar.`);
        setBuscaProduto('');
        setQtd(1);
        setTipoUsc('normal');
        onAtualizado();
        return;
      }
      const res = await apiFetch(`${API_URL}/os/${osDetalhe.id}/materiais`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto_id: produto.id, quantidade_usada: qtd, tipo_usc: tipoUsc }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        mostrarToast(`Serviço "${produto.nome}" lançado (${totalUsc} ${temUsc ? (tipoUsc === 'especial' ? 'USC especial' : 'USC normal') : produto.unidade}).`);
        setBuscaProduto('');
        setQtd(1);
        setTipoUsc('normal');
        onAtualizado();
      } else {
        mostrarToast(erroDaResposta(data, 'Erro ao lançar serviço.'), 'error');
      }
    } catch {
      mostrarToast('Erro de conexão ao lançar serviço.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  const estornar = async (id) => {
    // Chamado só após confirmação no ModalConfirmacao
    setEstornandoId(null);
    try {
      const res = await apiFetch(`${API_URL}/os/${osDetalhe.id}/materiais/${id}`, { method: 'DELETE' });
      if (res.ok) {
        mostrarToast('Lançamento estornado.');
        onAtualizado();
      } else {
        mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao estornar.'), 'error');
      }
    } catch {
      mostrarToast('Erro de conexão ao estornar.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* O.S encerrada: apenas o gestor pode lançar/estornar serviços */}
      {podeEditar && ['concluida', 'cancelada'].includes(osDetalhe.status) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] font-bold text-amber-700 flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          O.S encerrada: lançamentos e estornos são permitidos apenas ao gestor.
        </div>
      )}
      {/* Busca rápida com autocompletar (bipagem ou digitação) */}
      <div className="relative">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Buscar serviço (nome ou código)</label>
        <input
          type="text"
          value={textoBusca}
          onChange={(e) => aoBuscar(e.target.value)}
          placeholder="Bipe ou digite nome ou código (normal/especial)..."
          disabled={!podeEditar}
          className={`w-full px-3.5 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm ${selecionado ? 'pr-9' : ''}`}
        />
        {selecionado && (
          <button
            type="button"
            onClick={() => { setBuscaProduto(''); setTipoUsc('normal'); }}
            title="Limpar seleção"
            className="absolute right-2.5 top-[30px] w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <X size={14} />
          </button>
        )}
        {!selecionado && sugestoes.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
            {sugestoes.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setBuscaProduto(String(p.id)); setTipoUsc(tipoDaSelecao(p)); }}
                className="w-full text-left px-3 py-2 hover:bg-primary-50 text-sm text-slate-700 flex flex-col gap-0.5 cursor-pointer"
              >
                <span className="flex items-center justify-between gap-2 w-full">
                  <span className="font-semibold truncate">{p.nome}</span>
                  <span className="text-xs text-slate-400 shrink-0">{p.unidade} · USC {p.preco_unitario}{Number(p.qtd_usc_especial || 0) > 0 ? ` + ${p.qtd_usc_especial}` : ''}</span>
                </span>
                {(p.codigo || p.codigo_especial) && (
                  <span className="text-[10px] font-semibold text-slate-400 w-full">
                    {p.codigo ? `Cod.: ${p.codigo}` : ''}
                    {p.codigo && p.codigo_especial ? ' · ' : ''}
                    {p.codigo_especial ? `Esp.: ${p.codigo_especial}` : ''}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {/* Feedback explícito quando não há produtos encontrados */}
        {!selecionado && buscaProduto.trim().length >= 2 && sugestoes.length === 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
            <p className="px-3 py-3 text-xs text-slate-400 text-center">Nenhum serviço encontrado para “{buscaProduto}”</p>
          </div>
        )}
        {catalogoDoContrato.length === 0 && (
          <p className="text-[10px] font-bold text-amber-600 mt-1.5">
            Nenhum serviço cadastrado para este contrato. Cadastre em Serviços (com o contrato correspondente).
          </p>
        )}
      </div>

      {/* Tipo de USC: o fator vem do cadastro do serviço (ex.: 0.48 normal / 0.67 especial) */}
      {selecionado && temUsc && (
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">Tipo de USC</label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!podeEditar}
              onClick={() => setTipoUsc('normal')}
              className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border cursor-pointer disabled:opacity-40 ${
                tipoUsc === 'normal'
                  ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-primary-300'
              }`}
            >
              USC normal {uscNormal > 0 && <span className={tipoUsc === 'normal' ? 'text-primary-100' : 'text-slate-400'}>· {uscNormal}</span>}
            </button>
            {uscEspecial > 0 && (
              <button
                type="button"
                disabled={!podeEditar}
                onClick={() => setTipoUsc('especial')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border cursor-pointer disabled:opacity-40 ${
                  tipoUsc === 'especial'
                    ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'
                }`}
              >
                USC especial · {uscEspecial}
              </button>
            )}
          </div>
          {temUsc && fatorUsc > 0 && (
            <p className="text-[10px] font-semibold text-slate-400 mt-1.5">
              {qtd} {selecionado.unidade} × {fatorUsc} USC = <b className="text-slate-600">{totalUsc} USC {tipoUsc === 'especial' ? 'especial' : 'normal'}</b>
            </p>
          )}
        </div>
      )}

      {/* Código vigente conforme o tipo escolhido (mesmo serviço, códigos distintos) */}
      {selecionado && codigoAtivo && (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-500 flex items-center justify-between gap-2 -mt-1">
          <span>
            Código {tipoUsc === 'especial' ? 'especial' : 'normal'} aplicado:
          </span>
          <span className={`font-mono font-bold px-2 py-0.5 rounded-md border ${
            tipoUsc === 'especial'
              ? 'bg-violet-50 text-violet-700 border-violet-200'
              : 'bg-primary-50 text-primary-700 border-primary-200'
          }`}>
            {codigoAtivo}
          </span>
        </div>
      )}

      {/* Seletor numérico grande "+" e "-" e aplicação em linha própria */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={!podeEditar}
            onClick={() => setQtd(q => Math.max(0.5, Number((q - (q > 1 ? 1 : 0.5)).toFixed(2))))}
            className="w-12 h-12 shrink-0 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-2xl font-black flex items-center justify-center disabled:opacity-40 cursor-pointer"
          >
            −
          </button>
          <input
            type="number"
            min="0"
            step="0.5"
            value={qtd}
            onChange={(e) => setQtd(Number(e.target.value))}
            disabled={!podeEditar}
            className="w-28 h-12 text-center text-lg font-bold border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
          <button
            type="button"
            disabled={!podeEditar}
            onClick={() => setQtd(q => Number((q + (q < 1 ? 0.5 : 1)).toFixed(2)))}
            className="w-12 h-12 shrink-0 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-2xl font-black flex items-center justify-center disabled:opacity-40 cursor-pointer"
          >
            +
          </button>
        </div>
        <button
          type="button"
          onClick={lancar}
          disabled={!podeEditar || salvando}
          className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer"
        >
          <Package size={18} />{salvando ? 'Salvando...' : 'Aplicar'}
        </button>
      </div>
      {/* Resumo do serviço selecionado: total já aplicado (USC) */}
      {selecionado && (() => {
        const item = (osDetalhe.materiais?.itens || []).find(i => i.produto_id === selecionado.id);
        const aplicado = item?.aplicado ?? 0;
        return (
          <div className="rounded-xl border px-3 py-2 text-xs flex flex-wrap gap-3 items-center -mt-1 bg-slate-50 border-slate-100">
            <span className="text-slate-500">Selecionado: <b className="text-slate-700">{selecionado.nome}</b> ({selecionado.unidade})</span>
            <span className="text-slate-400">│</span>
            <span className="text-slate-500">Aplicado até agora: <b className="text-slate-700">{aplicado} USC</b></span>
          </div>
        );
      })()}

      {/* Serviços aplicados nesta O.S */}
      <div className="bg-slate-50 rounded-xl border border-slate-100 divide-y divide-slate-100">
        {(osDetalhe.materiais?.itens || []).map(item => (
          <div key={item.produto_id} className="px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-700 truncate">{item.nome}</p>
              <p className="text-xs text-slate-400">
                {item.aplicado} USC {item.unidade}
              </p>
            </div>
            <span className="text-xs font-bold shrink-0 text-slate-500">
              {item.aplicado} USC
            </span>
          </div>
        ))}
        {!(osDetalhe.materiais?.itens || []).length && (
            <p className="px-3 py-4 text-center text-xs text-slate-400">Nenhum serviço aplicado ainda.</p>
        )}
      </div>

      {/* Últimos lançamentos com opção de estorno */}
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase mb-1.5">Últimos lançamentos</p>
        <div className="space-y-1">
          {(osDetalhe.lancamentos || []).slice(0, 8).map(l => {
            const pecas = Number(l.quantidade_pecas || 0);
            const fator = Number(l.fator_usc || 0);
            const nome = l.produtos?.nome || l.produto_nome || '';
            const rotuloTipo = l.tipo_usc === 'especial' ? 'USC especial' : 'USC normal';
            const usaConta = pecas > 0 && fator > 0;
            return (
              <div key={l.id} className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2 gap-2">
                <span className="text-xs text-slate-600 min-w-0 truncate">
                  <span className="truncate">
                    {fmtData(l.data_lancamento)} · {nome} —{' '}
                    {usaConta
                      ? `${pecas} × ${rotuloTipo} (${fator}) = ${l.quantidade_usada} USC`
                      : `${l.quantidade_usada} × ${nome}`}
                  </span>
                  {l.codigo_servico && (
                    <span className="ml-1.5 shrink-0 font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-slate-200 bg-white text-slate-500">
                      {l.codigo_servico}
                    </span>
                  )}
                  {l.tipo_usc && (
                    <span className={`ml-1.5 shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                      l.tipo_usc === 'especial'
                        ? 'bg-violet-50 text-violet-700 border-violet-200'
                        : 'bg-primary-50 text-primary-700 border-primary-200'
                    }`}>
                      {rotuloTipo}
                    </span>
                  )}
                </span>
                {podeEstornar && (
                  <button onClick={() => setEstornandoId(l.id)} className="text-slate-300 hover:text-rose-600 cursor-pointer shrink-0" title="Estornar">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
          {!(osDetalhe.lancamentos || []).length && (
            <p className="text-xs text-slate-400">Sem lançamentos individuais.</p>
          )}
        </div>
      </div>

      {/* Confirmação de estorno */}
      <ModalConfirmacao
        aberto={estornandoId != null}
        titulo="Estornar lançamento"
            mensagem="Estornar este lançamento de serviço? Esta ação não pode ser desfeita."
        confirmarTexto="Estornar"
        onConfirmar={() => estornar(estornandoId)}
        onCancelar={() => setEstornandoId(null)}
      />
    </div>
  );
}

function TabEvidencias({ osDetalhe, onAtualizado, mostrarToast, podeEditar, podeExcluir }) {
  const [fotos, setFotos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [fotoParaExcluir, setFotoParaExcluir] = useState(null); // ID aguardando confirmação
  const inputRef = useRef(null);

  const carregarFotos = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_URL}/os/${osDetalhe.id}/fotos`);
      if (res.ok) setFotos(await res.json());
    } catch {
      /* silencioso: aba apenas fica vazia */
    }
  }, [osDetalhe.id]);

  useEffect(() => { carregarFotos(); }, [carregarFotos]);

  const enviarArquivos = async (files) => {
    setEnviando(true);
    let ok = 0;
    for (const original of files) {
      const arquivo = await comprimirImagem(original);
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      try {
        const res = await apiFetch(`${API_URL}/os/${osDetalhe.id}/fotos`, { method: 'POST', body: fd });
        if (res.ok) ok += 1;
        else mostrarToast(erroDaResposta(await res.json().catch(() => null), `Falha ao enviar ${arquivo.name}.`), 'error');
      } catch {
        mostrarToast(`Erro de conexão ao enviar ${arquivo.name}.`, 'error');
      }
    }
    if (ok) mostrarToast(`${ok} foto(s) anexada(s).`);
    setEnviando(false);
    carregarFotos();
    onAtualizado();
  };

  const excluirFoto = async (id) => {
    setFotoParaExcluir(null);
    try {
      const res = await apiFetch(`${API_URL}/os/${osDetalhe.id}/fotos/${id}`, { method: 'DELETE' });
      if (res.ok) { carregarFotos(); onAtualizado(); }
      else mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao excluir foto.'), 'error');
    } catch {
      mostrarToast('Erro ao excluir foto.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Botão grande de câmera: captura direta no celular */}
      <button
        type="button"
        disabled={!podeEditar || enviando}
        onClick={() => inputRef.current?.click()}
        className="w-full h-24 rounded-2xl border-2 border-dashed border-primary-300 bg-primary-50/60 hover:bg-primary-50 text-primary-700 font-bold flex flex-col items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer transition-all"
      >
        <Camera size={28} />
        {enviando ? 'Enviando...' : 'Tirar / Anexar Foto'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) enviarArquivos(Array.from(e.target.files));
          e.target.value = '';
        }}
      />

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {fotos.map(f => (
          <div key={f.id} className="relative group aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
            <img src={f.url_temporaria} alt={f.nome_original} className="w-full h-full object-cover" loading="lazy" />
            {podeExcluir && (
              <button
                onClick={() => setFotoParaExcluir(f.id)}
                className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                title="Excluir"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        {!fotos.length && (
          <div className="col-span-full text-center py-6 text-xs text-slate-400 flex flex-col items-center gap-1">
            <ImageIcon size={22} />
            Nenhuma evidência anexada ainda.
          </div>
        )}
      </div>

      {/* Confirmação de exclusão de evidência */}
      <ModalConfirmacao
        aberto={fotoParaExcluir != null}
        titulo="Excluir evidência"
        mensagem={
          osDetalhe.status === 'impedida'
            ? 'Esta O.S está IMPEDIDA — a foto pode ser a única evidência do impedimento. Excluir mesmo assim?'
            : 'Excluir esta foto? Esta ação não pode ser desfeita.'
        }
        onConfirmar={() => excluirFoto(fotoParaExcluir)}
        onCancelar={() => setFotoParaExcluir(null)}
      />
    </div>
  );
}

function TabTimeline({ historico }) {
  if (!historico?.length) {
    return <p className="text-xs text-slate-400 text-center py-6">Sem eventos registrados.</p>;
  }
  return (
    <div className="relative pl-5 space-y-4 before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-0.5 before:bg-slate-100">
      {[...historico].reverse().map(h => (
        <div key={h.id} className="relative">
          <span className={`absolute -left-5 top-1 w-3.5 h-3.5 rounded-full border-2 border-white ${
            h.status_novo === 'impedida' ? 'bg-orange-500'
              : ['concluida'].includes(h.status_novo) ? 'bg-emerald-500'
              : ['cancelada'].includes(h.status_novo) ? 'bg-rose-500'
              : 'bg-primary-500'
          }`} />
          <p className="text-sm font-bold text-slate-700">
            {LABEL_STATUS[h.status_novo] || h.status_novo}
            {h.status_anterior && (
              <span className="text-xs font-medium text-slate-400"> (de {LABEL_STATUS[h.status_anterior]?.toLowerCase() || h.status_anterior})</span>
            )}
          </p>
          {h.justificativa && <p className="text-xs text-slate-500 mt-0.5 italic">&ldquo;{h.justificativa}&rdquo;</p>}
          <p className="text-[10px] text-slate-400 mt-0.5">
            {fmtData(h.criado_em)} · {h.usuario_alteracao || '-'}
            {h.geolocalizacao_log && ` · 📍 ${h.geolocalizacao_log}`}
          </p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel de execução (drawer do gestor e tela cheia no mobile)
// ---------------------------------------------------------------------------

// Formata segundos como HH:MM:SS
function formatarTempo(segundos) {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function CronometroHH({ osDetalhe, capturarGps, onAtualizado, mostrarToast, podeEditar }) {
  const [processando, setProcessando] = useState(false);
  const [segundosDecorridos, setSegundosDecorridos] = useState(0);
  const aberto = osDetalhe.cronometro_aberto;

  // Atualiza o contador a cada segundo enquanto o cronômetro está ativo
  useEffect(() => {
    if (!aberto?.inicio) {
      setSegundosDecorridos(0);
      return;
    }
    const calcular = () => {
      const inicio = new Date(aberto.inicio);
      const agora = new Date();
      setSegundosDecorridos(Math.max(0, Math.floor((agora - inicio) / 1000)));
    };
    calcular();
    const intervalo = setInterval(calcular, 1000);
    return () => clearInterval(intervalo);
  }, [aberto?.inicio]);

  const acionar = async (acao, tentativa = 0) => {
    setProcessando(true);
    // Localização real no momento da ação (não reutiliza check-in antigo).
    const gps = await capturarGps();

    // Offline: registra na fila com o horário real do dispositivo.
    if (usarLocal()) {
      try {
        await enfileirarOperacao({
          tipo: acao === 'play' ? 'apontamento_play' : 'apontamento_pause',
          os_id: osDetalhe.id,
          payload: { geolocalizacao: gps },
        });
        mostrarToast(acao === 'play'
          ? 'Início registrado no dispositivo (será sincronizado).'
          : 'Pausa registrada no dispositivo (será sincronizada).');
        // Reflexo otimista do cronômetro aberto.
        onAtualizado();
      } catch {
        mostrarToast('Falha ao registrar o apontamento no dispositivo.', 'error');
      } finally {
        setProcessando(false);
      }
      return;
    }

    try {
      const url = `${API_URL}/os/${osDetalhe.id}/apontamentos${gps ? `?geolocalizacao=${encodeURIComponent(gps)}` : ''}`;
      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        mostrarToast(acao === 'play' ? 'Cronômetro iniciado.' : `Pausa registrada (${data.minutos_trabalhados} min).`);
        onAtualizado();
      } else {
        mostrarToast(erroDaResposta(data, 'Erro no apontamento.'), 'error');
      }
    } catch {
      // Sem internet real: registra na fila local (Modo Campo).
      if (tentativa === 0 && isModoCampo()) {
        registrarFalhaDeRede();
        return acionar(acao, 1);
      }
      mostrarToast('Erro de conexão no apontamento de horas.', 'error');
    } finally {
      setProcessando(false);
    }
  };

  if (!podeEditar) return null;
  const desabilitado = ['rascunho', 'impedida', 'concluida', 'cancelada'].includes(osDetalhe.status);

  return (
    <div className="space-y-2">
      <button
        onClick={() => acionar(aberto ? 'pause' : 'play')}
        disabled={desabilitado || processando}
        className={`w-full h-16 rounded-2xl text-white font-extrabold text-base flex items-center justify-center gap-3 shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
          aberto ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-900/20' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-900/20'
        }`}
      >
        {aberto ? <><Pause size={26} /> PAUSAR TRABALHO</> : <><Play size={26} /> INICIAR TRABALHO</>}
      </button>
      {/* Cronômetro visual em tempo real */}
      {aberto && (
        <div className="flex items-center justify-center gap-2 bg-amber-50 border border-amber-200 rounded-xl py-2">
          <Clock size={14} className="text-amber-600 animate-pulse" />
          <span className="font-mono text-lg font-extrabold text-amber-700 tabular-nums tracking-wider">
            {formatarTempo(segundosDecorridos)}
          </span>
          <span className="text-xs text-amber-500 font-semibold">em andamento</span>
        </div>
      )}
    </div>
  );
}

// Botões de transição de status direto no painel — essencial no modo campo,
// onde não há drag-and-drop. Transições irreversíveis pedem confirmação.
// O checklist de execução bloqueia o início (grupo 1) e a conclusão.
function AcoesStatus({ detalhe, podeEditar, mudarStatus, aoAplicado, ehGestor, transicoesMap, onAbrirChecklist, mostrarToast }) {
  const [destinoConfirmar, setDestinoConfirmar] = useState(null);
  const [processando, setProcessando] = useState(false);

  if (!podeEditar) return null;
  const alvos = transicoesMap[detalhe.status] || new Set();
  // 'impedida' fica fora dos botões: exige justificativa + fotos (modal dedicado do Kanban).
  const principal = detalhe.status === 'rascunho' && alvos.has('aberta') ? 'aberta' : null;
  const retomar = detalhe.status === 'impedida' && alvos.has('em_andamento');
  const iniciar = detalhe.status === 'aberta' && alvos.has('em_andamento');
  const podeCancelar = alvos.has('cancelada') && ehGestor;
  const concluir = alvos.has('concluida');

  const checklist = detalhe.checklist;

  const liberarInicio = async () => {
    if (checklist && !checklist.inicio_liberado) {
      mostrarToast('Preencha o checklist de início (Grupo 1 - Preparação) para liberar a execução.', 'error');
      onAbrirChecklist?.();
      return false;
    }
    const ok = await mudarStatus(detalhe, 'em_andamento');
    if (ok) aoAplicado();
    return ok;
  };

  const concluirOs = () => {
    if (checklist && !checklist.completo) {
      const faltam = checklist.total - checklist.respondidos;
      mostrarToast(`O checklist da O.S está incompleto (${faltam} item(ns) pendente(s)).`, 'error');
      onAbrirChecklist?.();
      return;
    }
    setDestinoConfirmar('concluida');
  };

  const aplicar = async () => {
    setProcessando(true);
    const ok = await mudarStatus(detalhe, destinoConfirmar);
    setProcessando(false);
    setDestinoConfirmar(null);
    if (ok) aoAplicado();
  };

  if (!principal && !retomar && !iniciar && !concluir && !podeCancelar) return null;

  return (
    <div className="space-y-2">
      {(principal || iniciar || retomar) && (
        <button
          onClick={principal ? () => mudarStatus(detalhe, 'aberta').then(ok => ok && aoAplicado()) : liberarInicio}
          className="w-full h-11 rounded-xl border border-primary-200 bg-primary-50 hover:bg-primary-100 text-primary-700 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-all"
        >
          <Play size={16} /> {principal ? 'Ativar O.S' : retomar ? 'Retomar Execução' : 'Iniciar Execução'}
        </button>
      )}
      <div className={`grid ${concluir && podeCancelar ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
        {concluir && (
          <button
            onClick={concluirOs}
            className="h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-40"
            disabled={processando}
          >
            <Check size={15} /> Concluir O.S
          </button>
        )}
        {podeCancelar && (
          <button
            onClick={() => setDestinoConfirmar('cancelada')}
            className="h-11 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-40"
            disabled={processando}
          >
            <X size={15} /> Cancelar O.S
          </button>
        )}
      </div>

      <ModalConfirmacao
        aberto={!!destinoConfirmar}
        titulo={destinoConfirmar === 'concluida' ? 'Concluir O.S' : 'Cancelar O.S'}
        mensagem={
          destinoConfirmar === 'concluida'
            ? `Confirmar a conclusão da O.S ${detalhe.codigo}? Esta ação encerra os cronômetros e não pode ser desfeita.`
            : `Confirmar o cancelamento da O.S ${detalhe.codigo}? Esta ação não pode ser desfeita.`
        }
        confirmarTexto={destinoConfirmar === 'concluida' ? 'Confirmar' : 'Cancelar O.S'}
        perigo={destinoConfirmar !== 'concluida'}
        loading={processando}
        onConfirmar={aplicar}
        onCancelar={() => setDestinoConfirmar(null)}
      />
    </div>
  );
}

function PainelExecucao({ osId, produtos, capturarGps, onFechar, recarregarLista, mostrarToast, ehMobile, mudarStatus, ehGestor, onEditar, onExcluir, transicoes }) {
  const [detalhe, setDetalhe] = useState(null);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState('insumos');

  const carregar = useCallback(async (tentativa = 0) => {
    try {
      // Offline: busca no pacote de campo baixado na base.
      if (usarLocal()) {
        const local = await getOSLocal(osId);
        if (local) {
          setDetalhe(local);
          return;
        }
        setErro('Esta O.S não está disponível offline. Conecte-se para baixar o pacote de campo.');
        return;
      }
      const res = await apiFetch(`${API_URL}/os/${osId}`);
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setDetalhe(data);
        // Em Modo Campo, mantém o pacote local atualizado para o campo.
        if (isModoCampo()) salvarDetalheLocal(data);
      } else if (res.status === 500 && tentativa === 0 && !usarLocal()) {
        // Erros 500 no detalhe costumam ser transitórios (queda de conexão com
        // o banco no servidor): tenta uma segunda vez antes de exibir o erro.
        setTimeout(() => carregar(1), 1500);
      } else setErro(erroDaResposta(data, 'Erro ao carregar O.S.'));
    } catch {
      // Falhas de conexão costumam ser transitórias (cold start do servidor,
      // WiFi sem internet no campo): tenta uma segunda vez — no Modo Campo a
      // segunda tentativa já cai no pacote local graças à sonda.
      registrarFalhaDeRede();
      if (tentativa === 0) {
        setTimeout(() => carregar(1), 1500);
      } else {
        setErro('Erro de conexão ao carregar a O.S.');
      }
    }
  }, [osId]);

  useEffect(() => { carregar(); }, [carregar]);

  if (erro) {
    return (
      <div className="fixed inset-0 w-full lg:left-auto lg:w-[560px] xl:w-[680px] bg-white z-40 flex flex-col items-center justify-center gap-4 p-6">
        <div className="text-center space-y-2">
          <AlertTriangle size={28} className="text-rose-500 mx-auto" />
          <p className="text-sm font-bold text-rose-600">{erro}</p>
          <p className="text-xs text-slate-400 max-w-sm">Verifique sua conexão com a internet e tente novamente.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => { setErro(''); carregar(); }}
            className="px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-all cursor-pointer"
          >
            Tentar novamente
          </button>
          <button onClick={onFechar} className="px-5 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-all cursor-pointer">
            Voltar
          </button>
        </div>
      </div>
    );
  }

  if (!detalhe) {
    return (
      <div className="fixed inset-0 w-full lg:left-auto lg:w-[560px] xl:w-[680px] bg-white z-40 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const mo = detalhe.mao_de_obra || {};
  const mat = detalhe.materiais || {};
  const encerrada = ['concluida', 'cancelada'].includes(detalhe.status);
  const podeEditar = !encerrada;
  // Em O.S encerrada, somente o gestor pode lançar serviços e estornar
  // lançamentos (ajustes pós-conclusão); demais ações seguem bloqueadas.
  const podeLancarServico = podeEditar || (ehGestor && encerrada);
  const podeEstornar = ehGestor;
  const podeExcluir = ehGestor && podeEditar;
  // Exclusão da O.S: gestor, apenas rascunho ou encerradas (sem execução ativa).
  const podeExcluirOs = ehGestor && ['rascunho', 'concluida', 'cancelada'].includes(detalhe.status);
  const prazo = situacaoPrazo(detalhe);

  const abrirPdf = async (caminho) => {
    // Abre uma aba imediatamente (evita bloqueio de popup) e navega para o
    // PDF gerado (o download exige o token, então usamos fetch + blob URL).
    const janela = window.open('', '_blank');
    try {
      const res = await apiFetch(`${API_URL}${caminho}`);
      if (!res.ok) {
        janela?.close();
        mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao gerar o PDF.'), 'error');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      janela?.location.replace(url);
    } catch {
      janela?.close();
      mostrarToast('Erro de conexão ao gerar o PDF.', 'error');
    }
  };

  const corpoAbas = (
    <>
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-4">
        {[['checklist', 'Checklist', ListChecks], ['insumos', 'Serviços', Package], ['evidencias', 'Evidências', Camera], ['timeline', 'Histórico', Clock]].map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setAba(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 min-h-11 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              aba === key ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500'
            }`}
          >
            <Icon size={15} />{label}
          </button>
        ))}
      </div>
      {aba === 'checklist' && (
        <TabChecklist
          osDetalhe={detalhe}
          onAtualizado={() => { carregar(); recarregarLista(); }}
          mostrarToast={mostrarToast}
          podeEditar={podeEditar}
        />
      )}
      {aba === 'insumos' && (
        <TabInsumos
          osDetalhe={{ ...detalhe, lancamentos: detalhe.ultimos_lancamentos }}
          produtos={produtos}
          onAtualizado={carregar}
          mostrarToast={mostrarToast}
          podeEditar={podeLancarServico}
          podeEstornar={podeEstornar}
        />
      )}
      {aba === 'evidencias' && (
        <TabEvidencias osDetalhe={detalhe} onAtualizado={carregar} mostrarToast={mostrarToast} podeEditar={podeEditar} podeExcluir={podeExcluir} />
      )}
      {aba === 'timeline' && <TabTimeline historico={detalhe.historico} />}
    </>
  );

  const cabecalho = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold text-primary-700">{detalhe.codigo}</span>
            <BadgeStatus status={detalhe.status} />
            <BadgePrioridade prioridade={detalhe.prioridade} />
            {prazo && (
              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold flex items-center gap-1 ${prazo.classe}`}>
                <CalendarClock size={11} />{prazo.label}
              </span>
            )}
          </div>
          <p className="text-lg font-extrabold text-slate-800 mt-1 leading-tight">{detalhe.obras?.nome}</p>
          <p className="text-xs text-slate-400">
            Cliente: {detalhe.obras?.clientes?.nome || detalhe.obras?.cliente_celesc || '-'} · Equipe:{' '}
            {detalhe.equipes ? (detalhe.equipes.numero ? `Nº ${detalhe.equipes.numero} - ${detalhe.equipes.nome}` : detalhe.equipes.nome) : 'sem equipe'}
          </p>
        </div>
        <button onClick={onFechar} className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 cursor-pointer">
          <X size={20} />
        </button>
      </div>

      {detalhe.descricao_escopo && (
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3 mt-3 whitespace-pre-wrap">
          <b className="text-slate-600">Escopo:</b> {detalhe.descricao_escopo}
        </p>
      )}

      {/* Checklist de início pendente: bloqueia a liberação da execução */}
      {detalhe.status === 'aberta' && detalhe.checklist && !detalhe.checklist.inicio_liberado && (
        <div className="mt-3 rounded-xl border-2 border-rose-300 bg-rose-50 p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <ListChecks size={18} className="text-rose-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-extrabold text-rose-700">Checklist de início pendente</p>
              <p className="text-[10px] text-rose-500 font-semibold">
                Preencha o Grupo 1 - Preparação para liberar a execução ({detalhe.checklist.respondidos}/{detalhe.checklist.total} respondidos).
              </p>
            </div>
          </div>
          <button
            onClick={() => setAba('checklist')}
            className="shrink-0 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-[11px] font-bold cursor-pointer transition-all"
          >
            Abrir checklist
          </button>
        </div>
      )}

      {/* Cartões de custo */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="bg-sky-50 rounded-xl p-2.5 border border-sky-100">
          <p className="text-[9px] font-bold text-sky-600 uppercase">Horas H.H.</p>
          <p className="text-sm font-extrabold text-sky-800">{mo.total_horas ?? 0} h</p>
        </div>
        <div className="bg-emerald-50 rounded-xl p-2.5 border border-emerald-100" title={mo.custo_mo_real > 0 ? '' : 'Valor da hora por equipe ainda não definido'}>
          <p className="text-[9px] font-bold text-emerald-600 uppercase">Custo M.O.</p>
          <p className="text-sm font-extrabold text-emerald-800">
            {mo.custo_mo_real > 0 ? brl(mo.custo_mo_real) : '—'}
          </p>
        </div>
        <div className="bg-amber-50 rounded-xl p-2.5 border border-amber-100">
          <p className="text-[9px] font-bold text-amber-600 uppercase">Materiais</p>
          <p className="text-sm font-extrabold text-amber-800">{mat.total_aplicado ?? 0} USC</p>
        </div>
      </div>

      {/* Breakdown de horas por funcionário */}
      {(mo.por_funcionario?.length > 0) && (
        <details className="mt-2 group">
          <summary className="text-[10px] font-bold text-slate-400 uppercase tracking-wide cursor-pointer flex items-center gap-1 select-none list-none">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            Horas por funcionário
          </summary>
          <div className="mt-1.5 bg-slate-50 border border-slate-100 rounded-xl divide-y divide-slate-100">
            {mo.por_funcionario.map((f, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-slate-600 font-semibold truncate">{f.nome || 'Funcionário'}</span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs font-bold text-sky-700">{(f.minutos / 60).toFixed(1)} h</span>
                  <span className="text-xs text-slate-400">{brl(f.custo)}</span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Ações rápidas */}
      <div className="space-y-2 mt-3">
        <CronometroHH
          osDetalhe={detalhe}
          capturarGps={capturarGps}
          onAtualizado={() => { carregar(); recarregarLista(); }}
          mostrarToast={mostrarToast}
          podeEditar={podeEditar}
        />
        <AcoesStatus
          detalhe={detalhe}
          podeEditar={podeEditar}
          mudarStatus={mudarStatus}
          aoAplicado={() => { carregar(); recarregarLista(); }}
          ehGestor={ehGestor}
          transicoesMap={transicoes}
          onAbrirChecklist={() => setAba('checklist')}
          mostrarToast={mostrarToast}
        />        {ehGestor && (
          <div className="grid gap-2 grid-cols-2">
            <button
              onClick={() => onEditar(detalhe)}
              className="h-11 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-slate-50 cursor-pointer"
            >
              <Pencil size={14} /> Editar
            </button>
            <button
              onClick={() => abrirPdf(`/os/${detalhe.id}/imprimir`)}
              className="h-11 rounded-xl bg-primary-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-primary-700 cursor-pointer"
            >
              <Printer size={14} /> Imprimir O.S
            </button>
            <button
              onClick={() => abrirPdf(`/os/${detalhe.id}/pdf`)}
              className="h-11 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-slate-50 cursor-pointer"
            >
              <FileDown size={14} /> Relatório
            </button>
            <button
              onClick={() => abrirPdf(`/os/${detalhe.id}/checklist/report`)}
              className="h-11 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-slate-50 cursor-pointer"
            >
              <ListChecks size={14} /> Checklist PDF
            </button>
            {podeExcluirOs && (
              <button type="button" onClick={() => onExcluir(detalhe)} className="h-11 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-rose-100 cursor-pointer col-span-2">
                <Trash2 size={14} /> Excluir O.S
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );

  // No mobile ocupa a tela inteira (modo campo); no gestor, drawer lateral.
  return (
    <div className={`${ehMobile ? 'fixed inset-0 z-40 overflow-y-auto' : 'fixed inset-0 z-40 overflow-y-auto shadow-2xl border-l border-slate-200 w-full lg:left-auto lg:w-[560px] xl:w-[680px]'} bg-slate-50`}>
      <div className="p-4 lg:p-6 space-y-4 pb-10">
        {usarLocal() && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
            <WifiOff size={14} className="shrink-0" />
            Offline — ações salvas no dispositivo e sincronizadas ao reconectar
          </div>
        )}
        {cabecalho}
        {corpoAbas}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modais: nova O.S, impedimento
// ---------------------------------------------------------------------------

const FORM_OS_INICIAL = {
  obra_id: '', equipe_id: '', prioridade: 'media', prazo_entrega: '',
  descricao_escopo: '', custo_mo_orcado: '',
  tipo: 'construcao', agencia: '', municipio: '', local_servico: '',
  bt_energizado: false, at_energizado_bloqueio: false, bloqueio: false,
  hora_desligar: '', hora_religar: '', alimentador: '', chave: '', obs: '',
};

// Autocomplete de obras: sugere conforme digita, buscando por nome (Nota PS)
// e pelo nome do cliente. onChange recebe a obra selecionada (ou null).
// Suporta teclado: setas ↑/↓ para navegar e Enter para confirmar.
function ObraAutocomplete({ obras, value, disabled = false, onChange }) {
  const [termo, setTermo] = useState('');
  const [aberto, setAberto] = useState(false);
  const [indiceAtivo, setIndiceAtivo] = useState(-1);
  const editando = useRef(false); // true enquanto o usuário digita (não sincronizar)
  const itemRefs = useRef({}); // refs dos itens p/ rolar até o destacado

  const selecionada = obras.find(o => o.id === Number(value)) || null;

  // Nome do cliente exibido na obra: cadastro OU Cliente Celesc.
  const rotuloClienteObra = (o) => o.clientes?.nome || o.cliente_celesc || '';

  // Ao receber uma obra selecionada externamente (modo edição/prefill), exibe o nome dela.
  // Durante a digitação do usuário, não sobrescreve o texto.
  useEffect(() => {
    if (editando.current) return;
    if (selecionada) setTermo(`${selecionada.nome} — ${rotuloClienteObra(selecionada)}`);
    else if (!value) setTermo('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const sugestoes = useMemo(() => {
    const t = termo.trim().toLowerCase();
    if (!t) return []; // só sugere quando o usuário começa a digitar
    return obras
      .filter(o =>
        (o.nome || '').toLowerCase().includes(t) ||
        (rotuloClienteObra(o) || '').toLowerCase().includes(t)
      )
      .slice(0, 8);
  }, [termo, obras]);

  // Reinicia o cursor ao mudar os resultados da busca.
  useEffect(() => { setIndiceAtivo(-1); }, [sugestoes]);

  // Mantém o item destacado visível na lista (rolagem automática).
  useEffect(() => {
    if (indiceAtivo < 0) return;
    const el = itemRefs.current[sugestoes[indiceAtivo]?.id];
    el?.scrollIntoView({ block: 'nearest' });
  }, [indiceAtivo, sugestoes]);

  const escolher = (o) => {
    editando.current = false;
    setTermo(`${o.nome} — ${rotuloClienteObra(o)}`);
    setAberto(false);
    setIndiceAtivo(-1);
    onChange(o);
  };

  const aoDigitar = (texto) => {
    editando.current = true;
    setTermo(texto);
    setAberto(true);
    // Se o texto deixou de corresponder à obra selecionada, limpa a seleção.
    const selecionadaAtual = obras.find(o => o.id === Number(value));
    if (selecionadaAtual && texto.trim() !== `${selecionadaAtual.nome} — ${rotuloClienteObra(selecionadaAtual)}`.trim()) {
      onChange(null);
    }
  };

  const aoTeclar = (e) => {
    if (disabled) return;
    const tecla = e.key || e.code;
    const baixo = tecla === 'ArrowDown' || tecla === 'Down';
    const cima = tecla === 'ArrowUp' || tecla === 'Up';

    if (baixo || cima) {
      e.preventDefault();
      if (sugestoes.length === 0) return;
      setAberto(true);
      setIndiceAtivo(prev => {
        if (baixo) return (prev + 1) % sugestoes.length;
        return prev <= 0 ? sugestoes.length - 1 : prev - 1;
      });
    } else if (tecla === 'Enter') {
      if (aberto && indiceAtivo >= 0 && sugestoes[indiceAtivo]) {
        e.preventDefault();
        escolher(sugestoes[indiceAtivo]);
      }
    } else if (tecla === 'Escape' || tecla === 'Esc') {
      setAberto(false);
      setIndiceAtivo(-1);
    }
  };

  return (
    <div className="relative">
      <input
        value={termo}
        disabled={disabled}
        onChange={(e) => aoDigitar(e.target.value)}
        onKeyDown={aoTeclar}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => { setAberto(false); setIndiceAtivo(-1); }, 150)}
        placeholder="Digite o nome ou a Nota PS da obra..."
        className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-primary-500 disabled:bg-slate-100 disabled:text-slate-500"
      />
      {aberto && !disabled && sugestoes.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
          {sugestoes.map((o, i) => (
            <li key={o.id} className="border-b border-slate-50 last:border-0">
              <button
                ref={el => { itemRefs.current[o.id] = el; }}
                type="button"
                onMouseDown={() => escolher(o)}
                onMouseEnter={() => setIndiceAtivo(i)}
                className={`w-full text-left px-3.5 py-2.5 transition-colors cursor-pointer ${
                  i === indiceAtivo
                    ? 'bg-primary-100 ring-2 ring-inset ring-primary-200'
                    : 'hover:bg-primary-50'
                }`}
              >
                <span className={`block text-sm font-bold truncate ${i === indiceAtivo ? 'text-primary-900' : 'text-slate-800'}`}>{o.nome}</span>
                <span className="block text-xs text-slate-400 truncate">{rotuloClienteObra(o) || 'Sem cliente'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModalNovaOS({ aberto, obras, equipes, onFechar, onCriada, mostrarToast, edicao }) {
  const [form, setForm] = useState(FORM_OS_INICIAL);
  const [salvando, setSalvando] = useState(false);
  const [criada, setCriada] = useState(null); // {id, codigo} ao salvar com sucesso
  const [imprimindo, setImprimindo] = useState(false);

  // Preenche o formulário no modo edição (ou zera no modo criação).
  useEffect(() => {
    if (!aberto) return;
    if (edicao) {
      setForm({
        obra_id: String(edicao.obra_id || ''),
        equipe_id: edicao.equipe_id ? String(edicao.equipe_id) : '',
        prioridade: edicao.prioridade || 'media',
        prazo_entrega: edicao.prazo_entrega || '',
        descricao_escopo: edicao.descricao_escopo || '',
        custo_mo_orcado: edicao.custo_mo_orcado != null ? String(edicao.custo_mo_orcado) : '',
        tipo: edicao.tipo || 'construcao',
        agencia: edicao.agencia || '',
        municipio: edicao.municipio || '',
        local_servico: edicao.local_servico || '',
        bt_energizado: !!edicao.bt_energizado,
        at_energizado_bloqueio: !!edicao.at_energizado_bloqueio,
        bloqueio: !!edicao.bloqueio,
        hora_desligar: edicao.hora_desligar || '',
        hora_religar: edicao.hora_religar || '',
        alimentador: edicao.alimentador || '',
        chave: edicao.chave || '',
        obs: edicao.obs || '',
      });
      setCriada(null);
    } else {
      setForm(FORM_OS_INICIAL);
      setCriada(null);
    }
  }, [aberto, edicao]);

  const totalGeral = Number(form.custo_mo_orcado || 0);

  const salvar = async (e) => {
    e.preventDefault();
    if (!form.obra_id) { mostrarToast('Selecione a obra.', 'error'); return; }
    setSalvando(true);
    try {
      const corpo = {
        equipe_id: form.equipe_id ? Number(form.equipe_id) : null,
        prioridade: form.prioridade,
        prazo_entrega: form.prazo_entrega || null,
        descricao_escopo: form.descricao_escopo || null,
        custo_mo_orcado: Number(form.custo_mo_orcado || 0),
        // Materiais orçados desativados por enquanto (criação sem itens;
        // edição preserva o orçamento existente ao omitir o campo).
        tipo: form.tipo,
        agencia: form.agencia || null,
        municipio: form.municipio || null,
        local_servico: form.local_servico || null,
        bt_energizado: form.bt_energizado,
        at_energizado_bloqueio: form.at_energizado_bloqueio,
        bloqueio: form.bloqueio,
        hora_desligar: form.hora_desligar || null,
        hora_religar: form.hora_religar || null,
        alimentador: form.alimentador || null,
        chave: form.chave || null,
        obs: form.obs || null,
      };

      const res = edicao
        ? await apiFetch(`${API_URL}/os/${edicao.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo),
          })
        : await apiFetch(`${API_URL}/os/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ obra_id: Number(form.obra_id), ...corpo }),
          });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        if (edicao) {
          mostrarToast(`O.S ${data.codigo || edicao.codigo} atualizada.`);
          onCriada();
          onFechar();
        } else {
          mostrarToast(`O.S ${data.codigo} criada como rascunho.`);
          onCriada();
          setCriada(data);
        }
      } else {
        mostrarToast(erroDaResposta(data, edicao ? 'Erro ao atualizar O.S.' : 'Erro ao criar O.S.'), 'error');
      }
    } catch {
      mostrarToast(edicao ? 'Erro de conexão ao atualizar O.S.' : 'Erro de conexão ao criar O.S.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  const imprimirModelo = async () => {
    if (!criada) return;
    // Abre a aba antes do fetch (evita bloqueio de popup).
    const janela = window.open('', '_blank');
    setImprimindo(true);
    try {
      const res = await apiFetch(`${API_URL}/os/${criada.id}/imprimir`);
      if (!res.ok) {
        janela?.close();
        mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao gerar o modelo.'), 'error');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      janela?.location.replace(url);
    } catch {
      janela?.close();
      mostrarToast('Erro de conexão ao gerar o modelo.', 'error');
    } finally {
      setImprimindo(false);
    }
  };

  if (!aberto) return null;

  // Etapa de sucesso: oferece imprimir o modelo antes de fechar.
  if (criada) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center animate-in fade-in zoom-in duration-200">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-4">
            <Check size={28} className="text-emerald-600" />
          </div>
          <h3 className="text-lg font-extrabold text-slate-800">O.S {criada.codigo} criada!</h3>
          <p className="text-xs text-slate-500 mt-1 mb-6">Deseja imprimir a ordem de serviço no modelo oficial?</p>
          <div className="space-y-2">
            <button
              onClick={imprimirModelo}
              disabled={imprimindo}
              className="w-full py-3 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
            >
              <Printer size={16} /> {imprimindo ? 'Gerando PDF...' : 'Imprimir O.S'}
            </button>
            <button
              onClick={() => { onFechar(); setCriada(null); }}
              className="w-full py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 cursor-pointer"
            >
              Concluir
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <form onSubmit={salvar} className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden max-h-[92vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between sticky top-0">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <ClipboardList className="text-primary-400" size={20} />
            {edicao ? `Editar O.S ${edicao.codigo}` : 'Nova Ordem de Serviço'}
          </h3>
          <button type="button" onClick={onFechar} className="text-slate-400 hover:text-white cursor-pointer"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Obra *</label>
            <ObraAutocomplete
              obras={obras}
              value={form.obra_id}
              disabled={!!edicao}
              onChange={(obraSel) => setForm(f => ({
                ...f,
                obra_id: obraSel ? String(obraSel.id) : '',
                municipio: f.municipio || obraSel?.cidade || '',
                local_servico: f.local_servico || obraSel?.endereco || '',
              }))}
            />
            {edicao && (
              <p className="text-[10px] text-slate-400 mt-1 font-semibold">A obra não pode ser alterada após a criação.</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Tipo de O.S</label>
            <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-primary-500">
              <option value="construcao">Construção</option>
              <option value="manutencao">Manutenção</option>
              <option value="linha_viva">Linha Viva</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Equipe</label>
              <select value={form.equipe_id} onChange={(e) => setForm({ ...form, equipe_id: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-primary-500">
                <option value="">Definir depois</option>
                {equipes.map(eq => <option key={eq.id} value={eq.id}>{eq.numero ? `Nº ${eq.numero} - ${eq.nome}` : eq.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Prioridade</label>
              <select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-primary-500">
                {Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Prazo de entrega</label>
              <input type="date" value={form.prazo_entrega} onChange={(e) => setForm({ ...form, prazo_entrega: e.target.value })}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">M.O. orçada (R$)</label>
              <input type="number" step="0.01" min="0" value={form.custo_mo_orcado}
                onChange={(e) => setForm({ ...form, custo_mo_orcado: e.target.value })}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Escopo do serviço</label>
            <textarea rows={3} value={form.descricao_escopo} onChange={(e) => setForm({ ...form, descricao_escopo: e.target.value })}
              placeholder="Descreva o serviço a ser executado..."
              className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500" />
          </div>

          {/* Dados do modelo de impressão */}
          <div className="border border-slate-100 rounded-xl p-3 bg-slate-50 space-y-3">
            <p className="text-xs font-extrabold text-slate-600 uppercase tracking-wide">Modelo de impressão</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Agência</label>
                <input value={form.agencia} onChange={(e) => setForm({ ...form, agencia: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Município</label>
                <input value={form.municipio} onChange={(e) => setForm({ ...form, municipio: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Local</label>
              <input value={form.local_servico} onChange={(e) => setForm({ ...form, local_servico: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500" />
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={form.bt_energizado}
                  onChange={(e) => setForm({ ...form, bt_energizado: e.target.checked })}
                  className="w-4 h-4 accent-primary-600" />
                BT Energ.
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={form.at_energizado_bloqueio}
                  onChange={(e) => setForm({ ...form, at_energizado_bloqueio: e.target.checked })}
                  className="w-4 h-4 accent-primary-600" />
                AT Energ.
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={form.bloqueio}
                  onChange={(e) => setForm({ ...form, bloqueio: e.target.checked })}
                  className="w-4 h-4 accent-primary-600" />
                Bloqueio
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">H. Desligar</label>
                <input type="time" value={form.hora_desligar} onChange={(e) => setForm({ ...form, hora_desligar: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">H. Religar</label>
                <input type="time" value={form.hora_religar} onChange={(e) => setForm({ ...form, hora_religar: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Alimentador</label>
                <input value={form.alimentador} onChange={(e) => setForm({ ...form, alimentador: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Chave</label>
                <input value={form.chave} onChange={(e) => setForm({ ...form, chave: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Obs.</label>
              <input value={form.obs} onChange={(e) => setForm({ ...form, obs: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500" />
            </div>
          </div>
        </div>
        {/* Resumo do custo de M.O. previsto antes de salvar */}
        {Number(form.custo_mo_orcado) > 0 && (
          <div className="mx-6 mb-3 rounded-xl bg-slate-900 text-white px-4 py-2.5 flex justify-between items-center">
            <span className="text-xs font-semibold text-slate-300">M.O. orçada prevista</span>
            <span className="text-base font-extrabold">{brl(totalGeral)}</span>
          </div>
        )}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 sticky bottom-0 bg-white">
          <button type="button" onClick={onFechar}
            className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 cursor-pointer">Cancelar</button>
          <button type="submit" disabled={salvando}
            className="px-5 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 cursor-pointer">
            {salvando ? 'Salvando...' : edicao ? 'Salvar Alterações' : 'Criar O.S'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ModalImpedimento({ aberto, osAlvo, onConfirmar, onCancelar, processando }) {
  const [justificativa, setJustificativa] = useState('');
  const [fotos, setFotos] = useState([]);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const inputFotoRef = useRef(null);

  useEffect(() => {
    if (aberto) {
      setJustificativa('');
      setFotos([]);
    }
  }, [aberto]);

  if (!aberto || !osAlvo) return null;

  const enviarFotos = async (files) => {
    setEnviandoFoto(true);
    let novosFotoIds = [...fotos];
    for (const original of files) {
      const arquivo = await comprimirImagem(original);

      // Offline: guarda a foto no dispositivo; o id local vira a referência
      // da evidência no status de impedimento (mapeado na sincronização).
      if (usarLocal()) {
        try {
          const gps = await capturarGeolocalizacao();
          const foto = await enfileirarFoto({ os_id: osAlvo.id, checklist_item_id: null, arquivo, geolocalizacao: gps });
          novosFotoIds = [...novosFotoIds, foto.id_local];
        } catch { /* continua */ }
        continue;
      }

      const fd = new FormData();
      fd.append('arquivo', arquivo);
      try {
        const res = await apiFetch(`${API_URL}/os/${osAlvo.id}/fotos`, { method: 'POST', body: fd });
        if (res.ok) {
          const data = await res.json();
          novosFotoIds = [...novosFotoIds, data.id];
        }
      } catch {
        // Sem internet real no campo: a evidência vira foto local (id local
        // referenciado no status de impedimento e mapeado na sincronização).
        if (isModoCampo()) {
          registrarFalhaDeRede();
          try {
            const gps = await capturarGeolocalizacao();
            const foto = await enfileirarFoto({ os_id: osAlvo.id, checklist_item_id: null, arquivo, geolocalizacao: gps });
            novosFotoIds = [...novosFotoIds, foto.id_local];
          } catch { /* continua */ }
        }
      }
    }
    setFotos(novosFotoIds);
    setEnviandoFoto(false);
  };

  const valido = justificativa.trim().length >= 20 && fotos.length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-orange-500 text-white px-6 py-4 flex items-center gap-2">
          <AlertTriangle size={22} />
          <h3 className="font-bold text-lg">Marcar O.S {osAlvo?.codigo} como IMPEDIDA</h3>
        </div>
        <div className="p-6 space-y-4">
          {/* Passo 1: Motivo */}
          <div>
            <p className="text-xs font-bold text-slate-600 mb-1.5 flex items-center gap-1">
              <span className="w-4 h-4 rounded-full bg-orange-500 text-white text-[9px] font-black flex items-center justify-center">1</span>
              Descreva o motivo do impedimento
            </p>
            <textarea
              rows={4}
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder="Ex: Chuva intensa inviabilizou a concretagem na área externa; aguardando melhoria do tempo."
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-orange-400"
            />
            <span className={`text-xs font-semibold ${justificativa.trim().length >= 20 ? 'text-emerald-600' : 'text-slate-400'}`}>
              {justificativa.trim().length}/20 caracteres mínimos
            </span>
          </div>

          {/* Passo 2: Evidência fotográfica — upload direto aqui no modal */}
          <div>
            <p className="text-xs font-bold text-slate-600 mb-1.5 flex items-center gap-1">
              <span className="w-4 h-4 rounded-full bg-orange-500 text-white text-[9px] font-black flex items-center justify-center">2</span>
              Anexar foto de evidência
            </p>
            <button
              type="button"
              disabled={enviandoFoto}
              onClick={() => inputFotoRef.current?.click()}
              className={`w-full h-20 rounded-xl border-2 border-dashed font-bold flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer text-sm disabled:opacity-50 ${
                fotos.length > 0
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                  : 'border-orange-300 bg-orange-50 text-orange-700'
              }`}
            >
              <Camera size={22} />
              {enviandoFoto
                ? 'Enviando...'
                : fotos.length > 0
                  ? `✓ ${fotos.length} foto(s) anexada(s) — adicionar mais`
                  : 'Tirar / Escolher foto de evidência'
              }
            </button>
            <input
              ref={inputFotoRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) enviarFotos(Array.from(e.target.files));
                e.target.value = '';
              }}
            />
          </div>

          {/* Checklist de validação */}
          <div className="flex gap-4 text-xs">
            <span className={`flex items-center gap-1 font-semibold ${justificativa.trim().length >= 20 ? 'text-emerald-600' : 'text-slate-400'}`}>
              <Check size={12} />{justificativa.trim().length >= 20 ? 'Motivo ok' : 'Motivo incompleto'}
            </span>
            <span className={`flex items-center gap-1 font-semibold ${fotos.length > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
              <Camera size={12} />{fotos.length > 0 ? `${fotos.length} evidência(s)` : 'Sem evidência'}
            </span>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onCancelar}
            className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 cursor-pointer">Cancelar</button>
          <button
            onClick={() => onConfirmar(justificativa.trim(), fotos)}
            disabled={!valido || processando || enviandoFoto}
            className="px-5 py-2 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600 disabled:opacity-40 cursor-pointer"
          >
            {processando ? 'Registrando...' : 'Confirmar impedimento'}
          </button>
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

function OrdensServico({ usuarioAtual }) {
  const [listaOs, setListaOs] = useState([]);
  const [obras, setObras] = useState([]);
  const [equipes, setEquipes] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [visao, setVisao] = useState('quadro');       // quadro | arquivo | cadastros
  const [osSelecionada, setOsSelecionada] = useState(null);
  const [modalNova, setModalNova] = useState(false);
  const [modalEdicao, setModalEdicao] = useState(null); // detalhe da O.S em edição
  const [modalImpedimento, setModalImpedimento] = useState(null); // {os, destinoColuna}
  const [confirmacaoEncerrar, setConfirmacaoEncerrar] = useState(null); // {os, destino}
  const [confirmacaoExcluir, setConfirmacaoExcluir] = useState(null); // {os} — exclusão definitiva
  const [confirmacaoFinalizarModoCampo, setConfirmacaoFinalizarModoCampo] = useState(false); // confirmação do Finalizar Modo Campo
  const [processando, setProcessando] = useState(false);
  const [draggingOsStatus, setDraggingOsStatus] = useState(null); // status do card sendo arrastado

  const [filtroBusca, setFiltroBusca] = useState('');
  const [filtroObra, setFiltroObra] = useState('');
  const [filtroEquipe, setFiltroEquipe] = useState('');
  const [filtroPrioridade, setFiltroPrioridade] = useState('');
  const [filtroStatus, setFiltroStatus] = useState(''); // chip do pipeline (gestor)
  const [filtroArquivo, setFiltroArquivo] = useState(''); // '' = todas; concluida | cancelada
  const [totalOs, setTotalOs] = useState(0);
  const [transicoes, setTransicoes] = useState(TRANSICOES_STATUS); // fonte única do backend

  // Arquivo de encerradas (visão do gestor) — paginação independente.
  const [listaEncerradas, setListaEncerradas] = useState([]);
  const [totalEncerradas, setTotalEncerradas] = useState(0);
  const [carregandoArquivo, setCarregandoArquivo] = useState(false);

  // Largura da tela (painel em tela cheia < 1024px; drawer no desktop).
  const [ehTelaLarga, setEhTelaLarga] = useState(
    typeof window !== 'undefined' && window.innerWidth >= 1024,
  );

  // ---- Modo Campo (offline) ----
  const [modoCampo, setModoCampoState] = useState(isModoCampo());
  const [offline, setOffline] = useState(isOffline());
  const [pendentes, setPendentes] = useState({ operacoes: 0, fotos: 0, total: 0 });
  const [sincronizando, setSincronizando] = useState(false);
  const [preparandoPacote, setPreparandoPacote] = useState(false);
  const [infoPacoteLocal, setInfoPacoteLocal] = useState(null);
  const [modalPendenciasAberto, setModalPendenciasAberto] = useState(false);
  const [ultimoResumo, setUltimoResumo] = useState(null);

  const mostrarToast = useCallback((message, type = 'success', acao = null) => {
    setToast({ message, type, acao });
    // Erros ficam mais tempo na tela (móvel); sucesso some antes.
    setTimeout(() => setToast(null), type === 'error' ? 8000 : 4500);
  }, []);

  const sincronizarAgora = useCallback(async (silencioso = false) => {
    if (isOffline()) {
      if (!silencioso) mostrarToast('Sem conexão — sincronize quando voltar à internet.', 'error');
      return;
    }
    if (sincronizando) return;
    setSincronizando(true);
    try {
      const resumo = await sincronizar();
      setUltimoResumo(resumo);
      if (usuarioAtual?.nome) salvarResponsavelLocal(usuarioAtual.nome);
      if (!silencioso || resumo.fotosEnviadas || resumo.operacoesEnviadas || resumo.falhas.length) {
        if (resumo.falhas.length) {
          const resumosErros = [...new Set(resumo.falhas.slice(0, 3).map(f => f.erro))].join('\n');
          mostrarToast(
            `${resumo.fotosEnviadas + resumo.operacoesEnviadas} sincronizado(s), ${resumo.falhas.length} com erro.\n${resumosErros}`,
            'error',
            { label: 'Ver pendências', onClick: () => setModalPendenciasAberto(true) },
          );
        } else {
          mostrarToast(`${resumo.fotosEnviadas + resumo.operacoesEnviadas} item(ns) sincronizado(s).`);
        }
      }
      carregarDados();
    } catch {
      if (!silencioso) mostrarToast('Falha ao sincronizar. Tente novamente.', 'error');
    } finally {
      setSincronizando(false);
      const p = await contarPendentes();
      setPendentes(p);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sincronizando, mostrarToast, usuarioAtual?.nome]);

  // Monitora a conexão de verdade (sonda HTTP a cada 10s — o navigator.onLine
  // engana em WiFi sem internet, comum no campo). Ao reconectar com pendências
  // na fila, sincroniza automaticamente.
  useEffect(() => {
    let sondaEmAndamento = false;
    const atualizar = async (daSonda = false) => {
      if (!sondaEmAndamento && daSonda) {
        sondaEmAndamento = true;
        await testarConexao();
        sondaEmAndamento = false;
      }
      const offlineAtual = isOffline();
      setOffline(offlineAtual);
      if (offlineAtual === false) {
        contarPendentes().then(p => { setPendentes(p); if (p.total > 0) sincronizarAgora(true); });
      }
    };
    const noEvento = () => atualizar(false);
    const naSonda = () => atualizar(true);
    window.addEventListener('online', noEvento);
    window.addEventListener('offline', noEvento);
    // Sonda imediata ao montar (Modo Campo) e a cada 10s.
    if (modoCampo) naSonda();
    const sonda = setInterval(naSonda, 10000);
    const contador = setInterval(() => {
      contarPendentes().then(setPendentes);
    }, 4000);
    return () => {
      window.removeEventListener('online', noEvento);
      window.removeEventListener('offline', noEvento);
      clearInterval(sonda);
      clearInterval(contador);
    };
  }, [sincronizarAgora, modoCampo]);

  useEffect(() => {
    if (modoCampo) infoPacote().then(setInfoPacoteLocal).catch(() => setInfoPacoteLocal(null));
    else setInfoPacoteLocal(null);
  }, [modoCampo]);

  const alternarModoCampo = async () => {
    if (offline) {
      mostrarToast('Conecte-se à internet para preparar o Modo Campo.', 'error');
      return;
    }
    setPreparandoPacote(true);
    try {
      const qtd = await prepararPacoteCampo();
      if (usuarioAtual?.nome) await salvarResponsavelLocal(usuarioAtual.nome);
      setModoCampo(true);
      setModoCampoState(true);
      setInfoPacoteLocal({ quantidade: qtd, preparado_em: new Date().toISOString() });
      mostrarToast(`Modo Campo pronto: ${qtd} O.S baixadas para o dispositivo.`);
    } catch {
      mostrarToast('Falha ao preparar o Modo Campo. Tente novamente.', 'error');
    } finally {
      setPreparandoPacote(false);
    }
  };

  // Finalizar Modo Campo (único fluxo de saída): abre a confirmação; ao
  // confirmar, sincroniza TODAS as pendências e encerra o Modo Campo,
  // apagando os dados locais do dispositivo.
  const finalizarModoCampo = async () => {
    if (!modoCampo) return;
    if (isOffline()) {
      mostrarToast('Sem conexão — conecte-se à internet para finalizar o Modo Campo.', 'error');
      return;
    }
    if (sincronizando || preparandoPacote) return;
    setConfirmacaoFinalizarModoCampo(true);
  };

  const confirmarFinalizarModoCampo = async () => {
    setConfirmacaoFinalizarModoCampo(false);
    if (!modoCampo) return;
    if (isOffline()) {
      mostrarToast('Sem conexão — conecte-se à internet para finalizar o Modo Campo.', 'error');
      return;
    }
    if (sincronizando || preparandoPacote) return;
    setSincronizando(true);
    try {
      const resumo = await sincronizar();
      setUltimoResumo(resumo);
      if (resumo.falhas.length) {
        setPendentes(await contarPendentes());
        mostrarToast(
          `Não foi possível finalizar: ${resumo.falhas.length} item(ns) com erro. Revise as pendências e tente novamente.`,
          'error',
          { label: 'Ver pendências', onClick: () => setModalPendenciasAberto(true) },
        );
        return;
      }
      if (usuarioAtual?.nome) salvarResponsavelLocal(usuarioAtual.nome);
      await limparPacote();
      setModoCampo(false);
      setModoCampoState(false);
      setInfoPacoteLocal(null);
      setPendentes({ operacoes: 0, fotos: 0, total: 0 });
      setUltimoResumo(null);
      carregarDados();
      mostrarToast('Modo Campo finalizado: pendências sincronizadas e dados locais apagados.');
    } catch {
      mostrarToast('Falha ao finalizar o Modo Campo. Tente novamente.', 'error');
    } finally {
      setSincronizando(false);
    }
  };

  // Debounce da busca: só consulta o servidor após 350ms sem digitar.
  const [buscaAplicada, setBuscaAplicada] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setBuscaAplicada(filtroBusca.trim()), 350);
    return () => clearTimeout(timer);
  }, [filtroBusca]);

  // Máquina de estados vinda do backend (fonte única; fallback local).
  useEffect(() => {
    apiFetch(`${API_URL}/os/transicoes`)
      .then(res => res.ok ? res.json() : null)
      .then(dados => {
        if (dados?.transicoes) {
          const mapa = {};
          for (const [origem, destinos] of Object.entries(dados.transicoes)) {
            mapa[origem] = new Set(destinos);
          }
          setTransicoes(mapa);
        }
      })
      .catch(() => { /* mantém o fallback local */ });
  }, []);

  // Gestor do módulo O.S (permissão "os"); o usuário de campo ("os_campo")
  // apenas visualiza e executa tarefas das O.S da própria equipe.
  const ehGestor = (usuarioAtual?.permissoes || []).includes('os');

  // Acompanha a largura da tela (>= 1024px = drawer lateral; senão tela cheia).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const atualizar = () => setEhTelaLarga(mq.matches);
    mq.addEventListener?.('change', atualizar);
    return () => mq.removeEventListener?.('change', atualizar);
  }, []);

  const capturarGps = useCallback(async () => capturarGeolocalizacao(), []);

  const buscarPagina = useCallback(async (offset, reset) => {
    try {
      // Offline: usa o pacote de campo baixado na base.
      if (usarLocal()) {
        const lista = await getListaLocal();
        setTotalOs(lista.length);
        setListaOs(lista);
        setLoading(false);
        return;
      }
      const params = new URLSearchParams();
      if (buscaAplicada) params.set('busca', buscaAplicada);
      if (filtroObra) params.set('obra_id', filtroObra);
      if (filtroEquipe) params.set('equipe_id', filtroEquipe);
      if (filtroPrioridade) params.set('prioridade', filtroPrioridade);
      if (filtroStatus) params.set('status', filtroStatus);
      params.set('limit', String(LIMITE_PAGINA));
      params.set('offset', String(offset));
      const qs = params.toString();

      // Cadastros de apoio (obras/equipes/produtos) são restritos ao gestor.
      const resOs = await apiFetch(`${API_URL}/os/${qs ? `?${qs}` : ''}`);
      if (resOs.ok) {
        const pagina = await resOs.json();
        const total = Number(resOs.headers.get('X-Total-Count') || pagina.length);
        setTotalOs(total);
        setListaOs(prev => (reset ? pagina : [...prev, ...pagina]));
      } else {
        mostrarToast('Erro ao carregar O.S.', 'error');
      }
      // Catálogo de serviços: necessário ao gestor (cadastro) e ao campo
      // (lançamento de serviços na O.S). Obras/equipes são apenas do gestor.
      const [resProdutos, resObras, resEquipes] = await Promise.all([
        apiFetch(`${API_URL}/os/produtos`),
        ehGestor ? apiFetch(`${API_URL}/os/obras`) : Promise.resolve(null),
        ehGestor ? apiFetch(`${API_URL}/os/equipes`) : Promise.resolve(null),
      ]);
      if (resProdutos.ok) setProdutos(await resProdutos.json());
      if (ehGestor && resObras?.ok) setObras(await resObras.json());
      if (ehGestor && resEquipes?.ok) setEquipes(await resEquipes.json());
    } catch {
      // Sem internet real (WiFi sem dados): usa o pacote local no Modo Campo.
      registrarFalhaDeRede();
      if (usarLocal()) {
        const lista = await getListaLocal();
        setTotalOs(lista.length);
        setListaOs(lista);
        const catalogo = await getProdutosLocal();
        if (catalogo.length) setProdutos(catalogo);
      } else {
        mostrarToast('Erro de conexão ao carregar o módulo de O.S.', 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [buscaAplicada, filtroObra, filtroEquipe, filtroPrioridade, filtroStatus, ehGestor, mostrarToast]);

  // Listagem de Encerradas (gestor): paginação e filtros próprios.
  const carregarArquivo = useCallback(async (offset, reset) => {
    if (!ehGestor || usarLocal()) return;
    setCarregandoArquivo(true);
    try {
      const params = new URLSearchParams();
      if (buscaAplicada) params.set('busca', buscaAplicada);
      if (filtroObra) params.set('obra_id', filtroObra);
      if (filtroEquipe) params.set('equipe_id', filtroEquipe);
      if (filtroPrioridade) params.set('prioridade', filtroPrioridade);
      params.set('status', filtroArquivo || 'concluida,cancelada');
      params.set('limit', String(LIMITE_PAGINA));
      params.set('offset', String(offset));
      const res = await apiFetch(`${API_URL}/os/?${params.toString()}`);
      if (res.ok) {
        const pagina = await res.json();
        setTotalEncerradas(Number(res.headers.get('X-Total-Count') || pagina.length));
        setListaEncerradas(prev => (reset ? pagina : [...prev, ...pagina]));
      } else {
        mostrarToast('Erro ao carregar Encerradas.', 'error');
      }
    } catch {
      registrarFalhaDeRede();
      if (!usarLocal()) mostrarToast('Erro de conexão ao carregar Encerradas.', 'error');
    } finally {
      setCarregandoArquivo(false);
    }
  }, [buscaAplicada, filtroObra, filtroEquipe, filtroPrioridade, filtroArquivo, ehGestor, mostrarToast]);

  const carregarDados = useCallback(() => {
    if (ehGestor && visao === 'arquivo') carregarArquivo(0, true);
    else buscarPagina(0, true);
  }, [buscarPagina, carregarArquivo, ehGestor, visao]);

  const carregarMais = () => buscarPagina(listaOs.length, false);
  const carregarMaisArquivo = () => carregarArquivo(listaEncerradas.length, false);

  // Recarrega sempre que carregarDados muda de identidade — o que acontece ao
  // trocar filtros (via buscarPagina/carregarArquivo) ou a visão atual.
  useEffect(() => { carregarDados(); }, [carregarDados]);

  // Recarrega o painel após operações no painel de execução.
  const recarregarLista = useCallback(() => { carregarDados(); }, [carregarDados]);

  // --- Transição de status --------------------------------------------------

  const mudarStatus = useCallback(async (os, novoStatus, extras = {}, tentativa = 0) => {
    setProcessando(true);
    // Localização real no momento da ação (não reutiliza check-in antigo).
    const gps = await capturarGps();

    // Offline: registra na fila do dispositivo e reflete localmente.
    if (usarLocal()) {
      try {
        await enfileirarOperacao({
          tipo: 'status',
          os_id: os.id,
          payload: {
            novo_status: novoStatus,
            justificativa: extras.justificativa || null,
            geolocalizacao: gps,
            fotos_ids: extras.fotos_ids || [],
          },
        });
        await atualizarStatusLocal(os.id, novoStatus);
        setListaOs(prev => prev.map(o => (o.id === os.id ? { ...o, status: novoStatus } : o)));
        setOsSelecionada(prev => prev);
        mostrarToast(`${os.codigo} movida para "${LABEL_STATUS[novoStatus]}" (será sincronizada).`);
        const p = await contarPendentes();
        setPendentes(p);
        return true;
      } catch {
        mostrarToast('Falha ao registrar a transição no dispositivo.', 'error');
        return false;
      } finally {
        setProcessando(false);
      }
    }

    try {
      const res = await apiFetch(`${API_URL}/os/${os.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novo_status: novoStatus, geolocalizacao: gps, ...extras }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        mostrarToast(`${os.codigo} movida para "${LABEL_STATUS[novoStatus]}".`);
        recarregarLista();
        return true;
      }
      mostrarToast(erroDaResposta(data, 'Transição não permitida.'), 'error');
      return false;
    } catch {
      // Sem internet real: a transição entra na fila local (Modo Campo).
      if (tentativa === 0 && isModoCampo()) {
        registrarFalhaDeRede();
        return mudarStatus(os, novoStatus, extras, 1);
      }
      mostrarToast('Erro de conexão ao alterar status.', 'error');
      return false;
    } finally {
      setProcessando(false);
    }
  }, [capturarGps, mostrarToast, recarregarLista]);

  // Exclusão definitiva de O.S (gestor; rascunho/encerradas) — chama a rota
  // e atualiza a visão atual.
  const excluirOs = async () => {
    const alvo = confirmacaoExcluir?.os;
    if (!alvo) return;
    setConfirmacaoExcluir(null);
    setProcessando(true);
    try {
      const res = await apiFetch(`${API_URL}/os/${alvo.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        mostrarToast(`O.S ${alvo.codigo} excluída.`);
        if (osSelecionada === alvo.id) setOsSelecionada(null);
        recarregarLista();
      } else {
        mostrarToast(erroDaResposta(data, 'Erro ao excluir a O.S.'), 'error');
      }
    } catch {
      mostrarToast('Erro de conexão ao excluir a O.S.', 'error');
    } finally {
      setProcessando(false);
    }
  };

  // Drag-and-drop do Kanban com validação UX antes de chamar a API.
  const aoArrastarInicio = (resultado) => {
    const os = listaOs.find(o => String(o.id) === resultado.draggableId);
    if (os) setDraggingOsStatus(os.status);
  };

  const aoArrastarFim = (resultado) => {    setDraggingOsStatus(null);
    const { destination, source, draggableId } = resultado;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;

    const os = listaOs.find(o => String(o.id) === draggableId);
    if (!os) return;
    const destino = destination.droppableId;

    // Bloqueia transições inválidas com feedback claro ao usuário.
    if (!transicoes[os.status]?.has(destino)) {
      mostrarToast(`Transição não permitida: "${LABEL_STATUS[os.status]}" → "${LABEL_STATUS[destino]}".`, 'error');
      return;
    }

    // Cancelamento é decisão de gestão: só quem tem "os" pode cancelar.
    if (destino === 'cancelada' && !ehGestor) {
      mostrarToast('O cancelamento da O.S é restrito ao gestor.', 'error');
      return;
    }

    // Regra crítica: impedir exige justificativa + fotos (modal dedicado).
    if (destino === 'impedida') {
      setModalImpedimento({ os });
      return;
    }
    // Encerramentos são irreversíveis: pedem confirmação explícita.
    if (['concluida', 'cancelada'].includes(destino)) {
      setConfirmacaoEncerrar({ os, destino });
      return;
    }
    mudarStatus(os, destino);
  };

  const confirmarImpedimento = async (justificativa, fotosIds = []) => {
    const { os } = modalImpedimento;
    // As fotos já foram enviadas pelo modal — só passamos os IDs para o backend validar.
    const ok = await mudarStatus(os, 'impedida', { justificativa, fotos_ids: fotosIds });
    if (ok) setModalImpedimento(null);
  };

  // --- Agrupamento do Kanban ---------------------------------------------------

  // Colunas visíveis: gestor vê todas; o campo vê as em execução + impedidas.
  const colunasVisiveis = useMemo(
    () => COLUNAS.filter(c => ehGestor || ['aberta', 'em_andamento', 'impedida'].includes(c.id)),
    [ehGestor],
  );

  const porColuna = useMemo(() => {
    const mapa = Object.fromEntries(COLUNAS.map(c => [c.id, []]));
    for (const os of listaOs) (mapa[os.status] || mapa.rascunho).push(os);
    return mapa;
  }, [listaOs]);

  // Etapas do "funil ativo" (exclui o arquivo de encerradas) e arquivo.
  const pipelineCols = useMemo(
    () => colunasVisiveis.filter(c => STATUS_PIPELINE.includes(c.id)),
    [colunasVisiveis],
  );
  const arquivoCols = useMemo(
    () => colunasVisiveis.filter(c => !STATUS_PIPELINE.includes(c.id)),
    [colunasVisiveis],
  );

  // Colunas exibidas no quadro (gestor): em repouso apenas as etapas do funil
  // que têm O.S (ou a etapa sendo filtrada); durante o arrastar, as etapas
  // vazias e o arquivo (Concluída/Cancelada) aparecem como destinos.
  const arrastando = draggingOsStatus !== null;
  const colunasQuadro = useMemo(() => {
    if (!ehGestor) return colunasVisiveis;
    if (arrastando) return [...pipelineCols, ...arquivoCols];
    return pipelineCols.filter(c => porColuna[c.id].length > 0 || filtroStatus === c.id);
  }, [ehGestor, arrastando, pipelineCols, arquivoCols, porColuna, filtroStatus, colunasVisiveis]);

  const quadroVazio = ehGestor && !arrastando && colunasQuadro.length === 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-400">Carregando Ordens de Serviço...</p>
        </div>
      </div>
    );
  }

  const seletorVisao = (
    <div className="flex bg-slate-100 rounded-xl p-1">
      {[
        ['quadro', 'Quadro', LayoutGrid],
        ...(ehGestor ? [['arquivo', 'Encerradas', Archive]] : []),
        ...(ehGestor ? [['cadastros', 'Cadastros', FolderKanban]] : []),
      ].map(([key, label, Icon]) => (
        <button key={key} onClick={() => setVisao(key)}
          className={`flex items-center gap-1.5 px-3 py-1.5 min-h-11 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            visao === key ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}>
          <Icon size={14} />{label}
        </button>
      ))}
    </div>
  );

  const botaoNova = ehGestor ? (
    <button onClick={() => setModalNova(true)}
      className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl font-semibold text-sm hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer">
      <Plus size={18} /> Nova O.S
    </button>
  ) : null;

  const filtros = (
    <div className="flex flex-col md:flex-row gap-3 md:items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
      <div className="relative flex-1 md:max-w-xs">
        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400"><Search size={16} /></span>
        <input value={filtroBusca} onChange={(e) => setFiltroBusca(e.target.value)}
          placeholder="Buscar código, obra, Nota PS ou cliente..."
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-sm focus:outline-none focus:border-primary-500" />
      </div>
      {ehGestor && (
        <select value={filtroObra} onChange={(e) => setFiltroObra(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600">
          <option value="">Todas as obras</option>
          {obras.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
        </select>
      )}
      {ehGestor && (
        <select value={filtroEquipe} onChange={(e) => setFiltroEquipe(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600">
          <option value="">Todas as equipes</option>
          {equipes.map(eq => <option key={eq.id} value={eq.id}>{eq.numero ? `Nº ${eq.numero} - ${eq.nome}` : eq.nome}</option>)}
        </select>
      )}
      <select value={filtroPrioridade} onChange={(e) => setFiltroPrioridade(e.target.value)}
        className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600">
        <option value="">Todas as prioridades</option>
        {Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      {/* Botão limpar filtros — aparece só quando há filtros ativos */}
      {(filtroBusca || filtroObra || filtroEquipe || filtroPrioridade || filtroStatus) && (
        <button
          onClick={() => {
            setFiltroBusca(''); setBuscaAplicada(''); setFiltroObra(''); setFiltroEquipe(''); setFiltroPrioridade(''); setFiltroStatus('');
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-xs font-bold hover:bg-rose-100 transition-colors cursor-pointer shrink-0"
        >
          <X size={13} />
          Limpar filtros
          <span className="bg-rose-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-black">
            {[filtroBusca, filtroObra, filtroEquipe, filtroPrioridade, filtroStatus].filter(Boolean).length}
          </span>
        </button>
      )}
    </div>
  );

  // Cores dos chips por status (espelha o BadgeStatus).
  const COR_CHIP = {
    rascunho: { sel: 'bg-slate-600 text-white border-slate-600', off: 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300' },
    aberta: { sel: 'bg-sky-600 text-white border-sky-600', off: 'bg-sky-50 text-sky-700 border-sky-200 hover:border-sky-300' },
    em_andamento: { sel: 'bg-primary-600 text-white border-primary-600', off: 'bg-primary-50 text-primary-700 border-primary-200 hover:border-primary-300' },
    impedida: { sel: 'bg-orange-600 text-white border-orange-600', off: 'bg-orange-50 text-orange-700 border-orange-200 hover:border-orange-300' },
  };

  // Barra de resumo do pipeline (gestor): chips por status + card Encerradas.
  const barraPipeline = ehGestor ? (
    <div className="flex flex-wrap items-center gap-2 bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mr-1">Pipeline</span>
      {pipelineCols.map(col => {
        const ativo = filtroStatus === col.id;
        const cor = COR_CHIP[col.id] || COR_CHIP.rascunho;
        return (
          <button
            key={col.id}
            onClick={() => setFiltroStatus(ativo ? '' : col.id)}
            title={ativo ? 'Remover filtro por status' : `Filtrar o quadro por "${col.label}"`}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold transition-all cursor-pointer ${
              ativo ? cor.sel : cor.off
            }`}
          >
            {col.label} <span className={`rounded-full px-1.5 text-[10px] font-black ${ativo ? 'bg-white/25' : 'bg-white border'}`}>{porColuna[col.id].length}</span>
          </button>
        );
      })}
      <div className="flex-1" />
      <button
        onClick={() => setVisao('arquivo')}
        title="Ver as O.S concluídas e canceladas"
        className="flex items-center gap-2 px-4 py-2 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-bold hover:bg-emerald-100 transition-all cursor-pointer"
      >
        <Archive size={13} />
        Encerradas · {porColuna.concluida.length + porColuna.cancelada.length}
        <span className="text-[9px] font-semibold opacity-70">({porColuna.concluida.length} concluídas · {porColuna.cancelada.length} canceladas)</span>
      </button>
      {/* Barra de proporção: só quando a lista está 100% carregada e sem filtros */}
      {totalOs === listaOs.length && totalOs > 0 && !filtroBusca && !filtroObra && !filtroEquipe && !filtroPrioridade && !filtroStatus && (
        <div className="w-full flex h-1.5 bg-slate-100 rounded-full overflow-hidden">
          {pipelineCols.map(col => (
            porColuna[col.id].length > 0 && (
              <span key={col.id} title={`${col.label}: ${porColuna[col.id].length}`}
                className={`h-full ${col.id === 'impedida' ? 'bg-orange-400' : col.id === 'aberta' ? 'bg-sky-400' : col.id === 'em_andamento' ? 'bg-primary-500' : 'bg-slate-400'}`}
                style={{ width: `${(porColuna[col.id].length / totalOs) * 100}%` }} />
            )
          ))}
        </div>
      )}
    </div>
  ) : null;


  return (
    <div className="space-y-5 relative">
      <Toast toast={toast} />

      {/* Header de ações */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          {seletorVisao}
          <span className="text-xs text-slate-400 font-semibold">{totalOs} O.S no total{listaOs.length < totalOs ? ` (${listaOs.length} carregadas)` : ''}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Modo Campo: exclusivo do usuário de campo (os_campo) — o gestor
              não usa download offline/finalização de pacote local */}
          {!ehGestor && modoCampo && (
            <>
              {/* Finalizar Modo Campo: único fluxo de saída (sincroniza e encerra) */}
              <button
                onClick={finalizarModoCampo}
                disabled={preparandoPacote || sincronizando}
                title="Sincronizar todas as pendências com a base e encerrar o Modo Campo (apaga os dados locais do dispositivo)"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-300 bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 transition-all cursor-pointer disabled:opacity-50"
              >
                {sincronizando
                  ? <RefreshCw size={15} className="animate-spin" />
                  : <Check size={15} />}
                {sincronizando ? 'Finalizando...' : 'Finalizar Modo Campo'}
              </button>

              {/* Modo Campo: ativo vira indicador sem ação (a saída é feita
                  pelo "Finalizar Modo Campo") */}
              <button
                disabled
                title='Modo Campo ativo — para encerrar, use o botão "Finalizar Modo Campo"'
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border font-bold text-xs transition-all border-primary-300 bg-primary-600 text-white cursor-default opacity-100"
              >
                <HardHat size={15} />
                {preparandoPacote ? 'Baixando O.S...' : `Modo Campo ${infoPacoteLocal ? `(${infoPacoteLocal.quantidade} O.S)` : ''}`}
              </button>
            </>
          )}

          {!ehGestor && !modoCampo && (
            /* Preparar Modo Campo: baixa o pacote offline para o dispositivo */
            <button
              onClick={alternarModoCampo}
              disabled={preparandoPacote || sincronizando}
              title="Baixar as O.S para o dispositivo e trabalhar sem internet"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border font-bold text-xs transition-all cursor-pointer disabled:opacity-50 border-primary-300 bg-primary-50 text-primary-700 hover:bg-primary-100"
            >
              <HardHat size={15} />
              {preparandoPacote ? 'Baixando O.S...' : 'Preparar Modo Campo'}
            </button>
          )}

          {/* Pendências + sincronizar (visível quando há fila offline) */}
          {pendentes.total > 0 && (
            <button
              onClick={() => setModalPendenciasAberto(true)}
              title="Abrir pendências de sincronização"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-700 font-bold text-xs hover:bg-amber-100 transition-all cursor-pointer"
            >
              <RefreshCw size={15} className={sincronizando ? 'animate-spin' : ''} />
              {sincronizando ? 'Sincronizando...' : `Pendências (${pendentes.total})`}
            </button>
          )}
          {botaoNova}
        </div>
      </div>

      {/* Aviso de operação offline */}
      {offline && (
        <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <WifiOff size={18} className="text-amber-600 shrink-0" />
            <div>
              <p className="text-xs font-extrabold text-amber-800">
                Sem conexão — operando com o pacote local
              </p>
              <p className="text-[10px] font-semibold text-amber-600">
                {pendentes.total > 0
                  ? `${pendentes.total} item(ns) aguardando sincronização.`
                  : 'As ações serão registradas e sincronizadas ao reconectar.'}
              </p>
            </div>
          </div>
          {modoCampo && (
            <span className="shrink-0 text-[10px] font-bold bg-white border border-amber-200 text-amber-700 rounded-full px-3 py-1">
              Modo Campo ativo
            </span>
          )}
        </div>
      )}

      {visao === 'quadro' && (
        <>
          {filtros}
          {barraPipeline}

          {/* Estado vazio do funil ativo (gestor) */}
          {quadroVazio && !osSelecionada && (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 px-6 py-12 text-center space-y-1">
              <p className="text-sm font-bold text-slate-500">Nenhuma O.S em andamento no momento.</p>
              <p className="text-xs text-slate-400">
                As O.S concluídas e canceladas ficam organizadas na aba <b>Encerradas</b>.
              </p>
            </div>
          )}

          {/* ===== KANBAN (desktop) ===== */}
          <DragDropContext onDragStart={aoArrastarInicio} onDragEnd={aoArrastarFim}>
            <div
              className={`${quadroVazio && !osSelecionada ? 'hidden' : ''} hidden lg:grid gap-3 items-start relative ${ehGestor ? '' : 'grid-cols-3'}`}
              style={ehGestor ? { gridTemplateColumns: `repeat(${Math.max(colunasQuadro.length, 1)}, minmax(0, 1fr))` } : undefined}
            >
              {colunasQuadro.map(col => {
                // Durante o drag, calcula se esta coluna é um destino válido
                const eDestinoInvalido = draggingOsStatus !== null
                  && draggingOsStatus !== col.id
                  && !transicoes[draggingOsStatus]?.has(col.id);

                return (
                  <div
                    key={col.id}
                    className={`bg-white/70 rounded-2xl border transition-all duration-200 ${
                      eDestinoInvalido
                        ? 'border-slate-200 opacity-40 grayscale pointer-events-none'
                        : 'border-slate-100'
                    }`}
                  >
                    <div className="px-3 pt-3 pb-2 flex items-center justify-between">
                      <span className={`text-xs font-extrabold uppercase tracking-wide ${
                        col.id === 'impedida' ? 'text-orange-600' : col.id === 'concluida' ? 'text-emerald-600' : col.id === 'cancelada' ? 'text-rose-500' : 'text-slate-500'
                      }`}>{col.label}</span>
                      <span className="text-[10px] font-bold bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">
                        {porColuna[col.id].length}
                      </span>
                    </div>
                    <Droppable droppableId={col.id}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`px-2 pb-2 space-y-2 min-h-[120px] max-h-[calc(100vh-280px)] overflow-y-auto rounded-b-2xl transition-colors ${
                            snapshot.isDraggingOver ? 'bg-primary-50/80 ring-2 ring-primary-300 ring-inset' : ''
                          }`}
                        >
                          {porColuna[col.id].map((os, index) => (
                            <Draggable key={os.id} draggableId={String(os.id)} index={index}>
                              {(prov, snap) => (
                                <div ref={prov.innerRef} {...prov.draggableProps} {...prov.dragHandleProps}
                                  style={{ ...prov.draggableProps.style, opacity: snap.isDragging ? 0.85 : 1 }}>
                                  <CardOS os={os} onClick={() => setOsSelecionada(os.id)} />
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {porColuna[col.id].length === 0 && (
                            <p className="mx-1 text-center text-[10px] font-semibold text-slate-300 border border-dashed border-slate-200 rounded-xl py-5">
                              Sem O.S — arraste para cá
                            </p>
                          )}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                );
              })}
            </div>
          </DragDropContext>

          {/* Drawer de detalhes (desktop) — fora do grid para sobreviver ao
              estado vazio e às trocas de colunas dinâmicas */}
          {osSelecionada != null && (
            <PainelExecucao
              osId={osSelecionada}
              obras={obras}
              produtos={produtos}
              capturarGps={capturarGps}
              onFechar={() => setOsSelecionada(null)}
              recarregarLista={recarregarLista}
              mostrarToast={mostrarToast}
              ehMobile={false}
              mudarStatus={mudarStatus}
              ehGestor={ehGestor}
              onEditar={(detalhe) => setModalEdicao(detalhe)}
              onExcluir={(detalhe) => setConfirmacaoExcluir({ os: detalhe })}
              transicoes={transicoes}
            />
          )}

          {/* ===== MODO CAMPO (mobile): lista + execução em tela cheia ===== */}
          <div className="lg:hidden space-y-3">            {osSelecionada != null ? (
              <>
                <button onClick={() => setOsSelecionada(null)}
                  className="flex items-center gap-1.5 text-sm font-bold text-primary-600 cursor-pointer">
                  <ChevronLeft size={18} /> Voltar ao quadro
                </button>
                <PainelExecucao
                  osId={osSelecionada}
                  obras={obras}
                  produtos={produtos}
                  capturarGps={capturarGps}
                  onFechar={() => setOsSelecionada(null)}
                  recarregarLista={recarregarLista}
                  mostrarToast={mostrarToast}
                  ehMobile
                  mudarStatus={mudarStatus}
                  ehGestor={ehGestor}
                  onEditar={(detalhe) => setModalEdicao(detalhe)}
                  onExcluir={(detalhe) => setConfirmacaoExcluir({ os: detalhe })}
                  transicoes={transicoes}
                />
              </>
            ) : (
              <>
                {listaOs.length === 0 && (
                  <p className="text-center text-sm text-slate-400 py-12">Nenhuma O.S encontrada.</p>
                )}
                {/* Agrupada por status para localizar rapidamente as O.S em execução */}
                {colunasVisiveis.filter(col => porColuna[col.id].length > 0).map(col => (
                  <div key={col.id} className="space-y-2">
                    <div className="flex items-center gap-2 pt-1">
                      <span className={`text-[10px] font-extrabold uppercase tracking-wider ${
                        col.id === 'impedida' ? 'text-orange-600' : col.id === 'concluida' ? 'text-emerald-600' : col.id === 'cancelada' ? 'text-rose-500' : 'text-slate-500'
                      }`}>{col.label}</span>
                      <span className="text-[10px] font-bold bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">
                        {porColuna[col.id].length}
                      </span>
                      <div className="flex-1 h-px bg-slate-200" />
                    </div>
                    {porColuna[col.id].map(os => (
                      <CardOS key={os.id} os={os} onClick={() => setOsSelecionada(os.id)} />
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Paginação: carrega a próxima página do Kanban */}
          {listaOs.length < totalOs && (
            <button
              onClick={carregarMais}
              className="w-full py-3 rounded-xl border border-slate-200 bg-white text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Carregar mais ({totalOs - listaOs.length} restantes)
            </button>
          )}
        </>
      )}

      {visao === 'arquivo' && ehGestor && (
        <>
          {filtros}

          {/* Seletor: todas / concluídas / canceladas */}
          <div className="flex flex-wrap items-center gap-2 bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mr-1">Encerradas</span>
            {[['', 'Todas'], ['concluida', 'Concluídas'], ['cancelada', 'Canceladas']].map(([valor, rotulo]) => {
              const ativo = filtroArquivo === valor;
              return (
                <button key={valor} onClick={() => setFiltroArquivo(valor)}
                  className={`px-3 py-1.5 rounded-full border text-[11px] font-bold transition-all cursor-pointer ${
                    ativo
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-primary-300'
                  }`}>
                  {rotulo}
                </button>
              );
            })}
            <div className="flex-1" />
            <span className="text-[10px] font-bold text-slate-400">
              {totalEncerradas > 0 && listaEncerradas.length < totalEncerradas
                ? `${totalEncerradas} no total (${listaEncerradas.length} carregadas)`
                : `${totalEncerradas} O.S encerradas`}
            </span>
          </div>

          {carregandoArquivo && listaEncerradas.length === 0 ? (
            <div className="text-center py-14 text-xs text-slate-400">Carregando Encerradas...</div>
          ) : listaEncerradas.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 px-6 py-12 text-center">
              <p className="text-sm font-bold text-slate-500">Nenhuma O.S encerrada encontrada.</p>
              <p className="text-xs text-slate-400 mt-1">Ajuste os filtros acima ou acompanhe o quadro.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-100 overflow-hidden">
              {listaEncerradas.map(os => (
                <div key={os.id} className="flex items-stretch hover:bg-slate-50 transition-colors">
                  <button onClick={() => setOsSelecionada(os.id)}
                    className="flex-1 min-w-0 flex flex-col md:flex-row md:items-center gap-1.5 md:gap-4 px-4 py-3 text-left cursor-pointer">
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-primary-700">{os.codigo}</span>
                        <BadgeStatus status={os.status} />
                        <BadgePrioridade prioridade={os.prioridade} />
                      </span>
                      <span className="block text-xs font-semibold text-slate-700 truncate mt-1">{os.obras?.nome || '—'}</span>
                      <span className="block text-[10px] text-slate-400 truncate">
                        Equipe: {os.equipes?.numero ? `Nº ${os.equipes.numero} - ` : ''}{os.equipes?.nome || 'sem equipe'}
                      </span>
                    </span>
                    <span className="flex items-center gap-4 shrink-0 text-[10px] text-slate-400 font-semibold flex-wrap">
                      <span>Encerrada em <b className="text-slate-600">{fmtData(os.data_fim)}</b></span>
                      <span className="hidden sm:inline">{(os.total_materiais_aplicado || 0).toFixed(3)} USC aplicado</span>
                      <span className="hidden sm:inline">{os.fotos_count || 0} foto(s)</span>
                    </span>
                  </button>
                  <span className="flex items-center pr-2.5">
                    <button
                      onClick={() => setConfirmacaoExcluir({ os })}
                      title={`Excluir permanentemente a O.S ${os.codigo}`}
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    >
                      <Trash2 size={15} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {listaEncerradas.length > 0 && listaEncerradas.length < totalEncerradas && (
            <button onClick={carregarMaisArquivo}
              className="w-full py-3 rounded-xl border border-slate-200 bg-white text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors cursor-pointer">
              Carregar mais ({totalEncerradas - listaEncerradas.length} restantes)
            </button>
          )}

          {/* Detalhes da O.S encerrada: drawer (desktop) / tela cheia (móvel) */}
          {osSelecionada != null && (
            <PainelExecucao
              osId={osSelecionada}
              obras={obras}
              produtos={produtos}
              capturarGps={capturarGps}
              onFechar={() => setOsSelecionada(null)}
              recarregarLista={recarregarLista}
              mostrarToast={mostrarToast}
              ehMobile={!ehTelaLarga}
              mudarStatus={mudarStatus}
              ehGestor={ehGestor}
              onEditar={(detalhe) => setModalEdicao(detalhe)}
              onExcluir={(detalhe) => setConfirmacaoExcluir({ os: detalhe })}
              transicoes={transicoes}
            />
          )}
        </>
      )}

      {visao === 'cadastros' && ehGestor && (
        <PainelCadastros
          obras={obras} equipes={equipes} produtos={produtos}
          recarregar={recarregarLista} mostrarToast={mostrarToast}
        />
      )}

      {ehGestor && (
        <ModalNovaOS
          aberto={modalNova || !!modalEdicao}
          obras={obras} equipes={equipes}
          edicao={modalEdicao}
          onFechar={() => { setModalNova(false); setModalEdicao(null); }}
          onCriada={recarregarLista}
          mostrarToast={mostrarToast}
        />
      )}

      <ModalImpedimento
        aberto={!!modalImpedimento}
        osAlvo={modalImpedimento?.os}
        processando={processando}
        onConfirmar={confirmarImpedimento}
        onCancelar={() => setModalImpedimento(null)}
      />


      <ModalConfirmacao
        aberto={!!confirmacaoEncerrar}
        titulo={confirmacaoEncerrar?.destino === 'concluida' ? 'Concluir O.S' : 'Cancelar O.S'}
        mensagem={
          confirmacaoEncerrar?.destino === 'concluida'
            ? `Confirmar a conclusão da O.S ${confirmacaoEncerrar?.os?.codigo}? Esta ação encerra os cronômetros e não pode ser desfeita.`
            : `Confirmar o cancelamento da O.S ${confirmacaoEncerrar?.os?.codigo}? Esta ação não pode ser desfeita.`
        }
        loading={processando}
        onConfirmar={async () => {
          const ok = await mudarStatus(confirmacaoEncerrar.os, confirmacaoEncerrar.destino);
          if (ok) setConfirmacaoEncerrar(null);
        }}
        onCancelar={() => setConfirmacaoEncerrar(null)}
      />

      <ModalConfirmacao
        aberto={!!confirmacaoExcluir}
        titulo="Excluir O.S"
        mensagem={confirmacaoExcluir?.os
          ? `Excluir permanentemente a O.S ${confirmacaoExcluir.os.codigo}? Apaga fotos, lançamentos de serviços, checklist e histórico — sem possibilidade de desfazer.`
          : ''}
        confirmarTexto="Excluir permanentemente"
        perigo
        loading={processando}
        onConfirmar={excluirOs}
        onCancelar={() => setConfirmacaoExcluir(null)}
      />

      <ModalConfirmacao
        aberto={confirmacaoFinalizarModoCampo}
        titulo="Finalizar Modo Campo"
        mensagem="Sincronizar todas as pendências com a base e encerrar o Modo Campo, apagando os dados locais deste dispositivo? (O tablet é da equipe.) Se houver itens com erro na sincronização, você poderá revisá-los antes de finalizar."
        confirmarTexto="Sincronizar e finalizar"
        perigo
        loading={sincronizando}
        onConfirmar={confirmarFinalizarModoCampo}
        onCancelar={() => setConfirmacaoFinalizarModoCampo(false)}
      />

      <ModalPendenciasSync
        aberto={modalPendenciasAberto}
        onFechar={() => setModalPendenciasAberto(false)}
        sincronizando={sincronizando}
        offline={offline}
        ultimoResumo={ultimoResumo}
        onSincronizarTudo={() => sincronizarAgora()}
        onItemSincronizado={async () => {
          const p = await contarPendentes();
          setPendentes(p);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cadastros de apoio (Obras, Equipes, Produtos) — CRUD compacto
// ---------------------------------------------------------------------------

function CampoTexto({ label, ...props }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-700 mb-1">{label}</label>
      <input {...props}
        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500" />
    </div>
  );
}

function PainelCadastros({ obras, equipes, produtos, recarregar, mostrarToast }) {
  const [abaAtiva, setAbaAtiva] = useState('obras');

  // Clientes (usados no autopreenchimento por Nota PS e no select da obra).
  const [listaClientes, setListaClientes] = useState([]);
  const [clienteAuto, setClienteAuto] = useState(null); // cliente encontrado pela Nota PS

  useEffect(() => {
    apiFetch(`${API_URL}/clientes/`)
      .then(res => (res.ok ? res.json() : []))
      .then(setListaClientes)
      .catch(() => setListaClientes([]));
  }, []);

  // Obras
  const [novaObra, setNovaObra] = useState({ nome: '', cliente_id: '', cliente_celesc: '', cidade: '', endereco: '' });
  const [obraCelesc, setObraCelesc] = useState(false); // true = obra de terceiro (Cliente Celesc)
  const [filtroObraLista, setFiltroObraLista] = useState('');
  const [obraEmEdicao, setObraEmEdicao] = useState(null);
  const [excluirObraAlvo, setExcluirObraAlvo] = useState(null);

  // Equipes
  const [novaEquipe, setNovaEquipe] = useState({ nome: '', numero: '', membros: [], lider: '' });
  const [filtroEquipeLista, setFiltroEquipeLista] = useState('');
  const [equipeEmEdicao, setEquipeEmEdicao] = useState(null);
  const [excluirEquipeAlvo, setExcluirEquipeAlvo] = useState(null);

  // Produtos (serviços por contrato)
  const [novoProduto, setNovoProduto] = useState({ nome: '', codigo: '', codigo_especial: '', unidade: 'UN', preco_unitario: '', qtd_usc_especial: '', tipo: '' });
  const [filtroProdutoLista, setFiltroProdutoLista] = useState('');
  const [filtroTipoProduto, setFiltroTipoProduto] = useState('todos');
  const [produtoEmEdicao, setProdutoEmEdicao] = useState(null);
  const [excluirProdutoAlvo, setExcluirProdutoAlvo] = useState(null);

  // Importação em lote de serviços (.xlsx) — contrato fixo escolhido na tela.
  const [modalImportar, setModalImportar] = useState(false);
  const [impContrato, setImpContrato] = useState('construcao');
  const [impArquivo, setImpArquivo] = useState(null); // arquivo validado (aguardando confirmação)
  const [impResumo, setImpResumo] = useState(null);   // {resumo, contrato} da simulação
  const [impProcessando, setImpProcessando] = useState(false);
  const inputImportRef = useRef(null);

  const post = async (url, corpo, msgOk) => {
    try {
      const res = await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      const data = await res.json().catch(() => null);
      if (res.ok) { mostrarToast(msgOk); recarregar(); return true; }
      mostrarToast(erroDaResposta(data, 'Erro ao salvar.'), 'error');
      return false;
    } catch {
      mostrarToast('Erro de conexão.', 'error');
      return false;
    }
  };

  const put = async (url, corpo, msgOk) => {
    try {
      const res = await apiFetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      const data = await res.json().catch(() => null);
      if (res.ok) { mostrarToast(msgOk); recarregar(); return true; }
      mostrarToast(erroDaResposta(data, 'Erro ao salvar.'), 'error');
      return false;
    } catch {
      mostrarToast('Erro de conexão.', 'error');
      return false;
    }
  };

  const inativar = async (url, msgOk) => {
    try {
      const res = await apiFetch(url, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (res.ok) { mostrarToast(data?.message || msgOk); recarregar(); }
      else mostrarToast(erroDaResposta(data, 'Erro ao excluir.'), 'error');
    } catch {
      mostrarToast('Erro de conexão.', 'error');
    }
  };

  const obrasFiltradas = useMemo(() => {
    if (!filtroObraLista) return obras;
    const termo = filtroObraLista.toLowerCase();
    return obras.filter(o =>
      (o.nome || '').toLowerCase().includes(termo) ||
      (o.clientes?.nome || o.cliente_celesc || '').toLowerCase().includes(termo) ||
      (o.cidade || '').toLowerCase().includes(termo) ||
      (o.endereco || '').toLowerCase().includes(termo)
    );
  }, [obras, filtroObraLista]);

  // Autopreenchimento: digitar a Nota PS localiza o cliente correspondente e
  // já vincula o cliente + cidade/endereço do cadastro dele (só vale no modo
  // "Cliente do cadastro"; obras da Celesc não passam pelo cadastro).
  useEffect(() => {
    if (obraCelesc) {
      setClienteAuto(null);
      return;
    }
    if (obraEmEdicao) {
      setClienteAuto(null);
      return;
    }
    const termo = (novaObra.nome || '').trim().toLowerCase();
    if (termo.length < 3) {
      setClienteAuto(null);
      return;
    }
    const timer = setTimeout(() => {
      const candidatos = listaClientes.filter(c =>
        (c.nota_ps || '').trim().toLowerCase().includes(termo)
      );
      const cliente = candidatos.find(c => (c.nota_ps || '').trim().toLowerCase() === termo) ||
        (candidatos.length === 1 ? candidatos[0] : null);
      setClienteAuto(cliente);
      if (cliente) {
        setNovaObra(prev => ({
          ...prev,
          cliente_id: prev.cliente_id || String(cliente.id),
          cidade: prev.cidade || cliente.cidade || '',
          endereco: prev.endereco || cliente.endereco || '',
        }));
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [novaObra.nome, listaClientes, obraEmEdicao, obraCelesc]);

  const equipesFiltradas = useMemo(() => {
    if (!filtroEquipeLista) return equipes;
    const termo = filtroEquipeLista.toLowerCase();
    return equipes.filter(eq =>
      (eq.nome || '').toLowerCase().includes(termo) ||
      (eq.membros || []).some(m => (m.nome || '').toLowerCase().includes(termo))
    );
  }, [equipes, filtroEquipeLista]);

  const produtosFiltrados = useMemo(() => {
    let lista = produtos;
    // Filtro por contrato: legados (sem tipo) valem para todos os contratos.
    if (filtroTipoProduto !== 'todos') {
      lista = lista.filter(p => !p.tipo || p.tipo === filtroTipoProduto);
    }
    if (filtroProdutoLista) {
      const termo = filtroProdutoLista.toLowerCase();
      lista = lista.filter(p =>
        (p.nome || '').toLowerCase().includes(termo) ||
        (p.codigo || '').toLowerCase().includes(termo) ||
        (p.codigo_especial || '').toLowerCase().includes(termo)
      );
    }
    return lista;
  }, [produtos, filtroProdutoLista, filtroTipoProduto]);

  const ROTULOS_TIPO_SERVICO = {
    construcao: 'Construção',
    manutencao: 'Manutenção',
    linha_viva: 'Linha Viva',
  };

  const iniciarProdutoEdicao = (p) => {
    setProdutoEmEdicao(p);
    setNovoProduto({
      nome: p.nome || '',
      codigo: p.codigo || '',
      codigo_especial: p.codigo_especial || '',
      unidade: p.unidade || 'UN',
      preco_unitario: p.preco_unitario != null ? String(p.preco_unitario) : '',
      qtd_usc_especial: p.qtd_usc_especial != null ? String(p.qtd_usc_especial) : '',
      tipo: p.tipo || '',
    });
  };

  const cancelarProdutoEdicao = () => {
    setProdutoEmEdicao(null);
    setNovoProduto({ nome: '', codigo: '', codigo_especial: '', unidade: 'UN', preco_unitario: '', qtd_usc_especial: '', tipo: '' });
  };

  // --- Importação em lote de serviços (.xlsx) ---

  const baixarModeloServicos = async () => {
    try {
      const res = await apiFetch(`${API_URL}/os/produtos/modelo`);
      if (!res.ok) {
        mostrarToast('Erro ao baixar o modelo.', 'error');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'modelo_servicos.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      mostrarToast('Erro de conexão ao baixar o modelo.', 'error');
    }
  };

  const enviarImportacao = async (simular, arquivo, contrato) => {
    const formData = new FormData();
    formData.append('file', arquivo);
    formData.append('simular', simular ? 'true' : 'false');
    formData.append('tipo', contrato);
    return apiFetch(`${API_URL}/os/produtos/importar`, { method: 'POST', body: formData });
  };

  const escolherArquivoServicos = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      mostrarToast('Apenas arquivos .xlsx são permitidos.', 'error');
      return;
    }
    setImpProcessando(true);
    try {
      const res = await enviarImportacao(true, file, impContrato);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        mostrarToast(erroDaResposta(data, 'Erro ao validar planilha.'), 'error');
        return;
      }
      if (data.importados === 0 && (data.erros || []).length === 0) {
        mostrarToast('Nenhuma linha com dados foi encontrada na planilha.', 'error');
        return;
      }
      setImpArquivo(file);
      setImpResumo({ resumo: data, contrato: impContrato });
    } catch {
      mostrarToast('Erro de conexão ao validar planilha.', 'error');
    } finally {
      setImpProcessando(false);
    }
  };

  const confirmarImportacaoServicos = async () => {
    if (!impArquivo || !impResumo) return;
    setImpProcessando(true);
    try {
      const res = await enviarImportacao(false, impArquivo, impResumo.contrato);
      const data = await res.json().catch(() => null);
      if (res.ok) {
        const numErros = (data.erros || []).length;
        if (data.importados > 0 && numErros === 0) {
          mostrarToast(`${data.importados} serviço(s) importado(s) com sucesso!`);
        } else if (data.importados > 0 && numErros > 0) {
          mostrarToast(`${data.importados} importado(s), ${numErros} com erro. Confira o relatório abaixo.`, 'error');
        } else {
          mostrarToast('Nenhum serviço importado. Verifique os erros abaixo.', 'error');
        }
        // Mantém o modal aberto com o RELATÓRIO FINAL (linhas com erro), para
        // conferência — só fecha quando o usuário clicar em Fechar.
        setImpResumo(prev => (prev ? { ...prev, resumo: data, confirmado: true } : prev));
        recarregar();
      } else {
        mostrarToast(erroDaResposta(data, 'Erro ao importar planilha.'), 'error');
      }
    } catch {
      mostrarToast('Erro de conexão ao importar planilha.', 'error');
    } finally {
      setImpProcessando(false);
    }
  };

  const reiniciarImportacao = () => {
    setImpArquivo(null);
    setImpResumo(null);
    setImpContrato('construcao');
    if (inputImportRef.current) inputImportRef.current.value = '';
  };

  const ABAS = [
    { id: 'obras', label: 'Obras', icone: FolderKanban },
    { id: 'equipes', label: 'Equipes', icone: HardHat },
    { id: 'produtos', label: 'Serviços', icone: Boxes }
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      {/* Abas de Navegação */}
      <div className="flex border-b border-slate-100 mb-6 overflow-x-auto scrollbar-none gap-2">
        {ABAS.map(aba => {
          const Icone = aba.icone;
          const ativa = abaAtiva === aba.id;
          return (
            <button
              key={aba.id}
              onClick={() => setAbaAtiva(aba.id)}
              className={`flex items-center gap-2 px-5 py-3 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                ativa
                  ? 'border-primary-600 text-primary-600 font-black'
                  : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-200'
              }`}
            >
              <Icone size={15} />
              {aba.label}
            </button>
          );
        })}
      </div>

      {/* Conteúdo Aba OBRAS */}
      {abaAtiva === 'obras' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Esquerda: Lista e Busca */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
              <h3 className="font-extrabold text-slate-800 text-sm">Obras Cadastradas ({obrasFiltradas.length})</h3>
              {/* Barra de Busca */}
              <div className="relative w-full sm:max-w-xs">
                <input
                  type="text"
                  placeholder="Buscar obra..."
                  value={filtroObraLista}
                  onChange={e => setFiltroObraLista(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-primary-500 bg-slate-50 focus:bg-white"
                />
                <Search size={12} className="absolute left-2.5 top-2.5 text-slate-400" />
                {filtroObraLista && (
                  <button onClick={() => setFiltroObraLista('')} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[450px] overflow-y-auto pr-1">
              {obrasFiltradas.length === 0 ? (
                <div className="col-span-full text-center text-xs text-slate-400 py-12">Nenhuma obra encontrada.</div>
              ) : (
                obrasFiltradas.map(o => (
                  <div key={o.id} className="group relative flex flex-col gap-1 text-xs bg-slate-50 hover:bg-slate-100/70 rounded-xl p-3 border border-slate-100 transition-all">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-extrabold text-slate-800 break-words leading-tight">{o.nome}</span>
                      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => {
                            setObraEmEdicao(o);
                            setObraCelesc(!!o.cliente_celesc && !o.cliente_id);
                            setNovaObra({
                              nome: o.nome || '',
                              cliente_id: String(o.cliente_id || ''),
                              cliente_celesc: o.cliente_celesc || '',
                              cidade: o.cidade || '',
                              endereco: o.endereco || ''
                            });
                          }}
                          className="text-slate-400 hover:text-primary-600 cursor-pointer p-1 rounded hover:bg-white border hover:border-slate-200"
                          title="Editar obra"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={() => setExcluirObraAlvo(o)}
                          className="text-slate-400 hover:text-rose-600 cursor-pointer p-1 rounded hover:bg-white border hover:border-slate-200"
                          title="Excluir obra"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1.5 text-slate-500 font-semibold mt-1">
                      <Building size={11} className="text-slate-400 flex-shrink-0" />
                      <span className="truncate">{o.clientes?.nome || o.cliente_celesc || 'Sem cliente'}</span>
                    </div>

                    {(o.cidade || o.endereco) && (
                      <div className="flex items-start gap-1.5 text-slate-400 text-[10px] leading-tight mt-0.5">
                        <MapPin size={10} className="text-slate-400 mt-0.5 flex-shrink-0" />
                        <span className="break-words">
                          {o.endereco ? `${o.endereco}` : ''}
                          {o.endereco && o.cidade ? ' · ' : ''}
                          {o.cidade ? `${o.cidade}` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Direita: Formulário */}
          <div className="bg-slate-50/50 rounded-2xl border border-slate-100 p-5 space-y-4 h-fit">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                {obraEmEdicao ? `Editar Obra` : 'Nova Obra'}
              </h4>
              {obraEmEdicao && (
                <span className="text-[9px] font-bold bg-amber-50 text-amber-700 rounded-full px-2 py-0.5 border border-amber-200 animate-pulse">
                  Modo Edição
                </span>
              )}
            </div>
            
            <div className="space-y-3">
              {/* Tipo de cliente: cadastro de clientes OU Cliente Celesc */}
              <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
                {[['cadastro', 'Cliente do cadastro'], ['celesc', 'Cliente Celesc']].map(([modo, rotulo]) => {
                  const ativo = obraCelesc === (modo === 'celesc');
                  return (
                    <button key={modo} type="button"
                      onClick={() => {
                        setObraCelesc(modo === 'celesc');
                        setNovaObra(prev => ({
                          ...prev,
                          ...(modo === 'celesc'
                            ? { cliente_id: '' }
                            : { cliente_celesc: '' }),
                        }));
                      }}
                      className={`flex-1 py-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        ativo ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}>
                      {rotulo}
                    </button>
                  );
                })}
              </div>

              <div>
                <CampoTexto label="Nota PS *" value={novaObra.nome} onChange={e => setNovaObra({ ...novaObra, nome: e.target.value })} />
                {!obraCelesc && clienteAuto && (
                  <p className="text-[10px] font-bold text-emerald-600 mt-1">
                    Cliente vinculado automaticamente: {clienteAuto.nome}
                  </p>
                )}
                {!obraCelesc && !clienteAuto && !obraEmEdicao && (novaObra.nome || '').trim().length >= 3 && (
                  <p className="text-[10px] font-semibold text-slate-400 mt-1">
                    Nenhum cliente com esta Nota PS — selecione manualmente abaixo.
                  </p>
                )}
              </div>

              {!obraCelesc ? (
                <ClienteAutocomplete
                  clientes={listaClientes}
                  value={novaObra.cliente_id}
                  onChange={(cliente) => {
                    if (!cliente) {
                      setNovaObra({ ...novaObra, cliente_id: '' });
                      return;
                    }
                    // Ao selecionar o cliente, preenche Nota PS, cidade e endereço.
                    setNovaObra({
                      ...novaObra,
                      cliente_id: String(cliente.id),
                      nome: cliente.nota_ps || novaObra.nome,
                      cidade: cliente.cidade || '',
                      endereco: cliente.endereco || '',
                    });
                  }}
                />
              ) : (
                <CampoTexto label="Cliente Celesc (obra de terceiro) *"
                  value={novaObra.cliente_celesc}
                  onChange={e => setNovaObra({ ...novaObra, cliente_celesc: e.target.value })}
                  placeholder="Ex.: Celesc — Regional X" />
              )}
              <CampoTexto label="Cidade" value={novaObra.cidade} onChange={e => setNovaObra({ ...novaObra, cidade: e.target.value })} />
              <CampoTexto label="Endereço" value={novaObra.endereco} onChange={e => setNovaObra({ ...novaObra, endereco: e.target.value })} />
            </div>

            <div className="flex gap-2 pt-2">
              {obraEmEdicao && (
                <button
                  type="button"
                  onClick={() => {
                    setObraEmEdicao(null);
                    setObraCelesc(false);
                    setNovaObra({ nome: '', cliente_id: '', cliente_celesc: '', cidade: '', endereco: '' });
                  }}
                  className="flex-1 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer hover:bg-slate-50"
                >
                  Cancelar
                </button>
              )}
              <button
                onClick={async () => {
                  if (!novaObra.nome) { mostrarToast('Informe a Nota PS.', 'error'); return; }
                  if (obraCelesc) {
                    if (!(novaObra.cliente_celesc || '').trim()) { mostrarToast('Informe o Cliente Celesc (nome/contrato da obra).', 'error'); return; }
                  } else if (!novaObra.cliente_id) {
                    mostrarToast('Selecione o cliente do cadastro ou mude para "Cliente Celesc".', 'error');
                    return;
                  }
                  const payload = {
                    nome: novaObra.nome,
                    cliente_id: obraCelesc ? null : Number(novaObra.cliente_id),
                    cliente_celesc: obraCelesc ? (novaObra.cliente_celesc || '').trim() || null : null,
                    cidade: novaObra.cidade || null,
                    endereco: novaObra.endereco || null
                  };
                  
                  let ok;
                  if (obraEmEdicao) {
                    ok = await put(`${API_URL}/os/obras/${obraEmEdicao.id}`, payload, 'Obra atualizada.');
                  } else {
                    ok = await post(`${API_URL}/os/obras`, payload, 'Obra criada.');
                  }

                  if (ok) {
                    setObraCelesc(false);
                    setNovaObra({ nome: '', cliente_id: '', cliente_celesc: '', cidade: '', endereco: '' });
                    setObraEmEdicao(null);
                  }
                }}
                className="flex-[2] py-2.5 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all cursor-pointer text-center">
                {obraEmEdicao ? 'Salvar Alterações' : 'Cadastrar Obra'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conteúdo Aba EQUIPES */}
      {abaAtiva === 'equipes' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Esquerda: Lista e Busca */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
              <h3 className="font-extrabold text-slate-800 text-sm">Equipes Cadastradas ({equipesFiltradas.length})</h3>
              {/* Barra de Busca */}
              <div className="relative w-full sm:max-w-xs">
                <input
                  type="text"
                  placeholder="Buscar equipe ou membro..."
                  value={filtroEquipeLista}
                  onChange={e => setFiltroEquipeLista(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-primary-500 bg-slate-50 focus:bg-white"
                />
                <Search size={12} className="absolute left-2.5 top-2.5 text-slate-400" />
                {filtroEquipeLista && (
                  <button onClick={() => setFiltroEquipeLista('')} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[450px] overflow-y-auto pr-1">
              {equipesFiltradas.length === 0 ? (
                <div className="col-span-full text-center text-xs text-slate-400 py-12">Nenhuma equipe encontrada.</div>
              ) : (
                equipesFiltradas.map(eq => (
                  <div key={eq.id} className="group relative flex flex-col gap-2 text-xs bg-slate-50 hover:bg-slate-100/70 rounded-xl p-3 border border-slate-100 transition-all">
                    <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <HardHat size={14} className="text-primary-600 flex-shrink-0" />
                      <span className="font-extrabold text-slate-800 break-words leading-tight">{eq.nome}</span>
                      {eq.numero && (
                        <span className="text-[10px] font-bold bg-primary-50 text-primary-700 border border-primary-100 rounded-full px-2 py-0.5">
                          Nº {eq.numero}
                        </span>
                      )}
                    </div>
                      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => {
                            setEquipeEmEdicao(eq);
                            setNovaEquipe({
                              nome: eq.nome || '',
                              numero: eq.numero || '',
                              membros: (eq.membros || []).map(m => String(m.funcionario_id)),
                              lider: String((eq.membros || []).find(m => m.lider)?.funcionario_id || '')
                            });
                          }}
                          className="text-slate-400 hover:text-primary-600 cursor-pointer p-1 rounded hover:bg-white border hover:border-slate-200"
                          title="Editar equipe"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={() => setExcluirEquipeAlvo(eq)}
                          className="text-slate-400 hover:text-rose-600 cursor-pointer p-1 rounded hover:bg-white border hover:border-slate-200"
                          title="Excluir equipe"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1 mt-1">
                      {(eq.membros || []).map(m => {
                        const ehLider = eq.lider_id ? m.id === eq.lider_id : m.lider;
                        return (
                          <span
                            key={m.id}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              ehLider
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-white text-slate-600 border-slate-200'
                            }`}
                          >
                            {m.nome} {ehLider && '★'}
                          </span>
                        );
                      })}
                      {(!eq.membros || eq.membros.length === 0) && (
                        <span className="text-slate-400 italic text-[11px]">Nenhum membro vinculado</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Direita: Formulário */}
          <div className="bg-slate-50/50 rounded-2xl border border-slate-100 p-5 space-y-4 h-fit">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                {equipeEmEdicao ? 'Editar Equipe' : 'Nova Equipe'}
              </h4>
              {equipeEmEdicao && (
                <span className="text-[9px] font-bold bg-amber-50 text-amber-700 rounded-full px-2 py-0.5 border border-amber-200 animate-pulse">
                  Modo Edição
                </span>
              )}
            </div>
            <div className="space-y-3">
              <CampoTexto label="Nome da equipe *" value={novaEquipe.nome} onChange={e => setNovaEquipe({ ...novaEquipe, nome: e.target.value })} />
              <CampoTexto label="Número da equipe * (impresso no modelo de O.S)" value={novaEquipe.numero} onChange={e => setNovaEquipe({ ...novaEquipe, numero: e.target.value })} />
              <MembrosEquipePicker
                membros={novaEquipe.membros}
                lider={novaEquipe.lider}
                onChange={(membros, lider) => setNovaEquipe({ ...novaEquipe, membros, lider })}
              />
            </div>

            <div className="flex gap-2 pt-2">
              {equipeEmEdicao && (
                <button
                  type="button"
                  onClick={() => {
                    setEquipeEmEdicao(null);
                    setNovaEquipe({ nome: '', numero: '', membros: [], lider: '' });
                  }}
                  className="flex-1 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer hover:bg-slate-50"
                >
                  Cancelar
                </button>
              )}
              <button
                onClick={async () => {
                  if (!novaEquipe.nome) { mostrarToast('Informe o nome da equipe.', 'error'); return; }
                  if (!novaEquipe.numero) { mostrarToast('Informe o número da equipe.', 'error'); return; }
                  const payload = {
                    nome: novaEquipe.nome,
                    numero: novaEquipe.numero || null,
                    membro_ids: novaEquipe.membros.map(Number),
                    lider_id: novaEquipe.lider ? Number(novaEquipe.lider) : null,
                  };
                  const ok = equipeEmEdicao
                    ? await put(`${API_URL}/os/equipes/${equipeEmEdicao.id}`, payload, 'Equipe atualizada.')
                    : await post(`${API_URL}/os/equipes`, payload, 'Equipe criada.');
                  if (ok) {
                    setNovaEquipe({ nome: '', numero: '', membros: [], lider: '' });
                    setEquipeEmEdicao(null);
                  }
                }}
                className={`${equipeEmEdicao ? 'flex-[2]' : 'w-full'} py-2.5 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all cursor-pointer text-center`}>
                {equipeEmEdicao ? 'Salvar Alterações' : 'Cadastrar Equipe'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conteúdo Aba PRODUTOS */}
      {abaAtiva === 'produtos' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Esquerda: Lista e Busca */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
              <h3 className="font-extrabold text-slate-800 text-sm">Serviços ({produtosFiltrados.length})</h3>
              <div className="flex flex-wrap items-center gap-2">
                {/* Ações de importação em lote */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={baixarModeloServicos}
                    title="Baixar modelo .xlsx para preenchimento"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-[10px] font-bold hover:bg-slate-50 transition-all cursor-pointer"
                  >
                    <FileSpreadsheet size={13} />
                    Modelo
                  </button>
                  <button
                    type="button"
                    onClick={() => { setModalImportar(true); setImpResumo(null); setImpArquivo(null); }}
                    title="Cadastrar serviços em lote (.xlsx)"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary-600 text-white text-[10px] font-bold hover:bg-primary-700 transition-all cursor-pointer"
                  >
                    <Upload size={13} />
                    Importar em lote
                  </button>
                </div>
                {/* Filtro por contrato */}
                <div className="flex bg-slate-100 rounded-xl p-1">
                  {[['todos', 'Todos'], ['construcao', 'Construção'], ['manutencao', 'Manutenção'], ['linha_viva', 'Linha Viva']].map(([valor, rotulo]) => (
                    <button
                      key={valor}
                      onClick={() => setFiltroTipoProduto(valor)}
                      className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                        filtroTipoProduto === valor ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {rotulo}
                    </button>
                  ))}
                </div>
                {/* Barra de Busca */}
                <div className="relative w-full sm:max-w-xs">
                  <input
                    type="text"
                    placeholder="Buscar serviço ou código..."
                    value={filtroProdutoLista}
                    onChange={e => setFiltroProdutoLista(e.target.value)}
                    className="w-full pl-8 pr-7 py-1.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-primary-500 bg-slate-50 focus:bg-white"
                  />
                  <Search size={12} className="absolute left-2.5 top-2.5 text-slate-400" />
                  {filtroProdutoLista && (
                    <button onClick={() => setFiltroProdutoLista('')} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600">
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[450px] overflow-y-auto pr-1">
              {produtosFiltrados.length === 0 ? (
                <div className="col-span-full text-center text-xs text-slate-400 py-12">Nenhum serviço encontrado.</div>
              ) : (
                produtosFiltrados.map(p => (
                  <div key={p.id} className="group relative flex flex-col gap-1 text-xs bg-slate-50 hover:bg-slate-100/70 rounded-xl p-3 border border-slate-100 transition-all">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-extrabold text-slate-800 break-words leading-tight">{p.nome}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => iniciarProdutoEdicao(p)}
                          className="text-slate-400 hover:text-amber-600 cursor-pointer p-1 rounded hover:bg-white border hover:border-slate-200 opacity-60 group-hover:opacity-100 transition-opacity"
                          title="Editar serviço"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={() => setExcluirProdutoAlvo(p)}
                          className="text-slate-400 hover:text-rose-600 cursor-pointer p-1 rounded hover:bg-white border hover:border-slate-200 opacity-60 group-hover:opacity-100 transition-opacity"
                          title="Excluir serviço"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                    
                    {(p.codigo || p.codigo_especial) && (
                      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-0.5 text-[10px] font-semibold">
                        {p.codigo && (
                          <span className="text-slate-400">Cod.: {p.codigo}</span>
                        )}
                        {p.codigo_especial && (
                          <span className="text-violet-500">Esp.: {p.codigo_especial}</span>
                        )}
                      </div>
                    )}
                    
                    <div className="text-emerald-600 font-bold mt-1 text-[11px]">
                      Qtd USC: {p.preco_unitario} <span className="text-slate-400 font-normal">/ {p.unidade}</span>
                      {Number(p.qtd_usc_especial || 0) > 0 && (
                        <span className="text-violet-600 font-semibold ml-2">Especial: {p.qtd_usc_especial}</span>
                      )}
                    </div>

                    <span className={`mt-1 text-[9px] font-bold px-2 py-0.5 rounded-full self-start ${
                      p.tipo
                        ? 'bg-primary-50 text-primary-700 border border-primary-100'
                        : 'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}>
                      {ROTULOS_TIPO_SERVICO[p.tipo] || 'Todos os contratos'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Direita: Formulário */}
          <div className="bg-slate-50/50 rounded-2xl border border-slate-100 p-5 space-y-4 h-fit">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              {produtoEmEdicao ? 'Editar Serviço' : 'Novo Serviço'}
            </h4>
            
            <div className="space-y-3">
              <CampoTexto label="Serviço *" value={novoProduto.nome} onChange={e => setNovoProduto({ ...novoProduto, nome: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <CampoTexto label="Código normal" placeholder="Bipagem do USC normal" value={novoProduto.codigo} onChange={e => setNovoProduto({ ...novoProduto, codigo: e.target.value })} />
                <CampoTexto label="Código especial" placeholder="Bipagem do USC especial" value={novoProduto.codigo_especial} onChange={e => setNovoProduto({ ...novoProduto, codigo_especial: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <CampoTexto label="Unidade" value={novoProduto.unidade} onChange={e => setNovoProduto({ ...novoProduto, unidade: e.target.value })} />
                <CampoTexto label="Qtd USC" type="number" step="0.01" min="0" value={novoProduto.preco_unitario}
                  onChange={e => setNovoProduto({ ...novoProduto, preco_unitario: e.target.value })} />
              </div>
              <CampoTexto label="Qtd USC especial" type="number" step="0.01" min="0" value={novoProduto.qtd_usc_especial}
                onChange={e => setNovoProduto({ ...novoProduto, qtd_usc_especial: e.target.value })} />
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Contrato *</label>
                <select
                  value={novoProduto.tipo}
                  onChange={e => setNovoProduto({ ...novoProduto, tipo: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold bg-white"
                >
                  <option value="">Selecione o contrato...</option>
                  {[['construcao', 'Construção'], ['manutencao', 'Manutenção'], ['linha_viva', 'Linha Viva']].map(([valor, rotulo]) => (
                    <option key={valor} value={valor}>{rotulo}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={async () => {
                if (!novoProduto.nome) { mostrarToast('Informe o nome do serviço.', 'error'); return; }
                if (!novoProduto.tipo) { mostrarToast('Selecione o contrato do serviço.', 'error'); return; }
                const corpo = {
                  nome: novoProduto.nome,
                  codigo: novoProduto.codigo || null,
                  codigo_especial: novoProduto.codigo_especial || null,
                  unidade: novoProduto.unidade || 'UN',
                  preco_unitario: Number(novoProduto.preco_unitario || 0),
                  qtd_usc_especial: Number(novoProduto.qtd_usc_especial || 0),
                  tipo: novoProduto.tipo,
                };
                const ok = produtoEmEdicao
                  ? await put(`${API_URL}/os/produtos/${produtoEmEdicao.id}`, corpo, 'Serviço atualizado.')
                  : await post(`${API_URL}/os/produtos`, corpo, 'Serviço criado.');
                if (ok) cancelarProdutoEdicao();
              }}
              className="w-full py-2.5 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all cursor-pointer">
              {produtoEmEdicao ? 'Salvar Alterações' : 'Cadastrar Serviço'}
            </button>
            {produtoEmEdicao && (
              <button
                onClick={cancelarProdutoEdicao}
                className="w-full py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50 transition-all cursor-pointer"
              >
                Cancelar edição
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modal de Confirmação para Obras */}
      <ModalConfirmacao
        aberto={!!excluirObraAlvo}
        titulo="Confirmar exclusão de obra"
        mensagem={`Deseja realmente excluir ou inativar a obra "${excluirObraAlvo?.nome}"?`}
        confirmarTexto="Excluir"
        cancelarTexto="Cancelar"
        perigo
        onConfirmar={async () => {
          if (excluirObraAlvo) {
            await inativar(`${API_URL}/os/obras/${excluirObraAlvo.id}`, 'Obra excluída.');
            setExcluirObraAlvo(null);
          }
        }}
        onCancelar={() => setExcluirObraAlvo(null)}
      />

      {/* Modal de Confirmação para Equipes */}
      <ModalConfirmacao
        aberto={!!excluirEquipeAlvo}
        titulo="Confirmar exclusão de equipe"
        mensagem={`Deseja realmente excluir a equipe "${excluirEquipeAlvo?.nome}"?`}
        confirmarTexto="Excluir"
        cancelarTexto="Cancelar"
        perigo
        onConfirmar={async () => {
          if (excluirEquipeAlvo) {
            await inativar(`${API_URL}/os/equipes/${excluirEquipeAlvo.id}`, 'Equipe excluída.');
            setExcluirEquipeAlvo(null);
          }
        }}
        onCancelar={() => setExcluirEquipeAlvo(null)}
      />

      {/* Modal de Confirmação para Serviços */}
      <ModalConfirmacao
        aberto={!!excluirProdutoAlvo}
        titulo="Confirmar exclusão de serviço"
        mensagem={`Deseja realmente excluir o serviço "${excluirProdutoAlvo?.nome}"?`}
        confirmarTexto="Excluir"
        cancelarTexto="Cancelar"
        perigo
        onConfirmar={async () => {
          if (excluirProdutoAlvo) {
            await inativar(`${API_URL}/os/produtos/${excluirProdutoAlvo.id}`, 'Serviço excluído.');
            setExcluirProdutoAlvo(null);
          }
        }}
        onCancelar={() => setExcluirProdutoAlvo(null)}
      />

      {/* Modal: Importação em lote de serviços */}
      {modalImportar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { if (!impProcessando) setModalImportar(false); }}
        >
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-sm font-extrabold text-slate-800">
                  {impResumo?.confirmado ? 'Importação concluída' : 'Importar serviços em lote'}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {impResumo?.confirmado
                    ? 'Confira o relatório abaixo. As linhas em vermelho não foram aplicadas.'
                    : 'Planilha .xlsx — um serviço por linha. Códigos iguais aos cadastrados são atualizados.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { if (!impProcessando) setModalImportar(false); }}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Contrato dos serviços *</label>
                <select
                  value={impContrato}
                  disabled={impProcessando || !!impResumo}
                  onChange={e => setImpContrato(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-primary-500 text-sm font-semibold bg-white disabled:bg-slate-100"
                >
                  {[['construcao', 'Construção'], ['manutencao', 'Manutenção'], ['linha_viva', 'Linha Viva']].map(([valor, rotulo]) => (
                    <option key={valor} value={valor}>{rotulo}</option>
                  ))}
                </select>
                <p className="text-[10px] font-semibold text-slate-400 mt-1">
                  Vale para todas as linhas do arquivo. Baixe o modelo pelo botão &quot;Modelo&quot; para conferir as colunas.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Arquivo .xlsx</label>
                <input
                  ref={inputImportRef}
                  type="file"
                  accept=".xlsx"
                  disabled={impProcessando}
                  onChange={escolherArquivoServicos}
                  className="block w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-primary-50 file:text-primary-700 file:text-[11px] file:font-bold file:cursor-pointer cursor-pointer disabled:opacity-40"
                />
              </div>

              {impProcessando && (
                <p className="text-xs font-semibold text-slate-400">Processando planilha...</p>
              )}

              {impResumo && !impProcessando && (
                <div className={`rounded-xl border p-3 space-y-2 ${impResumo.confirmado ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50'}`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${impResumo.confirmado ? 'text-slate-500' : 'text-slate-400'}`}>
                    {impResumo.confirmado ? 'Relatório final da importação' : 'Prévia (nada foi gravado ainda)'}
                  </p>
                  <div className="flex flex-wrap gap-2 text-[11px] font-bold">
                    <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100">
                      {impResumo.resumo.criados} novo(s)
                    </span>
                    <span className="px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100">
                      {impResumo.resumo.atualizados} atualizado(s)
                    </span>
                    <span className={`px-2 py-1 rounded-lg border ${impResumo.resumo.erros?.length ? 'bg-rose-50 text-rose-700 border-rose-100' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                      {impResumo.resumo.erros?.length || 0} erro(s)
                    </span>
                    {impResumo.resumo.ignoradas > 0 && (
                      <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-500 border border-slate-200">
                        {impResumo.resumo.ignoradas} linha(s) em branco
                      </span>
                    )}
                  </div>
                  {(impResumo.resumo.erros || []).length > 0 && (
                    <div className="max-h-32 overflow-y-auto rounded-lg bg-white border border-slate-100 divide-y divide-slate-50">
                      {impResumo.resumo.erros.map((erro, idx) => (
                        <p key={idx} className="px-2.5 py-1.5 text-[11px] text-rose-600">
                          Linha {erro.linha}: {erro.mensagem}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-4">
              <button
                type="button"
                onClick={() => { if (!impProcessando) setModalImportar(false); }}
                className="flex-1 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-40"
                disabled={impProcessando}
              >
                {impResumo?.confirmado ? 'Fechar' : 'Cancelar'}
              </button>
              {impResumo && !impProcessando && !impResumo.confirmado && (
                <button
                  type="button"
                  onClick={confirmarImportacaoServicos}
                  className="flex-[2] py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-all cursor-pointer"
                >
                  Confirmar importação
                </button>
              )}
              {impResumo?.confirmado && !impProcessando && (
                <button
                  type="button"
                  onClick={reiniciarImportacao}
                  className="flex-[2] py-2.5 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all cursor-pointer"
                >
                  Importar outro arquivo
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Autocomplete de clientes: sugere conforme digita (nome, CPF/CNPJ ou Nota
// PS) e chama onChange com o cliente selecionado (ou null ao limpar).
// Suporta teclado: setas ↑/↓ para navegar e Enter para confirmar.
function ClienteAutocomplete({ clientes, value, disabled = false, onChange }) {
  const [termo, setTermo] = useState('');
  const [aberto, setAberto] = useState(false);
  const [indiceAtivo, setIndiceAtivo] = useState(-1);
  const editando = useRef(false); // true enquanto o usuário digita (não sincronizar)
  const itemRefs = useRef({}); // refs dos itens p/ rolar até o destacado

  const selecionado = clientes.find(c => c.id === Number(value)) || null;

  // Ao receber um cliente selecionado externamente (modo edição/prefill),
  // exibe o nome dele. Durante a digitação, não sobrescreve o texto.
  useEffect(() => {
    if (editando.current) return;
    if (selecionado) setTermo(selecionado.nome);
    else if (!value) setTermo('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const sugestoes = useMemo(() => {
    const t = termo.trim().toLowerCase();
    if (!t) return []; // só sugere quando o usuário começa a digitar
    return clientes
      .filter(c =>
        (c.nome || '').toLowerCase().includes(t) ||
        (c.cpf_cnpj || '').toLowerCase().includes(t) ||
        (c.nota_ps || '').toLowerCase().includes(t)
      )
      .slice(0, 8);
  }, [termo, clientes]);

  // Reinicia o cursor ao mudar os resultados da busca.
  useEffect(() => { setIndiceAtivo(-1); }, [sugestoes]);

  // Mantém o item destacado visível na lista (rolagem automática).
  useEffect(() => {
    if (indiceAtivo < 0) return;
    const el = itemRefs.current[sugestoes[indiceAtivo]?.id];
    el?.scrollIntoView({ block: 'nearest' });
  }, [indiceAtivo, sugestoes]);

  const escolher = (c) => {
    editando.current = false;
    setTermo(c.nome);
    setAberto(false);
    setIndiceAtivo(-1);
    onChange(c);
  };

  const aoDigitar = (texto) => {
    editando.current = true;
    setTermo(texto);
    setAberto(true);
    // Se o texto deixou de corresponder ao cliente selecionado, limpa a seleção.
    const selecionadaAtual = clientes.find(c => c.id === Number(value));
    if (selecionadaAtual && texto.trim() !== selecionadaAtual.nome) {
      onChange(null);
    }
  };

  const aoTeclar = (e) => {
    if (disabled) return;
    const tecla = e.key || e.code;
    const baixo = tecla === 'ArrowDown' || tecla === 'Down';
    const cima = tecla === 'ArrowUp' || tecla === 'Up';

    if (baixo || cima) {
      e.preventDefault();
      if (sugestoes.length === 0) return;
      setAberto(true);
      setIndiceAtivo(prev => {
        if (baixo) return (prev + 1) % sugestoes.length;
        return prev <= 0 ? sugestoes.length - 1 : prev - 1;
      });
    } else if (tecla === 'Enter') {
      if (aberto && indiceAtivo >= 0 && sugestoes[indiceAtivo]) {
        e.preventDefault();
        escolher(sugestoes[indiceAtivo]);
      }
    } else if (tecla === 'Escape' || tecla === 'Esc') {
      setAberto(false);
      setIndiceAtivo(-1);
    }
  };

  return (
    <div className="relative">
      <label className="block text-xs font-bold text-slate-700 mb-1">Cliente *</label>
      <input
        value={termo}
        disabled={disabled}
        onChange={(e) => aoDigitar(e.target.value)}
        onKeyDown={aoTeclar}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => { setAberto(false); setIndiceAtivo(-1); }, 150)}
        placeholder="Digite o nome, CPF/CNPJ ou Nota PS..."
        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-primary-500 disabled:bg-slate-100 disabled:text-slate-500"
      />
      {aberto && !disabled && sugestoes.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
          {sugestoes.map((c, i) => (
            <li key={c.id} className="border-b border-slate-50 last:border-0">
              <button
                ref={el => { itemRefs.current[c.id] = el; }}
                type="button"
                onMouseDown={() => escolher(c)}
                onMouseEnter={() => setIndiceAtivo(i)}
                className={`w-full text-left px-3.5 py-2.5 transition-colors cursor-pointer ${
                  i === indiceAtivo
                    ? 'bg-primary-100 ring-2 ring-inset ring-primary-200'
                    : 'hover:bg-primary-50'
                }`}
              >
                <span className={`block text-sm font-bold truncate ${i === indiceAtivo ? 'text-primary-900' : 'text-slate-800'}`}>{c.nome}</span>
                <span className="block text-xs text-slate-400 truncate">
                  {c.cpf_cnpj || ''}
                  {c.nota_ps ? ` · Nota PS ${c.nota_ps}` : ''}
                  {c.cidade ? ` · ${c.cidade}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Seletor de membros da equipe (funcionários) + líder.
function MembrosEquipePicker({ membros, lider, onChange }) {
  const [funcs, setFuncs] = useState([]);

  useEffect(() => {
    apiFetch(`${API_URL}/funcionarios/?limit=10000`)
      .then(res => (res.ok ? res.json() : []))
      .then(setFuncs)
      .catch(() => setFuncs([]));
  }, []);

  const alternar = (id) => {
    const novos = membros.includes(id) ? membros.filter(m => m !== id) : [...membros, id];
    const novoLider = lider && !novos.includes(lider) ? '' : lider;
    onChange(novos, novoLider);
  };

  return (
    <div>
      <p className="text-xs font-bold text-slate-700 mb-1">Membros (★ define o líder)</p>
      <div className="max-h-32 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-50">
        {funcs.map(f => (
          <div key={f.id} className="flex items-center justify-between px-2.5 py-1.5">
            <button type="button" onClick={() => alternar(String(f.id))}
              className="flex items-center gap-2 text-xs text-left cursor-pointer">
              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                membros.includes(String(f.id)) ? 'bg-primary-600 border-primary-600 text-white' : 'border-slate-300'
              }`}>
                {membros.includes(String(f.id)) && <Check size={10} />}
              </span>
              <span className="text-slate-600">{f.nome}</span>
            </button>
            {membros.includes(String(f.id)) && (
              <button type="button"
                onClick={() => onChange(membros, lider === String(f.id) ? '' : String(f.id))}
                className={`text-sm cursor-pointer ${lider === String(f.id) ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}
                title="Definir como líder">★</button>
            )}
          </div>
        ))}
        {!funcs.length && <p className="text-xs text-slate-400 px-2.5 py-2">Nenhum funcionário cadastrado.</p>}
      </div>
    </div>
  );
}

export default OrdensServico;
