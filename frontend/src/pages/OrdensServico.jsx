import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  Plus, Search, X, Play, Camera, Package, ClipboardList, MapPin,
  AlertTriangle, Check, Clock, CalendarClock, FileDown, LayoutGrid,
  FolderKanban, HardHat, Boxes, Trash2, Image as ImageIcon,
  Pencil, Building, Printer, ListChecks, RefreshCw, WifiOff, ChevronDown, Archive,
  Upload, FileSpreadsheet, Download, BarChart3, Trophy, ChevronLeft, ChevronRight, Send,
} from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';
import ModalConfirmacao from '../components/ModalConfirmacao';
import ModalPendenciasSync from '../components/ModalPendenciasSync';
import PainelObra from '../components/PainelObra';
import { comprimirImagem } from '../utils/imagem';
import { rotuloFator, unidadeContrato } from '../utils/contratos';
import {
  isModoCampo, setModoCampo, isOffline, usarLocal,
  prepararPacoteCampo, atualizarPacoteCampo, limparPacote, salvarDonoPacote, infoPacote,
  getOSLocal, getChecklistLocal, getListaLocal, getProdutosLocal, salvarDetalheLocal, salvarChecklistLocal,
  atualizarStatusLocal, atualizarRespostaLocal, recalcularResumo,
  enfileirarOperacao, enfileirarFoto, contarPendentes, descartarPendente,
  registrarFotoItemLocal, hidratarFotosPendentes, hidratarFotosCache, getFotosCacheLocal,
  cachearFotosChecklist, salvarUltimoSync,
  lancamentosPendentesDaFila,
  salvarResponsavelLocal,
  registrarFalhaDeRede, testarConexao, estaEmWifi, armazenamentoOfflineDisponivel,
} from '../offline/offline';
import { sincronizar } from '../offline/sync';

// ---------------------------------------------------------------------------
// Constantes de domínio (espelham o backend)
// ---------------------------------------------------------------------------

const COLUNAS = [
  { id: 'rascunho', label: 'Rascunho' },
  { id: 'aberta', label: 'Aberta' },
  { id: 'em_andamento', label: 'Em Andamento' },
  { id: 'concluida', label: 'Concluída' },
  { id: 'cancelada', label: 'Cancelada' },
];

// Etapas do "funil ativo" do quadro (exclui o arquivo de encerradas).
const STATUS_PIPELINE = ['rascunho', 'aberta', 'em_andamento'];

// Rótulos de status. 'impedida' é legado (status descontinuado): mantido
// apenas para exibir a linha do tempo de O.S antigas.
const LABEL_STATUS = { ...Object.fromEntries(COLUNAS.map(c => [c.id, c.label])), impedida: 'Impedida' };

// Contratos/tipos de O.S — fonte única dos literais espalhados pela página.
const TIPOS_SERVICO_OPCOES = [
  { valor: 'construcao', rotulo: 'Construção' },
  { valor: 'manutencao', rotulo: 'Manutenção' },
  { valor: 'linha_viva', rotulo: 'Linha Viva' },
];
const ROTULOS_TIPO_SERVICO = Object.fromEntries(TIPOS_SERVICO_OPCOES.map(o => [o.valor, o.rotulo]));
const TIPO_PADRAO_OS = 'construcao';

// Aplica os mesmos filtros/busca do servidor sobre uma lista local (offline):
// termo busca em código/escopo/obra/equipe + obra/equipe/prioridade/status.
function filtrarListaLocal(lista, { busca, obra_id, equipe_id, prioridade, status }) {
  const termo = String(busca || '').trim().toLowerCase();
  return lista.filter(os => {
    if (obra_id && Number(os.obra_id) !== Number(obra_id)) return false;
    if (equipe_id && Number(os.equipe_id) !== Number(equipe_id)) return false;
    if (prioridade && os.prioridade !== prioridade) return false;
    if (status && os.status !== status) return false;
    if (termo) {
      const alvo = [os.codigo, os.descricao_escopo, os.obras?.nome, os.equipes?.nome]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });
}

// Espelha a máquina de estados do backend — usada como FALLBACK enquanto o
// endpoint /os/transicoes (fonte única) não é carregado.
const TRANSICOES_STATUS = {
  rascunho:    new Set(['aberta', 'cancelada']),
  aberta:      new Set(['em_andamento', 'cancelada']),
  em_andamento: new Set(['concluida', 'cancelada']),
  concluida:   new Set(['aberta']),
  cancelada:   new Set(['aberta']),
};

const LIMITE_PAGINA = 100;
// Modo Campo contínuo: throttle entre refreshes automáticos e intervalo do
// refresh periódico (novas O.S + atualizações + poda das encerradas).
// 30 min: uma O.S nova ainda chega ao tocar no app (focus/online) ou pelo
// botão "Atualizar O.S"; o intervalo longo evita baixar a lista a cada 4 min.
const REFRESH_MIN_MS = 60 * 1000;
const REFRESH_INTERVALO_MS = 30 * 60 * 1000;

// ---- Aba Desempenho (gestor): helpers de mês ----
const NOMES_MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

// Mês atual no fuso LOCAL do navegador (YYYY-MM) — o ISO/UTC viraria o mês
// horas antes da meia-noite no Brasil.
function mesAtualLocal() {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

function somarMes(mes, delta) {
  const [ano, numero] = mes.split('-').map(Number);
  const data = new Date(ano, numero - 1 + delta, 1);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
}

function rotuloMes(mes) {
  if (!mes) return '';
  const [ano, numero] = mes.split('-');
  const nome = NOMES_MESES[Number(numero) - 1] || '';
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} ${ano}`;
}

// Contratos INDEPENDENTES: cada contrato tem o SEU catálogo. Um serviço só
// pertence ao catálogo do próprio tipo; legados (sem tipo) valem para todos.
const servicoServeParaTipo = (servico, tipo) =>
  !servico.tipo || servico.tipo === tipo;

const PRIORIDADES = {
  baixa: { label: 'Baixa', cor: 'bg-slate-100 text-slate-600 border-slate-200' },
  media: { label: 'Média', cor: 'bg-blue-50 text-blue-700 border-blue-200' },
  alta: { label: 'Alta', cor: 'bg-amber-50 text-amber-700 border-amber-300' },
  critica: { label: 'Crítica', cor: 'bg-rose-50 text-rose-700 border-rose-300' },
};

// Identificação das abas do PainelExecucao: o ícone usa a cor da seção em
// TODAS as abas (só o traço, sem fundo); a aba ativa herda a cor no texto e
// ganha o filete inferior. Fallback neutro para chaves futuras.
const CORES_ABA = {
  checklist: { icone: 'text-primary-600', ativo: 'text-primary-700', filete: 'bg-primary-500' },
  insumos: { icone: 'text-violet-600', ativo: 'text-violet-700', filete: 'bg-violet-500' },
  evidencias: { icone: 'text-emerald-600', ativo: 'text-emerald-700', filete: 'bg-emerald-500' },
  timeline: { icone: 'text-slate-500', ativo: 'text-slate-700', filete: 'bg-slate-400' },
};
const COR_ABA_PADRAO = CORES_ABA.timeline;

// Data de execução em DD/MM (fatiada do ISO, sem new Date() para não
// deslocar o dia pelo fuso do navegador).
function diaMes(iso) {
  const [ano, mes, dia] = String(iso || '').slice(0, 10).split('-');
  return ano && mes && dia ? `${dia}/${mes}` : '';
}

// Semáforo de execução: vermelho = atrasada, âmbar = executa em <= 3 dias;
// acima disso o badge fica neutro. A data de execução aparece SEMPRE junto do
// contador (facilita a identificação visual no Modo Campo).
// A contagem é por DIA DE CALENDÁRIO: cruza os componentes da data LOCAL com a
// meia-noite UTC dos mesmos componentes (imune a fuso e horário de verão).
// Assim o prazo de hoje é 0 mesmo às 10h — antes, a diferença contra 23:59:59
// dava fração < 1 e o `Math.ceil` exibia "Executa em 1d" no dia do prazo.
export function situacaoExecucao(os) {
  if (!os.prazo_entrega || ['concluida', 'cancelada'].includes(os.status)) return null;
  const [ano, mes, dia] = String(os.prazo_entrega).slice(0, 10).split('-').map(Number);
  if (!ano || !mes || !dia) return null;
  const agora = new Date();
  const dias = Math.round(
    (Date.UTC(ano, mes - 1, dia) - Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate())) / 86400000
  );
  const data = diaMes(os.prazo_entrega);
  if (dias < 0) return { label: `Execução atrasada (${Math.abs(dias)}d)`, data, classe: 'bg-rose-100 text-rose-700 border-rose-200', urgente: true };
  if (dias === 0) return { label: 'Executa hoje', data, classe: 'bg-amber-100 text-amber-800 border-amber-200', urgente: false };
  if (dias <= 3) return { label: `Executa em ${dias}d`, data, classe: 'bg-amber-100 text-amber-800 border-amber-200', urgente: false };
  return { label: `Executa em ${dias}d`, data, classe: 'bg-slate-50 text-slate-600 border-slate-200', urgente: false };
}

const fmtData = (iso) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
};

// Evento de cancelamento mais recente do histórico (com justificativa) — usado
// no destaque do PainelExecucao e na aba Evidências para dar contexto.
// 'impedida' é legado (status descontinuado): mantido só para O.S antigas.
const cancelamentoAtual = (historico) => {
  if (!Array.isArray(historico)) return null;
  const evento = [...historico]
    .reverse()
    .find(h => ['cancelada', 'impedida'].includes(h.status_novo) && (h.justificativa || h.criado_em));
  return evento || null;
};

// Captura a geolocalização do dispositivo (sem bloqueio por raio).
// Com cache curto (60s) e timeout reduzido: no campo, agir (responder, foto)
// não pode ficar esperando o GPS — usa a última posição válida se necessário.
const _cacheGps = { valor: null, em: 0 };
const GPS_CACHE_MS = 60 * 1000;
const GPS_TIMEOUT_MS = 2500;
const capturarGeolocalizacao = () => new Promise((resolve) => {
  const agora = Date.now();
  if (_cacheGps.valor && agora - _cacheGps.em < GPS_CACHE_MS) {
    return resolve(_cacheGps.valor);
  }
  if (!navigator.geolocation) return resolve(_cacheGps.valor);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const valor = `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
      _cacheGps.valor = valor;
      _cacheGps.em = Date.now();
      resolve(valor);
    },
    () => resolve(_cacheGps.valor),
    { timeout: GPS_TIMEOUT_MS, maximumAge: GPS_CACHE_MS },
  );
});

