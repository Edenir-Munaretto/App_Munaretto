import React, { useCallback, useEffect, useState } from 'react';
import { FileDown, Loader2, Save, X } from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';

// ---------------------------------------------------------------------------
// Carta de Término (Conclusão) da Obra: preenchimento do documento que é
// salvo na obra (1 término, substituível) e baixado em PDF.
// Abre a partir do PainelObra; pré-preenche com os dados da obra quando não
// há término salvo.
// ---------------------------------------------------------------------------

// Os blocos "instalado" e "que saiu" usam os MESMOS campos (ficha do PDF
// equivalente — ex.: troca de transformador com dados repetidos).
const INSTALADO_CAMPOS = [
  ['marca', 'Marca'],
  ['numero', 'Nº Trafo'],
  ['potencia', 'Potência'],
  ['ano', 'Ano'],
  ['impedancia', 'Imp.'],
  ['massa', 'Massa'],
  ['volume', 'Volume'],
  ['tap_1', '1° TAP'],
  ['tap', 'TAP'],
  ['n_taps', 'Nº TAP\'s'],
  ['placa', 'Placa'],
];

const vazio = () => ({
  marca: '',
  numero: '',
  potencia: '',
  ano: '',
  impedancia: '',
  massa: '',
  volume: '',
  tap_1: '',
  tap: '',
  n_taps: '',
  placa: '',
});

// Datas exibidas/editadas no formulário em formato brasileiro (dd/mm/aaaa);
// ao salvar, são convertidas para AAAA-MM-DD (o PDF imprime por extenso).
const hojeBR = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const isoParaBr = (valor) => {
  const t = String(valor || '').trim();
  if (t.length >= 10 && t[4] === '-' && t[7] === '-') {
    return `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(0, 4)}`;
  }
  return t;
};

const brParaIso = (valor) => {
  const t = String(valor || '').trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : t;
};

// Payload da API: datas sempre em AAAA-MM-DD (o PDF imprime por extenso).
const paraEnvio = (form) => ({
  ...form,
  data_conclusao: brParaIso(form?.data_conclusao),
  data_emissao: brParaIso(form?.data_emissao),
});

function Campo({ rotulo, valor, onChange, placeholder = '' }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">{rotulo}</span>
      <input
        value={valor || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 bg-slate-50 focus:bg-white"
      />
    </label>
  );
}

function Grupo({ titulo, children }) {
  return (
    <div className="bg-slate-50/60 border border-slate-100 rounded-2xl p-4">
      <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-3">{titulo}</p>
      {children}
    </div>
  );
}

