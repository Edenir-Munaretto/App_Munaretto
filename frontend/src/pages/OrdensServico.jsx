import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  Plus, Search, X, Play, Pause, Camera, Package, ClipboardList, MapPin,
  AlertTriangle, Check, Clock, CalendarClock, Copy, FileDown, LayoutGrid,
  FolderKanban, HardHat, Boxes, Trash2, ChevronLeft, Image as ImageIcon,
  Pencil, Building, Printer,
} from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';
import ModalConfirmacao from '../components/ModalConfirmacao';

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

// Redimensiona/comprime a imagem ANTES do upload (canvas no navegador):
// reduz fotos de celular para no máx. 1600px e converte para JPEG ~82%,
// economizando armazenamento no B2 e tempo de envio no campo.
async function comprimirImagem(arquivo, maxLado = 1600, qualidade = 0.82) {
  if (!arquivo || !arquivo.type || !arquivo.type.startsWith('image/')) return arquivo;
  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    if (escala >= 1) {
      bitmap.close();
      return arquivo; // já pequena o suficiente
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualidade));
    if (!blob) return arquivo;
    return new File([blob], arquivo.name.replace(/\.(png|webp)$/i, '.jpg') || 'foto.jpg', { type: 'image/jpeg' });
  } catch {
    return arquivo; // fallback: envia o original
  }
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
  return (
    <div className={`fixed top-4 right-4 z-[60] p-4 rounded-xl shadow-xl flex items-center gap-3 border text-sm max-w-sm animate-in slide-in-from-top-4 duration-300 ${
      toast.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
    }`}>
      <div className={`p-1 rounded-full ${toast.type === 'error' ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>
        {toast.type === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}
      </div>
      <p className="font-semibold">{toast.message}</p>
    </div>
  );
}

function BarraMateriais({ os }) {
  const orc = os.custo_materiais_orcado;
  const apl = os.custo_materiais_aplicado;
  const perc = os.perc_materiais;
  if (!orc && !apl) return null;
  const estourou = perc != null && perc > 100;
  return (
    <div className="mt-2">
      <div className="flex justify-between text-[10px] font-semibold text-slate-500">
        <span>Materiais</span>
        <span>{brl(apl)} {orc ? `/ ${brl(orc)}` : '(sem orçado)'}</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-0.5">
        <div
          className={`h-full rounded-full transition-all ${estourou ? 'bg-rose-500' : 'bg-primary-500'}`}
          style={{ width: `${Math.min(perc ?? 100, 100)}%` }}
        />
      </div>
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
      <p className="text-xs text-slate-400">{os.obras?.clientes?.nome || ''}</p>

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

// ---------------------------------------------------------------------------
// Abas compartilhadas entre o drawer do gestor e a tela de campo (mobile)
// ---------------------------------------------------------------------------

function TabInsumos({ osDetalhe, produtos, onAtualizado, mostrarToast, podeEditar, podeEstornar }) {
  const [buscaProduto, setBuscaProduto] = useState('');
  const [qtd, setQtd] = useState(1);
  const [salvando, setSalvando] = useState(false);
  const [estornandoId, setEstornandoId] = useState(null); // ID do lançamento aguardando confirmação

  // Autocompletar: filtra o catálogo local pelo que foi digitado/bipado.
  const sugestoes = useMemo(() => {
    const termo = buscaProduto.trim().toLowerCase();
    if (!termo) return [];
    return produtos
      .filter(p => p.nome.toLowerCase().includes(termo) || (p.codigo || '').toLowerCase().includes(termo))
      .slice(0, 6);
  }, [buscaProduto, produtos]);

  const selecionado = useMemo(
    () => produtos.find(p => p.id === Number(buscaProduto)) || null,
    [buscaProduto, produtos],
  );

  const lancar = async () => {
    const produto = selecionado || (sugestoes.length === 1 ? sugestoes[0] : null);
    if (!produto) {
      mostrarToast('Selecione um produto da lista.', 'error');
      return;
    }
    setSalvando(true);
    try {
      const res = await apiFetch(`${API_URL}/os/${osDetalhe.id}/materiais`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto_id: produto.id, quantidade_usada: qtd }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        mostrarToast(`Material "${produto.nome}" lançado.`);
        setBuscaProduto('');
        setQtd(1);
        onAtualizado();
      } else {
        mostrarToast(erroDaResposta(data, 'Erro ao lançar material.'), 'error');
      }
    } catch {
      mostrarToast('Erro de conexão ao lançar material.', 'error');
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
      {/* Busca rápida com autocompletar (bipagem ou digitação) */}
      <div className="relative">
        <label className="block text-xs font-bold text-slate-700 mb-1.5">Buscar material (nome ou código)</label>
        <input
          type="text"
          value={buscaProduto}
          onChange={(e) => setBuscaProduto(e.target.value)}
          placeholder="Bipe ou digite o nome..."
          disabled={!podeEditar}
          className="w-full px-3.5 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
        />
        {!selecionado && sugestoes.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
            {sugestoes.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => setBuscaProduto(String(p.id))}
                className="w-full text-left px-3 py-2.5 hover:bg-primary-50 text-sm text-slate-700 flex justify-between gap-2"
              >
                <span className="font-semibold truncate">{p.nome}</span>
                <span className="text-xs text-slate-400 shrink-0">{p.unidade} · {brl(p.preco_unitario)}</span>
              </button>
            ))}
          </div>
        )}
        {/* Feedback explícito quando não há produtos encontrados */}
        {!selecionado && buscaProduto.trim().length >= 2 && sugestoes.length === 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
            <p className="px-3 py-3 text-xs text-slate-400 text-center">Nenhum produto encontrado para “{buscaProduto}”</p>
          </div>
        )}
      </div>

      {/* Seletor numérico grande "+" e "-" */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!podeEditar}
          onClick={() => setQtd(q => Math.max(0.5, Number((q - (q > 1 ? 1 : 0.5)).toFixed(2))))}
          className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-2xl font-black flex items-center justify-center disabled:opacity-40 cursor-pointer"
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
          className="flex-1 h-12 text-center text-lg font-bold border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20"
        />
        <button
          type="button"
          disabled={!podeEditar}
          onClick={() => setQtd(q => Number((q + (q < 1 ? 0.5 : 1)).toFixed(2)))}
          className="w-12 h-12 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-2xl font-black flex items-center justify-center disabled:opacity-40 cursor-pointer"
        >
          +
        </button>
        <button
          type="button"
          onClick={lancar}
          disabled={!podeEditar || salvando}
          className="h-12 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-40 cursor-pointer"
        >
          <Package size={18} />{salvando ? 'Salvando...' : 'Aplicar'}
        </button>
      </div>
      {/* Saldo de material: mostra orçado / aplicado / saldo ao selecionar um produto */}
      {selecionado && (() => {
        const item = (osDetalhe.materiais?.itens || []).find(i => i.produto_id === selecionado.id);
        const orcado = item?.orcado ?? null;
        const aplicado = item?.aplicado ?? 0;
        const saldo = orcado !== null ? orcado - aplicado : null;
        const estourou = saldo !== null && saldo < 0;
        return (
          <div className={`rounded-xl border px-3 py-2 text-xs flex flex-wrap gap-3 items-center -mt-1 ${
            estourou ? 'bg-rose-50 border-rose-200' : 'bg-slate-50 border-slate-100'
          }`}>
            <span className="text-slate-500">Selecionado: <b className="text-slate-700">{selecionado.nome}</b> ({selecionado.unidade})</span>
            {orcado !== null && (
              <>
                <span className="text-slate-400">│</span>
                <span className="text-slate-500">Orçado: <b>{orcado}</b></span>
                <span className="text-slate-400">│</span>
                <span className="text-slate-500">Aplicado: <b>{aplicado}</b></span>
                <span className="text-slate-400">│</span>
                <span className={`font-bold ${estourou ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {estourou ? `⚠️ Excedido em ${Math.abs(saldo).toFixed(2)}` : `Saldo: ${saldo.toFixed(2)}`}
                </span>
              </>
            )}
          </div>
        );
      })()}

      {/* Comparativo Aplicado vs Orçado */}
      <div className="bg-slate-50 rounded-xl border border-slate-100 divide-y divide-slate-100">
        {(osDetalhe.materiais?.itens || []).map(item => (
          <div key={item.produto_id} className="px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-700 truncate">{item.nome}</p>
              <p className="text-xs text-slate-400">
                {item.aplicado} / {item.orcado || 0} {item.unidade}
                {item.perc_aplicado != null && ` (${item.perc_aplicado}%)`}
              </p>
            </div>
            <span className={`text-xs font-bold shrink-0 ${item.orcado && item.aplicado > item.orcado ? 'text-rose-600' : 'text-slate-500'}`}>
              {brl(item.custo_aplicado)}
            </span>
          </div>
        ))}
        {!(osDetalhe.materiais?.itens || []).length && (
          <p className="px-3 py-4 text-center text-xs text-slate-400">Nenhum material aplicado ainda.</p>
        )}
      </div>

      {/* Últimos lançamentos com opção de estorno */}
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase mb-1.5">Últimos lançamentos</p>
        <div className="space-y-1">
          {(osDetalhe.lancamentos || []).slice(0, 8).map(l => (
            <div key={l.id} className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
              <span className="text-xs text-slate-600 truncate">
                {fmtData(l.data_lancamento)} · {l.quantidade_usada} × {l.produtos?.nome || l.produto_nome || ''}
              </span>
              {podeEstornar && (
                <button onClick={() => setEstornandoId(l.id)} className="text-slate-300 hover:text-rose-600 cursor-pointer" title="Estornar">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          {!(osDetalhe.lancamentos || []).length && (
            <p className="text-xs text-slate-400">Sem lançamentos individuais.</p>
          )}
        </div>
      </div>

      {/* Confirmação de estorno */}
      <ModalConfirmacao
        aberto={estornandoId != null}
        titulo="Estornar lançamento"
        mensagem="Estornar este lançamento de material? Esta ação não pode ser desfeita."
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

function CronometroHH({ osDetalhe, geolocalizacao, capturarGps, onAtualizado, mostrarToast, podeEditar }) {
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

  const acionar = async (acao) => {
    setProcessando(true);
    let gps = geolocalizacao;
    if (!gps) gps = await capturarGps();
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
function AcoesStatus({ detalhe, podeEditar, mudarStatus, aoAplicado, ehGestor, transicoesMap }) {
  const [destinoConfirmar, setDestinoConfirmar] = useState(null);
  const [processando, setProcessando] = useState(false);

  if (!podeEditar) return null;
  const alvos = transicoesMap[detalhe.status] || new Set();
  // 'impedida' fica fora dos botões: exige justificativa + fotos (modal dedicado do Kanban).
  const principal = detalhe.status === 'rascunho' && alvos.has('aberta') ? 'aberta' : null;
  const retomar = detalhe.status === 'impedida' && alvos.has('em_andamento');
  const iniciar = detalhe.status === 'aberta' && alvos.has('em_andamento');
  const podeCancelar = alvos.has('cancelada') && ehGestor;

  const aplicar = async () => {
    setProcessando(true);
    const ok = await mudarStatus(detalhe, destinoConfirmar);
    setProcessando(false);
    setDestinoConfirmar(null);
    if (ok) aoAplicado();
  };

  if (!principal && !retomar && !iniciar && !alvos.has('concluida') && !podeCancelar) return null;

  return (
    <div className="space-y-2">
      {(principal || iniciar || retomar) && (
        <button
          onClick={() => mudarStatus(detalhe, principal || 'em_andamento').then(ok => ok && aoAplicado())}
          className="w-full h-11 rounded-xl border border-primary-200 bg-primary-50 hover:bg-primary-100 text-primary-700 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-all"
        >
          <Play size={16} /> {principal ? 'Ativar O.S' : retomar ? 'Retomar Execução' : 'Iniciar Execução'}
        </button>
      )}
      <div className={`grid ${alvos.has('concluida') && podeCancelar ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
        {alvos.has('concluida') && (
          <button
            onClick={() => setDestinoConfirmar('concluida')}
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

function PainelExecucao({ osId, produtos, geolocalizacao, capturarGps, onFechar, recarregarLista, mostrarToast, ehMobile, mudarStatus, ehGestor, onEditar, transicoes }) {
  const [detalhe, setDetalhe] = useState(null);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState('insumos');

  const carregar = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_URL}/os/${osId}`);
      const data = await res.json().catch(() => null);
      if (res.ok) setDetalhe(data);
      else setErro(erroDaResposta(data, 'Erro ao carregar O.S.'));
    } catch {
      setErro('Erro de conexão ao carregar a O.S.');
    }
  }, [osId]);

  useEffect(() => { carregar(); }, [carregar]);

  if (erro) {
    return (
      <div className="fixed inset-0 w-full lg:left-auto lg:w-[560px] xl:w-[680px] bg-white z-40 flex items-center justify-center">
        <p className="text-sm text-rose-600">{erro}</p>
        <button onClick={onFechar} className="ml-3 text-sm text-primary-600 underline">Voltar</button>
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
  const podeEditar = !['concluida', 'cancelada'].includes(detalhe.status);
  // Ações de gestão dentro do painel (estorno, excluir evidência) exigem "os".
  const podeEstornar = ehGestor && podeEditar;
  const podeExcluir = ehGestor && podeEditar;
  const prazo = situacaoPrazo(detalhe);

  const duplicar = async () => {
    try {
      const res = await apiFetch(`${API_URL}/os/${detalhe.id}/duplicar`, { method: 'POST' });
      if (res.ok) {
        mostrarToast(`O.S duplicada como ${(await res.json()).codigo}.`);
        recarregarLista();
      } else {
        mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao duplicar.'), 'error');
      }
    } catch {
      mostrarToast('Erro de conexão ao duplicar.', 'error');
    }
  };

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
        {[['insumos', 'Insumos', Package], ['evidencias', 'Evidências', Camera], ['timeline', 'Histórico', Clock]].map(([key, label, Icon]) => (
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
      {aba === 'insumos' && (
        <TabInsumos
          osDetalhe={{ ...detalhe, lancamentos: detalhe.ultimos_lancamentos }}
          produtos={produtos}
          onAtualizado={carregar}
          mostrarToast={mostrarToast}
          podeEditar={podeEditar}
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
            Cliente: {detalhe.obras?.clientes?.nome || '-'} · Equipe:{' '}
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
        <div className={`rounded-xl p-2.5 border ${(mat.total_aplicado_rs ?? 0) > (mat.total_orcado_rs ?? 0) && mat.total_orcado_rs > 0 ? 'bg-rose-50 border-rose-100' : 'bg-amber-50 border-amber-100'}`}>
          <p className="text-[9px] font-bold text-amber-600 uppercase">Materiais</p>
          <p className="text-sm font-extrabold text-amber-800">{brl(mat.total_aplicado_rs)}</p>
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
          geolocalizacao={geolocalizacao}
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
        />        <div className={`grid gap-2 ${ehGestor ? 'grid-cols-2' : 'grid-cols-2'}`}>
          {ehGestor && (
            <button
              onClick={() => onEditar(detalhe)}
              className="h-11 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-slate-50 cursor-pointer"
            >
              <Pencil size={14} /> Editar
            </button>
          )}
          {ehGestor && (
            <button
              onClick={duplicar}
              className="h-11 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-slate-50 cursor-pointer"
            >
              <Copy size={14} /> Duplicar
            </button>
          )}
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
        </div>
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

function ModalNovaOS({ aberto, obras, equipes, produtos, onFechar, onCriada, mostrarToast, edicao }) {
  const [form, setForm] = useState(FORM_OS_INICIAL);
  const [itens, setItens] = useState([]); // [{produto_id, quantidade_orcada}]
  const [produtoItem, setProdutoItem] = useState('');
  const [qtdItem, setQtdItem] = useState(1);
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
      setItens((edicao.itens_orcados || []).map(i => ({
        produto_id: i.produto_id,
        quantidade_orcada: Number(i.quantidade_orcada),
      })));
      setCriada(null);
    } else {
      setForm(FORM_OS_INICIAL);
      setItens([]);
      setCriada(null);
    }
  }, [aberto, edicao]);

  // Totais calculados em tempo real: materiais orçados + custo de M.O.
  const totalMateriais = useMemo(
    () => itens.reduce((acc, i) => {
      const prod = produtos.find(p => p.id === i.produto_id);
      return acc + i.quantidade_orcada * Number(prod?.preco_unitario || 0);
    }, 0),
    [itens, produtos],
  );
  const totalGeral = totalMateriais + Number(form.custo_mo_orcado || 0);

  const addItem = () => {
    const pid = Number(produtoItem);
    if (!pid || !produtos.some(p => p.id === pid)) {
      mostrarToast('Selecione um produto para o orçamento.', 'error');
      return;
    }
    setItens(prev => [...prev.filter(i => i.produto_id !== pid), { produto_id: pid, quantidade_orcada: Number(qtdItem) }]);
    setProdutoItem('');
    setQtdItem(1);
  };

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
        itens_orcados: itens,
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
            <select value={form.obra_id} disabled={!!edicao}
              onChange={(e) => {
              const obraSel = obras.find(o => o.id === Number(e.target.value));
              setForm(f => ({
                ...f,
                obra_id: e.target.value,
                municipio: f.municipio || obraSel?.cidade || '',
                local_servico: f.local_servico || obraSel?.endereco || '',
              }));
            }}
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-primary-500 disabled:bg-slate-100 disabled:text-slate-500">
              <option value="">Selecione...</option>
              {obras.map(o => <option key={o.id} value={o.id}>{o.nome} — {o.clientes?.nome || ''}</option>)}
            </select>
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

          {/* Itens orçados */}
          <div className="border border-slate-100 rounded-xl p-3 bg-slate-50">
            <p className="text-xs font-bold text-slate-600 mb-2">Materiais orçados</p>
            <div className="flex gap-2">
              <select value={produtoItem} onChange={(e) => setProdutoItem(e.target.value)}
                className="flex-1 px-2.5 py-2 border border-slate-200 rounded-lg text-xs">
                <option value="">Produto...</option>
                {produtos.map(p => <option key={p.id} value={p.id}>{p.nome} ({p.unidade})</option>)}
              </select>
              <input type="number" min="0.5" step="0.5" value={qtdItem} onChange={(e) => setQtdItem(e.target.value)}
                className="w-20 px-2 py-2 border border-slate-200 rounded-lg text-xs text-center" />
              <button type="button" onClick={addItem}
                className="px-3 py-2 bg-primary-600 text-white rounded-lg text-xs font-bold cursor-pointer">Add</button>
            </div>
            <ul className="mt-2 space-y-1">
              {itens.map(i => {
                const prod = produtos.find(p => p.id === i.produto_id);
                return (
                  <li key={i.produto_id} className="flex justify-between items-center text-xs bg-white rounded-lg px-2.5 py-1.5 border border-slate-100">
                    <span className="truncate">{prod?.nome} — {i.quantidade_orcada} {prod?.unidade}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <b className="text-slate-500">{brl(i.quantidade_orcada * Number(prod?.preco_unitario || 0))}</b>
                      <button type="button" onClick={() => setItens(itens.filter(x => x.produto_id !== i.produto_id))}
                        className="text-slate-300 hover:text-rose-600 cursor-pointer"><Trash2 size={13} /></button>
                    </span>
                  </li>
                );
              })}
            </ul>
            {/* Custo total em tempo real */}
            {itens.length > 0 && (
              <div className="mt-2 flex justify-between text-xs font-bold text-slate-600 bg-primary-50 border border-primary-100 rounded-lg px-2.5 py-1.5">
                <span>Total de materiais orçados</span>
                <span>{brl(totalMateriais)}</span>
              </div>
            )}
          </div>
        </div>
        {/* Resumo do custo geral (materiais + M.O.) antes de criar */}
        {(itens.length > 0 || Number(form.custo_mo_orcado) > 0) && (
          <div className="mx-6 mb-3 rounded-xl bg-slate-900 text-white px-4 py-2.5 flex justify-between items-center">
            <span className="text-xs font-semibold text-slate-300">Custo total previsto</span>
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
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      try {
        const res = await apiFetch(`${API_URL}/os/${osAlvo.id}/fotos`, { method: 'POST', body: fd });
        if (res.ok) {
          const data = await res.json();
          novosFotoIds = [...novosFotoIds, data.id];
        }
      } catch { /* continua */ }
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
  const [visao, setVisao] = useState('quadro');       // quadro | cadastros
  const [osSelecionada, setOsSelecionada] = useState(null);
  const [modalNova, setModalNova] = useState(false);
  const [modalEdicao, setModalEdicao] = useState(null); // detalhe da O.S em edição
  const [modalImpedimento, setModalImpedimento] = useState(null); // {os, destinoColuna}
  const [confirmacaoEncerrar, setConfirmacaoEncerrar] = useState(null); // {os, destino}
  const [processando, setProcessando] = useState(false);
  const [geolocalizacao, setGeolocalizacao] = useState(null);
  const [checkinInfo, setCheckinInfo] = useState(null);
  const [draggingOsStatus, setDraggingOsStatus] = useState(null); // status do card sendo arrastado

  const [filtroBusca, setFiltroBusca] = useState('');
  const [filtroObra, setFiltroObra] = useState('');
  const [filtroEquipe, setFiltroEquipe] = useState('');
  const [filtroPrioridade, setFiltroPrioridade] = useState('');
  const [totalOs, setTotalOs] = useState(0);
  const [transicoes, setTransicoes] = useState(TRANSICOES_STATUS); // fonte única do backend

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

  // Check-in persistente: restaura o registro do dia após recarregar a página.
  useEffect(() => {
    try {
      const chave = `os_checkin_${new Date().toISOString().slice(0, 10)}`;
      const salvo = localStorage.getItem(chave);
      if (salvo) {
        const dados = JSON.parse(salvo);
        setCheckinInfo({ quando: new Date(dados.quando), gps: dados.gps || null });
        if (dados.gps) setGeolocalizacao(dados.gps);
      }
    } catch { /* armazenamento indisponível */ }
  }, []);

  const mostrarToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  }, []);

  // Gestor do módulo O.S (permissão "os"); o usuário de campo ("os_campo")
  // apenas visualiza e executa tarefas das O.S da própria equipe.
  const ehGestor = (usuarioAtual?.permissoes || []).includes('os');

  const capturarGps = useCallback(async () => {
    const gps = await capturarGeolocalizacao();
    setGeolocalizacao(gps);
    return gps;
  }, []);

  const buscarPagina = useCallback(async (offset, reset) => {
    try {
      const params = new URLSearchParams();
      if (buscaAplicada) params.set('busca', buscaAplicada);
      if (filtroObra) params.set('obra_id', filtroObra);
      if (filtroEquipe) params.set('equipe_id', filtroEquipe);
      if (filtroPrioridade) params.set('prioridade', filtroPrioridade);
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
      if (ehGestor) {
        const [resObras, resEquipes, resProdutos] = await Promise.all([
          apiFetch(`${API_URL}/os/obras`),
          apiFetch(`${API_URL}/os/equipes`),
          apiFetch(`${API_URL}/os/produtos`),
        ]);
        if (resObras.ok) setObras(await resObras.json());
        if (resEquipes.ok) setEquipes(await resEquipes.json());
        if (resProdutos.ok) setProdutos(await resProdutos.json());
      }
    } catch {
      mostrarToast('Erro de conexão ao carregar o módulo de O.S.', 'error');
    } finally {
      setLoading(false);
    }
  }, [buscaAplicada, filtroObra, filtroEquipe, filtroPrioridade, ehGestor, mostrarToast]);

  const carregarDados = useCallback(() => { buscarPagina(0, true); }, [buscarPagina]);

  const carregarMais = () => buscarPagina(listaOs.length, false);

  useEffect(() => { carregarDados(); }, [carregarDados]);

  // Recarrega o painel após operações no painel de execução.
  const recarregarLista = useCallback(() => { carregarDados(); }, [carregarDados]);

  // --- Transição de status --------------------------------------------------

  const mudarStatus = useCallback(async (os, novoStatus, extras = {}) => {
    setProcessando(true);
    let gps = geolocalizacao;
    if (!gps) gps = await capturarGps();
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
      mostrarToast('Erro de conexão ao alterar status.', 'error');
      return false;
    } finally {
      setProcessando(false);
    }
  }, [geolocalizacao, capturarGps, mostrarToast, recarregarLista]);

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


  // --- Check-in de campo ------------------------------------------------------

  const fazerCheckin = async () => {
    const gps = await capturarGps();
    const info = { quando: new Date(), gps };
    setCheckinInfo(info);
    if (gps) setGeolocalizacao(gps);
    // Persiste no dispositivo para sobreviver a recarregamentos (por dia).
    try {
      const chave = `os_checkin_${new Date().toISOString().slice(0, 10)}`;
      localStorage.setItem(chave, JSON.stringify({ quando: info.quando.toISOString(), gps }));
    } catch { /* armazenamento indisponível */ }
    mostrarToast(gps
      ? 'Check-in registrado com localização!'
      : 'Check-in registrado (sem GPS disponível no dispositivo).');
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
      {[['quadro', 'Quadro', LayoutGrid], ...(ehGestor ? [['cadastros', 'Cadastros', FolderKanban]] : [])].map(([key, label, Icon]) => (
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
          placeholder="Buscar código ou escopo..."
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
      {(filtroBusca || filtroObra || filtroEquipe || filtroPrioridade) && (
        <button
          onClick={() => { setFiltroBusca(''); setBuscaAplicada(''); setFiltroObra(''); setFiltroEquipe(''); setFiltroPrioridade(''); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-xs font-bold hover:bg-rose-100 transition-colors cursor-pointer shrink-0"
        >
          <X size={13} />
          Limpar filtros
          <span className="bg-rose-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-black">
            {[filtroBusca, filtroObra, filtroEquipe, filtroPrioridade].filter(Boolean).length}
          </span>
        </button>
      )}
    </div>
  );


  return (
    <div className="space-y-5 relative">
      <Toast toast={toast} />

      {/* Header de ações */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          {seletorVisao}
          <span className="text-xs text-slate-400 font-semibold">{totalOs} O.S no total{listaOs.length < totalOs ? ` (${listaOs.length} carregadas)` : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Check-in de campo: registra hora + GPS para as próximas ações */}
          <button onClick={fazerCheckin}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 font-bold text-xs hover:bg-emerald-100 cursor-pointer">
            <MapPin size={15} />
            {checkinInfo ? `Check-in ${checkinInfo.quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${checkinInfo.gps ? ' 📍' : ''}` : 'Fazer Check-in'}
          </button>
          {botaoNova}
        </div>
      </div>

      {visao === 'quadro' && (
        <>
          {filtros}

          {/* ===== KANBAN (desktop) ===== */}
          <DragDropContext onDragStart={aoArrastarInicio} onDragEnd={aoArrastarFim}>
            <div className="hidden lg:grid grid-cols-3 xl:grid-cols-6 gap-3 items-start relative">
              {colunasVisiveis.map(col => {
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
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                );
              })}


              {/* Drawer de detalhes */}
              {osSelecionada != null && (
                <PainelExecucao
                  osId={osSelecionada}
                  obras={obras}
                  produtos={produtos}
                  geolocalizacao={geolocalizacao}
                  capturarGps={capturarGps}
                  onFechar={() => setOsSelecionada(null)}
                  recarregarLista={recarregarLista}
                  mostrarToast={mostrarToast}
                  ehMobile={false}
                  mudarStatus={mudarStatus}
                  ehGestor={ehGestor}
                  onEditar={(detalhe) => setModalEdicao(detalhe)}
                  transicoes={transicoes}
                />
              )}
            </div>
          </DragDropContext>

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
                  geolocalizacao={geolocalizacao}
                  capturarGps={capturarGps}
                  onFechar={() => setOsSelecionada(null)}
                  recarregarLista={recarregarLista}
                  mostrarToast={mostrarToast}
                  ehMobile
                  mudarStatus={mudarStatus}
                  ehGestor={ehGestor}
                  onEditar={(detalhe) => setModalEdicao(detalhe)}
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

      {visao === 'cadastros' && ehGestor && (
        <PainelCadastros
          obras={obras} equipes={equipes} produtos={produtos}
          recarregar={recarregarLista} mostrarToast={mostrarToast}
        />
      )}

      {ehGestor && (
        <ModalNovaOS
          aberto={modalNova || !!modalEdicao}
          obras={obras} equipes={equipes} produtos={produtos}
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

  // Obras
  const [novaObra, setNovaObra] = useState({ nome: '', cliente_id: '', cidade: '', endereco: '' });
  const [filtroObraLista, setFiltroObraLista] = useState('');
  const [obraEmEdicao, setObraEmEdicao] = useState(null);
  const [excluirObraAlvo, setExcluirObraAlvo] = useState(null);

  // Equipes
  const [novaEquipe, setNovaEquipe] = useState({ nome: '', numero: '', membros: [], lider: '' });
  const [filtroEquipeLista, setFiltroEquipeLista] = useState('');
  const [equipeEmEdicao, setEquipeEmEdicao] = useState(null);
  const [excluirEquipeAlvo, setExcluirEquipeAlvo] = useState(null);

  // Produtos
  const [novoProduto, setNovoProduto] = useState({ nome: '', codigo: '', unidade: 'UN', preco_unitario: '' });
  const [filtroProdutoLista, setFiltroProdutoLista] = useState('');
  const [excluirProdutoAlvo, setExcluirProdutoAlvo] = useState(null);

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
      (o.clientes?.nome || '').toLowerCase().includes(termo) ||
      (o.cidade || '').toLowerCase().includes(termo) ||
      (o.endereco || '').toLowerCase().includes(termo)
    );
  }, [obras, filtroObraLista]);

  const equipesFiltradas = useMemo(() => {
    if (!filtroEquipeLista) return equipes;
    const termo = filtroEquipeLista.toLowerCase();
    return equipes.filter(eq =>
      (eq.nome || '').toLowerCase().includes(termo) ||
      (eq.membros || []).some(m => (m.nome || '').toLowerCase().includes(termo))
    );
  }, [equipes, filtroEquipeLista]);

  const produtosFiltrados = useMemo(() => {
    if (!filtroProdutoLista) return produtos;
    const termo = filtroProdutoLista.toLowerCase();
    return produtos.filter(p =>
      (p.nome || '').toLowerCase().includes(termo) ||
      (p.codigo || '').toLowerCase().includes(termo)
    );
  }, [produtos, filtroProdutoLista]);

  const ABAS = [
    { id: 'obras', label: 'Obras', icone: FolderKanban },
    { id: 'equipes', label: 'Equipes', icone: HardHat },
    { id: 'produtos', label: 'Produtos / Insumos', icone: Boxes }
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
                            setNovaObra({
                              nome: o.nome || '',
                              cliente_id: String(o.cliente_id || ''),
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
                      <span className="truncate">{o.clientes?.nome || 'Sem cliente'}</span>
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
              <CampoTexto label="Nome da obra *" value={novaObra.nome} onChange={e => setNovaObra({ ...novaObra, nome: e.target.value })} />
              <ClientesSelect value={novaObra.cliente_id} onChange={(v) => setNovaObra({ ...novaObra, cliente_id: v })} />
              <CampoTexto label="Cidade" value={novaObra.cidade} onChange={e => setNovaObra({ ...novaObra, cidade: e.target.value })} />
              <CampoTexto label="Endereço" value={novaObra.endereco} onChange={e => setNovaObra({ ...novaObra, endereco: e.target.value })} />
            </div>

            <div className="flex gap-2 pt-2">
              {obraEmEdicao && (
                <button
                  type="button"
                  onClick={() => {
                    setObraEmEdicao(null);
                    setNovaObra({ nome: '', cliente_id: '', cidade: '', endereco: '' });
                  }}
                  className="flex-1 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer hover:bg-slate-50"
                >
                  Cancelar
                </button>
              )}
              <button
                onClick={async () => {
                  if (!novaObra.nome || !novaObra.cliente_id) { mostrarToast('Informe nome e cliente da obra.', 'error'); return; }
                  const payload = {
                    nome: novaObra.nome,
                    cliente_id: Number(novaObra.cliente_id),
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
                    setNovaObra({ nome: '', cliente_id: '', cidade: '', endereco: '' });
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
              <h3 className="font-extrabold text-slate-800 text-sm">Produtos & Insumos ({produtosFiltrados.length})</h3>
              {/* Barra de Busca */}
              <div className="relative w-full sm:max-w-xs">
                <input
                  type="text"
                  placeholder="Buscar produto ou código..."
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

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[450px] overflow-y-auto pr-1">
              {produtosFiltrados.length === 0 ? (
                <div className="col-span-full text-center text-xs text-slate-400 py-12">Nenhum produto encontrado.</div>
              ) : (
                produtosFiltrados.map(p => (
                  <div key={p.id} className="group relative flex flex-col gap-1 text-xs bg-slate-50 hover:bg-slate-100/70 rounded-xl p-3 border border-slate-100 transition-all">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-extrabold text-slate-800 break-words leading-tight">{p.nome}</span>
                      <button
                        onClick={() => setExcluirProdutoAlvo(p)}
                        className="text-slate-400 hover:text-rose-600 cursor-pointer p-1 rounded hover:bg-white border hover:border-slate-200 opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0"
                        title="Excluir produto"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    
                    {p.codigo && (
                      <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                        Cod: {p.codigo}
                      </div>
                    )}
                    
                    <div className="text-emerald-600 font-bold mt-1 text-[11px]">
                      {brl(p.preco_unitario)} <span className="text-slate-400 font-normal">/ {p.unidade}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Direita: Formulário */}
          <div className="bg-slate-50/50 rounded-2xl border border-slate-100 p-5 space-y-4 h-fit">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Novo Produto / Insumo</h4>
            
            <div className="space-y-3">
              <CampoTexto label="Nome do produto *" value={novoProduto.nome} onChange={e => setNovoProduto({ ...novoProduto, nome: e.target.value })} />
              <CampoTexto label="Código (SKU)" value={novoProduto.codigo} onChange={e => setNovoProduto({ ...novoProduto, codigo: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <CampoTexto label="Unidade" value={novoProduto.unidade} onChange={e => setNovoProduto({ ...novoProduto, unidade: e.target.value })} />
                <CampoTexto label="Preço Unitário (R$)" type="number" step="0.01" min="0" value={novoProduto.preco_unitario}
                  onChange={e => setNovoProduto({ ...novoProduto, preco_unitario: e.target.value })} />
              </div>
            </div>

            <button
              onClick={async () => {
                if (!novoProduto.nome) { mostrarToast('Informe o nome do produto.', 'error'); return; }
                const ok = await post(`${API_URL}/os/produtos`, {
                  nome: novoProduto.nome,
                  codigo: novoProduto.codigo || null,
                  unidade: novoProduto.unidade || 'UN',
                  preco_unitario: Number(novoProduto.preco_unitario || 0)
                }, 'Produto criado.');
                if (ok) setNovoProduto({ nome: '', codigo: '', unidade: 'UN', preco_unitario: '' });
              }}
              className="w-full py-2.5 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all cursor-pointer">
              Cadastrar Produto
            </button>
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

      {/* Modal de Confirmação para Produtos */}
      <ModalConfirmacao
        aberto={!!excluirProdutoAlvo}
        titulo="Confirmar exclusão de produto"
        mensagem={`Deseja realmente excluir o produto "${excluirProdutoAlvo?.nome}"?`}
        confirmarTexto="Excluir"
        cancelarTexto="Cancelar"
        perigo
        onConfirmar={async () => {
          if (excluirProdutoAlvo) {
            await inativar(`${API_URL}/os/produtos/${excluirProdutoAlvo.id}`, 'Produto excluído.');
            setExcluirProdutoAlvo(null);
          }
        }}
        onCancelar={() => setExcluirProdutoAlvo(null)}
      />
    </div>
  );
}

// Select de clientes (reutiliza o endpoint público de Clientes do sistema).
function ClientesSelect({ value, onChange }) {
  const [clientes, setClientes] = useState([]);
  useEffect(() => {
    apiFetch(`${API_URL}/clientes/`)
      .then(res => (res.ok ? res.json() : []))
      .then(setClientes)
      .catch(() => setClientes([]));
  }, []);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm">
      <option value="">Selecione o cliente *</option>
      {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
    </select>
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