// ---------------------------------------------------------------------------
// Seletor de fotos (câmera / galeria)
// ---------------------------------------------------------------------------
// Abre o seletor de imagens criando um <input type="file"> NOVO a cada chamada
// e o remove ao final (evita o bug do Android em que o mesmo input "para" de
// abrir a câmera após usos).
//   - capture: true  -> capture="environment": abre a CÂMERA direto;
//   - capture: false -> abre a galeria/arquivos.
// Resolve com File[] (vazio se o usuário cancelar).
function abrirSeletorFoto({ capture = false, multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'environment');
    if (multiple) input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    let concluido = false;
    const finalizar = () => {
      // Ao voltar da câmera o foco pode retornar ANTES do "change": aguarda um
      // instante e relê os arquivos (cancelamento não dispara "change").
      setTimeout(() => {
        if (concluido) return;
        concluido = true;
        const arquivos = input.files ? Array.from(input.files) : [];
        window.removeEventListener('focus', finalizar);
        if (input.parentNode) input.parentNode.removeChild(input);
        resolve(arquivos);
      }, 1200);
    };
    input.addEventListener('change', finalizar, { once: true });
    window.addEventListener('focus', finalizar);
    input.click();
  });
}

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
    <div className={`fixed z-[70] pointer-events-none rounded-xl shadow-xl border text-sm p-4 flex items-start gap-3 max-w-[calc(100vw-2rem)] sm:max-w-sm animate-in slide-in-from-bottom-4 sm:slide-in-from-top-4 duration-300 ${cor} bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:top-4 sm:bottom-auto`}>
      <div className={`p-1 rounded-full shrink-0 ${icone}`}>
        {toast.type === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold whitespace-pre-line break-words">{toast.message}</p>
        {toast.acao && (
          <button
            onClick={toast.acao.onClick}
            className="mt-1.5 text-xs font-extrabold underline underline-offset-2 hover:opacity-80 cursor-pointer pointer-events-auto"
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
      <span>{apl} {unidadeContrato(os.tipo)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card da O.S (usado no Kanban e na lista mobile)
// ---------------------------------------------------------------------------

function CardOS({ os, onClick, draggableProps = {}, ehGestor = true }) {
  const execucao = situacaoExecucao(os);
  const cliente = os.obras?.clientes?.nome || os.obras?.cliente_celesc || '';
  const classeCard = `bg-white rounded-xl border shadow-sm hover:shadow-md transition-all p-3 cursor-pointer ${
    execucao?.urgente ? 'border-l-4 border-l-rose-500 border-y-slate-300 border-r-slate-300' : 'border-slate-300'
  }`;
  const badgeRetroativa = os.retroativa ? (
    <span
      className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[10px] font-bold text-amber-700"
      title="O.S retroativa (execução registrada em papel)"
    >
      Retroativa
    </span>
  ) : null;
  const chipExecucao = execucao ? (
    <span className={`px-2.5 py-1 rounded-lg border flex items-center gap-1.5 ${execucao.classe}`}>
      <CalendarClock size={14} className="shrink-0" />
      <span className="flex flex-col leading-tight">
        <span className="text-[10px] font-bold opacity-80">{execucao.label}</span>
        {execucao.data && <span className="text-sm font-black">{execucao.data}</span>}
      </span>
    </span>
  ) : null;
  const chipEquipe = os.equipes ? (
    <span
      className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-1.5 max-w-full"
      title={os.equipes.nome}
    >
      <HardHat size={14} className="shrink-0 text-slate-400" />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="text-[10px] font-bold text-slate-400">Equipe</span>
        <span className="text-sm font-black text-slate-600 truncate">{os.equipes.nome}</span>
      </span>
    </span>
  ) : null;
  const chipFotos = os.fotos_count > 0 ? (
    <span className="px-2 py-0.5 rounded-full bg-primary-50 border border-primary-200 text-[10px] font-bold text-primary-700 flex items-center gap-1" title={`${os.fotos_count} foto(s) anexada(s)`}>
      <Camera size={11} />{os.fotos_count}
    </span>
  ) : null;

  // Usuário de campo: card enxuto — a equipe é implícita (a O.S já chega
  // atribuída) e a data de execução fica logo abaixo da prioridade. O gestor
  // mantém o layout completo (data + equipe + fotos na linha inferior).
  if (!ehGestor) {
    return (
      <div {...draggableProps} onClick={onClick} className={classeCard}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="font-mono text-xs font-bold text-primary-700">{os.codigo}</span>
            <p className="text-sm font-bold text-slate-800 mt-1 truncate">{os.obras?.nome || 'Obra'}</p>
            <p className="text-xs text-slate-400 truncate">{cliente}</p>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1.5">
            <div className="flex items-center justify-end gap-1.5 flex-wrap">
              {badgeRetroativa}
              <BadgePrioridade prioridade={os.prioridade} />
            </div>
            {chipExecucao}
          </div>
        </div>

        {chipFotos && (
          <div className="flex items-center gap-1.5 mt-2">{chipFotos}</div>
        )}

        <BarraMateriais os={os} />
      </div>
    );
  }

  return (
    <div {...draggableProps} onClick={onClick} className={classeCard}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-bold text-primary-700">{os.codigo}</span>
        <div className="flex items-center gap-1.5">
          {badgeRetroativa}
          <BadgePrioridade prioridade={os.prioridade} />
        </div>
      </div>
      <p className="text-sm font-bold text-slate-800 mt-1 truncate">{os.obras?.nome || 'Obra'}</p>
      <p className="text-xs text-slate-400">{cliente}</p>

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {chipExecucao}
        {chipEquipe}
        {chipFotos}
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
  const inicializouGrupo = useRef(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const modoCampo = isModoCampo();

      // 1) Modo Campo: a cópia do dispositivo é SEMPRE a fonte primária de
      //    exibição (bolha local — as ações ficam na fila até o sync manual,
      //    mesmo conectado). Evita o 422 do servidor quando a resposta é dada
      //    antes da foto e mantém a UX do offline.
      let localAchado = false;
      if (modoCampo) {
        let local = await getChecklistLocal(osDetalhe.id);
        if (local) {
          localAchado = true;
          // Reconstrói os previews de fotos ainda não sincronizadas.
          local = await hidratarFotosPendentes(local);
          // Aplica as fotos do servidor já em cache (visualização offline).
          local = await hidratarFotosCache(local);
          // Sana o resumo salvo se estiver defasado dos itens (respostas
          // locais vs. refresh do pacote): mantém gates/contagens coerentes.
          const itens = local.itens || [];
          const resumoCorrigido = recalcularResumo(itens, local.resumo);
          if (JSON.stringify(resumoCorrigido) !== JSON.stringify(local.resumo)) {
            try {
              await salvarChecklistLocal(osDetalhe.id, { itens, resumo: resumoCorrigido });
              const detalheLocal = await getOSLocal(osDetalhe.id);
              if (detalheLocal) {
                detalheLocal.checklist = resumoCorrigido;
                await salvarDetalheLocal(detalheLocal);
              }
            } catch { /* best-effort: a tela usa o resumo recalculado */ }
          }
          setDados({ itens, resumo: resumoCorrigido });
        } else if (!isOffline()) {
          // Sem cópia local (O.S com conexão): o GET remoto serve de "seed"
          // inicial do pacote; a partir daí as ações passam a ser locais.
          try {
            const res = await apiFetch(`${API_URL}/os/${osDetalhe.id}/checklist`);
            if (res.ok) {
              const dados = await res.json();
              setDados(dados);
              await salvarChecklistLocal(osDetalhe.id, dados);
              // Cache das fotos do servidor (best-effort) para uso offline.
              cachearFotosChecklist(osDetalhe.id, dados.itens || []).catch(() => {});
              localAchado = true;
            } else {
              mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao carregar checklist.'), 'error');
            }
          } catch {
            registrarFalhaDeRede();
          }
        }
        if (!localAchado) {
          mostrarToast('Checklist indisponível offline (baixe o pacote de campo).', 'error');
        }
        return;
      }

      // 2) Fora do Modo Campo: o servidor é a fonte. Offline sem pacote, o
      //    usuário deve ver erros de conexão, não dados vazios.
      if (!usarLocal()) {
        const res = await apiFetch(`${API_URL}/os/${osDetalhe.id}/checklist`);
        if (res.ok) {
          const dados = await res.json();
          setDados(dados);
        } else {
          mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao carregar checklist.'), 'error');
        }
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
      // Nomes dos grupos preservados POR NÚMERO (não por posição/índice).
      const resumo = recalcularResumo(itens, prev.resumo);
      return { itens, resumo };
    });
  };

  // Reflete no estado da tela a foto pendente recém-tirada (preview offline).
  const refletirFotoLocal = (itemId, entrada) => {
    setDados(prev => {
      if (!prev) return prev;
      const itens = prev.itens.map(i => (i.id === itemId
        ? { ...i, fotos: [...(i.fotos || []).filter(f => !f.pendente), entrada] }
        : i));
      return { itens, resumo: prev.resumo };
    });
  };

  const responder = async (item, resposta, tentativa = 0) => {
    if (!podeEditar) return;
    // Itens com `exige_foto` aceitam a resposta sim/não SEM foto — a foto pode
    // ser anexada depois (botão Foto). Enquanto faltar, o grupo/checklist não
    // é marcado como completo (ver resumo exibido abaixo) e a conclusão da
    // O.S continua barrada pelo backend.
    setSalvandoItem(item.id);
    const gps = await capturarGeolocalizacao();

    // Modo Campo (online ou offline): grava na fila e reflete localmente;
    // conectado, o sync automático envia em segundo plano (debounce).
    if (isModoCampo() || usarLocal()) {
      try {
        await enfileirarOperacao({
          tipo: 'checklist_resposta',
          os_id: osDetalhe.id,
          payload: { item_id: item.id, resposta, geolocalizacao: gps },
        });
        await refletirRespostaLocal(item, resposta, gps);
        onAtualizado();
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

    // Modo Campo (online ou offline): guarda a foto no dispositivo, enfileira
    // o envio e mostra o PREVIEW imediato abaixo da pergunta.
    if (isModoCampo() || usarLocal()) {
      try {
        const { entrada } = await registrarFotoItemLocal({
          os_id: osDetalhe.id,
          item_id: item.id,
          arquivo,
          geolocalizacao: gps,
        });
        refletirFotoLocal(item.id, entrada);
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
        // Upload de foto em rede de campo é lento: 90s em vez do padrão de 30s.
        signal: AbortSignal.timeout(90000),
      });
      if (res.ok) {
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

  // O resumo salvo pode ficar defasado em relação aos itens (refresh do
  // pacote vs. respostas locais): cor/contagem SEMPRE derivam dos itens
  // exibidos — o verde só aparece com todos os itens visíveis respondidos.
  const resumo = recalcularResumo(dados.itens, dados.resumo);
  const itensPorGrupo = {};
  for (const item of dados.itens) {
    (itensPorGrupo[item.grupo] = itensPorGrupo[item.grupo] || []).push(item);
  }

  // Pendência de EVIDÊNCIA: itens `exige_foto` respondidos sim/não sem foto.
  // Não trava o preenchimento — apenas mantém grupo/checklist como incompleto
  // (a foto anexada depois, mesmo offline, resolve a pendência).
  const fotoPendenteDe = (item) =>
    item.exige_foto &&
    ['sim', 'nao'].includes(item.resposta?.resposta) &&
    !(item.fotos || []).length;
  const itensComFotoPendente = dados.itens.filter(fotoPendenteDe);
  const idsFotoPendente = new Set(itensComFotoPendente.map(i => i.id));
  const fotosPendentesPorGrupo = {};
  for (const p of itensComFotoPendente) {
    fotosPendentesPorGrupo[p.grupo] = (fotosPendentesPorGrupo[p.grupo] || 0) + 1;
  }
  const totalRespondidas = resumo.respondidos;
  const todasRespondidas = resumo.total > 0 && totalRespondidas === resumo.total;
  const completoEfetivo = todasRespondidas && itensComFotoPendente.length === 0;

  const marcar = (marcado) => (marcado
    ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50');

  return (
    <div className="space-y-4">
      {/* Resumo geral */}
      <div className={`rounded-xl border px-3 py-2.5 text-xs flex items-center justify-between gap-2 ${
        resumo.inicio_liberado && completoEfetivo ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
          : resumo.inicio_liberado ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-rose-50 border-rose-200 text-rose-700'
      }`}>
        <span className="font-bold flex items-center gap-1.5">
          <ListChecks size={14} />
          {totalRespondidas}/{resumo.total} respondidos
          {!resumo.inicio_liberado && ' · checklist de início pendente'}
          {resumo.inicio_liberado && !todasRespondidas && ' · em andamento'}
          {resumo.inicio_liberado && todasRespondidas && !completoEfetivo &&
            ` · ${itensComFotoPendente.length} foto(s) pendente(s)`}
          {completoEfetivo && ' · completo'}
        </span>
        <span className="text-[10px] font-semibold">{completoEfetivo ? '✓' : ''}</span>
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
          const fotosPendentes = fotosPendentesPorGrupo[grupo.grupo] || 0;
          const faltandoResposta = grupo.respondidos < grupo.total;
          const aguardandoFoto = !faltandoResposta && fotosPendentes > 0;
          const completo = grupo.completo && !fotosPendentes;
          const itens = itensPorGrupo[grupo.grupo] || [];
          return (
            <div key={grupo.grupo}>
              <button
                type="button"
                onClick={() => setGrupoAberto(aberto ? null : grupo.grupo)}
                aria-expanded={aberto}
                title={`Grupo ${grupo.grupo} · ${grupo.nome}`}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer transition-colors max-[639px]:px-4 max-[639px]:py-4 ${
                  aberto ? 'bg-primary-50'
                    : faltandoResposta ? 'bg-rose-50/60 hover:bg-rose-50'
                    : 'bg-white hover:bg-slate-50'
                }`}
              >
                <span className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-xs font-black transition-colors max-[639px]:w-11 max-[639px]:h-11 max-[639px]:text-base ${
                  completo ? 'bg-emerald-100 text-emerald-700'
                    : faltandoResposta ? 'bg-rose-100 text-rose-700'
                    : aguardandoFoto ? 'bg-amber-100 text-amber-700'
                    : aberto ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                  {completo ? <Check size={16} className="max-[639px]:w-5 max-[639px]:h-5" /> : aguardandoFoto ? <Camera size={15} className="max-[639px]:w-5 max-[639px]:h-5" /> : grupo.grupo}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      <span className="text-sm font-extrabold text-slate-700 max-[639px]:text-[17px]">Grupo {grupo.grupo}</span>
                      <span className="text-xs font-semibold text-slate-400 max-[639px]:text-sm"> · {grupo.nome}</span>
                    </span>
                    <span className={`shrink-0 text-[10px] font-bold rounded-full px-2 py-0.5 ${
                      completo ? 'bg-emerald-100 text-emerald-700'
                        : faltandoResposta ? 'bg-rose-100 text-rose-700'
                        : aguardandoFoto ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {grupo.respondidos}/{grupo.total}
                      {faltandoResposta ? ` · faltam ${grupo.total - grupo.respondidos}` : ''}
                      {fotosPendentes ? ` · ${fotosPendentes} foto(s)` : ''}
                    </span>
                  </span>
                  <span className="block h-1 mt-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <span className={`block h-full ${
                      faltandoResposta ? 'bg-rose-500' : aguardandoFoto ? 'bg-amber-500' : 'bg-primary-500'
                    } transition-all`}
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
                            {idsFotoPendente.has(item.id) && (
                              <p className="text-[9px] font-bold text-rose-600 mt-0.5">
                                Evidência fotográfica pendente — anexe a foto para concluir o checklist.
                              </p>
                            )}
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              {podeEditar ? (
                                <>
                                  {[['sim', 'Sim'], ['nao', 'Não'], ['na', 'N/A']].map(([valor, rotulo]) => (
                                    <button key={valor}
                                      disabled={salvandoItem === item.id}
                                      onClick={() => responder(item, valor)}
                                      className={`px-3 py-1 rounded-lg border text-[11px] font-bold transition-all cursor-pointer disabled:opacity-40 max-[639px]:text-[15px] max-[639px]:px-4 max-[639px]:py-2.5 max-[639px]:min-w-[3.5rem] ${marcar(resposta === valor)}`}>
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
                                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-primary-200 bg-primary-50 text-primary-700 text-[10px] font-bold hover:bg-primary-100 transition-all cursor-pointer disabled:opacity-40 max-[639px]:text-[13px] max-[639px]:px-3.5 max-[639px]:py-2"
                                >
                                  <Camera size={11} className="max-[639px]:w-4 max-[639px]:h-4" />
                                  {enviandoFoto === item.id ? 'Enviando...' : temFoto ? 'Trocar foto' : 'Foto'}
                                </button>
                              )}
                            </div>
                            {resposta === 'nao' && justificativa && (
                              <p className="text-[10px] text-rose-600 font-semibold mt-1">Justificativa: {justificativa}</p>
                            )}
                            {temFoto && (
                              <div className="flex flex-wrap gap-2 mt-1.5">
                                {item.fotos.map(f => {
                                  const img = (
                                    <img src={f.url_temporaria} alt={f.nome_original || 'foto'}
                                      className="w-16 h-16 rounded-lg object-cover border border-slate-200" loading="lazy" />
                                  );
                                  return (
                                    <div key={f.id} className="relative w-16 h-16">
                                      {f.url_temporaria ? (
                                        <a href={f.url_temporaria} target="_blank" rel="noopener noreferrer" title="Abrir foto">
                                          {img}
                                        </a>
                                      ) : img}
                                      {f.pendente && (
                                        <span className="absolute -bottom-1 right-0 text-[8px] font-bold px-1 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                          sincronizando…
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
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

      {fotoAlvo && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center animate-in fade-in zoom-in duration-200">
            <div className="w-12 h-12 mx-auto rounded-full bg-primary-50 border border-primary-100 flex items-center justify-center mb-3">
              <Camera size={22} className="text-primary-600" />
            </div>
            <h4 className="text-sm font-extrabold text-slate-800 mb-1">Evidência fotográfica</h4>
            <p className="text-xs text-slate-500 mb-5">{fotoAlvo.classificacao} {fotoAlvo.pergunta}</p>
            <div className="space-y-2">
              <button
                type="button"
                disabled={enviandoFoto === fotoAlvo.id}
                onClick={async () => {
                  const files = await abrirSeletorFoto({ capture: true });
                  if (files.length) enviarFoto(files);
                }}
                className="w-full py-3 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 cursor-pointer disabled:opacity-40"
              >
                {enviandoFoto === fotoAlvo.id ? 'Enviando...' : 'Tirar foto'}
              </button>
              <button
                type="button"
                disabled={enviandoFoto === fotoAlvo.id}
                onClick={async () => {
                  const files = await abrirSeletorFoto({ multiple: true });
                  if (files.length) enviarFoto(files);
                }}
                className="w-full py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 cursor-pointer disabled:opacity-40"
              >
                Escolher da galeria
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
  const [produtoSelecionadoId, setProdutoSelecionadoId] = useState(null);
  const [qtd, setQtd] = useState(1);
  const [tipoUsc, setTipoUsc] = useState('normal');
  const [salvando, setSalvando] = useState(false);
  const [estornandoId, setEstornandoId] = useState(null); // ID do lançamento aguardando confirmação
  // Unidade de valor do contrato da O.S (USC construção / UMD manutenção / ULV linha viva).
  const unidade = unidadeContrato(osDetalhe.tipo);
  const rotuloUsc = (sub) => rotuloFator(osDetalhe.tipo, sub);

  // Modo Campo (online ou offline): lançamentos gravam primeiro na fila local.
  // Estes registros pendentes são sobrepostos à visão do servidor para que o
  // usuário veja e possa estornar imediatamente o que ainda não sincronizou.
  const [pendentesLocais, setPendentesLocais] = useState([]);

  const carregarPendentesLocais = useCallback(async () => {
    if (!isModoCampo()) { setPendentesLocais([]); return; }
    const ops = await lancamentosPendentesDaFila(osDetalhe.id);
    const idsFila = new Set(ops.map(o => String(o.id_local)));
    const local = await getOSLocal(osDetalhe.id);
    const linhas = ((local?.ultimos_lancamentos) || [])
      .filter(l => l.pendente_local && idsFila.has(String(l.id_local)));
    setPendentesLocais(linhas);
  }, [osDetalhe.id]);

  useEffect(() => { carregarPendentesLocais(); }, [carregarPendentesLocais]);

  // Enquanto houver pendências visíveis, verifica a fila de tempos em tempos:
  // ao sincronizar, as linhas somem da lista sozinhas.
  useEffect(() => {
    if (!isModoCampo() || pendentesLocais.length === 0) return undefined;
    const t = setInterval(carregarPendentesLocais, 4000);
    return () => clearInterval(t);
  }, [pendentesLocais.length, carregarPendentesLocais]);

  const porProdutoDelta = useMemo(() => {
    const mapa = new Map();
    for (const l of pendentesLocais) {
      const produtoId = Number(l.produto_id);
      mapa.set(produtoId, (mapa.get(produtoId) || 0) + Number(l.quantidade_usada || 0));
    }
    return mapa;
  }, [pendentesLocais]);

  // Agregado "Serviços aplicados": itens do servidor + pendências locais
  // (cria linha virtual quando o serviço ainda não chegou ao servidor).
  const itensVisao = useMemo(() => {
    const base = (osDetalhe.materiais?.itens || []).map(it => {
      const delta = porProdutoDelta.get(Number(it.produto_id)) || 0;
      return delta ? { ...it, aplicado: Number((Number(it.aplicado || 0) + delta).toFixed(3)) } : it;
    });
    for (const l of pendentesLocais) {
      if (base.some(it => Number(it.produto_id) === Number(l.produto_id))) continue;
      base.push({
        produto_id: l.produto_id,
        nome: l.produtos?.nome || 'Serviço',
        unidade: l.produtos?.unidade || unidade,
        aplicado: Number(l.quantidade_usada || 0),
      });
    }
    return base;
  }, [osDetalhe.materiais, pendentesLocais, porProdutoDelta, unidade]);

  // Últimos lançamentos: servidor + linhas pendentes da fila local.
  const lancamentosVisao = useMemo(() => {
    const base = osDetalhe.lancamentos || [];
    if (!pendentesLocais.length) return base;
    const idsBase = new Set(
      base.map(b => (b.id_local != null ? String(b.id_local) : null)).filter(Boolean),
    );
    const extras = pendentesLocais.filter(l => !idsBase.has(String(l.id_local)));
    return [...extras, ...base];
  }, [osDetalhe.lancamentos, pendentesLocais]);

  // Catálogo do CONTRATO da O.S: só serviços compatíveis com o tipo (ou
  // legados). Manutenção e Linha Viva compartilham o mesmo catálogo.
  const catalogoDoContrato = useMemo(() => {
    const tipoOs = osDetalhe.tipo;
    return produtos.filter(p => servicoServeParaTipo(p, tipoOs));
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
    () => catalogoDoContrato.find(p => p.id === produtoSelecionadoId) || null,
    [produtoSelecionadoId, catalogoDoContrato],
  );

  // Ao selecionar uma sugestão, exibe o nome do serviço na barra.
  const textoBusca = selecionado ? selecionado.nome : buscaProduto;

  // Código vigente conforme o tipo escolhido: bipagem/digitação do código
  // ESPECIAL seleciona o serviço já com o fator especial (mesma descrição,
  // dois códigos distintos).
  const codigoAtivo = tipoUsc === 'especial'
    ? selecionado?.codigo_especial || selecionado?.codigo
    : selecionado?.codigo || selecionado?.codigo_especial;

  const tipoDaSelecao = (p) => {
    const termo = String(buscaProduto || '').trim().toLowerCase();
    if (p.codigo_especial && termo === String(p.codigo_especial).trim().toLowerCase()) return 'especial';
    return 'normal';
  };

  // Digitar/bipar apenas preenche a busca: a lista aparece abaixo e a seleção
  // acontece só ao tocar na sugestão (nada é puxado para a barra sozinho).
  const aoDigitarBusca = (texto) => {
    setBuscaProduto(texto);
    setProdutoSelecionadoId(null);
  };

  const selecionarProduto = (p) => {
    setTipoUsc(tipoDaSelecao(p));
    setProdutoSelecionadoId(p.id);
    setBuscaProduto(p.nome);
  };

  // Fatores de conversão do cadastro do produto (normal / especial).
  const uscNormal = Number(selecionado?.preco_unitario || 0);
  const uscEspecial = Number(selecionado?.qtd_usc_especial || 0);
  const temUsc = uscNormal > 0 || uscEspecial > 0;
  const fatorUsc = tipoUsc === 'especial' ? uscEspecial : uscNormal;
  const totalUsc = temUsc && fatorUsc > 0 ? Number((qtd * fatorUsc).toFixed(3)) : qtd;

  // Espelha o lançamento no pacote local (offline e — no Modo Campo — também
  // após o lançamento online, para o estado local não ficar velho ao cair a
  // rede; A5). `idLocal` liga o registro ao item da FILA quando o lançamento
  // ainda não foi sincronizado (permite estornar direto no dispositivo).
  const refletirMaterialLocal = async (produto, totalAplicado, idLocal = null) => {
    const local = await getOSLocal(osDetalhe.id);
    if (!local) return;
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
    item.aplicado = Number((item.aplicado + totalAplicado).toFixed(3));
    if (tipoUsc === 'especial') item.aplicado_especial = Number((item.aplicado_especial + totalAplicado).toFixed(3));
    else item.aplicado_normal = Number((item.aplicado_normal + totalAplicado).toFixed(3));
    materiais.total_aplicado = Number(((materiais.total_aplicado || 0) + totalAplicado).toFixed(3));
    local.materiais = materiais;
    const linha = {
      id: Date.now(),
      produto_id: produto.id,
      quantidade_usada: totalAplicado,
      quantidade_pecas: qtd,
      fator_usc: temUsc && fatorUsc > 0 ? fatorUsc : 0,
      tipo_usc: tipoUsc,
      codigo_servico: tipoUsc === 'especial'
        ? produto.codigo_especial || produto.codigo || null
        : produto.codigo || produto.codigo_especial || null,
      data_lancamento: new Date().toISOString(),
      produtos: { nome: produto.nome, unidade: produto.unidade || '-' },
    };
    if (idLocal) {
      linha.id_local = idLocal;
      linha.pendente_local = true; // aguardando sincronização (estorno local)
    }
    local.ultimos_lancamentos = [linha, ...(local.ultimos_lancamentos || [])].slice(0, 10);
    await salvarDetalheLocal(local);
  };

  const limparFormulario = () => {
    setBuscaProduto('');
    setProdutoSelecionadoId(null);
    setQtd(1);
    setTipoUsc('normal');
  };

  const lancar = async () => {
    const produto = selecionado || (sugestoes.length === 1 ? sugestoes[0] : null);
    if (!produto) {
      mostrarToast('Selecione um serviço da lista.', 'error');
      return;
    }
    setSalvando(true);
    try {
      // Modo Campo (online ou offline): entra na fila e reflete localmente; o
      // servidor revalida e converte na sincronização (mesma lógica de
      // conversão do gestor) — conectado, o sync automático roda em segundo plano.
      if (isModoCampo() || usarLocal()) {
        const op = await enfileirarOperacao({
          tipo: 'material',
          os_id: osDetalhe.id,
          payload: {
            produto_id: produto.id,
            quantidade_usada: qtd,
            tipo_usc: tipoUsc,
            tipo_os: osDetalhe.tipo, // p/ exibir a unidade do contrato nas pendências
          },
        });
        await refletirMaterialLocal(produto, totalUsc, op.id_local);
        limparFormulario();
        carregarPendentesLocais();
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
        if (isModoCampo()) await refletirMaterialLocal(produto, totalUsc);
        limparFormulario();
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

  // Remove o lançamento pendente do snapshot local e atualiza os totais.
  const removerMaterialLocal = async (alvo) => {
    const local = await getOSLocal(osDetalhe.id);
    if (!local) return;
    const valor = Number(alvo.quantidade_usada || 0);
    const materiais = local.materiais || { itens: [], total_aplicado: 0 };
    const itens = (materiais.itens || [])
      .map(item => {
        if (item.produto_id !== alvo.produto_id) return item;
        const novo = { ...item };
        novo.aplicado = Number((Number(novo.aplicado || 0) - valor).toFixed(3));
        if (alvo.tipo_usc === 'especial') {
          novo.aplicado_especial = Number((Number(novo.aplicado_especial || 0) - valor).toFixed(3));
        } else {
          novo.aplicado_normal = Number((Number(novo.aplicado_normal || 0) - valor).toFixed(3));
        }
        return novo;
      })
      .filter(item => Number(item.aplicado || 0) > 0);
    materiais.itens = itens;
    materiais.total_aplicado = Number(Math.max(0, Number(materiais.total_aplicado || 0) - valor).toFixed(3));
    local.materiais = materiais;
    local.ultimos_lancamentos = (local.ultimos_lancamentos || []).filter(l => l.id !== alvo.id);
    await salvarDetalheLocal(local);
  };

  const estornar = async (id) => {
    // Chamado só após confirmação no ModalConfirmacao
    setEstornandoId(null);
    const alvo = pendentesLocais.find(p => String(p.id_local) === String(id) || Number(p.id) === Number(id))
      || (osDetalhe.lancamentos || []).find(l => Number(l.id) === Number(id) || String(l.id_local) === String(id));
    // Lançamento pendente no dispositivo (ainda não sincronizado): remove da
    // fila e do snapshot local — não existe no servidor ainda.
    if (alvo?.pendente_local) {
      try {
        if (alvo.id_local) await descartarPendente('operacao', alvo.id_local);
        await removerMaterialLocal(alvo);
        mostrarToast('Lançamento removido do dispositivo (não será sincronizado).');
        carregarPendentesLocais();
        onAtualizado();
      } catch {
        mostrarToast('Falha ao remover o lançamento pendente.', 'error');
      }
      return;
    }
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
          onChange={(e) => aoDigitarBusca(e.target.value)}
          placeholder="Bipe ou digite nome ou código (normal/especial)..."
          disabled={!podeEditar}
          className={`w-full px-3.5 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm ${selecionado ? 'pr-9' : ''}`}
        />
        {selecionado && (
          <button
            type="button"
            onClick={() => { setBuscaProduto(''); setProdutoSelecionadoId(null); setTipoUsc('normal'); }}
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
                onClick={() => selecionarProduto(p)}
                className="w-full text-left px-3 py-2 hover:bg-primary-50 text-sm text-slate-700 flex flex-col gap-0.5 cursor-pointer"
              >
                <span className="flex items-center justify-between gap-2 w-full">
                  <span className="font-semibold truncate">{p.nome}</span>
                  <span className="text-xs text-slate-400 shrink-0">{p.unidade} · {unidadeContrato(p.tipo || osDetalhe.tipo)} {p.preco_unitario}{Number(p.qtd_usc_especial || 0) > 0 ? ` + ${p.qtd_usc_especial}` : ''}</span>
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

      {/* Tipo de fator: o fator vem do cadastro do serviço (ex.: 0.48 normal / 0.67 especial) */}
      {selecionado && temUsc && (
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">Tipo de {unidade}</label>
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
              {rotuloUsc('normal')} {uscNormal > 0 && <span className={tipoUsc === 'normal' ? 'text-primary-100' : 'text-slate-400'}>· {uscNormal}</span>}
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
                {rotuloUsc('especial')} · {uscEspecial}
              </button>
            )}
          </div>
          {temUsc && fatorUsc > 0 && (
            <p className="text-[10px] font-semibold text-slate-400 mt-1.5">
              {qtd} {selecionado.unidade} × {fatorUsc} {unidade} = <b className="text-slate-600">{totalUsc} {unidade} {tipoUsc === 'especial' ? 'especial' : 'normal'}</b>
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
      {/* Resumo do serviço selecionado: total já aplicado */}
      {selecionado && (() => {
        const item = itensVisao.find(i => Number(i.produto_id) === Number(selecionado.id));
        const aplicado = item?.aplicado ?? 0;
        return (
          <div className="rounded-xl border px-3 py-2 text-xs flex flex-wrap gap-3 items-center -mt-1 bg-slate-50 border-slate-100">
            <span className="text-slate-500">Selecionado: <b className="text-slate-700">{selecionado.nome}</b> ({selecionado.unidade})</span>
            <span className="text-slate-400">│</span>
            <span className="text-slate-500">Aplicado até agora: <b className="text-slate-700">{aplicado} {unidade}</b></span>
          </div>
        );
      })()}

      {/* Serviços aplicados nesta O.S */}
      <div className="bg-slate-50 rounded-xl border border-slate-100 divide-y divide-slate-100">
        {itensVisao.map(item => (
          <div key={item.produto_id} className="px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-700 truncate">{item.nome}</p>
              <p className="text-xs text-slate-400">
                {item.aplicado} {unidade} {item.unidade}
              </p>
            </div>
            <span className="text-xs font-bold shrink-0 text-slate-500">
              {item.aplicado} {unidade}
            </span>
          </div>
        ))}
        {itensVisao.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-slate-400">Nenhum serviço aplicado ainda.</p>
        )}
      </div>

      {/* Últimos lançamentos com opção de estorno */}
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase mb-1.5">Últimos lançamentos</p>
        <div className="space-y-1">
          {lancamentosVisao.slice(0, 8).map(l => {
            const pecas = Number(l.quantidade_pecas || 0);
            const fator = Number(l.fator_usc || 0);
            const nome = l.produtos?.nome || l.produto_nome || '';
            const rotuloTipo = rotuloUsc(l.tipo_usc === 'especial' ? 'especial' : 'normal');
            const usaConta = pecas > 0 && fator > 0;
            return (
              <div key={l.id} className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2 gap-2">
                <span className="text-xs text-slate-600 min-w-0 truncate">
                  <span className="truncate">
                    {fmtData(l.data_lancamento)} · {nome} —{' '}
                    {usaConta
                      ? `${pecas} × ${rotuloTipo} (${fator}) = ${l.quantidade_usada} ${unidade}`
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
                  {l.pendente_local && (
                    <span className="ml-1.5 shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                      não sincronizado
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
          {lancamentosVisao.length === 0 && (
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

  const carregarFotos = useCallback(async () => {
    // Offline (Modo Campo): usa as fotos de evidência em cache no dispositivo.
    if (isOffline()) {
      try {
        setFotos(await getFotosCacheLocal(osDetalhe.id));
      } catch {
        setFotos([]);
      }
      return;
    }
    try {
      const res = await apiFetch(`${API_URL}/os/${osDetalhe.id}/fotos`);
      if (res.ok) setFotos(await res.json());
    } catch {
      // Sem conexão real: cai para o cache local (se houver).
      try {
        setFotos(await getFotosCacheLocal(osDetalhe.id));
      } catch {
        /* silencioso: aba apenas fica vazia */
      }
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
        const res = await apiFetch(`${API_URL}/os/${osDetalhe.id}/fotos`, {
          method: 'POST',
          body: fd,
          // Upload de foto em rede de campo é lento: 90s em vez do padrão.
          signal: AbortSignal.timeout(90000),
        });
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
      {/* Contexto do cancelamento: o motivo acompanha as fotos de evidência */}
      {(() => {
        const cancelamento = cancelamentoAtual(osDetalhe.historico);
        if (!cancelamento) return null;
        return (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide text-rose-700">
              <AlertTriangle size={12} /> Motivo do cancelamento
            </p>
            {cancelamento.justificativa && (
              <p className="text-xs text-rose-900/90 mt-1 italic leading-relaxed">
                &ldquo;{cancelamento.justificativa}&rdquo;
              </p>
            )}
            <p className="text-[10px] text-rose-700/80 font-semibold mt-1">
              {fmtData(cancelamento.criado_em)}
              {cancelamento.usuario_alteracao ? ` · ${cancelamento.usuario_alteracao}` : ''}
            </p>
          </div>
        );
      })()}

      {/* Captura de evidência: câmera direta OU galeria (seletores separados) */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!podeEditar || enviando}
          onClick={async () => {
            const files = await abrirSeletorFoto({ capture: true });
            if (files.length) enviarArquivos(files);
          }}
          className="h-24 rounded-2xl border-2 border-dashed border-primary-300 bg-primary-50/60 hover:bg-primary-50 text-primary-700 font-bold flex flex-col items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer transition-all"
        >
          <Camera size={28} />
          {enviando ? 'Enviando...' : 'Tirar foto'}
        </button>
        <button
          type="button"
          disabled={!podeEditar || enviando}
          onClick={async () => {
            const files = await abrirSeletorFoto({ multiple: true });
            if (files.length) enviarArquivos(files);
          }}
          className="h-24 rounded-2xl border-2 border-dashed border-slate-300 bg-white hover:bg-slate-50 text-slate-600 font-bold flex flex-col items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer transition-all"
        >
          <ImageIcon size={26} />
          Anexar fotos
        </button>
      </div>

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
          osDetalhe.status === 'cancelada'
            ? 'Esta O.S está CANCELADA — a foto pode ser a única evidência do cancelamento. Excluir mesmo assim?'
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
            ['cancelada', 'impedida'].includes(h.status_novo) ? 'bg-rose-500'
              : ['concluida'].includes(h.status_novo) ? 'bg-emerald-500'
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

// Botões de transição de status direto no painel — essencial no modo campo,
// onde não há drag-and-drop. Transições irreversíveis pedem confirmação.
// O checklist de execução bloqueia o início (grupo 1) e a conclusão.
// 'Cancelar O.S' abre o modal dedicado (justificativa obrigatória) para
// gestor e campo.
function AcoesStatus({ detalhe, podeEditar, mudarStatus, aoAplicado, transicoesMap, onAbrirChecklist, onPedirCancelamento, mostrarToast, ehGestor = false }) {
  const [destinoConfirmar, setDestinoConfirmar] = useState(null);
  const [processando, setProcessando] = useState(false);

  if (!podeEditar) return null;
  const alvos = transicoesMap[detalhe.status] || new Set();
  const principal = detalhe.status === 'rascunho' && alvos.has('aberta') ? 'aberta' : null;
  const iniciar = detalhe.status === 'aberta' && alvos.has('em_andamento');
  const podeCancelar = alvos.has('cancelada');
  const concluir = alvos.has('concluida');
  // O gestor não inicia a execução (tarefa da equipe de campo): no lugar do
  // botão ele vê o aviso "Aguardando início da equipe".
  const mostrarAguardando = ehGestor && iniciar;

  const checklist = detalhe.checklist;

  const liberarInicio = async () => {
    if (checklist && !checklist.inicio_liberado) {
      mostrarToast('Preencha o checklist de início (Grupo 1 - Preparação) para liberar a execução.', 'error');
      onAbrirChecklist?.();
      return false;
    }
    setProcessando(true);
    const ok = await mudarStatus(detalhe, 'em_andamento');
    setProcessando(false);
    if (ok) aoAplicado();
    return ok;
  };

  const ativarOs = async () => {
    setProcessando(true);
    const ok = await mudarStatus(detalhe, 'aberta');
    setProcessando(false);
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

  if (!principal && !(iniciar && !ehGestor) && !mostrarAguardando && !concluir && !podeCancelar) return null;

  return (
    <div className="space-y-2">
      {principal && (
        <button
          onClick={ativarOs}
          disabled={processando}
          className="w-full h-16 rounded-2xl bg-primary-600 hover:bg-primary-700 text-white text-base font-extrabold shadow-lg shadow-primary-900/10 flex items-center justify-center gap-3 cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send size={24} /> Enviar O.S
        </button>
      )}
      {iniciar && !ehGestor && (
        <button
          onClick={liberarInicio}
          disabled={processando}
          className="w-full h-16 rounded-2xl bg-primary-600 hover:bg-primary-700 text-white text-base font-extrabold shadow-lg shadow-primary-900/10 flex items-center justify-center gap-3 cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Play size={24} /> Iniciar Execução
        </button>
      )}
      {mostrarAguardando && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 flex items-start gap-2.5">
          <Send size={16} className="text-sky-600 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-extrabold text-sky-800">Aguardando início da equipe</p>
            <p className="text-[10px] text-sky-600 font-semibold leading-relaxed">
              A O.S foi enviada ao campo. A execução começa após o checklist de preparação
              {detalhe.checklist ? ` (${detalhe.checklist.respondidos}/${detalhe.checklist.total} respondidos)` : ''}.
            </p>
          </div>
        </div>
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
            onClick={() => onPedirCancelamento?.(detalhe)}
            className="h-11 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-40"
            disabled={processando}
          >
            <X size={15} /> Cancelar O.S
          </button>
        )}
      </div>

      <ModalConfirmacao
        aberto={!!destinoConfirmar}
        titulo="Concluir O.S"
        mensagem={`Confirmar a conclusão da O.S ${detalhe.codigo}? Esta ação não pode ser desfeita.`}
        confirmarTexto="Confirmar"
        perigo={false}
        loading={processando}
        onConfirmar={aplicar}
        onCancelar={() => setDestinoConfirmar(null)}
      />
    </div>
  );
}

function PainelExecucao({ osId, produtos, onFechar, recarregarLista, mostrarToast, ehMobile, mudarStatus, ehGestor, onEditar, onExcluir, transicoes, onPedirCancelamento, onReabrir, versaoPainel, equipes = [] }) {
  const [detalhe, setDetalhe] = useState(null);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState('insumos');
  const [modalImprimir, setModalImprimir] = useState(false);
  // Timer do retry (1500ms) — cancelado ao trocar de O.S ou desmontar o painel
  // (sem cleanup o retry antigo disparava com o osId anterior, A8).
  const timerRetry = useRef(null);
  // Guarda anti-corrida: trocar de O.S rapidamente não pode deixar a resposta
  // da O.S antiga sobrescrever o detalhe da nova (A??).
  const osIdRef = useRef(osId);

  const carregar = useCallback(async (tentativa = 0) => {
    setErro('');
    if (osIdRef.current !== osId) {
      // Primeira carga para esta O.S: limpa o detalhe anterior.
      osIdRef.current = osId;
      setDetalhe(null);
    }
    try {
      // Offline: busca no pacote de campo baixado na base.
      if (usarLocal()) {
        const local = await getOSLocal(osId);
        if (osIdRef.current !== osId) return;
        if (local) {
          setDetalhe(local);
          return;
        }
        setErro('Esta O.S ainda não está completa no pacote de campo. Conecte-se ao Wi-Fi: ela é baixada automaticamente para o dispositivo.');
        return;
      }
      const res = await apiFetch(`${API_URL}/os/${osId}`);
      const data = await res.json().catch(() => null);
      if (osIdRef.current !== osId) return;
      if (res.ok) {
        // Em Modo Campo conectado, respostas/fotos seguem na fila local: o
        // resumo do checklist do pacote prevalece sobre o do servidor, para
        // os gates (início/conclusão) não ficarem desatualizados no painel.
        if (isModoCampo()) {
          try {
            const local = await getChecklistLocal(osId);
            if (local?.resumo) data.checklist = local.resumo;
          } catch { /* best-effort: mantém o resumo do servidor */ }
        }
        setDetalhe(data);
        // Em Modo Campo, mantém o pacote local atualizado para o campo.
        if (isModoCampo()) salvarDetalheLocal(data);
      } else if (res.status === 500 && tentativa === 0 && !usarLocal()) {
        // Erros 500 no detalhe costumam ser transitórios (queda de conexão com
        // o banco no servidor): tenta uma segunda vez antes de exibir o erro.
        clearTimeout(timerRetry.current);
        timerRetry.current = setTimeout(() => carregar(1), 1500);
      } else setErro(erroDaResposta(data, 'Erro ao carregar O.S.'));
    } catch {
      // Falhas de conexão costumam ser transitórias (cold start do servidor,
      // WiFi sem internet no campo): tenta uma segunda vez — no Modo Campo a
      // segunda tentativa já cai no pacote local graças à sonda.
      registrarFalhaDeRede();
      if (tentativa === 0) {
        clearTimeout(timerRetry.current);
        timerRetry.current = setTimeout(() => carregar(1), 1500);
      } else {
        if (osIdRef.current !== osId) return;
        setErro('Erro de conexão ao carregar a O.S.');
      }
    }
  }, [osId]);

  useEffect(() => {
    setErro('');
    carregar();
    // Limpa o retry pendente ao trocar de O.S, desmontar ou após o refresh
    // do pacote pós-sync manual (versaoPainel) (A8).
    return () => clearTimeout(timerRetry.current);
  }, [carregar, versaoPainel]);

  // O.S retroativa não tem aba de checklist: se ela estava ativa, volta para
  // Serviços (as demais abas continuam funcionando normalmente).
  useEffect(() => {
    if (detalhe?.checklist_dispensado && aba === 'checklist') setAba('insumos');
  }, [detalhe?.checklist_dispensado, aba]);

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

  const mat = detalhe.materiais || {};
  const encerrada = ['concluida', 'cancelada'].includes(detalhe.status);
  const podeEditar = !encerrada;
  // Em O.S encerrada, somente o gestor pode lançar serviços e estornar
  // lançamentos (ajustes pós-conclusão); o CAMPO também estorna em O.S em
  // execução (correção de lançamento errado), com backend validando equipe.
  const podeLancarServico = podeEditar || (ehGestor && encerrada);
  const podeEstornar = ehGestor || !encerrada;
  const podeExcluir = ehGestor && podeEditar;
  // Exclusão da O.S: gestor, apenas rascunho ou encerradas (sem execução ativa).
  const podeExcluirOs = ehGestor && ['rascunho', 'concluida', 'cancelada'].includes(detalhe.status);
  const execucao = situacaoExecucao(detalhe);

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
      // Libera a blob URL depois de a aba nova carregar (revogar antes pode
      // cancelar a leitura do PDF).
      setTimeout(() => window.URL.revokeObjectURL(url), 120000);
    } catch {
      janela?.close();
      mostrarToast('Erro de conexão ao gerar o PDF.', 'error');
    }
  };

  // Usuário de campo não vê o Histórico (timeline de status do gestor).
  // O.S retroativa não tem checklist (execução registrada em papel).
  const abasDisponiveis = [
    ...(detalhe?.checklist_dispensado ? [] : [['checklist', 'Checklist', ListChecks]]),
    ['insumos', 'Serviços', Package],
    ['evidencias', 'Evidências', Camera],
    ...(ehGestor ? [['timeline', 'Histórico', Clock]] : []),
  ];

  const corpoAbas = (
    <>
      {detalhe?.checklist_dispensado && (
        <div className="mb-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-[11px] font-semibold text-amber-800">
          O.S retroativa — checklist dispensado. A execução foi registrada manualmente em papel;
          lance abaixo os serviços aplicados.
        </div>
      )}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-4">
        {abasDisponiveis.map(([key, label, Icon]) => {
          const cor = CORES_ABA[key] || COR_ABA_PADRAO;
          const ativa = aba === key;
          return (
            <button
              key={key}
              onClick={() => setAba(key)}
              className={`relative flex-1 flex items-center justify-center gap-1.5 py-2.5 min-h-11 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                ativa ? `bg-white shadow-sm ${cor.ativo}` : 'text-slate-500'
              }`}
            >
              <Icon size={16} className={ativa ? '' : cor.icone} />
              {label}
              {ativa && (
                <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 h-0.5 w-6 rounded-full ${cor.filete}`} />
              )}
            </button>
          );
        })}
      </div>
      {aba === 'checklist' && !detalhe?.checklist_dispensado && (
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
      {aba === 'timeline' && ehGestor && <TabTimeline historico={detalhe.historico} />}
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
            {execucao && (
              <span className={`px-2.5 py-1 rounded-lg border flex items-center gap-1.5 ${execucao.classe}`}>
                <CalendarClock size={14} className="shrink-0" />
                <span className="flex flex-col leading-tight">
                  <span className="text-[10px] font-bold opacity-80">{execucao.label}</span>
                  {execucao.data && <span className="text-sm font-black">{execucao.data}</span>}
                </span>
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

      {/* Destaque do cancelamento: motivo + quem + quando (fonte: histórico) */}
      {(() => {
        const cancelamento = cancelamentoAtual(detalhe.historico);
        if (!cancelamento) return null;
        return (
          <div className="mt-3 rounded-xl border-2 border-rose-300 bg-rose-50 p-3">
            <div className="flex items-center gap-2 text-rose-700">
              <AlertTriangle size={16} className="shrink-0" />
              <p className="text-xs font-extrabold uppercase tracking-wide">Cancelamento</p>
            </div>
            {cancelamento.justificativa && (
              <p className="text-xs text-rose-900/90 mt-1.5 italic leading-relaxed">
                &ldquo;{cancelamento.justificativa}&rdquo;
              </p>
            )}
            <p className="text-[10px] text-rose-700/80 font-semibold mt-1.5">
              {fmtData(cancelamento.criado_em)}
              {cancelamento.usuario_alteracao ? ` · ${cancelamento.usuario_alteracao}` : ''}
            </p>
          </div>
        );
      })()}

      {/* Checklist de início pendente: bloqueia a liberação da execução.
          Aviso apenas para o usuário de campo — o gestor não executa o
          checklist e o bloqueio do backend continua valendo para todos. */}
      {!ehGestor && detalhe.status === 'aberta' && detalhe.checklist && !detalhe.checklist.inicio_liberado && (
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

      {/* Cartão de Materiais (apenas gestor) — cronômetro/H.H. foi descontinuado */}
      {ehGestor && (
        <div className="mt-3">
          <div className="bg-amber-50 rounded-xl p-2.5 border border-amber-100">
            <p className="text-[9px] font-bold text-amber-600 uppercase">Materiais</p>
            <p className="text-sm font-extrabold text-amber-800">
              {mat.total_aplicado ?? 0} {unidadeContrato(detalhe.tipo)}
            </p>
          </div>
        </div>
      )}

      {/* Ações rápidas */}
      <div className="space-y-2 mt-3">
        <AcoesStatus
          detalhe={detalhe}
          podeEditar={podeEditar}
          mudarStatus={mudarStatus}
          aoAplicado={() => { carregar(); recarregarLista(); }}
          transicoesMap={transicoes}
          onAbrirChecklist={() => setAba('checklist')}
          onPedirCancelamento={onPedirCancelamento}
          mostrarToast={mostrarToast}
          ehGestor={ehGestor}
        />        {ehGestor && (
          <div className="grid gap-2 grid-cols-2">
            <button
              onClick={() => onEditar(detalhe)}
              className="h-11 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-slate-50 cursor-pointer"
            >
              <Pencil size={14} /> Editar
            </button>
            <button
              onClick={() => setModalImprimir(true)}
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
            {['concluida', 'cancelada'].includes(detalhe.status) && (
              <button
                type="button"
                onClick={() => onReabrir(detalhe)}
                className="h-11 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-amber-100 cursor-pointer col-span-2"
              >
                <RefreshCw size={14} /> Reabrir O.S (exige justificativa)
              </button>
            )}
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
        {cabecalho}
        {corpoAbas}
      </div>
      {modalImprimir && (
        <ModalImprimirOS
          detalhe={detalhe}
          equipes={equipes}
          abrirPdf={abrirPdf}
          mostrarToast={mostrarToast}
          onFechar={() => setModalImprimir(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modais: nova O.S, cancelamento
// ---------------------------------------------------------------------------

const FORM_OS_INICIAL = {
  obra_id: '', equipe_id: '', prioridade: 'media', prazo_entrega: '',
  descricao_escopo: '', custo_mo_orcado: '',
  tipo: TIPO_PADRAO_OS, agencia: '', municipio: '', local_servico: '',
  bt_energizado: false, at_energizado_bloqueio: false, bloqueio: false,
  hora_desligar: '', hora_religar: '', alimentador: '', chave: '', obs: '',
  // O.S retroativa: serviço já executado e anotado em papel.
  retroativa: false, data_execucao: '', justificativa_retroativa: '',
};

// Data de hoje no formato AAAA-MM-DD (limite máximo da data de execução).
const hojeIso = () => {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
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

function ModalNovaOS({ aberto, obras, equipes, onFechar, onCriada, mostrarToast, edicao, obraInicial = null, onAbrirOs = null }) {
  const [form, setForm] = useState(FORM_OS_INICIAL);
  const [salvando, setSalvando] = useState(false);
  const [criada, setCriada] = useState(null); // {id, codigo} ao salvar com sucesso
  const [imprimindo, setImprimindo] = useState(false);

  // Preenche o formulário no modo edição (ou zera no modo criação).
  // Criação a partir do PainelObra (`obraInicial`) já vem com a obra travada.
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
        tipo: edicao.tipo || TIPO_PADRAO_OS,
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
        retroativa: !!edicao.retroativa,
        data_execucao: edicao.data_execucao || '',
        justificativa_retroativa: '',
      });
      setCriada(null);
    } else {
      const base = { ...FORM_OS_INICIAL };
      if (obraInicial) {
        const obraSelecionada = obras.find(o => o.id === Number(obraInicial));
        base.obra_id = String(obraInicial);
        if (obraSelecionada) {
          // Mesmo autopreenchimento do autocomplete ao escolher a obra.
          base.municipio = obraSelecionada.cidade || '';
          base.local_servico = obraSelecionada.endereco || '';
        }
      }
      setForm(base);
      setCriada(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, edicao, obraInicial]);

  const salvar = async (e) => {
    e.preventDefault();
    if (salvando) return; // duplo toque/Enter repetido
    if (!form.obra_id) { mostrarToast('Selecione a obra.', 'error'); return; }
    const eraRetroativa = !edicao && form.retroativa;
    if (eraRetroativa) {
      if (!form.data_execucao) { mostrarToast('Informe a data real da execução.', 'error'); return; }
      if ((form.justificativa_retroativa || '').trim().length < 10) {
        mostrarToast('Descreva a justificativa da O.S retroativa (mínimo 10 caracteres).', 'error');
        return;
      }
    }
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
      if (eraRetroativa) {
        corpo.retroativa = true;
        corpo.data_execucao = form.data_execucao;
        corpo.justificativa_retroativa = form.justificativa_retroativa.trim();
      }

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
          mostrarToast(
            eraRetroativa
              ? `O.S retroativa ${data.codigo} registrada em andamento (sem checklist).`
              : `O.S ${data.codigo} criada como rascunho.`
          );
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
      // A aba nova navegou para a blob URL; revoga após um tempo de segurança
      // (revogar antes pode cancelar a leitura do PDF no navegador).
      setTimeout(() => window.URL.revokeObjectURL(url), 120000);
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
          <h3 className="text-lg font-extrabold text-slate-800">
            O.S {criada.codigo} {criada.retroativa ? 'registrada!' : 'criada!'}
          </h3>
          <p className="text-xs text-slate-500 mt-1 mb-6">
            {criada.retroativa
              ? 'O.S retroativa em andamento (sem checklist). Lance agora os serviços executados em campo.'
              : 'Deseja imprimir a ordem de serviço no modelo oficial?'}
          </p>
          <div className="space-y-2">
            {criada.retroativa && onAbrirOs && (
              <button
                onClick={() => {
                  // Passa a O.S inteira: o destino troca para a visão certa
                  // (Quadro) antes de abrir o painel de execução.
                  const os = criada;
                  setCriada(null);
                  onFechar();
                  onAbrirOs(os);
                }}
                className="w-full py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 cursor-pointer flex items-center justify-center gap-2"
              >
                <Package size={16} /> Lançar serviços agora
              </button>
            )}
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
          {/* Modalidade: normal (checklist) x retroativa (execução em papel) */}
          {!edicao && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Modalidade</label>
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, retroativa: false }))}
                  className={`py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    !form.retroativa ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  O.S normal
                </button>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, retroativa: true }))}
                  className={`py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    form.retroativa ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500'
                  }`}
                >
                  O.S retroativa
                </button>
              </div>
              {form.retroativa && (
                <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-3">
                  <p className="text-[11px] font-semibold text-amber-800 leading-relaxed">
                    Use quando o serviço <b>já foi executado</b> e anotado em papel. A O.S nasce
                    <b> em andamento</b>, na data real da execução, <b>sem checklist</b> — pronta para
                    lançar os serviços aplicados.
                  </p>
                  <div>
                    <label className="block text-xs font-bold text-amber-900 mb-1">Data real da execução *</label>
                    <input
                      type="date"
                      required={form.retroativa}
                      max={hojeIso()}
                      value={form.data_execucao}
                      onChange={(e) => setForm(f => ({ ...f, data_execucao: e.target.value }))}
                      className="w-full px-3.5 py-2.5 border border-amber-300 rounded-xl text-sm bg-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-amber-900 mb-1">
                      Justificativa (mínimo 10 caracteres) *
                    </label>
                    <textarea
                      rows={2}
                      required={form.retroativa}
                      value={form.justificativa_retroativa}
                      onChange={(e) => setForm(f => ({ ...f, justificativa_retroativa: e.target.value }))}
                      placeholder="Ex.: emergência de fim de semana; execução registrada no formulário de papel."
                      className="w-full px-3.5 py-2.5 border border-amber-300 rounded-xl text-sm bg-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Obra *</label>
            <ObraAutocomplete
              obras={obras}
              value={form.obra_id}
              disabled={!!edicao || !!obraInicial}
              onChange={(obraSel) => setForm(f => ({
                ...f,
                obra_id: obraSel ? String(obraSel.id) : '',
                municipio: f.municipio || obraSel?.cidade || '',
                local_servico: f.local_servico || obraSel?.endereco || '',
              }))}
            />
            {(edicao || obraInicial) && (
              <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                {edicao
                  ? 'A obra não pode ser alterada após a criação.'
                  : `O.S criada para a obra "${obras.find(o => o.id === Number(obraInicial))?.nome || ''}".`}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Tipo de O.S</label>
            <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-primary-500">
              {TIPOS_SERVICO_OPCOES.map(({ valor, rotulo }) => (
                <option key={valor} value={valor}>{rotulo}</option>
              ))}
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
          {/* Na O.S retroativa a data relevante é a real da execução (painel
              âmbar acima); o prazo previsto não se aplica. */}
          {!form.retroativa && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Data de execução</label>
              <input type="date" value={form.prazo_entrega} onChange={(e) => setForm({ ...form, prazo_entrega: e.target.value })}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500" />
            </div>
          )}
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

function ModalCancelamento({ aberto, osAlvo, onConfirmar, onCancelar, processando }) {
  const [justificativa, setJustificativa] = useState('');
  const [fotos, setFotos] = useState([]);
  const [enviandoFoto, setEnviandoFoto] = useState(false);

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

      // Modo Campo (online ou offline): guarda a foto no dispositivo; o id
      // local vira a referência da evidência no status de cancelamento
      // (mapeado na sincronização).
      if (isModoCampo() || usarLocal()) {
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
        const res = await apiFetch(`${API_URL}/os/${osAlvo.id}/fotos`, {
          method: 'POST',
          body: fd,
          // Upload de foto em rede de campo é lento: 90s em vez do padrão.
          signal: AbortSignal.timeout(90000),
        });
        if (res.ok) {
          const data = await res.json();
          novosFotoIds = [...novosFotoIds, data.id];
        }
      } catch {
        // Sem internet real no campo: a evidência vira foto local (id local
        // referenciado no status de cancelamento e mapeado na sincronização).
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

  // Cancelamento exige apenas a justificativa (>= 5 caracteres); a foto de
  // evidência é opcional.
  const valido = justificativa.trim().length >= 5;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-rose-600 text-white px-6 py-4 flex items-center gap-2">
          <AlertTriangle size={22} />
          <h3 className="font-bold text-lg">Cancelar O.S {osAlvo?.codigo}</h3>
        </div>
        <div className="p-6 space-y-4">
          {/* Passo 1: Motivo (obrigatório) */}
          <div>
            <p className="text-xs font-bold text-slate-600 mb-1.5 flex items-center gap-1">
              <span className="w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] font-black flex items-center justify-center">1</span>
              Descreva o motivo do cancelamento
            </p>
            <textarea
              rows={4}
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder="Ex: Cliente desistiu do serviço; obra suspensa pela concessionária."
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-rose-400"
            />
            <span className={`text-xs font-semibold ${justificativa.trim().length >= 5 ? 'text-emerald-600' : 'text-slate-400'}`}>
              {justificativa.trim().length}/5 caracteres mínimos
            </span>
          </div>

          {/* Passo 2: Evidência fotográfica (opcional) — upload direto aqui no modal */}
          <div>
            <p className="text-xs font-bold text-slate-600 mb-1.5 flex items-center gap-1">
              <span className="w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] font-black flex items-center justify-center">2</span>
              Anexar foto de evidência <span className="font-semibold text-slate-400">(opcional)</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={enviandoFoto}
                onClick={async () => {
                  const files = await abrirSeletorFoto({ capture: true });
                  if (files.length) enviarFotos(files);
                }}
                className={`h-20 rounded-xl border-2 border-dashed font-bold flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer text-sm disabled:opacity-50 ${
                  fotos.length > 0
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                    : 'border-rose-300 bg-rose-50 text-rose-700'
                }`}
              >
                <Camera size={22} />
                {enviandoFoto
                  ? 'Enviando...'
                  : fotos.length > 0
                    ? `✓ ${fotos.length} — adicionar`
                    : 'Tirar foto'
                }
              </button>
              <button
                type="button"
                disabled={enviandoFoto}
                onClick={async () => {
                  const files = await abrirSeletorFoto({ multiple: true });
                  if (files.length) enviarFotos(files);
                }}
                className={`h-20 rounded-xl border-2 border-dashed font-bold flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer text-sm disabled:opacity-50 ${
                  fotos.length > 0
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                    : 'border-slate-300 bg-white text-slate-600'
                }`}
              >
                <ImageIcon size={22} />
                {enviandoFoto
                  ? 'Enviando...'
                  : fotos.length > 0
                    ? `✓ ${fotos.length} — anexar mais`
                    : 'Escolher da galeria'
                }
              </button>
            </div>
          </div>

          {/* Checklist de validação */}
          <div className="flex gap-4 text-xs">
            <span className={`flex items-center gap-1 font-semibold ${justificativa.trim().length >= 5 ? 'text-emerald-600' : 'text-slate-400'}`}>
              <Check size={12} />{justificativa.trim().length >= 5 ? 'Motivo ok' : 'Motivo incompleto'}
            </span>
            <span className={`flex items-center gap-1 font-semibold ${fotos.length > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
              <Camera size={12} />{fotos.length > 0 ? `${fotos.length} evidência(s)` : 'Sem evidência (opcional)'}
            </span>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onCancelar}
            className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 cursor-pointer">Voltar</button>
          <button
            onClick={() => onConfirmar(justificativa.trim(), fotos)}
            disabled={!valido || processando || enviandoFoto}
            className="px-5 py-2 bg-rose-600 text-white rounded-xl text-sm font-semibold hover:bg-rose-700 disabled:opacity-40 cursor-pointer"
          >
            {processando ? 'Registrando...' : 'Confirmar cancelamento'}
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
  // Gestor abre direto no Desempenho; usuário de campo não tem essa aba.
  const [visao, setVisao] = useState(() => (
    (usuarioAtual?.permissoes || []).includes('os') ? 'desempenho' : 'quadro'
  )); // desempenho | obras | quadro | cadastros | arquivo
  const [osSelecionada, setOsSelecionada] = useState(null);
  const [versaoPainel, setVersaoPainel] = useState(0); // força re-leitura do painel após sync manual
  const [modalNova, setModalNova] = useState(false);
  const [novaOSObraId, setNovaOSObraId] = useState(null); // obra travada ao criar O.S pelo PainelObra
  const [versaoResumoObra, setVersaoResumoObra] = useState(0); // refresh do resumo do PainelObra após criar O.S
  const [modalEdicao, setModalEdicao] = useState(null); // detalhe da O.S em edição
  const [modalCancelamento, setModalCancelamento] = useState(null); // {os, destinoColuna}
  const [modalReabrir, setModalReabrir] = useState(null); // {os} — reabertura de encerrada (gestor)
  const [confirmacaoEncerrar, setConfirmacaoEncerrar] = useState(null); // {os, destino}
  const [confirmacaoExcluir, setConfirmacaoExcluir] = useState(null); // {os} — exclusão definitiva
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

  // ---- Aba Desempenho (gestor) ----
  const [resumoDesempenho, setResumoDesempenho] = useState(null);
  const [carregandoDesempenho, setCarregandoDesempenho] = useState(false);
  const [mesDesempenho, setMesDesempenho] = useState(mesAtualLocal);

  // Largura da tela (painel em tela cheia < 1024px; drawer no desktop).
  const [ehTelaLarga, setEhTelaLarga] = useState(
    typeof window !== 'undefined' && window.innerWidth >= 1024,
  );

  // ---- Modo Campo (offline) ----
  const [modoCampo, setModoCampoState] = useState(isModoCampo());
  const [offline, setOffline] = useState(isOffline());
  const [pendentes, setPendentes] = useState({ operacoes: 0, fotos: 0, total: 0, revisao: 0 });
  const [sincronizando, setSincronizando] = useState(false);
  const [progressoSync, setProgressoSync] = useState(null); // {enviadas, total} p/ feedback
  const [preparandoPacote, setPreparandoPacote] = useState(false);
  const [baixandoNovas, setBaixandoNovas] = useState(false);
  const [atualizandoAuto, setAtualizandoAuto] = useState(false);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null);
  const [erroRefresh, setErroRefresh] = useState(null);
  const [agoraTick, setAgoraTick] = useState(() => Date.now());
  const [modalPendenciasAberto, setModalPendenciasAberto] = useState(false);
  const [ultimoResumo, setUltimoResumo] = useState(null);
  // Pacote local ilegível/corrompido no Modo Campo: mostra cartão de
  // recuperação (em vez de tela branca) com saída para o servidor.
  const [erroLeituraLocal, setErroLeituraLocal] = useState(false);
  // Auto-preparo (uma tentativa por sessão) e throttle do refresh contínuo.
  const autoPreparoRef = useRef(false);
  const ultimoRefreshRef = useRef(0);
  // Evita refresh automático e manual rodando juntos (downloads concorrentes).
  const pacoteEmAndamento = useRef(false);

  const toastTimerRef = useRef(null);
  const mostrarToast = useCallback((message, type = 'success', acao = null) => {
    setToast({ message, type, acao });
    // Limpa o timer anterior: um toast novo cancela a ocultação do antigo
    // (timers soltos podiam apagar o toast seguinte antes da hora).
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), type === 'error' ? 8000 : 2000);
  }, []);

  // Limpa o timer do toast ao desmontar a página.
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  const sincronizarAgora = useCallback(async (silencioso = false) => {
    if (isOffline()) {
      if (!silencioso) mostrarToast('Sem conexão — sincronize quando voltar à internet.', 'error');
      return;
    }
    // Sincronização só no Wi-Fi: uploads de fotos em dados móveis ficam
    // lentos e podem travar (spinner eterno). Em 4G/3G fica tudo no
    // dispositivo aguardando uma rede Wi-Fi.
    if (!estaEmWifi()) {
      if (!silencioso) mostrarToast('Conecte-se ao Wi-Fi para sincronizar (evita travamentos em dados móveis).', 'error');
      return;
    }
    if (sincronizando) return;
    setSincronizando(true);
    setProgressoSync(null);
    try {
      const totalInicial = (await contarPendentes()).total;
      if (totalInicial === 0) {
        if (!silencioso) mostrarToast('Nada pendente para sincronizar.');
        return;
      }
      const resumo = await sincronizar((p) => {
        setProgressoSync({
          enviadas: p.fotosEnviadas + p.operacoesEnviadas + (p.descartados || 0),
          total: totalInicial,
        });
      });
      setUltimoResumo(resumo);
      salvarUltimoSync(resumo).catch(() => { /* diagnóstico best-effort */ });
      if (usuarioAtual?.nome) salvarResponsavelLocal(usuarioAtual.nome);

      // Auto-limpeza parcial (Modo Campo): respostas de checklist e transições
      // que o servidor recusou por O.S encerrada/imutável nunca serão
      // aplicadas — saem da fila com aviso (materiais e fotos seguem para
      // revisão manual no descarte).
      let removidas = 0;
      const removidasIds = new Set();
      if (isModoCampo()) {
        for (const f of resumo.falhas || []) {
          if (f.tipo !== 'operacao' || removidasIds.has(f.id_local)) continue;
          if (!['checklist_resposta', 'status'].includes(f.opTipo)) continue;
          if (!/O\.S encerrad|est[áa] encerrad|não pode ser alterad/i.test(String(f.erro || ''))) continue;
          try {
            await descartarPendente('operacao', f.id_local);
            removidasIds.add(f.id_local);
            removidas += 1;
          } catch { /* segue para o próximo */ }
        }
        if (removidas > 0) {
          resumo.falhas = resumo.falhas.filter(f => !removidasIds.has(f.id_local));
          resumo.conflitos = (resumo.conflitos || []).filter(f => !removidasIds.has(f.id_local));
        }
      }

      const enviadas = resumo.fotosEnviadas + resumo.operacoesEnviadas;
      const restamFalhas = resumo.falhas.length > 0;
      const partes = [];
      if (enviadas > 0) partes.push(`${enviadas} sincronizado(s)`);
      if (removidas > 0) partes.push(`${removidas} removida(s) de O.S encerrada`);

      // Fila zerada após o envio? (base para o atalho de finalizar e para o
      // refresh do pacote logo abaixo).
      const restantes = await contarPendentes();

      if (restamFalhas) {
        const resumosErros = [...new Set(resumo.falhas.slice(0, 3).map(f => f.erro))].join('\n');
        mostrarToast(
          `${partes.length ? `${partes.join(', ')}; ` : ''}${resumo.falhas.length} com erro.\n${resumosErros}`,
          'error',
          { label: 'Ver pendências', onClick: () => setModalPendenciasAberto(true) },
        );
      } else if (partes.length) {
        mostrarToast(
          isModoCampo() && restantes.total === 0 ? 'Tudo sincronizado.' : partes.join('; ') + '.',
        );
      }

      // Após o sync manual com a fila zerada, o pacote local é re-sincronizado
      // com o servidor (download) para a tela não carregar resíduos locais
      // (previews "não sincronizado", respostas já aplicadas) e para pegar
      // O.S novas atribuídas à equipe. Com pendências restantes
      // (falhas/conflitos) a cópia local é preservada para revisão.
      if (restantes.total === 0 && isModoCampo()) {
        try { await atualizarPacoteCampo(); } catch { /* best-effort */ }
        if (osSelecionada != null) {
          try {
            const [d, c] = await Promise.all([
              apiFetch(`${API_URL}/os/${osSelecionada}`).then(r => (r.ok ? r.json() : null)),
              apiFetch(`${API_URL}/os/${osSelecionada}/checklist`).then(r => (r.ok ? r.json() : null)),
            ]);
            if (d) await salvarDetalheLocal(d);
            if (c) await salvarChecklistLocal(osSelecionada, c);
            setVersaoPainel(v => v + 1);
          } catch { /* best-effort: próxima abertura recarrega */ }
        }
      }
      carregarDados();
    } catch {
      if (!silencioso) mostrarToast('Falha ao sincronizar. Tente novamente.', 'error');
    } finally {
      setSincronizando(false);
      setProgressoSync(null);
      // IndexedDB pode estar bloqueado/corrompido: nunca deixa o finally
      // derrubar a tela (rejeição não tratada cairia no overlay vermelho).
      try {
        const p = await contarPendentes();
        setPendentes(p);
      } catch {
        /* mantém a contagem anterior */
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sincronizando, mostrarToast, usuarioAtual?.nome]);

  // Monitora a conexão de verdade (sonda HTTP a cada 10s — o navigator.onLine
  // engana em WiFi sem internet, comum no campo). No Modo Campo a sincronização
  // é SOMENTE manual (botão Pendências / Finalizar) — a sonda só atualiza o
  // badge de conectividade e a contagem de pendências.
  useEffect(() => {
    let sondaEmAndamento = false;
    const estadoOffline = { atual: isOffline() };
    const atualizar = async (daSonda = false) => {
      if (!sondaEmAndamento && daSonda) {
        sondaEmAndamento = true;
        try {
          await testarConexao();
        } finally {
          sondaEmAndamento = false;
        }
      }
      const offlineAtual = isOffline();
      setOffline(offlineAtual);
      estadoOffline.atual = offlineAtual;
      if (offlineAtual === false) {
        contarPendentes().then(setPendentes).catch(() => {});
      }
    };
    const noEvento = () => atualizar(false);
    const naSonda = () => atualizar(true);
    window.addEventListener('online', noEvento);
    window.addEventListener('offline', noEvento);
    // Sonda imediata ao montar (Modo Campo) e a cada 10s — SOMENTE no Modo
    // Campo: fora dele, eventos online/offline + o contador já bastam (a
    // sonda incondicional consumia rede/bateria e marcava "sem conexão" com
    // falhas transitórias da API mesmo fora do campo).
    if (modoCampo) {
      naSonda();
      const sonda = setInterval(naSonda, 10000);
      const contador = setInterval(() => {
        contarPendentes().then(setPendentes).catch(() => {});
      }, 15000);
      return () => {
        window.removeEventListener('online', noEvento);
        window.removeEventListener('offline', noEvento);
        clearInterval(sonda);
        clearInterval(contador);
      };
    }
    const contador = setInterval(() => {
      contarPendentes().then(setPendentes).catch(() => {});
    }, 30000);
    return () => {
      window.removeEventListener('online', noEvento);
      window.removeEventListener('offline', noEvento);
      clearInterval(contador);
    };
  }, [sincronizarAgora, modoCampo]);

  // (Preparação do Modo Campo agora é automática — ver auto-preparo/refresh
  // mais abaixo, após `carregarDados`.)

  // (Limpeza total agora só no card de recuperação: "Limpar dados locais
  // deste aparelho" — o Modo Campo é contínuo.)

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

  // Geração da listagem: respostas antigas (filtro/visão trocados, "Carregar
  // mais" repetido) são descartadas antes de tocar o estado (A7).
  const geracaoListagem = useRef(0);

  const buscarPagina = useCallback(async (offset, reset) => {
    const requisicao = ++geracaoListagem.current;
    // Resposta antiga não pode sobrescrever o estado atual (corrida A7).
    const desatualizada = () => requisicao !== geracaoListagem.current;
    try {
      // Modo Campo (100% local): usa o pacote de campo baixado na base —
      // filtros, busca e paginação aplicados em memória.
      if (usarLocal()) {
        try {
          const lista = await getListaLocal();
          if (desatualizada()) return;
          // Fora do arquivo do gestor, O.S encerradas não aparecem (espelha o
          // filtro do servidor para o usuário de campo).
          const visivel = ehGestor ? lista : lista.filter(o => ['aberta', 'em_andamento'].includes(o.status));
          const filtrados = filtrarListaLocal(visivel, {
            busca: buscaAplicada, obra_id: filtroObra, equipe_id: filtroEquipe,
            prioridade: filtroPrioridade, status: filtroStatus,
          });
          const pagina = filtrados.slice(offset, offset + LIMITE_PAGINA);
          // Catálogo local de serviços: sem ele o campo não encontra serviços
          // por código/nome ao lançar (o servidor está indisponível).
          const catalogo = await getProdutosLocal();
          if (desatualizada()) return;
          if (catalogo.length) setProdutos(catalogo);
          setTotalOs(filtrados.length);
          setListaOs(prev => (reset ? pagina : [...prev, ...pagina]));
          setLoading(false);
        } catch (erroLocal) {
          // Pacote local ilegível/corrompido: mostra recuperação em vez de
          // tela branca (Fase 1 — anti-tela-branca do Modo Campo).
          console.error('Falha ao ler o pacote local do Modo Campo:', erroLocal);
          setErroLeituraLocal(true);
          setLoading(false);
        }
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
      const resOs = await apiFetch(`${API_URL}/os/${qs ? `?${qs}` : ''}`, { retry: 2 });
      if (resOs.ok) {
        const pagina = await resOs.json();
        const total = Number(resOs.headers.get('X-Total-Count') || pagina.length);
        if (desatualizada()) return;
        setTotalOs(total);
        setListaOs(prev => (reset ? pagina : [...prev, ...pagina]));
      } else if (!desatualizada()) {
        mostrarToast('Erro ao carregar O.S.', 'error');
      }
      // Catálogos de serviços/obras/equipes apenas na primeira página (ou ao
      // trocar filtros): "Carregar mais" não precisa redownloadar.
      if (!reset) return;
      const [resProdutos, resObras, resEquipes] = await Promise.all([
        apiFetch(`${API_URL}/os/produtos`, { retry: 2 }),
        ehGestor ? apiFetch(`${API_URL}/os/obras`, { retry: 2 }) : Promise.resolve(null),
        ehGestor ? apiFetch(`${API_URL}/os/equipes`, { retry: 2 }) : Promise.resolve(null),
      ]);
      if (desatualizada()) return;
      if (resProdutos.ok) setProdutos(await resProdutos.json());
      if (ehGestor && resObras?.ok) setObras(await resObras.json());
      if (ehGestor && resEquipes?.ok) setEquipes(await resEquipes.json());
    } catch {
      // Sem internet real (WiFi sem dados): usa o pacote local no Modo Campo.
      registrarFalhaDeRede();
      if (usarLocal()) {
        try {
          const lista = await getListaLocal();
          if (desatualizada()) return;
          // Fora do arquivo do gestor, O.S encerradas não aparecem (espelha o
          // filtro do servidor para o usuário de campo).
          const visivel = ehGestor ? lista : lista.filter(o => ['aberta', 'em_andamento'].includes(o.status));
          const filtrados = filtrarListaLocal(visivel, {
            busca: buscaAplicada, obra_id: filtroObra, equipe_id: filtroEquipe,
            prioridade: filtroPrioridade, status: filtroStatus,
          });
          const pagina = filtrados.slice(offset, offset + LIMITE_PAGINA);
          setTotalOs(filtrados.length);
          setListaOs(prev => (reset ? pagina : [...prev, ...pagina]));
          const catalogo = await getProdutosLocal();
          if (!desatualizada() && catalogo.length) setProdutos(catalogo);
        } catch (erroLocal) {
          console.error('Falha ao ler o pacote local do Modo Campo:', erroLocal);
          setErroLeituraLocal(true);
          setLoading(false);
        }
      } else if (!desatualizada()) {
        mostrarToast('Erro de conexão ao carregar o módulo de O.S.', 'error');
      }
    } finally {
      if (!desatualizada()) setLoading(false);
    }
  }, [buscaAplicada, filtroObra, filtroEquipe, filtroPrioridade, filtroStatus, ehGestor, mostrarToast]);

  // Listagem de Encerradas (gestor): paginação e filtros próprios.
  const carregarArquivo = useCallback(async (offset, reset) => {
    if (!ehGestor || usarLocal()) return;
    const requisicao = ++geracaoListagem.current;
    const desatualizada = () => requisicao !== geracaoListagem.current;
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
      const res = await apiFetch(`${API_URL}/os/?${params.toString()}`, { retry: 2 });
      if (res.ok) {
        const pagina = await res.json();
        const total = Number(res.headers.get('X-Total-Count') || pagina.length);
        if (desatualizada()) return;
        setTotalEncerradas(total);
        setListaEncerradas(prev => (reset ? pagina : [...prev, ...pagina]));
      } else if (!desatualizada()) {
        mostrarToast('Erro ao carregar Encerradas.', 'error');
      }
    } catch {
      registrarFalhaDeRede();
      if (!usarLocal() && !desatualizada()) mostrarToast('Erro de conexão ao carregar Encerradas.', 'error');
    } finally {
      if (!desatualizada()) setCarregandoArquivo(false);
    }
  }, [buscaAplicada, filtroObra, filtroEquipe, filtroPrioridade, filtroArquivo, ehGestor, mostrarToast]);

  const carregarDados = useCallback(() => {
    if (ehGestor && visao === 'desempenho') {
      // A aba carrega o próprio resumo; não há lista para buscar e o spinner
      // inicial precisa ser liberado.
      setLoading(false);
      return;
    }
    if (ehGestor && visao === 'arquivo') carregarArquivo(0, true);
    else buscarPagina(0, true);
  }, [buscarPagina, carregarArquivo, ehGestor, visao]);

  // Aba Desempenho (gestor): resumo por equipe do mês selecionado.
  const carregarDesempenho = useCallback(async () => {
    if (!ehGestor) return;
    setCarregandoDesempenho(true);
    try {
      const res = await apiFetch(
        `${API_URL}/os/dashboard-equipes?mes=${encodeURIComponent(mesDesempenho)}`,
        { retry: 2 }
      );
      if (res.ok) {
        setResumoDesempenho(await res.json());
      } else {
        mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao carregar o desempenho.'), 'error');
      }
    } catch {
      mostrarToast('Erro de conexão ao carregar o desempenho.', 'error');
    } finally {
      setCarregandoDesempenho(false);
    }
  }, [ehGestor, mesDesempenho, mostrarToast]);

  useEffect(() => {
    if (ehGestor && visao === 'desempenho') carregarDesempenho();
  }, [ehGestor, visao, carregarDesempenho]);

  const carregarMais = () => buscarPagina(listaOs.length, false);
  const carregarMaisArquivo = () => carregarArquivo(listaEncerradas.length, false);

  // Recarrega sempre que carregarDados muda de identidade — o que acontece ao
  // trocar filtros (via buscarPagina/carregarArquivo) ou a visão atual.
  useEffect(() => { carregarDados(); }, [carregarDados]);

  // Recarrega o painel após operações no painel de execução.
  const recarregarLista = useCallback(() => { carregarDados(); }, [carregarDados]);

  // Atualização manual do pacote (botão "Atualizar O.S"): novas O.S,
  // atualizações do servidor e poda das encerradas sem pendência.
  const atualizarOs = useCallback(async () => {
    if (isOffline()) {
      mostrarToast('Sem conexão — conecte-se para atualizar as O.S.', 'error');
      return;
    }
    if (baixandoNovas || sincronizando || preparandoPacote || pacoteEmAndamento.current) return;
    setBaixandoNovas(true);
    pacoteEmAndamento.current = true;
    try {
      // Manual: refresh completo (re-baixa também os detalhes/checklists das
      // existentes sem pendência).
      const r = await atualizarPacoteCampo({ completo: true });
      setUltimaAtualizacao(Date.now());
      setErroRefresh(null);
      const mudancas = r.novas + r.atualizadas + r.removidas;
      if (mudancas > 0) {
        carregarDados();
        if (osSelecionada != null) setVersaoPainel(v => v + 1);
        const partes = [];
        if (r.novas) partes.push(`${r.novas} nova(s)`);
        if (r.atualizadas) partes.push(`${r.atualizadas} atualizada(s)`);
        if (r.removidas) partes.push(`${r.removidas} removida(s)`);
        mostrarToast(`O.S atualizadas: ${partes.join(', ')}.`, r.faltantes.length ? 'error' : 'success');
      } else {
        mostrarToast('Tudo atualizado.');
      }
    } catch {
      mostrarToast('Falha ao atualizar as O.S. Tente novamente.', 'error');
    } finally {
      pacoteEmAndamento.current = false;
      setBaixandoNovas(false);
    }
  }, [baixandoNovas, sincronizando, preparandoPacote, osSelecionada, mostrarToast, carregarDados]);

  // Auto-preparo do Modo Campo (usuário de campo): baixa o pacote assim que
  // entra no módulo com internet — sem botão "Preparar". Uma tentativa por
  // sessão; se falhar, o efeito abaixo libera nova tentativa ao reconectar.
  const prepararModoCampoAutomatico = useCallback(async () => {
    if (isModoCampo() || isOffline() || sincronizando || preparandoPacote) return false;
    if (!armazenamentoOfflineDisponivel()) {
      mostrarToast(
        'Este navegador está bloqueando o armazenamento local. Libere cookies/dados do site para este endereço e recarregue para usar o Modo Campo.',
        'error',
      );
      return false;
    }
    setPreparandoPacote(true);
    try {
      const { quantidade, faltantes } = await prepararPacoteCampo();
      if (usuarioAtual?.nome) await salvarResponsavelLocal(usuarioAtual.nome);
      await salvarDonoPacote(usuarioAtual);
      setModoCampo(true);
      setModoCampoState(true);
      ultimoRefreshRef.current = Date.now();
      setUltimaAtualizacao(Date.now());
      carregarDados();
      mostrarToast(
        faltantes.length
          ? `Modo Campo pronto: ${quantidade} O.S (${faltantes.length} incompletas — completam ao reconectar).`
          : `Modo Campo pronto: ${quantidade} O.S no dispositivo.`,
        faltantes.length ? 'error' : 'success',
      );
      return true;
    } catch {
      return false; // tenta novamente na próxima conexão
    } finally {
      setPreparandoPacote(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sincronizando, preparandoPacote, usuarioAtual?.id, usuarioAtual?.nome, mostrarToast]);

  // Refresh contínuo do pacote (qualquer conexão): novas O.S + atualizações do
  // servidor + poda das encerradas sem pendência, com throttle.
  const refreshPacote = useCallback(async ({ forcar = false } = {}) => {
    if (!isModoCampo() || isOffline() || sincronizando || preparandoPacote || baixandoNovas) return null;
    if (pacoteEmAndamento.current) return null;
    const agora = Date.now();
    if (!forcar && agora - ultimoRefreshRef.current < REFRESH_MIN_MS) return null;
    ultimoRefreshRef.current = agora;
    pacoteEmAndamento.current = true;
    setAtualizandoAuto(true);
    try {
      const r = await atualizarPacoteCampo();
      setUltimaAtualizacao(Date.now());
      setErroRefresh(null);
      // Só mexe na tela quando o quadro muda de composição (nova/removida);
      // atualizações silenciosas ficam no pacote e valem ao reabrir o painel.
      if (r.novas > 0 || r.removidas > 0) carregarDados();
      return r;
    } catch {
      setErroRefresh('Falha ao atualizar o pacote — tentaremos novamente.');
      return null;
    } finally {
      pacoteEmAndamento.current = false;
      setAtualizandoAuto(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sincronizando, preparandoPacote, baixandoNovas, mostrarToast]);

  // Auto-preparo no primeiro acesso online do usuário de campo (uma vez por
  // sessão; se falhar, libera o ref para tentar de novo no próximo gatilho).
  // Sem `preparandoPacote` nas deps: evita retry imediato em falha persistente.
  useEffect(() => {
    if (ehGestor || isModoCampo() || isOffline() || preparandoPacote) return;
    if (autoPreparoRef.current) return;
    autoPreparoRef.current = true;
    prepararModoCampoAutomatico().then((ok) => {
      if (!ok && !isModoCampo()) autoPreparoRef.current = false;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ehGestor, offline, modoCampo]);

  // Refresh contínuo: ao reconectar, ao voltar ao app e a cada 4 min.
  const refreshPacoteRef = useRef(refreshPacote);
  useEffect(() => { refreshPacoteRef.current = refreshPacote; }, [refreshPacote]);
  useEffect(() => {
    if (!modoCampo) return;
    const aoVoltar = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      refreshPacoteRef.current();
    };
    window.addEventListener('focus', aoVoltar);
    window.addEventListener('online', aoVoltar);
    document.addEventListener('visibilitychange', aoVoltar);
    const timer = setInterval(() => refreshPacoteRef.current(), REFRESH_INTERVALO_MS);
    refreshPacoteRef.current();
    return () => {
      window.removeEventListener('focus', aoVoltar);
      window.removeEventListener('online', aoVoltar);
      document.removeEventListener('visibilitychange', aoVoltar);
      clearInterval(timer);
    };
  }, [modoCampo]);

  // "Atualizado há X": usa o horário do último preparo/refresh do pacote e
  // mantém o rótulo relativo atualizado a cada minuto.
  useEffect(() => {
    if (!modoCampo) return;
    let cancelado = false;
    infoPacote()
      .then((meta) => {
        const ts = meta?.preparado_em ? new Date(meta.preparado_em).getTime() : NaN;
        if (!cancelado && !Number.isNaN(ts)) setUltimaAtualizacao(ts);
      })
      .catch(() => {});
    const timer = setInterval(() => setAgoraTick(Date.now()), 60000);
    return () => { cancelado = true; clearInterval(timer); };
  }, [modoCampo]);

  // --- Transição de status --------------------------------------------------

  // Trava contra clique duplo (ou duas fontes ao mesmo tempo) enfileirando a
  // MESMA transição duas vezes — o `disabled` dos botões não basta (A7/doc).
  // O fallback offline (tentativa === 1) é reentrante e não é bloqueado.
  const statusEmAndamento = useRef(false);

  const mudarStatus = useCallback(async (os, novoStatus, extras = {}, tentativa = 0) => {
    if (tentativa === 0 && statusEmAndamento.current) {
      mostrarToast('Aguarde a transição anterior terminar.', 'error');
      return false;
    }
    statusEmAndamento.current = true;
    setProcessando(true);
    try {
      // Localização real no momento da ação (não reutiliza check-in antigo).
      const gps = await capturarGps();

      // Modo Campo (100% local, online ou não): registra na fila do
      // dispositivo e reflete localmente — sync apenas manual.
      if (isModoCampo() || usarLocal()) {
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
          setListaOs(prev => prev.map(o => (Number(o.id) === Number(os.id) ? { ...o, status: novoStatus } : o)));
          mostrarToast(`${os.codigo} movida para "${LABEL_STATUS[novoStatus]}" (sincronize quando quiser).`);
          const p = await contarPendentes();
          setPendentes(p);
          return true;
        } catch {
          mostrarToast('Falha ao registrar a transição no dispositivo.', 'error');
          return false;
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
          // Em Modo Campo reflete no pacote local: uma queda de rede logo
          // depois não deixa quadro/kanban com o estado antigo (A5). Falha
          // local não pode derrubar o fluxo (nem virar reenvio duplicado).
          if (isModoCampo()) {
            try {
              await atualizarStatusLocal(os.id, novoStatus);
            } catch {
              /* best-effort: o GET do detalhe/lista re-sincroniza depois */
            }
          }
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
      }
    } finally {
      statusEmAndamento.current = false;
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

  // Resumo do checklist usado pelo drag (mesmos gates dos botões, A10): local
  // no Modo Campo (online ou não); do servidor fora dele. O resumo local é
  // SEMPRE recalculado dos itens (evita resumo defasado liberar o gate).
  const resumoChecklistParaDrag = async (os) => {
    if (isModoCampo() || usarLocal()) {
      const local = await getChecklistLocal(os.id);
      if (!local?.itens) return local?.resumo || null;
      return recalcularResumo(local.itens, local.resumo);
    }
    try {
      const res = await apiFetch(`${API_URL}/os/${os.id}/checklist`);
      if (res.ok) {
        const dados = await res.json();
        if (isModoCampo() && dados?.resumo) salvarChecklistLocal(os.id, dados);
        return dados?.resumo || null;
      }
    } catch {
      /* sem resumo legível: o servidor revalida e responde com o erro real */
    }
    return null;
  };

  const aoArrastarFim = async (resultado) => {    setDraggingOsStatus(null);
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

    // O gestor não inicia a execução (tarefa da equipe de campo): arrastar
    // para "Em Andamento" é bloqueado para ele, como no painel.
    if (destino === 'em_andamento' && ehGestor) {
      mostrarToast('A execução é iniciada pela equipe de campo.', 'error');
      return;
    }

    // Os MESMOS gates do checklist que os botões do painel aplicam (A10):
    // drag não pode burlar "início liberado" nem concluir com checklist atrasado.
    if (destino === 'em_andamento') {
      const resumo = await resumoChecklistParaDrag(os);
      if (resumo && !resumo.inicio_liberado) {
        mostrarToast('Preencha o checklist de início (Grupo 1 - Preparação) para liberar a execução.', 'error');
        return;
      }
    }
    if (destino === 'concluida') {
      const resumo = await resumoChecklistParaDrag(os);
      if (resumo && !resumo.completo) {
        const faltam = (resumo.total || 0) - (resumo.respondidos || 0);
        mostrarToast(`O checklist da O.S está incompleto (${faltam} item(ns) pendente(s)).`, 'error');
        return;
      }
    }

    // Cancelamento exige justificativa (modal dedicado) — gestor e campo.
    if (destino === 'cancelada') {
      setModalCancelamento({ os });
      return;
    }
    // Conclusão é irreversível: pede confirmação explícita.
    if (destino === 'concluida') {
      setConfirmacaoEncerrar({ os, destino });
      return;
    }
    mudarStatus(os, destino);
  };

  const confirmarCancelamento = async (justificativa, fotosIds = []) => {
    const { os } = modalCancelamento;
    // As fotos (opcionais) já foram enviadas pelo modal — só passamos os IDs
    // para o backend validar a que O.S pertencem.
    const ok = await mudarStatus(os, 'cancelada', { justificativa, fotos_ids: fotosIds });
    if (ok) setModalCancelamento(null);
  };

  // Reabertura de O.S encerrada (gestor): justificativa registrada no histórico.
  const confirmarReabertura = async (justificativa) => {
    const os = modalReabrir;
    if (!os) return;
    setProcessando(true);
    try {
      const ok = await mudarStatus(os, 'aberta', { justificativa });
      if (ok) {
        setModalReabrir(null);
        mostrarToast(`O.S ${os.codigo} reaberta.`);
      } else {
        mostrarToast('Não foi possível reabrir a O.S. Confira a mensagem acima.', 'error');
      }
    } finally {
      setProcessando(false);
    }
  };

  // --- Agrupamento do Kanban ---------------------------------------------------

  // Colunas visíveis: gestor vê todas; o campo vê as em execução.
  const colunasVisiveis = useMemo(
    () => COLUNAS.filter(c => ehGestor || ['aberta', 'em_andamento'].includes(c.id)),
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

  // Rótulo relativo do último refresh do pacote (Modo Campo).
  const labelAtualizacao = useMemo(() => {
    if (!ultimaAtualizacao) return null;
    const min = Math.max(0, Math.floor((agoraTick - ultimaAtualizacao) / 60000));
    if (min < 1) return 'Atualizado agora';
    if (min < 60) return `Atualizado há ${min} min`;
    return `Atualizado há ${Math.floor(min / 60)} h`;
  }, [ultimaAtualizacao, agoraTick]);

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
        ...(ehGestor ? [['desempenho', 'Desempenho', BarChart3]] : []),
        ...(ehGestor ? [['obras', 'Obras', Building]] : []),
        ['quadro', 'Quadro O.S', LayoutGrid],
        ...(ehGestor ? [['cadastros', 'Cadastros', FolderKanban]] : []),
        ...(ehGestor ? [['arquivo', 'Encerradas', Archive]] : []),
      ].map(([key, label, Icon]) => (
        <button key={key} onClick={() => setVisao(key)}
          className={`flex items-center gap-1.5 px-3 py-1.5 min-h-11 rounded-lg text-sm font-bold transition-all cursor-pointer ${
            visao === key ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}>
          <Icon size={16} />{label}
        </button>
      ))}
    </div>
  );

  const abrirNovaOSDaObra = (obraId) => {
    // Criação de O.S é contextual: abre o modal com a obra travada.
    setNovaOSObraId(obraId);
    setModalNova(true);
  };

  const abrirOSDoPainelObra = (os) => {
    // Abre a O.S na visão certa (Quadro se em execução; Encerradas se
    // concluída/cancelada) — o PainelObra sai da tela junto da aba.
    const encerrada = os.status === 'concluida' || os.status === 'cancelada';
    setVisao(encerrada ? 'arquivo' : 'quadro');
    setOsSelecionada(os.id);
  };

  // Aba Desempenho: clicar no card da equipe abre o Quadro já filtrado por ela.
  const abrirQuadroDaEquipe = (equipe) => {
    setFiltroEquipe(String(equipe.id));
    setVisao('quadro');
  };

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
                className={`h-full ${col.id === 'aberta' ? 'bg-sky-400' : col.id === 'em_andamento' ? 'bg-primary-500' : 'bg-slate-400'}`}
                style={{ width: `${(porColuna[col.id].length / totalOs) * 100}%` }} />
            )
          ))}
        </div>
      )}
    </div>
  ) : null;


  // --- Recuperação de Modo Campo com pacote local ilegível ----------------
  const tentarLerLocalNovamente = () => {
    setErroLeituraLocal(false);
    carregarDados();
  };

  const sairModoCampoUsarServidor = async () => {
    setModoCampo(false);
    setModoCampoState(false);
    setErroLeituraLocal(false);
    carregarDados();
    mostrarToast('Modo Campo desativado — usando o servidor.');
  };

  const limparDadosLocaisDoCampo = async () => {
    const ok = window.confirm(
      'Limpar os dados locais do Modo Campo deste aparelho?\n\n'
      + 'Pendências ainda não sincronizadas (respostas, serviços e fotos) SERÃO PERDIDAS.',
    );
    if (!ok) return;
    try {
      await limparPacote();
    } catch { /* segue mesmo se a limpeza falhar parcialmente */ }
    setModoCampo(false);
    setModoCampoState(false);
    setErroLeituraLocal(false);
    carregarDados();
    mostrarToast('Dados locais do Modo Campo limpos.');
  };

  if (erroLeituraLocal && modoCampo) {
    return (
      <div className="rounded-2xl border-2 border-rose-200 bg-white p-6 max-w-lg mx-auto mt-10 text-center space-y-4">
        <AlertTriangle size={36} className="text-rose-500 mx-auto" />
        <div>
          <h3 className="text-base font-extrabold text-slate-800">Falha ao ler os dados locais do Modo Campo</h3>
          <p className="text-sm text-slate-500 mt-1.5">
            O pacote salvo neste aparelho está ilegível ou incompleto. Escolha como continuar:
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={tentarLerLocalNovamente}
            className="px-4 py-3 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 cursor-pointer"
          >
            Tentar novamente
          </button>
          <button
            onClick={sairModoCampoUsarServidor}
            className="px-4 py-3 rounded-xl border border-primary-300 bg-primary-50 text-primary-700 text-sm font-bold hover:bg-primary-100 cursor-pointer"
          >
            Sair do Modo Campo e usar o servidor
          </button>
          <button
            onClick={limparDadosLocaisDoCampo}
            className="px-4 py-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 text-sm font-bold hover:bg-rose-100 cursor-pointer"
          >
            Limpar dados locais deste aparelho
          </button>
        </div>
      </div>
    );
  }

  // Usuário de campo offline sem pacote baixado: orienta a conectar (o
  // auto-preparo baixa as O.S assim que houver internet).
  if (!ehGestor && !modoCampo && offline && !preparandoPacote) {
    return (
      <div className="space-y-3">
        <Toast toast={toast} />
        <div className="rounded-2xl border-2 border-amber-200 bg-white p-6 max-w-lg mx-auto mt-10 text-center space-y-4">
          <WifiOff size={36} className="text-amber-500 mx-auto" />
          <div>
            <h3 className="text-base font-extrabold text-slate-800">Modo Campo ainda não preparado</h3>
            <p className="text-sm text-slate-500 mt-1.5">
              Conecte-se à internet para baixar as O.S da sua equipe para este aparelho.
              O download é automático assim que houver conexão.
            </p>
          </div>
          <p className="flex items-center justify-center gap-1.5 text-xs font-bold text-amber-600">
            <WifiOff size={13} />
            Aguardando conexão…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-5 relative ${!ehTelaLarga ? 'os-celular' : ''}`}>
      <Toast toast={toast} />

      {/* Header de ações */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          {seletorVisao}
          <span className="text-sm text-slate-400 font-semibold">{totalOs} O.S no total{listaOs.length < totalOs ? ` (${listaOs.length} carregadas)` : ''}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Modo Campo: exclusivo do usuário de campo (os_campo) — preparação
              e refresh do pacote são automáticos */}
          {!ehGestor && modoCampo && (
            <>
              {/* Sincronizar agora: envio manual das pendências (Wi-Fi). Fica
                  destacado (badge + pulso) enquanto houver algo para enviar. */}
              <button
                onClick={() => sincronizarAgora()}
                disabled={preparandoPacote || sincronizando || baixandoNovas}
                title={pendentes.total > 0
                  ? `Enviar ${pendentes.total} pendência(s) para o servidor (Wi-Fi)`
                  : 'Enviar as pendências locais para o servidor (Wi-Fi)'}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border font-bold text-xs text-white transition-all cursor-pointer disabled:opacity-50 max-[639px]:px-5 max-[639px]:py-3 max-[639px]:text-[15px] ${
                  pendentes.total > 0
                    ? 'border-primary-300 bg-primary-600 hover:bg-primary-700 ring-2 ring-primary-300 ring-offset-1 shadow-lg shadow-primary-500/40'
                    : 'border-primary-300 bg-primary-600 hover:bg-primary-700'
                }`}
              >
                <RefreshCw size={15} className={sincronizando ? 'animate-spin' : ''} />
                {sincronizando
                  ? (progressoSync ? `Sincronizando (${progressoSync.enviadas}${progressoSync.total ? `/${progressoSync.total}` : ''})...` : 'Sincronizando...')
                  : 'Sincronizar agora'}
                {pendentes.total > 0 && !sincronizando && (
                  <span className={`relative ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black ${
                    pendentes.revisao === pendentes.total
                      ? 'bg-amber-400 text-amber-950'
                      : 'bg-white text-primary-700'
                  }`}>
                    <span
                      aria-hidden="true"
                      className={`absolute inset-0 rounded-full animate-ping motion-reduce:animate-none opacity-60 ${
                        pendentes.revisao === pendentes.total ? 'bg-amber-400' : 'bg-white'
                      }`}
                    />
                    <span className="relative">{pendentes.total}</span>
                  </span>
                )}
              </button>

              {/* Atualizar O.S: refresh manual do pacote (o automático roda ao
                  reconectar/voltar ao app e a cada 4 min) */}
              <button
                onClick={atualizarOs}
                disabled={preparandoPacote || sincronizando || baixandoNovas}
                title="Atualizar o pacote local (novas O.S, mudanças do servidor e remoção das encerradas)"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-sky-300 bg-sky-50 text-sky-700 font-bold text-xs hover:bg-sky-100 transition-all cursor-pointer disabled:opacity-50 max-[639px]:px-5 max-[639px]:py-3 max-[639px]:text-[15px]"
              >
                <Download size={15} className={baixandoNovas ? 'animate-bounce' : ''} />
                {baixandoNovas ? 'Atualizando...' : 'Atualizar O.S'}
              </button>

              {/* Feedback do refresh contínuo + horário do último pacote */}
              <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 max-[639px]:hidden">
                {atualizandoAuto ? (
                  <>
                    <RefreshCw size={11} className="animate-spin" />
                    Atualizando…
                  </>
                ) : erroRefresh ? (
                  <span className="flex items-center gap-1 text-amber-600" title={erroRefresh}>
                    <AlertTriangle size={11} />
                    {labelAtualizacao || 'Falha ao atualizar'}
                  </span>
                ) : (labelAtualizacao || '')}
              </span>

              {/* Pendências com erro/conflito: precisam de revisão/descarte */}
              {pendentes.revisao > 0 && (
                <button
                  onClick={() => setModalPendenciasAberto(true)}
                  title="Abrir pendências para revisar/descartar itens com erro"
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-700 font-bold text-xs hover:bg-amber-100 transition-all cursor-pointer max-[639px]:px-5 max-[639px]:py-3 max-[639px]:text-[15px]"
                >
                  <AlertTriangle size={15} />
                  Pendências ({pendentes.revisao})
                </button>
              )}
            </>
          )}

          {!ehGestor && !modoCampo && preparandoPacote && (
            /* Auto-preparo em andamento (primeiro acesso online do usuário) */
            <span className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-primary-200 bg-primary-50 text-primary-700 font-bold text-xs">
              <RefreshCw size={15} className="animate-spin" />
              Preparando Modo Campo...
            </span>
          )}
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
                        col.id === 'concluida' ? 'text-emerald-600' : col.id === 'cancelada' ? 'text-rose-500' : 'text-slate-500'
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
                                  <CardOS os={os} onClick={() => setOsSelecionada(os.id)} ehGestor={ehGestor} />
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

          {/* Painel de execução (ÚNICO por viewport): drawer no desktop
              (>=1024px) e tela cheia no mobile. Montado UMA única vez por
              O.S selecionada — duas instâncias simultâneas causavam GETs,
              toasts e cronômetros em dobro (A6). */}
          {osSelecionada != null && (
            <PainelExecucao
              osId={osSelecionada}
              versaoPainel={versaoPainel}
              obras={obras}
              equipes={equipes}
              produtos={produtos}
              onFechar={() => setOsSelecionada(null)}
              recarregarLista={recarregarLista}
              mostrarToast={mostrarToast}
              ehMobile={!ehTelaLarga}
              mudarStatus={mudarStatus}
              ehGestor={ehGestor}
              onEditar={(detalhe) => setModalEdicao(detalhe)}
              onExcluir={(detalhe) => setConfirmacaoExcluir({ os: detalhe })}
              onPedirCancelamento={(detalhe) => setModalCancelamento({ os: detalhe })}
              onReabrir={(detalhe) => setModalReabrir(detalhe)}
              transicoes={transicoes}
            />
          )}

          {/* ===== MODO CAMPO (mobile): lista ===== */}
          <div className="lg:hidden space-y-3">
            {listaOs.length === 0 && (
              <p className="text-center text-sm text-slate-400 py-12">Nenhuma O.S encontrada.</p>
            )}
            {/* Agrupada por status para localizar rapidamente as O.S em execução */}
            {colunasVisiveis.filter(col => porColuna[col.id].length > 0).map(col => (
              <div key={col.id} className="space-y-2">
                <div className="flex items-center gap-2 pt-1">
                  <span className={`text-[10px] font-extrabold uppercase tracking-wider ${
                    col.id === 'concluida' ? 'text-emerald-600' : col.id === 'cancelada' ? 'text-rose-500' : 'text-slate-500'
                  }`}>{col.label}</span>
                  <span className="text-[10px] font-bold bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">
                    {porColuna[col.id].length}
                  </span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                {porColuna[col.id].map(os => (
                  <CardOS key={os.id} os={os} onClick={() => setOsSelecionada(os.id)} ehGestor={ehGestor} />
                ))}
              </div>
            ))}
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

      {visao === 'desempenho' && ehGestor && (
        <PainelDesempenho
          dados={resumoDesempenho}
          carregando={carregandoDesempenho}
          mes={mesDesempenho}
          mesAtual={mesAtualLocal()}
          onMudarMes={setMesDesempenho}
          onAtualizar={carregarDesempenho}
          onSelecionarEquipe={abrirQuadroDaEquipe}
        />
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
                      <span className="hidden sm:inline">{Number(os.total_materiais_aplicado || 0).toFixed(3)} {unidadeContrato(os.tipo)} aplicado</span>
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
              versaoPainel={versaoPainel}
              obras={obras}
              equipes={equipes}
              produtos={produtos}
              onFechar={() => setOsSelecionada(null)}
              recarregarLista={recarregarLista}
              mostrarToast={mostrarToast}
              ehMobile={!ehTelaLarga}
              mudarStatus={mudarStatus}
              ehGestor={ehGestor}
              onEditar={(detalhe) => setModalEdicao(detalhe)}
              onExcluir={(detalhe) => setConfirmacaoExcluir({ os: detalhe })}
              onPedirCancelamento={(detalhe) => setModalCancelamento({ os: detalhe })}
              onReabrir={(detalhe) => setModalReabrir(detalhe)}
              transicoes={transicoes}
            />
          )}
        </>
      )}

      {visao === 'obras' && ehGestor && (
        <PainelObras
          obras={obras}
          recarregar={recarregarLista} mostrarToast={mostrarToast}
          onNovaOS={abrirNovaOSDaObra}
          refreshResumoKey={versaoResumoObra}
          onAbrirOS={abrirOSDoPainelObra}
        />
      )}

      {visao === 'cadastros' && ehGestor && (
        <PainelCadastros
          equipes={equipes} produtos={produtos}
          recarregar={recarregarLista} mostrarToast={mostrarToast}
        />
      )}

      {ehGestor && (
        <ModalNovaOS
          aberto={modalNova || !!modalEdicao}
          obras={obras} equipes={equipes}
          edicao={modalEdicao}
          obraInicial={novaOSObraId}
          onFechar={() => { setModalNova(false); setModalEdicao(null); setNovaOSObraId(null); }}
          onCriada={() => {
            recarregarLista();
            // Recarrega o resumo do PainelObra (nova O.S criada desta obra).
            setVersaoResumoObra(v => v + 1);
          }}
          onAbrirOs={abrirOSDoPainelObra}
          mostrarToast={mostrarToast}
        />
      )}

      <ModalCancelamento
        aberto={!!modalCancelamento}
        osAlvo={modalCancelamento?.os}
        processando={processando}
        onConfirmar={confirmarCancelamento}
        onCancelar={() => setModalCancelamento(null)}
      />

      <ModalReabrirOS
        aberto={!!modalReabrir}
        os={modalReabrir}
        processando={processando}
        onConfirmar={confirmarReabertura}
        onCancelar={() => setModalReabrir(null)}
      />


      <ModalConfirmacao
        aberto={!!confirmacaoEncerrar}
        titulo={confirmacaoEncerrar?.destino === 'concluida' ? 'Concluir O.S' : 'Cancelar O.S'}
        mensagem={
          confirmacaoEncerrar?.destino === 'concluida'
            ? `Confirmar a conclusão da O.S ${confirmacaoEncerrar?.os?.codigo}? Esta ação não pode ser desfeita.`
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
// Aba Desempenho (gestor): cards por equipe (backlog atual + concluídas e
// canceladas do mês) e rankings/evolução em CSS/SVG puro (sem bibliotecas).
// ---------------------------------------------------------------------------

function BarraRanking({ rotulo, detalhe, valor, maximo, cor = 'bg-primary-500' }) {
  const pct = maximo > 0 ? Math.max(2, Math.round((valor / maximo) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-bold text-slate-700 truncate">{rotulo}</span>
        <span className="font-black text-slate-800 shrink-0">{detalhe}</span>
      </div>
      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${cor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Contorno colorido por equipe (cor estável pelo id) para identificar cada
// card de relance. Tons suaves para não competir com os status internos.
const CORES_EQUIPE = [
  { borda: 'border-indigo-300', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { borda: 'border-teal-300', badge: 'bg-teal-50 text-teal-700 border-teal-200' },
  { borda: 'border-violet-300', badge: 'bg-violet-50 text-violet-700 border-violet-200' },
  { borda: 'border-cyan-300', badge: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  { borda: 'border-fuchsia-300', badge: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' },
  { borda: 'border-sky-300', badge: 'bg-sky-50 text-sky-700 border-sky-200' },
];

function corDaEquipe(equipe) {
  const base = Number.isFinite(Number(equipe?.id)) ? Number(equipe.id) : 0;
  return CORES_EQUIPE[Math.abs(base) % CORES_EQUIPE.length];
}

function PainelDesempenho({ dados, carregando, mes, mesAtual, onMudarMes, onAtualizar, onSelecionarEquipe }) {
  const [ordenacao, setOrdenacao] = useState('backlog');
  const [contratoVolume, setContratoVolume] = useState(TIPO_PADRAO_OS);

  const equipes = useMemo(() => dados?.equipes || [], [dados]);
  const semEquipe = dados?.sem_equipe;
  const destaque = dados?.destaque;
  const totais = dados?.totais;

  const ordenadas = useMemo(() => {
    const lista = [...equipes];
    if (ordenacao === 'concluidas') {
      lista.sort((a, b) => b.concluidas - a.concluidas || b.backlog - a.backlog);
    } else if (ordenacao === 'numero') {
      lista.sort((a, b) => String(a.numero || '').localeCompare(String(b.numero || ''), undefined, { numeric: true }));
    } else {
      lista.sort((a, b) => b.backlog - a.backlog || b.concluidas - a.concluidas);
    }
    return lista;
  }, [equipes, ordenacao]);

  const rankingProducao = useMemo(
    () => [...equipes].filter(e => e.concluidas > 0).sort((a, b) => b.concluidas - a.concluidas || b.backlog - a.backlog),
    [equipes]
  );
  const maxProducao = rankingProducao[0]?.concluidas || 0;

  const rankingVolume = useMemo(
    () => equipes
      .map(e => ({ equipe: e, volume: (e.volume_por_tipo || []).find(v => v.tipo === contratoVolume) }))
      .filter(item => item.volume)
      .sort((a, b) => b.volume.total - a.volume.total),
    [equipes, contratoVolume]
  );
  const maxVolume = rankingVolume[0]?.volume.total || 0;
  const unidadeVolume = rankingVolume[0]?.volume.unidade || unidadeContrato(contratoVolume);

  const serieDia = dados?.concluidas_por_dia || [];
  const maxDia = Math.max(1, ...serieDia);
  const meses = dados?.meses || [];
  const maxMes = Math.max(1, ...meses.map(m => m.concluidas + m.canceladas));
  const temSemEquipe = semEquipe && (semEquipe.backlog + semEquipe.concluidas + semEquipe.canceladas) > 0;

  return (
    <div className="space-y-4">
      {/* Cabeçalho: navegação de mês, refresh e totais */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onMudarMes(somarMes(mes, -1))}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
            title="Mês anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-extrabold text-slate-800 min-w-[150px] text-center">{rotuloMes(mes)}</span>
          <button
            onClick={() => onMudarMes(somarMes(mes, 1))}
            disabled={mes >= mesAtual}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Próximo mês"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={onAtualizar}
            disabled={carregando}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-40"
            title="Atualizar"
          >
            <RefreshCw size={14} className={carregando ? 'animate-spin' : ''} />
          </button>
        </div>
        {totais && (
          <div className="flex items-center gap-3 text-[11px] font-bold flex-wrap">
            <span className="bg-sky-50 text-sky-700 border border-sky-100 rounded-full px-2.5 py-1">Abertas {totais.backlog}</span>
            <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2.5 py-1">Concluídas {totais.concluidas}</span>
            <span className="bg-rose-50 text-rose-700 border border-rose-100 rounded-full px-2.5 py-1">Canceladas {totais.canceladas}</span>
          </div>
        )}
      </div>

      {/* Equipe destaque do mês */}
      {destaque && (
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-primary-950 text-white rounded-2xl p-4 sm:p-5 flex items-center gap-4 shadow-lg relative overflow-hidden">
          <div className="absolute right-0 bottom-0 top-0 w-1/3 bg-[radial-gradient(circle_at_right,rgba(245,158,11,0.18),transparent)] pointer-events-none" />
          <span className="w-12 h-12 rounded-2xl bg-amber-400/20 text-amber-300 flex items-center justify-center shrink-0 relative z-10">
            <Trophy size={24} />
          </span>
          <div className="min-w-0 relative z-10">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-300">Equipe destaque de {rotuloMes(mes)}</p>
            <p className="text-lg font-black truncate">
              {destaque.numero ? `Nº ${destaque.numero} · ` : ''}{destaque.nome}
            </p>
            <p className="text-xs text-slate-300">{destaque.concluidas} O.S concluída(s) no mês</p>
          </div>
        </div>
      )}

      {/* Cards por equipe */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-extrabold text-slate-800 text-sm">Equipes ({equipes.length})</h3>
        <select
          value={ordenacao}
          onChange={e => setOrdenacao(e.target.value)}
          className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 bg-white focus:outline-none focus:border-primary-500"
        >
          <option value="backlog">Ordenar por abertas</option>
          <option value="concluidas">Ordenar por concluídas</option>
          <option value="numero">Ordenar por nº da equipe</option>
        </select>
      </div>

      {carregando && !dados ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {[0, 1, 2].map(i => <div key={i} className="h-44 bg-slate-100 animate-pulse rounded-2xl" />)}
        </div>
      ) : equipes.length === 0 ? (
        <p className="text-center text-xs text-slate-400 py-10 bg-white rounded-2xl border border-slate-100">
          Nenhuma equipe cadastrada.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {ordenadas.map(eq => {
            const encerradas = eq.concluidas + eq.canceladas;
            const pctConclusao = encerradas > 0 ? Math.round((eq.concluidas / encerradas) * 100) : null;
            const ehDestaque = destaque?.equipe_id === eq.id;
            const cor = corDaEquipe(eq);
            return (
              <button
                key={eq.id}
                onClick={() => onSelecionarEquipe(eq)}
                title="Abrir o Quadro filtrado por esta equipe"
                className={`text-left bg-white rounded-2xl border-2 p-4 shadow-sm hover:shadow-md transition-all cursor-pointer space-y-3 ${
                  ehDestaque ? 'border-amber-400 ring-2 ring-amber-200' : cor.borda
                } ${eq.ativa === false ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <HardHat size={16} className="text-primary-600 shrink-0" />
                    <span className="font-extrabold text-slate-800 text-sm truncate">{eq.nome}</span>
                    {ehDestaque && <Trophy size={14} className="text-amber-500 shrink-0" />}
                  </div>
                  {eq.numero && (
                    <span className={`text-[10px] font-bold border rounded-full px-2 py-0.5 shrink-0 ${cor.badge}`}>
                      Nº {eq.numero}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="grid grid-cols-3 gap-2 flex-1">
                    <div>
                      <p className="text-[9px] font-extrabold uppercase tracking-wider text-sky-600">Abertas</p>
                      <p className="text-xl font-black text-slate-800">{eq.backlog}</p>
                      <p className="text-[9px] text-slate-400 font-semibold">em aberto agora</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-600">Concluídas</p>
                      <p className="text-xl font-black text-slate-800">{eq.concluidas}</p>
                      <p className="text-[9px] text-slate-400 font-semibold">no mês</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-extrabold uppercase tracking-wider text-rose-600">Canceladas</p>
                      <p className="text-xl font-black text-slate-800">{eq.canceladas}</p>
                      <p className="text-[9px] text-slate-400 font-semibold">no mês</p>
                    </div>
                  </div>
                  <div
                    className="relative w-14 h-14 rounded-full shrink-0"
                    title={pctConclusao == null
                      ? 'Nenhuma O.S encerrada no mês'
                      : `${pctConclusao}% das O.S encerradas no mês foram concluídas`}
                    style={{
                      background: pctConclusao == null
                        ? '#e2e8f0'
                        : `conic-gradient(#10b981 ${pctConclusao * 3.6}deg, #f43f5e 0deg)`,
                    }}
                  >
                    <span className="absolute inset-1.5 bg-white rounded-full flex items-center justify-center text-[10px] font-black text-slate-700">
                      {pctConclusao == null ? '—' : `${pctConclusao}%`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-400">
                  <span>{eq.membros} membro(s)</span>
                  <span className="flex gap-1.5 flex-wrap justify-end">
                    {(eq.volume_por_tipo || []).map(v => (
                      <span key={v.tipo} className="bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
                        {v.total} {v.unidade}
                      </span>
                    ))}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* O.S sem equipe (aparecem no total, mas não em um card) */}
      {temSemEquipe && (
        <p className="text-[11px] font-semibold text-slate-500 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          O.S sem equipe vinculada: abertas {semEquipe.backlog} · concluídas {semEquipe.concluidas} · canceladas {semEquipe.canceladas}.
        </p>
      )}

      {/* Rankings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
          <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
            <Trophy size={15} className="text-amber-500" /> Produção do mês — O.S concluídas
          </h4>
          {rankingProducao.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">Nenhuma O.S concluída neste mês.</p>
          ) : (
            <div className="space-y-2.5">
              {rankingProducao.map((eq, i) => (
                <BarraRanking
                  key={eq.id}
                  rotulo={`${i + 1}º ${eq.numero ? `· Nº ${eq.numero} ` : ''}${eq.nome}`}
                  detalhe={`${eq.concluidas} O.S`}
                  valor={eq.concluidas}
                  maximo={maxProducao}
                  cor={i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-orange-400' : 'bg-primary-500'}
                />
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <Boxes size={15} className="text-primary-600" /> Volume aplicado ({unidadeVolume})
            </h4>
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              {TIPOS_SERVICO_OPCOES.map(op => (
                <button
                  key={op.valor}
                  onClick={() => setContratoVolume(op.valor)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                    contratoVolume === op.valor ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {op.rotulo}
                </button>
              ))}
            </div>
          </div>
          {rankingVolume.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              Nenhum serviço aplicado em {ROTULOS_TIPO_SERVICO[contratoVolume]} neste mês.
            </p>
          ) : (
            <div className="space-y-2.5">
              {rankingVolume.map((item, i) => (
                <BarraRanking
                  key={item.equipe.id}
                  rotulo={`${i + 1}º ${item.equipe.numero ? `· Nº ${item.equipe.numero} ` : ''}${item.equipe.nome}`}
                  detalhe={`${item.volume.total} ${item.volume.unidade}`}
                  valor={item.volume.total}
                  maximo={maxVolume}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Evolução */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
          <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
            <BarChart3 size={15} className="text-primary-600" /> Concluídas por dia — {rotuloMes(mes)}
          </h4>
          {serieDia.every(v => v === 0) ? (
            <p className="text-xs text-slate-400 py-6 text-center">Nenhuma conclusão registrada neste mês.</p>
          ) : (
            <>
              <div className="flex items-end gap-[3px] h-28">
                {serieDia.map((valor, i) => (
                  <div key={i} className="flex-1 h-full flex items-end" title={`Dia ${i + 1}: ${valor} concluída(s)`}>
                    <div
                      className={`w-full rounded-t-sm ${valor > 0 ? 'bg-primary-500' : 'bg-slate-100'}`}
                      style={{ height: valor > 0 ? `${Math.max(6, (valor / maxDia) * 100)}%` : '3px' }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[9px] font-bold text-slate-400">
                <span>1</span><span>10</span><span>20</span><span>{serieDia.length}</span>
              </div>
            </>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
          <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
            <BarChart3 size={15} className="text-primary-600" /> Últimos 6 meses
          </h4>
          <div className="flex items-end gap-2 h-28">
            {meses.map(m => {
              const total = m.concluidas + m.canceladas;
              const altura = total > 0 ? Math.max(8, (total / maxMes) * 100) : 3;
              const pctCanceladas = total > 0 ? (m.canceladas / total) * 100 : 0;
              return (
                <div
                  key={m.mes}
                  className="flex-1 h-full flex flex-col justify-end items-center gap-1"
                  title={`${rotuloMes(m.mes)}: ${m.concluidas} concluída(s), ${m.canceladas} cancelada(s)`}
                >
                  <span className="text-[9px] font-black text-slate-500">{m.concluidas}</span>
                  <div className="w-full rounded-t-sm overflow-hidden bg-emerald-500" style={{ height: `${altura}%` }}>
                    <div className="w-full bg-rose-400" style={{ height: `${pctCanceladas}%` }} />
                  </div>
                  <span className="text-[9px] font-bold text-slate-400 uppercase">
                    {(NOMES_MESES[Number(m.mes.slice(5)) - 1] || '').slice(0, 3)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500" /> Concluídas</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-400" /> Canceladas</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Obras (visão própria do Controle de O.S): cards com resumo da gestão por
// obra + cadastro em modal + gestão consolidada (PainelObra) ao abrir o card.
// ---------------------------------------------------------------------------

const excluirRegistro = async (url, msgOk, mostrarToast, recarregar) => {
  try {
    const res = await apiFetch(url, { method: 'DELETE' });
    const data = await res.json().catch(() => null);
    if (res.ok) { mostrarToast(data?.message || msgOk); recarregar(); }
    else mostrarToast(erroDaResposta(data, 'Erro ao excluir.'), 'error');
  } catch {
    mostrarToast('Erro de conexão.', 'error');
  }
};

function PainelObras({ obras, recarregar, mostrarToast, onNovaOS, onAbrirOS, refreshResumoKey }) {
  // Gestão consolidada por obra: painel lateral aberto a partir dos cards.
  const [obraAberta, setObraAberta] = useState(null);

  // Cadastro de obra em MODAL (padrão dos demais módulos): edicao preenche o modal.
  const [obraModalAberto, setObraModalAberto] = useState(false);
  const [obraModalEdicao, setObraModalEdicao] = useState(null); // obra em edição

  const [filtroObraLista, setFiltroObraLista] = useState('');
  const [excluirObraAlvo, setExcluirObraAlvo] = useState(null);

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

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <h3 className="font-extrabold text-slate-800 text-sm">Obras Cadastradas ({obrasFiltradas.length})</h3>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            {/* Barra de Busca */}
            <div className="relative w-full sm:max-w-sm">
              <input
                type="text"
                placeholder="Buscar obra..."
                value={filtroObraLista}
                onChange={e => setFiltroObraLista(e.target.value)}
                className="w-full pl-9 pr-8 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/15 bg-slate-50 focus:bg-white"
              />
              <Search size={14} className="absolute left-3 top-3 text-slate-400" />
              {filtroObraLista && (
                <button onClick={() => setFiltroObraLista('')} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600">
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              onClick={() => setObraModalAberto(true)}
              className="flex items-center justify-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all cursor-pointer shadow-sm shrink-0"
            >
              <Plus size={14} /> Nova Obra
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[450px] overflow-y-auto pr-1">
          {obrasFiltradas.length === 0 ? (
            <div className="col-span-full text-center text-xs text-slate-400 py-12">Nenhuma obra encontrada.</div>
          ) : (
            obrasFiltradas.map(o => (
              <div
                key={o.id}
                onClick={() => setObraAberta(o)}
                title="Abrir a gestão da obra"
                className="group relative flex flex-col gap-1 text-xs bg-slate-50 hover:bg-slate-100/70 rounded-xl p-2.5 border border-slate-200 hover:border-primary-300 transition-all cursor-pointer select-none"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-extrabold text-slate-800 break-words leading-tight">{o.nome}</span>
                  <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setObraModalEdicao(o);
                        setObraModalAberto(true);
                      }}
                      className="text-slate-400 hover:text-primary-600 cursor-pointer p-1 rounded hover:bg-white border hover:border-slate-200"
                      title="Editar obra"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExcluirObraAlvo(o);
                      }}
                      className="text-slate-400 hover:text-rose-600 cursor-pointer p-1 rounded hover:bg-white border hover:border-slate-200"
                      title="Excluir obra"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-slate-500 font-semibold mt-0.5">
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

                {/* Resumo da gestão por obra: contagem de O.S e totais por contrato */}
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  {o.os_total > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-slate-200 text-[10px] font-extrabold text-slate-600 whitespace-nowrap">
                      <ClipboardList size={10} className="text-primary-600" />
                      {o.os_total} O.S
                      {o.os_ativas > 0 && <span className="text-sky-600">· {o.os_ativas} em execução</span>}
                      {o.os_encerradas > 0 && <span className="text-slate-400">· {o.os_encerradas} encerradas</span>}
                    </span>
                  )}
                  {(o.totais_por_tipo || []).map(t => (
                    <span
                      key={t.tipo}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-extrabold whitespace-nowrap ${
                        t.unidade === 'USC'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-violet-50 text-violet-700 border-violet-200'
                      }`}
                      title={`Total aplicado em ${t.unidade} (O.S em execução e concluídas)`}
                    >
                      {Number(t.total || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {t.unidade}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Formulário de obra em modal (padrão dos demais módulos) */}
        {obraModalAberto && (
          <ModalObraCadastro
            edicao={obraModalEdicao}
            recarregar={recarregar}
            mostrarToast={mostrarToast}
            onFechar={() => { setObraModalAberto(false); setObraModalEdicao(null); }}
          />
        )}
      </div>

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
            await excluirRegistro(`${API_URL}/os/obras/${excluirObraAlvo.id}`, 'Obra excluída.', mostrarToast, recarregar);
            setExcluirObraAlvo(null);
          }
        }}
        onCancelar={() => setExcluirObraAlvo(null)}
      />

      {/* Painel de gestão consolidada da obra (drawer/full-screen) */}
      {obraAberta && (
        <PainelObra
          obra={obraAberta}
          onFechar={() => setObraAberta(null)}
          onAbrirOS={onAbrirOS}
          onNovaOS={onNovaOS}
          refreshResumoKey={refreshResumoKey}
          mostrarToast={mostrarToast}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cadastros de apoio (Equipes, Produtos) — CRUD compacto
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

function PainelCadastros({ equipes, produtos, recarregar, mostrarToast }) {
  const [abaAtiva, setAbaAtiva] = useState('equipes');

  // Cadastros em MODAL (padrão dos demais módulos): edicao preenche o modal.
  const [equipeModalAberto, setEquipeModalAberto] = useState(false);
  const [equipeModalEdicao, setEquipeModalEdicao] = useState(null); // equipe em edição
  const [produtoModalAberto, setProdutoModalAberto] = useState(false);
  const [produtoModalEdicao, setProdutoModalEdicao] = useState(null); // serviço em edição

  // Equipes
  const [filtroEquipeLista, setFiltroEquipeLista] = useState('');
  const [excluirEquipeAlvo, setExcluirEquipeAlvo] = useState(null);
  // Impressão de O.S em branco (emergência): modal aberto + equipe pré-selecionada.
  const [imprimirBrancoAberto, setImprimirBrancoAberto] = useState(false);
  const [imprimirBrancoEquipe, setImprimirBrancoEquipe] = useState(null);

  // Produtos (serviços por contrato) — catálogos INDIVIDUAIS (sem "Todos")
  const [filtroProdutoLista, setFiltroProdutoLista] = useState('');
  const [filtroTipoProduto, setFiltroTipoProduto] = useState(TIPO_PADRAO_OS);
  const [excluirProdutoAlvo, setExcluirProdutoAlvo] = useState(null);

  // Importação em lote de serviços (.xlsx) — contrato fixo escolhido na tela.
  const [modalImportar, setModalImportar] = useState(false);
  const [impContrato, setImpContrato] = useState(TIPO_PADRAO_OS);
  const [impArquivo, setImpArquivo] = useState(null); // arquivo validado (aguardando confirmação)
  const [impResumo, setImpResumo] = useState(null);   // {resumo, contrato} da simulação
  const [impProcessando, setImpProcessando] = useState(false);
  const inputImportRef = useRef(null);

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
    // Filtro ESTRITO por contrato ativo: cada contrato tem o seu catálogo;
    // legados (sem tipo) valem para todos os contratos.
    lista = lista.filter(p => servicoServeParaTipo(p, filtroTipoProduto));
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

  // --- Importação em lote de serviços (.xlsx) ---

  const baixarModeloServicos = async () => {
    try {
      // O modelo traz os rótulos do contrato selecionado na aba (USC/UMD/ULV).
      const res = await apiFetch(`${API_URL}/os/produtos/modelo?tipo=${encodeURIComponent(filtroTipoProduto)}`);
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
    setImpContrato(filtroTipoProduto);
    if (inputImportRef.current) inputImportRef.current.value = '';
  };

  const ABAS = [
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

      {/* Conteúdo Aba EQUIPES */}
      {abaAtiva === 'equipes' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
            <h3 className="font-extrabold text-slate-800 text-sm">Equipes Cadastradas ({equipesFiltradas.length})</h3>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
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
              <button
                onClick={() => { setImprimirBrancoEquipe(null); setImprimirBrancoAberto(true); }}
                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all cursor-pointer shrink-0"
                title="Imprimir O.S em branco (emergência) com os membros da equipe"
              >
                <Printer size={14} /> Imprimir em branco
              </button>
              <button
                onClick={() => setEquipeModalAberto(true)}
                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all cursor-pointer shadow-sm shrink-0"
              >
                <Plus size={14} /> Nova Equipe
              </button>
            </div>
          </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[450px] overflow-y-auto pr-1">
              {equipesFiltradas.length === 0 ? (
                <div className="col-span-full text-center text-xs text-slate-400 py-12">Nenhuma equipe encontrada.</div>
              ) : (
                equipesFiltradas.map(eq => (
                  <div key={eq.id} className="group relative flex flex-col gap-2 text-xs bg-slate-50 hover:bg-slate-100/70 rounded-xl p-2.5 border border-slate-200 hover:border-primary-300 transition-all">
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
                          onClick={(e) => {
                            e.stopPropagation();
                            setImprimirBrancoEquipe(eq);
                            setImprimirBrancoAberto(true);
                          }}
                          className="text-slate-400 hover:text-primary-600 cursor-pointer p-1 rounded hover:bg-white border hover:border-slate-200"
                          title="Imprimir O.S em branco desta equipe"
                        >
                          <Printer size={11} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEquipeModalEdicao(eq);
                            setEquipeModalAberto(true);
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

            {/* Formulário de equipe em modal (padrão dos demais módulos) */}
            {equipeModalAberto && (
              <ModalEquipeCadastro
                edicao={equipeModalEdicao}
                recarregar={recarregar}
                mostrarToast={mostrarToast}
                onFechar={() => { setEquipeModalAberto(false); setEquipeModalEdicao(null); }}
              />
            )}

            {/* Impressão de O.S em branco (emergência/fim de semana) */}
            {imprimirBrancoAberto && (
              <ModalImprimirBranco
                equipes={equipes}
                equipeInicial={imprimirBrancoEquipe}
                mostrarToast={mostrarToast}
                onFechar={() => { setImprimirBrancoAberto(false); setImprimirBrancoEquipe(null); }}
              />
            )}
          </div>
      )}

      {/* Conteúdo Aba PRODUTOS */}
      {abaAtiva === 'produtos' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
            <h3 className="font-extrabold text-slate-800 text-sm">Serviços ({produtosFiltrados.length})</h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setProdutoModalAberto(true)}
                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-xl text-[10px] font-bold hover:bg-primary-700 transition-all cursor-pointer shadow-sm"
              >
                <Plus size={14} /> Novo Serviço
              </button>
              {/* Ações de importação em lote */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={baixarModeloServicos}
                  title={`Baixar modelo .xlsx do catálogo de ${ROTULOS_TIPO_SERVICO[filtroTipoProduto] || filtroTipoProduto}`}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-[10px] font-bold hover:bg-slate-50 transition-all cursor-pointer"
                >
                  <FileSpreadsheet size={13} />
                  Modelo
                </button>
                <button
                  type="button"
                  onClick={() => { setModalImportar(true); setImpContrato(filtroTipoProduto); setImpResumo(null); setImpArquivo(null); }}
                  title="Cadastrar serviços em lote (.xlsx)"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-[10px] font-bold hover:bg-slate-50 transition-all cursor-pointer"
                >
                  <Upload size={13} />
                  Importar em lote
                </button>
              </div>
                {/* Filtro por contrato (catálogos individuais) */}
                <div className="flex bg-slate-100 rounded-xl p-1">
                  {TIPOS_SERVICO_OPCOES.map(({ valor, rotulo }) => (
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

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[450px] overflow-y-auto pr-1">
              {produtosFiltrados.length === 0 ? (
                <div className="col-span-full text-center text-xs text-slate-400 py-12">Nenhum serviço encontrado.</div>
              ) : (
                produtosFiltrados.map(p => (
                  <div key={p.id} className="group relative flex flex-col gap-1 text-xs bg-slate-50 hover:bg-slate-100/70 rounded-xl p-2.5 border border-slate-200 hover:border-primary-300 transition-all">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-extrabold text-slate-800 break-words leading-tight">{p.nome}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setProdutoModalEdicao(p);
                            setProdutoModalAberto(true);
                          }}
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
                      Qtd {unidadeContrato(p.tipo || filtroTipoProduto)}: {p.preco_unitario} <span className="text-slate-400 font-normal">/ {p.unidade}</span>
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

            {/* Formulário de serviço em modal (padrão dos demais módulos) */}
            {produtoModalAberto && (
              <ModalProdutoCadastro
                edicao={produtoModalEdicao}
                contratoAtual={filtroTipoProduto}
                recarregar={recarregar}
                mostrarToast={mostrarToast}
                onFechar={() => { setProdutoModalAberto(false); setProdutoModalEdicao(null); }}
              />
            )}
          </div>
      )}

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
            await excluirRegistro(`${API_URL}/os/equipes/${excluirEquipeAlvo.id}`, 'Equipe excluída.', mostrarToast, recarregar);
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
            await excluirRegistro(`${API_URL}/os/produtos/${excluirProdutoAlvo.id}`, 'Serviço excluído.', mostrarToast, recarregar);
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
                  {TIPOS_SERVICO_OPCOES.map(({ valor, rotulo }) => (
                    <option key={valor} value={valor}>{rotulo}</option>
                  ))}
                </select>
                <p className="text-[10px] font-semibold text-slate-400 mt-1">
                  Vale para todas as linhas do arquivo. Os fatores são lidos como &quot;Qtd{' '}
                  {unidadeContrato(impContrato)}&quot; — baixe o modelo pelo botão &quot;Modelo&quot; para conferir as
                  colunas.
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

// ---------------------------------------------------------------------------
// Cadastro de Obra em MODAL (padrão dos demais módulos): abre sobre a lista,
// carrega os clientes ao abrir (autocomplete) e vincula automaticamente o
// cliente ao digitar a Nota PS (preenche cidade/endereço do cadastro).
// ---------------------------------------------------------------------------
function ModalObraCadastro({ edicao, recarregar, mostrarToast, onFechar }) {
  const vazio = () => ({ nome: '', cliente_id: '', cliente_celesc: '', cidade: '', endereco: '' });
  const [novaObra, setNovaObra] = useState(() => edicao
    ? {
        nome: edicao.nome || '',
        cliente_id: String(edicao.cliente_id || ''),
        cliente_celesc: edicao.cliente_celesc || '',
        cidade: edicao.cidade || '',
        endereco: edicao.endereco || '',
      }
    : vazio());
  const [obraCelesc, setObraCelesc] = useState(!!(edicao && edicao.cliente_celesc && !edicao.cliente_id));
  const [listaClientes, setListaClientes] = useState([]);
  const [clienteAuto, setClienteAuto] = useState(null); // cliente encontrado pela Nota PS
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    apiFetch(`${API_URL}/clientes/`)
      .then(res => (res.ok ? res.json() : []))
      .then(setListaClientes)
      .catch(() => setListaClientes([]));
  }, []);

  // Autopreenchimento por Nota PS (vale só na criação com "Cliente do cadastro").
  useEffect(() => {
    if (obraCelesc || edicao) {
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
  }, [novaObra.nome, listaClientes, obraCelesc, edicao]);

  const salvar = async () => {
    if (!novaObra.nome) { mostrarToast('Informe a Nota PS.', 'error'); return; }
    if (obraCelesc) {
      if (!(novaObra.cliente_celesc || '').trim()) { mostrarToast('Informe o Cliente Celesc (nome/contrato da obra).', 'error'); return; }
    } else if (!novaObra.cliente_id) {
      mostrarToast('Selecione o cliente do cadastro ou mude para "Cliente Celesc".', 'error');
      return;
    }
    setSalvando(true);
    try {
      const payload = {
        nome: novaObra.nome,
        cliente_id: obraCelesc ? null : Number(novaObra.cliente_id),
        cliente_celesc: obraCelesc ? (novaObra.cliente_celesc || '').trim() || null : null,
        cidade: novaObra.cidade || null,
        endereco: novaObra.endereco || null,
      };
      const res = await apiFetch(edicao ? `${API_URL}/os/obras/${edicao.id}` : `${API_URL}/os/obras`, {
        method: edicao ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        mostrarToast(erroDaResposta(data, 'Erro ao salvar.'), 'error');
        return;
      }
      mostrarToast(edicao ? 'Obra atualizada.' : 'Obra criada.');
      recarregar();
      onFechar();
    } catch {
      mostrarToast('Erro de conexão.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden max-h-[92vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between sticky top-0">
          <h3 className="text-sm font-extrabold">{edicao ? 'Editar Obra' : 'Nova Obra'}</h3>
          <button type="button" onClick={onFechar} className="text-slate-400 hover:text-white cursor-pointer"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-3">
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
            {!obraCelesc && !clienteAuto && !edicao && (novaObra.nome || '').trim().length >= 3 && (
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
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onFechar}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all cursor-pointer disabled:opacity-50"
          >
            {salvando ? 'Salvando...' : (edicao ? 'Salvar Alterações' : 'Cadastrar Obra')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cadastro de Equipe em MODAL (nome, número e composição de membros/líder).
// ---------------------------------------------------------------------------
function ModalEquipeCadastro({ edicao, recarregar, mostrarToast, onFechar }) {
  const vazio = () => ({ nome: '', numero: '', membros: [], lider: '' });
  const [novaEquipe, setNovaEquipe] = useState(() => edicao
    ? {
        nome: edicao.nome || '',
        numero: edicao.numero || '',
        membros: (edicao.membros || []).map(m => String(m.funcionario_id)),
        lider: String((edicao.membros || []).find(m => m.lider)?.funcionario_id || ''),
      }
    : vazio());
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    if (!novaEquipe.nome) { mostrarToast('Informe o nome da equipe.', 'error'); return; }
    if (!novaEquipe.numero) { mostrarToast('Informe o número da equipe.', 'error'); return; }
    setSalvando(true);
    try {
      const payload = {
        nome: novaEquipe.nome,
        numero: novaEquipe.numero || null,
        membro_ids: novaEquipe.membros.map(Number),
        lider_id: novaEquipe.lider ? Number(novaEquipe.lider) : null,
      };
      const res = await apiFetch(edicao ? `${API_URL}/os/equipes/${edicao.id}` : `${API_URL}/os/equipes`, {
        method: edicao ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        mostrarToast(erroDaResposta(data, 'Erro ao salvar.'), 'error');
        return;
      }
      mostrarToast(edicao ? 'Equipe atualizada.' : 'Equipe criada.');
      recarregar();
      onFechar();
    } catch {
      mostrarToast('Erro de conexão.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden max-h-[92vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between sticky top-0">
          <h3 className="text-sm font-extrabold">{edicao ? 'Editar Equipe' : 'Nova Equipe'}</h3>
          <button type="button" onClick={onFechar} className="text-slate-400 hover:text-white cursor-pointer"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-3">
          <CampoTexto label="Nome da equipe *" value={novaEquipe.nome} onChange={e => setNovaEquipe({ ...novaEquipe, nome: e.target.value })} />
          <CampoTexto label="Número da equipe * (impresso no modelo de O.S)" value={novaEquipe.numero} onChange={e => setNovaEquipe({ ...novaEquipe, numero: e.target.value })} />
          <MembrosEquipePicker
            membros={novaEquipe.membros}
            lider={novaEquipe.lider}
            onChange={(membros, lider) => setNovaEquipe({ ...novaEquipe, membros, lider })}
          />
        </div>
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onFechar}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all cursor-pointer disabled:opacity-50"
          >
            {salvando ? 'Salvando...' : (edicao ? 'Salvar Alterações' : 'Cadastrar Equipe')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Impressão da O.S no modo gestor: permite anexar a Solicitação de
// Desligamento (Celesc) ao PDF do modelo, escolhendo manualmente o
// substituto entre os demais membros da equipe (nunca o encarregado).
// Nada é gravado no sistema — a escolha vale só para esta impressão.
// ---------------------------------------------------------------------------
function ModalImprimirOS({ detalhe, equipes, abrirPdf, mostrarToast, onFechar }) {
  const [incluirDesligamento, setIncluirDesligamento] = useState(false);
  const [substitutoId, setSubstitutoId] = useState('');

  const equipe = (equipes || []).find(eq => String(eq.id) === String(detalhe?.equipe_id));
  const membros = equipe?.membros || [];
  const encarregado = membros.find(m => m.lider);
  const substitutos = membros.filter(m => !m.lider);
  const semEquipe = !detalhe?.equipe_id;

  const gerar = () => {
    if (incluirDesligamento && semEquipe) {
      mostrarToast('Vincule uma equipe à O.S para incluir a Solicitação de Desligamento.', 'error');
      return;
    }
    const params = new URLSearchParams();
    if (incluirDesligamento) {
      params.set('incluir_desligamento', 'true');
      if (substitutoId) params.set('substituto_id', substitutoId);
    }
    const query = params.toString();
    abrirPdf(`/os/${detalhe.id}/imprimir${query ? `?${query}` : ''}`);
    onFechar();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden max-h-[92vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between sticky top-0">
          <h3 className="text-sm font-extrabold">Imprimir O.S</h3>
          <button type="button" onClick={onFechar} className="text-slate-400 hover:text-white cursor-pointer"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-xs font-bold text-slate-700">{detalhe?.codigo} · {detalhe?.obras?.nome || 'Sem obra'}</p>
            <p className="text-[11px] text-slate-500 mt-1">
              Equipe: {detalhe?.equipes ? (detalhe.equipes.numero ? `Nº ${detalhe.equipes.numero} - ${detalhe.equipes.nome}` : detalhe.equipes.nome) : 'sem equipe'}
            </p>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 cursor-pointer hover:bg-slate-50 transition-colors">
            <input
              type="checkbox"
              checked={incluirDesligamento}
              onChange={e => setIncluirDesligamento(e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-primary-600 cursor-pointer"
            />
            <span>
              <span className="block text-xs font-bold text-slate-700">Incluir Solicitação de Desligamento</span>
              <span className="block text-[11px] text-slate-500 mt-0.5">
                Anexa a folha da Celesc como última página do PDF. Puxa agência, obra, local, município,
                data, desligar/religar, alimentador, FuChave, equipe e encarregado da O.S.
              </span>
            </span>
          </label>

          {incluirDesligamento && semEquipe && (
            <p className="text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5">
              Esta O.S não tem equipe vinculada. Edite a O.S e selecione a equipe para imprimir a Solicitação de Desligamento.
            </p>
          )}

          {incluirDesligamento && !semEquipe && (
            <div className="space-y-3">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs">
                <p className="font-bold text-slate-700 mb-1">Serão impressos no desligamento:</p>
                <p className="text-slate-600">
                  Encarregado: <span className="font-semibold">{encarregado?.nome || '—'}</span>
                </p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Substituto (opcional)</label>
                <select
                  value={substitutoId}
                  onChange={e => setSubstitutoId(e.target.value)}
                  disabled={substitutos.length === 0}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 bg-white disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <option value="">— Sem substituto —</option>
                  {substitutos.map(m => (
                    <option key={m.funcionario_id || m.id} value={String(m.funcionario_id)}>{m.nome}</option>
                  ))}
                </select>
                {substitutos.length === 0 && (
                  <p className="text-[10px] font-semibold text-slate-400 mt-1">
                    Nenhum outro membro na equipe além do encarregado.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onFechar}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={gerar}
            disabled={incluirDesligamento && semEquipe}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all cursor-pointer disabled:opacity-50"
          >
            <Printer size={14} /> Gerar PDF
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Impressão de O.S em branco (emergência/fim de semana): o modelo oficial sai
// com os campos vazios, imprimindo apenas equipe, encarregado e membros.
// Nada é gravado no sistema — serve para o encarregado preencher à mão.
// ---------------------------------------------------------------------------
function ModalImprimirBranco({ equipes, equipeInicial, mostrarToast, onFechar }) {
  const [equipeId, setEquipeId] = useState(() => String(equipeInicial?.id || ''));
  const [tipo, setTipo] = useState(TIPO_PADRAO_OS);
  const [gerando, setGerando] = useState(false);

  const equipe = equipes.find(eq => String(eq.id) === equipeId);
  const membros = equipe?.membros || [];
  const encarregado = membros.find(m => m.lider);

  const imprimir = async () => {
    if (!equipeId) { mostrarToast('Selecione a equipe.', 'error'); return; }
    // Abre a aba antes do fetch (evita bloqueio de popup).
    const janela = window.open('', '_blank');
    setGerando(true);
    try {
      const params = new URLSearchParams({ equipe_id: equipeId, tipo });
      const res = await apiFetch(`${API_URL}/os/imprimir-branco?${params.toString()}`);
      if (!res.ok) {
        janela?.close();
        mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao gerar a O.S em branco.'), 'error');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      janela?.location.replace(url);
      // A aba nova navegou para a blob URL; revoga após um tempo de segurança.
      setTimeout(() => window.URL.revokeObjectURL(url), 120000);
      onFechar();
    } catch {
      janela?.close();
      mostrarToast('Erro de conexão ao gerar a O.S em branco.', 'error');
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden max-h-[92vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between sticky top-0">
          <h3 className="text-sm font-extrabold">Imprimir O.S em Branco</h3>
          <button type="button" onClick={onFechar} className="text-slate-400 hover:text-white cursor-pointer"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-xs text-slate-500">
            Modelo oficial em branco para preenchimento manual (emergências/fins de semana).
            Sai impresso apenas o número da equipe, o encarregado e a tabela de membros.
            Nada é gravado no sistema.
          </p>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Equipe *</label>
            <select
              value={equipeId}
              onChange={e => setEquipeId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 bg-white"
            >
              <option value="">Selecione a equipe...</option>
              {equipes.map(eq => (
                <option key={eq.id} value={String(eq.id)}>
                  {eq.nome}{eq.numero ? ` (Nº ${eq.numero})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Tipo de O.S *</label>
            <select
              value={tipo}
              onChange={e => setTipo(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 bg-white"
            >
              {TIPOS_SERVICO_OPCOES.map(op => (
                <option key={op.valor} value={op.valor}>{op.rotulo}</option>
              ))}
            </select>
          </div>
          {equipe && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs">
              <p className="font-bold text-slate-700 mb-1">Serão impressos no modelo:</p>
              <p className="text-slate-600">
                Encarregado: <span className="font-semibold">{encarregado?.nome || '—'}</span>
              </p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {membros.length ? membros.map(m => (
                  <span
                    key={m.id}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                      m.lider
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    {m.nome} {m.lider && '★'}
                  </span>
                )) : (
                  <span className="text-slate-400 italic">
                    Nenhum membro vinculado — o modelo sairá sem a tabela de membros.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onFechar}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={imprimir}
            disabled={gerando || !equipeId}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all cursor-pointer disabled:opacity-50"
          >
            <Printer size={14} /> {gerando ? 'Gerando PDF...' : 'Imprimir em branco'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cadastro de Serviço (produto do catálogo) em MODAL.
// ---------------------------------------------------------------------------
function ModalProdutoCadastro({ edicao, contratoAtual, recarregar, mostrarToast, onFechar }) {
  const vazio = () => ({ nome: '', codigo: '', codigo_especial: '', unidade: 'UN', preco_unitario: '', qtd_usc_especial: '', tipo: '' });
  const [novoProduto, setNovoProduto] = useState(() => edicao
    ? {
        nome: edicao.nome || '',
        codigo: edicao.codigo || '',
        codigo_especial: edicao.codigo_especial || '',
        unidade: edicao.unidade || 'UN',
        preco_unitario: edicao.preco_unitario != null ? String(edicao.preco_unitario) : '',
        qtd_usc_especial: edicao.qtd_usc_especial != null ? String(edicao.qtd_usc_especial) : '',
        tipo: edicao.tipo || '',
      }
    : vazio());
  const [salvando, setSalvando] = useState(false);
  const contratoRotulo = unidadeContrato(novoProduto.tipo || contratoAtual);

  const salvar = async () => {
    if (!novoProduto.nome) { mostrarToast('Informe o nome do serviço.', 'error'); return; }
    if (!novoProduto.tipo) { mostrarToast('Selecione o contrato do serviço.', 'error'); return; }
    setSalvando(true);
    try {
      const corpo = {
        nome: novoProduto.nome,
        codigo: novoProduto.codigo || null,
        codigo_especial: novoProduto.codigo_especial || null,
        unidade: novoProduto.unidade || 'UN',
        preco_unitario: Number(novoProduto.preco_unitario || 0),
        qtd_usc_especial: Number(novoProduto.qtd_usc_especial || 0),
        tipo: novoProduto.tipo,
      };
      const res = await apiFetch(edicao ? `${API_URL}/os/produtos/${edicao.id}` : `${API_URL}/os/produtos`, {
        method: edicao ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        mostrarToast(erroDaResposta(data, 'Erro ao salvar.'), 'error');
        return;
      }
      mostrarToast(edicao ? 'Serviço atualizado.' : 'Serviço criado.');
      recarregar();
      onFechar();
    } catch {
      mostrarToast('Erro de conexão.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden max-h-[92vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between sticky top-0">
          <h3 className="text-sm font-extrabold">{edicao ? 'Editar Serviço' : 'Novo Serviço'}</h3>
          <button type="button" onClick={onFechar} className="text-slate-400 hover:text-white cursor-pointer"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-3">
          <CampoTexto label="Serviço *" value={novoProduto.nome} onChange={e => setNovoProduto({ ...novoProduto, nome: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <CampoTexto
              label="Código normal"
              placeholder={`Bipagem do ${contratoRotulo} normal`}
              value={novoProduto.codigo}
              onChange={e => setNovoProduto({ ...novoProduto, codigo: e.target.value })}
            />
            <CampoTexto
              label="Código especial"
              placeholder={`Bipagem do ${contratoRotulo} especial`}
              value={novoProduto.codigo_especial}
              onChange={e => setNovoProduto({ ...novoProduto, codigo_especial: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <CampoTexto label="Unidade" value={novoProduto.unidade} onChange={e => setNovoProduto({ ...novoProduto, unidade: e.target.value })} />
            <CampoTexto
              label={`Qtd ${contratoRotulo}`}
              type="number" step="0.01" min="0" value={novoProduto.preco_unitario}
              onChange={e => setNovoProduto({ ...novoProduto, preco_unitario: e.target.value })}
            />
          </div>
          <CampoTexto
            label={`Qtd ${contratoRotulo} especial`}
            type="number" step="0.01" min="0" value={novoProduto.qtd_usc_especial}
            onChange={e => setNovoProduto({ ...novoProduto, qtd_usc_especial: e.target.value })}
          />
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Contrato *</label>
            <select
              value={novoProduto.tipo}
              onChange={e => setNovoProduto({ ...novoProduto, tipo: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold bg-white"
            >
              <option value="">Selecione o contrato...</option>
              {TIPOS_SERVICO_OPCOES.map(({ valor, rotulo }) => (
                <option key={valor} value={valor}>{rotulo}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onFechar}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all cursor-pointer disabled:opacity-50"
          >
            {salvando ? 'Salvando...' : (edicao ? 'Salvar Alterações' : 'Cadastrar Serviço')}
          </button>
        </div>
      </div>
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

// Reabertura de O.S concluída/cancelada (gestor): pede justificativa, que fica
// registrada no histórico como auditoria (decisão de negócio nº 2).
function ModalReabrirOS({ aberto, os, processando, onConfirmar, onCancelar }) {
  const [justificativa, setJustificativa] = useState('');

  useEffect(() => {
    if (aberto) setJustificativa('');
  }, [aberto]);

  if (!aberto) return null;
  const valido = justificativa.trim().length >= 10;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
          <h3 className="font-bold text-base flex items-center gap-2">
            <RefreshCw size={18} className="text-amber-400" />
            Reabrir O.S {os?.codigo || ''}
          </h3>
          <button
            onClick={onCancelar}
            disabled={processando}
            className="text-slate-400 hover:text-white text-xl font-bold p-1 cursor-pointer disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-6">
          <p className="text-sm text-slate-600 mb-3">
            A O.S volta para o quadro como <b>aberta</b>. Informe o motivo da reabertura
            (fica registrado no histórico).
          </p>
          <textarea
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Motivo da reabertura (mínimo 10 caracteres)..."
            className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-amber-500 resize-none"
          />
          <p className="text-[10px] font-semibold text-slate-400 mt-1">
            {justificativa.trim().length}/10 caracteres mínimos
          </p>
          <div className="flex justify-end gap-3 pt-5 border-t border-slate-100 mt-5">
            <button
              type="button"
              onClick={onCancelar}
              disabled={processando}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onConfirmar(justificativa.trim())}
              disabled={!valido || processando}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-semibold transition-all shadow-md cursor-pointer disabled:opacity-40 flex items-center gap-2"
            >
              {processando ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Aguarde...
                </>
              ) : (
                'Reabrir O.S'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OrdensServico;