export default function TerminoObra({ obra, onFechar, mostrarToast }) {
  const [form, setForm] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [processando, setProcessando] = useState(false);

  const setTop = (campo, valor) => setForm(prev => ({ ...prev, [campo]: valor }));
  const setInstalado = (campo, valor) =>
    setForm(prev => ({ ...prev, instalado: { ...prev.instalado, [campo]: valor } }));
  const setSaiu = (campo, valor) => setForm(prev => ({ ...prev, saiu: { ...prev.saiu, [campo]: valor } }));

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    apiFetch(`${API_URL}/os/obras/${obra.id}/termino`)
      .then(async res => {
        if (!res.ok) throw new Error('Falha ao carregar o término.');
        const dados = await res.json();
        if (!ativo) return;
        if (dados.termo) {
          setForm({
            ...dados.termo,
            data_conclusao: isoParaBr(dados.termo.data_conclusao),
            data_emissao: isoParaBr(dados.termo.data_emissao),
            instalado: { ...vazio(), ...(dados.termo.instalado || {}) },
            saiu: { ...vazio(), ...(dados.termo.saiu || {}) },
          });
        } else {
          // Prefill automático a partir do cadastro da obra.
          const hoje = hojeBR();
          const local = [obra.endereco, obra.cidade].filter(Boolean).join(' - ');
          setForm({
            numero_projeto: obra.nome || '',
            consumidor: obra.clientes?.nome || obra.cliente_celesc || '',
            local_rede: local,
            data_conclusao: hoje,
            encarregado: '',
            cidade_emissao: obra.cidade || 'Concórdia',
            data_emissao: hoje,
            instalado: vazio(),
            saiu: vazio(),
          });
        }
      })
      .catch(() => {
        if (ativo) mostrarToast('Erro ao carregar o término da obra.', 'error');
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => { ativo = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obra.id]);

  const salvar = useCallback(async (silencioso = false) => {
    const res = await apiFetch(`${API_URL}/os/obras/${obra.id}/termino`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paraEnvio(form)),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (!silencioso) mostrarToast(erroDaResposta(data, 'Erro ao salvar o término.'), 'error');
      return false;
    }
    if (!silencioso) mostrarToast('Término salvo.');
    return true;
  }, [form, obra.id, mostrarToast]);

  const abrirPdf = async () => {
    if (processando) return; // duplo toque rápido
    // Abre a aba vazia no clique (evita bloqueio de popup); o PDF é apontado
    // nela quando chega — o usuário imprime/salva pelo visualizador.
    const janela = window.open('', '_blank');
    setProcessando(true);
    try {
      const ok = await salvar(true);
      if (!ok) {
        janela?.close();
        mostrarToast('Erro ao salvar antes de gerar o PDF.', 'error');
        return;
      }
      const res = await apiFetch(`${API_URL}/os/obras/${obra.id}/termino/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paraEnvio(form)),
      });
      if (!res.ok) {
        janela?.close();
        mostrarToast('Erro ao gerar o PDF do término.', 'error');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      janela?.location.replace(url);
      // Libera a blob URL depois de a aba carregar (revogar antes pode
      // cancelar a leitura do PDF).
      setTimeout(() => window.URL.revokeObjectURL(url), 120000);
      mostrarToast('Carta de término aberta.');
    } catch {
      janela?.close();
      mostrarToast('Falha de conexão ao gerar o PDF.', 'error');
    } finally {
      setProcessando(false);
    }
  };

  const salvarPdf = async () => {
    if (processando) return; // duplo toque rápido
    setProcessando(true);
    try {
      await salvar();
    } finally {
      setProcessando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[92vh] animate-in fade-in zoom-in duration-200">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div>
            <h3 className="text-sm font-extrabold">Carta de Término (Conclusão) da Obra</h3>
            <p className="text-[11px] text-slate-300 mt-0.5 truncate max-w-xl">
              {obra.nome} · {obra.clientes?.nome || obra.cliente_celesc || 'Sem cliente'}
            </p>
          </div>
          <button
            onClick={onFechar}
            className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto space-y-4">
          {carregando || !form ? (
            <div className="flex items-center justify-center gap-2 py-14 text-slate-400">
              <Loader2 size={18} className="animate-spin" />
              <p className="text-xs font-semibold">Carregando término...</p>
            </div>
          ) : (
            <>
              <Grupo titulo="Dados do projeto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Campo rotulo="Número do projeto" valor={form.numero_projeto} onChange={v => setTop('numero_projeto', v)} />
                  <Campo rotulo="Consumidor" valor={form.consumidor} onChange={v => setTop('consumidor', v)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <Campo rotulo="Local da Rede" valor={form.local_rede} onChange={v => setTop('local_rede', v)} />
                  <Campo rotulo="Data de conclusão" valor={form.data_conclusao} onChange={v => setTop('data_conclusao', v)} placeholder="dd/mm/aaaa ou AAAA-MM-DD" />
                </div>
              </Grupo>

              <Grupo titulo="Transformador instalado">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {INSTALADO_CAMPOS.map(([chave, rotulo]) => (
                    <Campo key={chave} rotulo={rotulo} valor={form.instalado[chave]} onChange={v => setInstalado(chave, v)} />
                  ))}
                </div>
              </Grupo>

              <Grupo titulo="Transformador que saiu (quando houver troca)">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {INSTALADO_CAMPOS.map(([chave, rotulo]) => (
                    <Campo key={chave} rotulo={rotulo} valor={form.saiu[chave]} onChange={v => setSaiu(chave, v)} />
                  ))}
                </div>
              </Grupo>

              <Grupo titulo="Assinatura">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Campo rotulo="Encarregado" valor={form.encarregado} onChange={v => setTop('encarregado', v)} />
                  <Campo rotulo="Cidade" valor={form.cidade_emissao} onChange={v => setTop('cidade_emissao', v)} />
                  <Campo rotulo="Data do documento" valor={form.data_emissao} onChange={v => setTop('data_emissao', v)} placeholder="dd/mm/aaaa ou AAAA-MM-DD" />
                </div>
              </Grupo>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={onFechar}
            disabled={processando}
            className="px-4 py-2.5 border border-slate-200 bg-white text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={salvarPdf}
            disabled={processando || carregando || !form}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-primary-300 text-primary-700 rounded-xl text-xs font-extrabold hover:bg-primary-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Save size={13} /> Salvar
          </button>
          <button
            onClick={abrirPdf}
            disabled={processando || carregando || !form}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-xs font-extrabold hover:bg-primary-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            {processando ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
            Salvar e abrir PDF
          </button>
        </div>
      </div>
    </div>
  );
}
