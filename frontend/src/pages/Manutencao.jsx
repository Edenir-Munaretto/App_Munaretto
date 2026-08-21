import React, { useState, useEffect } from 'react';
import {
  Car, Wrench, Plus, Edit2, Trash2, Search, Check, AlertTriangle,
  Printer, ArrowLeft, MapPin, Banknote, Package, Backpack, Gauge, History, RefreshCcw,
  FileText, Upload, ExternalLink, CalendarClock
} from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';
import ModalConfirmacao from '../components/ModalConfirmacao';
import ErroCarregamento from '../components/ErroCarregamento';
import PaginacaoControle from '../components/PaginacaoControle';
import { useFetchState } from '../hooks/useFetchState';
import { usePaginacao } from '../hooks/usePaginacao';

const TIPOS_MANUTENCAO = [
  'Manutenção',
  'Revisão',
  'Troca de pneus',
  'Troca de óleo',
  'Alinhamento e balanceamento',
  'Freios',
  'Elétrica',
  'Suspensão',
  'Motor',
  'Funilaria e pintura',
  'Outro',
];

const MANUTENCAO_INICIAL = {
  tipo: '',
  descricao: '',
  data_servico: '',
  oficina: '',
  valor: '',
  km_odometro: '',
  observacao: '',
};

const EQUIPAMENTO_INICIAL = {
  equipamento: '',
  quantidade: 1,
  observacao: '',
};

const TIPOS_DOCUMENTO = [
  'CRLV (documento do veículo)',
  'Certificado do Cronotacógrafo',
  'Seguro do veículo',
  'IPVA',
  'Licenciamento',
  'Inspeção veicular',
  'Outro',
];

function Manutencao() {
  const [veiculos, setVeiculos] = useState([]);
  const [busca, setBusca] = useState('');
  const [toast, setToast] = useState(null);
  const lista = useFetchState();

  // Modal de veículo
  const [showVeiculoModal, setShowVeiculoModal] = useState(false);
  const [veiculoEditingId, setVeiculoEditingId] = useState(null);
  const [veiculoForm, setVeiculoForm] = useState({ modelo: '', placa: '', observacao: '' });
  const [submittingVeiculo, setSubmittingVeiculo] = useState(false);

  // Detalhe do veículo
  const [veiculoSelecionado, setVeiculoSelecionado] = useState(null);
  const [aba, setAba] = useState('manutencoes');

  // Manutenções
  const [manutencoes, setManutencoes] = useState([]);
  const manutLista = useFetchState();
  const [showManutModal, setShowManutModal] = useState(false);
  const [manutEditingId, setManutEditingId] = useState(null);
  const [manutForm, setManutForm] = useState(MANUTENCAO_INICIAL);
  const [submittingManut, setSubmittingManut] = useState(false);

  // Filtro por período (relatório de manutenções)
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  // Equipamentos
  const [equipamentos, setEquipamentos] = useState([]);
  const equipLista = useFetchState();
  const [showEquipModal, setShowEquipModal] = useState(false);
  const [equipEditingId, setEquipEditingId] = useState(null);
  const [equipForm, setEquipForm] = useState(EQUIPAMENTO_INICIAL);
  const [submittingEquip, setSubmittingEquip] = useState(false);

  // Histórico de reposições de equipamentos
  const [showReposModal, setShowReposModal] = useState(false);
  const [reposEquip, setReposEquip] = useState(null);
  const [reposicoes, setReposicoes] = useState([]);
  const reposLista = useFetchState();
  const [reposForm, setReposForm] = useState({ data_reposicao: '', quantidade: 1, observacao: '' });
  const [submittingRepos, setSubmittingRepos] = useState(false);
  const [removendoRepos, setRemovendoRepos] = useState(false);

  // Documentos do veículo
  const [documentos, setDocumentos] = useState([]);
  const docLista = useFetchState();
  const [showDocModal, setShowDocModal] = useState(false);
  const [docForm, setDocForm] = useState({ tipo: '', data_validade: '', observacao: '' });
  const [docArquivo, setDocArquivo] = useState(null);
  const [submittingDoc, setSubmittingDoc] = useState(false);
  const [removendoDoc, setRemovendoDoc] = useState(false);

  // Confirmação de exclusão
  const [confirmarAcao, setConfirmarAcao] = useState(null);
  const [excluindo, setExcluindo] = useState(false);

  const pagVeic = usePaginacao(veiculos, 50, [busca]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const formatDateBR = (d) => {
    if (!d) return '';
    try {
      return new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString('pt-BR');
    } catch {
      return d;
    }
  };

  const formatBRL = (v) => {
    if (v == null || v === '') return '';
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  // Manutenções filtradas pelo período informado (data_servico em YYYY-MM-DD)
  const manutencoesFiltradas = manutencoes.filter((m) => {
    if (dataInicio && m.data_servico < dataInicio) return false;
    if (dataFim && m.data_servico > dataFim) return false;
    return true;
  });
  const totalPeriodo = manutencoesFiltradas.reduce((soma, m) => soma + (Number(m.valor) || 0), 0);
  const periodoAtivo = Boolean(dataInicio || dataFim);

  // ---------------------------------------------------------------------------
  // Veículos
  // ---------------------------------------------------------------------------
  const fetchVeiculos = async () => {
    lista.iniciar();
    try {
      const url = busca
        ? `${API_URL}/manutencao/veiculos?busca=${encodeURIComponent(busca)}`
        : `${API_URL}/manutencao/veiculos`;
      const res = await apiFetch(url);
      if (res.ok) {
        setVeiculos(await res.json());
        lista.sucesso();
      } else {
        lista.falhar(erroDaResposta(await res.json().catch(() => null), 'Erro ao buscar veículos.'));
      }
    } catch (err) {
      console.error('Erro ao buscar veículos:', err);
      lista.falhar('Erro de conexão ao buscar veículos.');
    }
  };

  useEffect(() => {
    fetchVeiculos();
  }, []);

  useEffect(() => {
    fetchVeiculos();
  }, [busca]);

  const openAddVeiculo = () => {
    setVeiculoEditingId(null);
    setVeiculoForm({ modelo: '', placa: '', observacao: '' });
    setShowVeiculoModal(true);
  };

  const openEditVeiculo = (v) => {
    setVeiculoEditingId(v.id);
    setVeiculoForm({ modelo: v.modelo, placa: v.placa, observacao: v.observacao || '' });
    setShowVeiculoModal(true);
  };

  const handleSubmitVeiculo = async (e) => {
    e.preventDefault();
    if (!veiculoForm.modelo.trim() || !veiculoForm.placa.trim()) {
      showToast('Modelo e placa são obrigatórios.', 'error');
      return;
    }
    setSubmittingVeiculo(true);
    try {
      const method = veiculoEditingId ? 'PUT' : 'POST';
      const url = veiculoEditingId
        ? `${API_URL}/manutencao/veiculos/${veiculoEditingId}`
        : `${API_URL}/manutencao/veiculos`;
      const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(veiculoForm) });
      if (res.ok) {
        setShowVeiculoModal(false);
        showToast(veiculoEditingId ? 'Veículo atualizado com sucesso!' : 'Veículo cadastrado com sucesso!');
        fetchVeiculos();
      } else {
        showToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao salvar veículo.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao salvar veículo.', 'error');
    } finally {
      setSubmittingVeiculo(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Detalhe do veículo: manutenções e equipamentos
  // ---------------------------------------------------------------------------
  const fetchManutencoes = async (veiculoId) => {
    manutLista.iniciar();
    try {
      const res = await apiFetch(`${API_URL}/manutencao/veiculos/${veiculoId}/manutencoes`);
      if (res.ok) {
        setManutencoes(await res.json());
        manutLista.sucesso();
      } else {
        manutLista.falhar('Erro ao buscar manutenções.');
      }
    } catch (err) {
      console.error(err);
      manutLista.falhar('Erro de conexão ao buscar manutenções.');
    }
  };

  const fetchEquipamentos = async (veiculoId) => {
    equipLista.iniciar();
    try {
      const res = await apiFetch(`${API_URL}/manutencao/veiculos/${veiculoId}/equipamentos`);
      if (res.ok) {
        setEquipamentos(await res.json());
        equipLista.sucesso();
      } else {
        equipLista.falhar('Erro ao buscar equipamentos.');
      }
    } catch (err) {
      console.error(err);
      equipLista.falhar('Erro de conexão ao buscar equipamentos.');
    }
  };

  const fetchDocumentos = async (veiculoId) => {
    docLista.iniciar();
    try {
      const res = await apiFetch(`${API_URL}/manutencao/veiculos/${veiculoId}/documentos`);
      if (res.ok) {
        setDocumentos(await res.json());
        docLista.sucesso();
      } else {
        docLista.falhar('Erro ao buscar documentos.');
      }
    } catch (err) {
      console.error(err);
      docLista.falhar('Erro de conexão ao buscar documentos.');
    }
  };

  // Situação da validade de um documento
  const situacaoValidade = (d) => {
    if (!d.data_validade) return null;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const fim = new Date(d.data_validade + 'T00:00:00');
    const dias = Math.ceil((fim - hoje) / 86400000);
    if (dias < 0) return { status: 'vencido', dias };
    if (dias <= 30) return { status: 'proximo', dias };
    return { status: 'valido', dias };
  };

  const abrirVeiculo = (v) => {
    setVeiculoSelecionado(v);
    setAba('manutencoes');
    fetchManutencoes(v.id);
    fetchEquipamentos(v.id);
    fetchDocumentos(v.id);
  };

  const fecharVeiculo = () => {
    setVeiculoSelecionado(null);
    setManutencoes([]);
    setEquipamentos([]);
    setDocumentos([]);
  };

  // ---------------------------------------------------------------------------
  // Manutenções
  // ---------------------------------------------------------------------------
  const openAddManut = () => {
    setManutEditingId(null);
    setManutForm({ ...MANUTENCAO_INICIAL });
    setShowManutModal(true);
  };

  const openEditManut = (m) => {
    setManutEditingId(m.id);
    setManutForm({
      tipo: m.tipo,
      descricao: m.descricao || '',
      data_servico: m.data_servico || '',
      oficina: m.oficina || '',
      valor: m.valor != null ? m.valor : '',
      km_odometro: m.km_odometro != null ? m.km_odometro : '',
      observacao: m.observacao || '',
    });
    setShowManutModal(true);
  };

  const handleSubmitManut = async (e) => {
    e.preventDefault();
    if (!manutForm.tipo.trim() || !manutForm.data_servico) {
      showToast('Tipo de serviço e data são obrigatórios.', 'error');
      return;
    }
    setSubmittingManut(true);
    try {
      const payload = {
        veiculo_id: veiculoSelecionado.id,
        tipo: manutForm.tipo.trim(),
        descricao: manutForm.descricao || null,
        data_servico: manutForm.data_servico,
        oficina: manutForm.oficina || null,
        valor: manutForm.valor === '' ? 0 : Number(manutForm.valor),
        km_odometro: manutForm.km_odometro === '' ? null : Number(manutForm.km_odometro),
        observacao: manutForm.observacao || null,
      };
      const method = manutEditingId ? 'PUT' : 'POST';
      const url = manutEditingId
        ? `${API_URL}/manutencao/manutencoes/${manutEditingId}`
        : `${API_URL}/manutencao/manutencoes`;
      const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) {
        setShowManutModal(false);
        showToast(manutEditingId ? 'Manutenção atualizada!' : 'Manutenção registrada!');
        fetchManutencoes(veiculoSelecionado.id);
      } else {
        showToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao salvar manutenção.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao salvar manutenção.', 'error');
    } finally {
      setSubmittingManut(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Equipamentos
  // ---------------------------------------------------------------------------
  const openAddEquip = () => {
    setEquipEditingId(null);
    setEquipForm({ ...EQUIPAMENTO_INICIAL });
    setShowEquipModal(true);
  };

  const openEditEquip = (eq) => {
    setEquipEditingId(eq.id);
    setEquipForm({
      equipamento: eq.equipamento,
      quantidade: eq.quantidade || 1,
      observacao: eq.observacao || '',
    });
    setShowEquipModal(true);
  };

  const handleSubmitEquip = async (e) => {
    e.preventDefault();
    if (!equipForm.equipamento.trim()) {
      showToast('Informe o nome do equipamento.', 'error');
      return;
    }
    setSubmittingEquip(true);
    try {
      const payload = {
        veiculo_id: veiculoSelecionado.id,
        equipamento: equipForm.equipamento.trim(),
        quantidade: Number(equipForm.quantidade) || 1,
        observacao: equipForm.observacao || null,
      };
      const method = equipEditingId ? 'PUT' : 'POST';
      const url = equipEditingId
        ? `${API_URL}/manutencao/equipamentos/${equipEditingId}`
        : `${API_URL}/manutencao/equipamentos`;
      const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) {
        setShowEquipModal(false);
        showToast(equipEditingId ? 'Equipamento atualizado!' : 'Equipamento cadastrado!');
        fetchEquipamentos(veiculoSelecionado.id);
      } else {
        showToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao salvar equipamento.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao salvar equipamento.', 'error');
    } finally {
      setSubmittingEquip(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Histórico de reposições de equipamentos
  // ---------------------------------------------------------------------------
  const fetchReposicoes = async (equipId) => {
    reposLista.iniciar();
    try {
      const res = await apiFetch(`${API_URL}/manutencao/equipamentos/${equipId}/reposicoes`);
      if (res.ok) {
        setReposicoes(await res.json());
        reposLista.sucesso();
      } else {
        reposLista.falhar('Erro ao buscar histórico de reposições.');
      }
    } catch (err) {
      console.error(err);
      reposLista.falhar('Erro de conexão ao buscar histórico.');
    }
  };

  const openReposModal = (eq) => {
    setReposEquip(eq);
    setReposForm({ data_reposicao: '', quantidade: 1, observacao: '' });
    setShowReposModal(true);
    fetchReposicoes(eq.id);
  };

  const handleSubmitRepos = async (e) => {
    e.preventDefault();
    if (!reposForm.data_reposicao) {
      showToast('Informe a data da reposição.', 'error');
      return;
    }
    setSubmittingRepos(true);
    try {
      const payload = {
        equipamento_id: reposEquip.id,
        data_reposicao: reposForm.data_reposicao,
        quantidade: Number(reposForm.quantidade) || 1,
        observacao: reposForm.observacao || null,
      };
      const res = await apiFetch(`${API_URL}/manutencao/equipamentos/reposicoes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setReposForm({ data_reposicao: '', quantidade: 1, observacao: '' });
        showToast('Reposição registrada!');
        fetchReposicoes(reposEquip.id);
        fetchEquipamentos(veiculoSelecionado.id);
      } else {
        showToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao registrar reposição.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao registrar reposição.', 'error');
    } finally {
      setSubmittingRepos(false);
    }
  };

  const excluirReposicao = async (id) => {
    if (!window.confirm('Excluir esta reposição do histórico?')) return;
    setRemovendoRepos(true);
    try {
      const res = await apiFetch(`${API_URL}/manutencao/equipamentos/reposicoes/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Reposição excluída.');
        fetchReposicoes(reposEquip.id);
        fetchEquipamentos(veiculoSelecionado.id);
      } else {
        showToast('Erro ao excluir reposição.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao excluir reposição.', 'error');
    } finally {
      setRemovendoRepos(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Documentos do veículo
  // ---------------------------------------------------------------------------
  const MIMES_DOCUMENTO = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

  const openAddDoc = () => {
    setDocForm({ tipo: '', data_validade: '', observacao: '' });
    setDocArquivo(null);
    setShowDocModal(true);
  };

  const baixarDocumento = async (d) => {
    try {
      const res = await apiFetch(`${API_URL}/manutencao/documentos/${d.id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        showToast(erroDaResposta(data, 'Documento não disponível.'), 'error');
        return;
      }
      const data = await res.json();
      window.open(data.url_temporaria, '_blank');
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao obter documento.', 'error');
    }
  };

  const handleSubmitDoc = async (e) => {
    e.preventDefault();
    if (!docForm.tipo.trim()) {
      showToast('Informe o tipo do documento.', 'error');
      return;
    }
    if (!docArquivo) {
      showToast('Selecione o arquivo do documento.', 'error');
      return;
    }
    if (!MIMES_DOCUMENTO.includes(docArquivo.type)) {
      showToast('Documento deve ser PDF, JPG, PNG ou WEBP.', 'error');
      return;
    }
    if (docArquivo.size > 15 * 1024 * 1024) {
      showToast('Documento deve ter no máximo 15 MB.', 'error');
      return;
    }
    setSubmittingDoc(true);
    try {
      const fd = new FormData();
      fd.append('arquivo', docArquivo);
      fd.append('tipo', docForm.tipo.trim());
      fd.append('data_validade', docForm.data_validade || '');
      fd.append('observacao', docForm.observacao || '');
      const res = await apiFetch(`${API_URL}/manutencao/veiculos/${veiculoSelecionado.id}/documentos`, { method: 'POST', body: fd });
      if (res.ok) {
        setShowDocModal(false);
        showToast('Documento anexado com sucesso!');
        fetchDocumentos(veiculoSelecionado.id);
      } else {
        showToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao anexar documento.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao anexar documento.', 'error');
    } finally {
      setSubmittingDoc(false);
    }
  };

  const excluirDocumento = async (d) => {
    if (!window.confirm(`Excluir o documento "${d.tipo}"?`)) return;
    setRemovendoDoc(true);
    try {
      const res = await apiFetch(`${API_URL}/manutencao/documentos/${d.id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Documento excluído.');
        fetchDocumentos(veiculoSelecionado.id);
      } else {
        showToast('Erro ao excluir documento.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao excluir documento.', 'error');
    } finally {
      setRemovendoDoc(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Exclusões
  // ---------------------------------------------------------------------------
  const confirmarExecucao = async () => {
    if (!confirmarAcao) return;
    setExcluindo(true);
    try {
      const { tipo, id } = confirmarAcao;
      const urls = {
        veiculo: `${API_URL}/manutencao/veiculos/${id}`,
        manutencao: `${API_URL}/manutencao/manutencoes/${id}`,
        equipamento: `${API_URL}/manutencao/equipamentos/${id}`,
      };
      const res = await apiFetch(urls[tipo], { method: 'DELETE' });
      if (res.ok) {
        showToast(tipo === 'veiculo' ? 'Veículo excluído.' : tipo === 'manutencao' ? 'Manutenção excluída.' : 'Equipamento excluído.');
        if (tipo === 'veiculo') fetchVeiculos();
        else if (tipo === 'manutencao') fetchManutencoes(veiculoSelecionado.id);
        else fetchEquipamentos(veiculoSelecionado.id);
      } else {
        showToast('Erro ao excluir o registro.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao excluir o registro.', 'error');
    } finally {
      setExcluindo(false);
      setConfirmarAcao(null);
    }
  };

  const inputCls = "w-full px-3 py-2.5 min-h-11 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-primary-500/20";

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          @page { margin: 8mm; }
          body {
            background-color: white !important;
            color: black !important;
          }
          aside, header, button, input, select, .print\\:hidden, .no-print {
            display: none !important;
          }
          main { padding: 0 !important; margin: 0 !important; }
          html, body { height: auto !important; max-height: none !important; overflow: visible !important; }
          .flex-1.overflow-y-auto { overflow: visible !important; height: auto !important; max-height: none !important; }
          .flex.h-dvh.overflow-hidden,
          .flex.h-screen.overflow-hidden,
          main { overflow: visible !important; height: auto !important; max-height: none !important; min-height: 0 !important; }
          .print-full-width {
            width: 100% !important;
            max-width: 100% !important;
            border: none !important;
            box-shadow: none !important;
            overflow: visible !important;
          }
        }
      `}</style>

      {toast && (
        <div className={`fixed bottom-4 right-4 z-[60] flex items-center gap-2 px-4 py-3 rounded-xl shadow-2xl text-white text-sm font-semibold ${toast.type === 'error' ? 'bg-rose-600' : 'bg-emerald-600'}`}>
          {toast.type === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}
          {toast.message}
        </div>
      )}

      {!veiculoSelecionado ? (
        /* ============================= LISTA DE VEÍCULOS ============================= */
        <>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Frota de Veículos</h2>
              <p className="text-xs text-slate-500 mt-0.5">Cadastre os veículos e acompanhe manutenções e equipamentos.</p>
            </div>
            <button
              onClick={openAddVeiculo}
              className="px-4 py-2 min-h-11 flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer"
            >
              <Plus size={16} /> Novo Veículo
            </button>
          </div>

          <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por modelo ou placa..."
                className={`${inputCls} pl-10`}
              />
            </div>
          </div>

          {/* Tabela (desktop) */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden hidden md:block print:hidden">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-xs uppercase tracking-wider">
                  <th className="px-3 py-3 md:px-6 md:py-4">Modelo</th>
                  <th className="px-3 py-3 md:px-6 md:py-4">Placa</th>
                  <th className="px-3 py-3 md:px-6 md:py-4">Observação</th>
                  <th className="px-3 py-3 md:px-6 md:py-4 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {lista.status === 'loading' ? (
                  <tr>
                    <td colSpan="4" className="text-center py-12 text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-xs">Buscando veículos...</p>
                      </div>
                    </td>
                  </tr>
                ) : lista.status === 'error' ? (
                  <tr>
                    <td colSpan="4">
                      <ErroCarregamento mensagem={lista.erro} onTentarNovamente={fetchVeiculos} />
                    </td>
                  </tr>
                ) : veiculos.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="text-center py-16 text-slate-400">
                      <Car className="mx-auto mb-3 text-slate-300" size={40} />
                      <p className="font-semibold mt-2">Nenhum veículo encontrado.</p>
                      <p className="text-xs mt-1">Cadastre um veículo no botão acima para iniciar.</p>
                    </td>
                  </tr>
                ) : (
                  pagVeic.itensPagina.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={() => abrirVeiculo(v)}>
                      <td className="px-3 py-3 md:px-6 md:py-4 font-bold text-slate-900">{v.modelo}</td>
                      <td className="px-3 py-3 md:px-6 md:py-4 font-mono text-xs font-bold tracking-widest">{v.placa}</td>
                      <td className="px-3 py-3 md:px-6 md:py-4 truncate max-w-[220px] text-slate-600">{v.observacao || '-'}</td>
                      <td className="px-3 py-3 md:px-6 md:py-4">
                        <div className="flex justify-center items-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditVeiculo(v); }}
                            className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors"
                            title="Editar"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmarAcao({ tipo: 'veiculo', id: v.id, nome: v.modelo }); }}
                            className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors"
                            title="Excluir"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {veiculos.length > 0 && (
              <PaginacaoControle
                paginaAtualSegura={pagVeic.paginaAtualSegura}
                totalPaginas={pagVeic.totalPaginas}
                onAnterior={() => pagVeic.setPaginaAtual(p => Math.max(1, p - 1))}
                onProximo={() => pagVeic.setPaginaAtual(p => Math.min(pagVeic.totalPaginas, p + 1))}
              />
            )}
          </div>

          {/* Lista em cartões (mobile) */}
          <div className="md:hidden divide-y divide-slate-100 bg-white rounded-2xl border border-slate-100 shadow-sm print:hidden">
            {lista.status === 'loading' ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12">
                <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs">Buscando veículos...</p>
              </div>
            ) : lista.status === 'error' ? (
              <ErroCarregamento mensagem={lista.erro} onTentarNovamente={fetchVeiculos} />
            ) : veiculos.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Car className="mx-auto mb-3 text-slate-300" size={40} />
                <p className="font-semibold mt-2">Nenhum veículo encontrado.</p>
                <p className="text-xs mt-1">Cadastre um veículo no botão acima para iniciar.</p>
              </div>
            ) : (
              pagVeic.itensPagina.map((v) => (
                <div key={v.id} className="px-4 py-3 flex items-center justify-between gap-3" onClick={() => abrirVeiculo(v)}>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-900 text-sm truncate">{v.modelo}</p>
                    <p className="font-mono text-xs text-slate-500 mt-0.5 font-bold tracking-widest">{v.placa}</p>
                    {v.observacao && <p className="text-xs text-slate-600 mt-1 truncate">{v.observacao}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEditVeiculo(v); }}
                      className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors"
                      title="Editar"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmarAcao({ tipo: 'veiculo', id: v.id, nome: v.modelo }); }}
                      className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors"
                      title="Excluir"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        /* ============================= DETALHE DO VEÍCULO ============================= */
        <div className="space-y-4 print:hidden">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={fecharVeiculo}
                className="w-11 h-11 flex items-center justify-center p-0 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all cursor-pointer"
                title="Voltar"
              >
                <ArrowLeft size={18} />
              </button>
              <div>
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Car size={20} className="text-primary-600" /> {veiculoSelecionado.modelo}
                </h2>
                <p className="text-xs text-slate-500 font-mono font-bold tracking-widest">Placa: {veiculoSelecionado.placa}</p>
              </div>
            </div>
            <button
              onClick={() => window.print()}
              className="px-4 py-2 min-h-11 flex items-center gap-2 bg-slate-900 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer"
            >
              <Printer size={16} /> {aba === 'manutencoes' ? 'Imprimir Relatório' : aba === 'equipamentos' ? 'Imprimir Checklist' : 'Imprimir Documentos'}
            </button>
          </div>

          {veiculoSelecionado.observacao && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              <span className="font-bold">Observação:</span> {veiculoSelecionado.observacao}
            </div>
          )}

          {/* Abas */}
          <div className="flex gap-2 border-b border-slate-200">
            <button
              onClick={() => setAba('manutencoes')}
              className={`px-4 py-2.5 text-sm font-bold rounded-t-lg border-b-2 transition-all cursor-pointer ${
                aba === 'manutencoes' ? 'text-primary-700 border-primary-600 bg-primary-50/50' : 'text-slate-500 border-transparent hover:text-slate-700'
              }`}
            >
              <span className="flex items-center gap-2"><Wrench size={15} /> Manutenções ({periodoAtivo ? manutencoesFiltradas.length : manutencoes.length})</span>
            </button>
            <button
              onClick={() => setAba('equipamentos')}
              className={`px-4 py-2.5 text-sm font-bold rounded-t-lg border-b-2 transition-all cursor-pointer ${
                aba === 'equipamentos' ? 'text-primary-700 border-primary-600 bg-primary-50/50' : 'text-slate-500 border-transparent hover:text-slate-700'
              }`}
            >
              <span className="flex items-center gap-2"><Backpack size={15} /> Equipamentos ({equipamentos.length})</span>
            </button>
            <button
              onClick={() => setAba('documentos')}
              className={`px-4 py-2.5 text-sm font-bold rounded-t-lg border-b-2 transition-all cursor-pointer ${
                aba === 'documentos' ? 'text-primary-700 border-primary-600 bg-primary-50/50' : 'text-slate-500 border-transparent hover:text-slate-700'
              }`}
            >
              <span className="flex items-center gap-2"><FileText size={15} /> Documentos ({documentos.length})</span>
            </button>
          </div>

          {/* Aba Manutenções */}
          {aba === 'manutencoes' && (
            <div className="space-y-3">
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 flex flex-col lg:flex-row items-stretch lg:items-end gap-3">
                <div className="flex flex-col">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Data inicial</label>
                  <input
                    type="date"
                    value={dataInicio}
                    onChange={(e) => setDataInicio(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Data final</label>
                  <input
                    type="date"
                    value={dataFim}
                    onChange={(e) => setDataFim(e.target.value)}
                    className={inputCls}
                  />
                </div>
                {periodoAtivo && (
                  <button
                    type="button"
                    onClick={() => { setDataInicio(''); setDataFim(''); }}
                    className="px-3 py-2.5 min-h-11 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all cursor-pointer"
                  >
                    Limpar período
                  </button>
                )}
                <div className="flex-1" />
                <div className="flex items-center gap-2">
                  {manutencoesFiltradas.length > 0 && (
                    <span className="px-3 py-2 text-xs font-bold text-slate-600 bg-slate-50 rounded-xl whitespace-nowrap">
                      {manutencoesFiltradas.length} registro(s) · {formatBRL(totalPeriodo)}
                    </span>
                  )}
                  <button
                    onClick={openAddManut}
                    className="px-4 py-2 min-h-11 flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer"
                  >
                    <Plus size={16} /> Nova Manutenção
                  </button>
                </div>
              </div>

              {manutLista.status === 'loading' ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex flex-col items-center justify-center text-slate-400 gap-3">
                  <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs">Carregando manutenções...</p>
                </div>
              ) : manutLista.status === 'error' ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
                  <ErroCarregamento mensagem={manutLista.erro} onTentarNovamente={() => fetchManutencoes(veiculoSelecionado.id)} />
                </div>
              ) : manutencoes.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center text-slate-400">
                  <Wrench className="mx-auto mb-3 text-slate-300" size={40} />
                  <p className="font-semibold mt-2">Nenhuma manutenção registrada.</p>
                  <p className="text-xs mt-1">Registre o que foi feito no veículo, a data e a oficina.</p>
                </div>
              ) : manutencoesFiltradas.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center text-slate-400">
                  <Wrench className="mx-auto mb-3 text-slate-300" size={40} />
                  <p className="font-semibold mt-2">Nenhuma manutenção no período selecionado.</p>
                  <p className="text-xs mt-1">Ajuste as datas ou limpe o filtro para ver o histórico completo.</p>
                </div>
              ) : (
                manutencoesFiltradas.map((m) => (
                  <div key={m.id} className="bg-white rounded-xl shadow-md border border-slate-200 flex items-stretch overflow-hidden transition-all hover:shadow-lg">
                    <div className="w-1.5 shrink-0 bg-primary-500" />
                    <div className="p-4 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-slate-900 text-sm">{m.tipo}</p>
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">
                            {formatDateBR(m.data_servico)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => openEditManut(m)}
                            className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors"
                            title="Editar"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => setConfirmarAcao({ tipo: 'manutencao', id: m.id, nome: m.tipo })}
                            className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors"
                            title="Excluir"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-600">
                        {m.oficina && (
                          <p className="flex items-center gap-1.5">
                            <MapPin size={13} className="text-slate-400" /> {m.oficina}
                          </p>
                        )}
                        {m.valor > 0 && (
                          <p className="flex items-center gap-1.5 font-bold text-emerald-700">
                            <Banknote size={13} className="text-slate-400" /> {formatBRL(m.valor)}
                          </p>
                        )}
                        {m.km_odometro != null && (
                          <p className="flex items-center gap-1.5">
                            <Gauge size={13} className="text-slate-400" /> {m.km_odometro} km
                          </p>
                        )}
                      </div>
                      {m.descricao && <p className="mt-2 text-xs text-slate-700">{m.descricao}</p>}
                      {m.observacao && <p className="mt-1 text-xs text-slate-400 italic">{m.observacao}</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Aba Equipamentos */}
          {aba === 'equipamentos' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">Lista de equipamentos do veículo para conferência.</p>
                <button
                  onClick={openAddEquip}
                  className="px-4 py-2 min-h-11 flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer"
                >
                  <Plus size={16} /> Adicionar Equipamento
                </button>
              </div>

              {equipLista.status === 'loading' ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex flex-col items-center justify-center text-slate-400 gap-3">
                  <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs">Carregando equipamentos...</p>
                </div>
              ) : equipLista.status === 'error' ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
                  <ErroCarregamento mensagem={equipLista.erro} onTentarNovamente={() => fetchEquipamentos(veiculoSelecionado.id)} />
                </div>
              ) : equipamentos.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center text-slate-400">
                  <Backpack className="mx-auto mb-3 text-slate-300" size={40} />
                  <p className="font-semibold mt-2">Nenhum equipamento cadastrado.</p>
                  <p className="text-xs mt-1">Adicione macaco, estepe, triângulo, extintor, etc. para montar o checklist.</p>
                </div>
              ) : (
                equipamentos.map((eq) => (
                  <div key={eq.id} className="bg-white rounded-xl shadow-md border border-slate-200 flex items-center justify-between gap-3 p-4 transition-all hover:shadow-lg">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Package size={16} className="text-primary-600 shrink-0" />
                        <p className="font-bold text-slate-900 text-sm truncate">{eq.equipamento}</p>
                        <span className="px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-100 text-[10px] font-bold shrink-0">
                          Qtd: {eq.quantidade}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                        <RefreshCcw size={12} className="text-slate-400 shrink-0" />
                        Última substituição: <span className="font-semibold text-slate-700">{eq.ultima_reposicao ? formatDateBR(eq.ultima_reposicao) : '—'}</span>
                      </p>
                      {eq.observacao && <p className="text-xs text-slate-500 mt-1 truncate">{eq.observacao}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openReposModal(eq)}
                        className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-primary-50 text-slate-500 hover:text-primary-700 border border-slate-100 transition-colors"
                        title="Histórico de reposições"
                      >
                        <History size={15} />
                      </button>
                      <button
                        onClick={() => openEditEquip(eq)}
                        className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors"
                        title="Editar"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => setConfirmarAcao({ tipo: 'equipamento', id: eq.id, nome: eq.equipamento })}
                        className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors"
                        title="Excluir"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Aba Documentos */}
          {aba === 'documentos' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">Anexe os documentos do veículo (CRLV, certificado do cronotacógrafo etc.) e acompanhe a data de validade de cada um.</p>
                <button
                  onClick={openAddDoc}
                  className="px-4 py-2 min-h-11 flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer"
                >
                  <Plus size={16} /> Anexar Documento
                </button>
              </div>

              {docLista.status === 'loading' ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex flex-col items-center justify-center text-slate-400 gap-3">
                  <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs">Carregando documentos...</p>
                </div>
              ) : docLista.status === 'error' ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
                  <ErroCarregamento mensagem={docLista.erro} onTentarNovamente={() => fetchDocumentos(veiculoSelecionado.id)} />
                </div>
              ) : documentos.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center text-slate-400">
                  <FileText className="mx-auto mb-3 text-slate-300" size={40} />
                  <p className="font-semibold mt-2">Nenhum documento anexado.</p>
                  <p className="text-xs mt-1">Anexe o documento do veículo e o certificado do cronotacógrafo para manter a documentação em dia.</p>
                </div>
              ) : (
                documentos.map((d) => {
                  const sit = situacaoValidade(d);
                  const sitCls = !sit
                    ? 'bg-slate-100 text-slate-600'
                    : sit.status === 'vencido'
                      ? 'bg-rose-100 text-rose-700 border border-rose-200'
                      : sit.status === 'proximo'
                        ? 'bg-amber-100 text-amber-700 border border-amber-200'
                        : 'bg-emerald-100 text-emerald-700 border border-emerald-200';
                  const sitLabel = !sit
                    ? 'Sem validade'
                    : sit.status === 'vencido'
                      ? `Vencido em ${formatDateBR(d.data_validade)}`
                      : sit.status === 'proximo'
                        ? `Vence em ${sit.dias} dia(s) — ${formatDateBR(d.data_validade)}`
                        : `Válido até ${formatDateBR(d.data_validade)}`;
                  return (
                    <div key={d.id} className="bg-white rounded-xl shadow-md border border-slate-200 p-4 transition-all hover:shadow-lg">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-primary-50 text-primary-700 border border-primary-100 shrink-0">
                              <FileText size={18} />
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-slate-900 text-sm">{d.tipo}</p>
                              <p className="text-xs text-slate-500 truncate">{d.nome_original}</p>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${sitCls}`}>
                              <span className="flex items-center gap-1.5">
                                <CalendarClock size={13} />
                                {sitLabel}
                              </span>
                            </span>
                            {d.observacao && <span className="text-xs text-slate-400 italic">{d.observacao}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => baixarDocumento(d)}
                            className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-primary-50 text-slate-500 hover:text-primary-700 border border-slate-100 transition-colors"
                            title="Abrir documento"
                          >
                            <ExternalLink size={15} />
                          </button>
                          <button
                            onClick={() => excluirDocumento(d)}
                            disabled={removendoDoc}
                            className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors cursor-pointer disabled:opacity-50"
                            title="Excluir documento"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* ============================= RELATÓRIO IMPRIMÍVEL (MANUTENÇÕES) ============================= */}
      {veiculoSelecionado && aba === 'manutencoes' && (
        <div className="hidden print:block">
          <div className="mb-6 border-b border-slate-300 pb-4">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold text-slate-800 uppercase tracking-wide">Relatório de Manutenções</h2>
                <p className="text-sm text-slate-600 mt-1">Munaretto & Co. — Controle de frota</p>
              </div>
              <p className="text-sm text-slate-600">Emitido em: {new Date().toLocaleDateString('pt-BR')}</p>
            </div>
          </div>
          <div className="mb-4 space-y-0.5">
            <p className="text-sm"><span className="font-bold">Veículo:</span> {veiculoSelecionado.modelo}</p>
            <p className="text-sm"><span className="font-bold">Placa:</span> {veiculoSelecionado.placa}</p>
            <p className="text-sm">
              <span className="font-bold">Período:</span>{' '}
              {dataInicio ? formatDateBR(dataInicio) : 'Início'} até {dataFim ? formatDateBR(dataFim) : 'Hoje'}
            </p>
            {veiculoSelecionado.observacao && <p className="text-sm text-slate-600">{veiculoSelecionado.observacao}</p>}
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-400 text-left">
                <th className="py-2 pr-2 w-8">Nº</th>
                <th className="py-2 pr-2 w-24">Data</th>
                <th className="py-2 pr-2">Tipo / Serviço</th>
                <th className="py-2 pr-2">Oficina</th>
                <th className="py-2 pr-2 w-24 text-right">Valor</th>
                <th className="py-2 w-20 text-right">Km</th>
              </tr>
            </thead>
            <tbody>
              {manutencoesFiltradas.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-4 text-center text-slate-400">Nenhuma manutenção no período.</td>
                </tr>
              ) : (
                manutencoesFiltradas.map((m, i) => (
                  <tr key={m.id} className="border-b border-slate-200 align-top">
                    <td className="py-2">{i + 1}</td>
                    <td className="py-2">{formatDateBR(m.data_servico)}</td>
                    <td className="py-2">
                      <span className="font-bold">{m.tipo}</span>
                      {m.descricao && <div className="text-xs text-slate-600 mt-0.5">{m.descricao}</div>}
                      {m.observacao && <div className="text-xs text-slate-400 italic">{m.observacao}</div>}
                    </td>
                    <td className="py-2">{m.oficina || '-'}</td>
                    <td className="py-2 text-right">{formatBRL(m.valor)}</td>
                    <td className="py-2 text-right">{m.km_odometro != null ? m.km_odometro : '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-400">
                <td colSpan="4" className="py-2 text-right font-bold">Total no período:</td>
                <td className="py-2 text-right font-bold">{formatBRL(totalPeriodo)}</td>
                <td className="py-2" />
              </tr>
            </tfoot>
          </table>
          <div className="mt-8 text-sm">
            <div className="flex flex-wrap justify-between gap-6">
              <div>Responsável: ______________________________</div>
              <div>Assinatura: ______________________________</div>
            </div>
          </div>
        </div>
      )}

      {/* ============================= CHECKLIST IMPRIMÍVEL ============================= */}
      {veiculoSelecionado && aba === 'equipamentos' && (
        <div className="hidden print:block">
          <div className="mb-6 border-b border-slate-300 pb-4">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold text-slate-800 uppercase tracking-wide">Checklist de Equipamentos</h2>
                <p className="text-sm text-slate-600 mt-1">Munaretto & Co. — Controle de frota</p>
              </div>
              <p className="text-sm text-slate-600">Data: {new Date().toLocaleDateString('pt-BR')}</p>
            </div>
          </div>
          <div className="mb-4 space-y-0.5">
            <p className="text-sm"><span className="font-bold">Veículo:</span> {veiculoSelecionado.modelo}</p>
            <p className="text-sm"><span className="font-bold">Placa:</span> {veiculoSelecionado.placa}</p>
            {veiculoSelecionado.observacao && <p className="text-sm text-slate-600">{veiculoSelecionado.observacao}</p>}
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-400 text-left">
                <th className="py-2 pr-2 w-10">Nº</th>
                <th className="py-2 pr-2">Equipamento</th>
                <th className="py-2 pr-2 w-16 text-center">Qtd</th>
                <th className="py-2 w-16 text-center">OK</th>
                <th className="py-2 w-16 text-center">Faltante</th>
              </tr>
            </thead>
            <tbody>
              {equipamentos.length === 0 ? (
                <tr>
                  <td colSpan="5" className="py-4 text-center text-slate-400">Nenhum equipamento cadastrado.</td>
                </tr>
              ) : (
                equipamentos.map((eq, i) => (
                  <tr key={eq.id} className="border-b border-slate-200">
                    <td className="py-2">{i + 1}</td>
                    <td className="py-2">{eq.equipamento}</td>
                    <td className="py-2 text-center">{eq.quantidade}</td>
                    <td className="py-2 text-center">☐</td>
                    <td className="py-2 text-center">☐</td>
                  </tr>
                ))
              )}
              <tr>
                <td colSpan="5" className="py-10 text-sm">
                  <div className="flex flex-wrap justify-between gap-6">
                    <div>Responsável: ______________________________</div>
                    <div>Data: ____ / ____ / ______</div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ============================= RELATÓRIO IMPRIMÍVEL (DOCUMENTOS) ============================= */}
      {veiculoSelecionado && aba === 'documentos' && (
        <div className="hidden print:block">
          <div className="mb-6 border-b border-slate-300 pb-4">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold text-slate-800 uppercase tracking-wide">Documentos do Veículo</h2>
                <p className="text-sm text-slate-600 mt-1">Munaretto & Co. — Controle de frota</p>
              </div>
              <p className="text-sm text-slate-600">Emitido em: {new Date().toLocaleDateString('pt-BR')}</p>
            </div>
          </div>
          <div className="mb-4 space-y-0.5">
            <p className="text-sm"><span className="font-bold">Veículo:</span> {veiculoSelecionado.modelo}</p>
            <p className="text-sm"><span className="font-bold">Placa:</span> {veiculoSelecionado.placa}</p>
            {veiculoSelecionado.observacao && <p className="text-sm text-slate-600">{veiculoSelecionado.observacao}</p>}
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-400 text-left">
                <th className="py-2 pr-2 w-8">Nº</th>
                <th className="py-2 pr-2">Documento</th>
                <th className="py-2 pr-2">Arquivo</th>
                <th className="py-2 pr-2 w-28">Validade</th>
                <th className="py-2 w-24 text-center">Situação</th>
              </tr>
            </thead>
            <tbody>
              {documentos.length === 0 ? (
                <tr>
                  <td colSpan="5" className="py-4 text-center text-slate-400">Nenhum documento anexado.</td>
                </tr>
              ) : (
                documentos.map((d, i) => {
                  const sit = situacaoValidade(d);
                  const sitLabel = !sit
                    ? 'Sem validade'
                    : sit.status === 'vencido'
                      ? 'Vencido'
                      : sit.status === 'proximo'
                        ? 'Próximo ao vencimento'
                        : 'Vigente';
                  return (
                    <tr key={d.id} className="border-b border-slate-200 align-top">
                      <td className="py-2">{i + 1}</td>
                      <td className="py-2">
                        <span className="font-bold">{d.tipo}</span>
                        {d.observacao && <div className="text-xs text-slate-600 mt-0.5">{d.observacao}</div>}
                      </td>
                      <td className="py-2">{d.nome_original}</td>
                      <td className="py-2">{d.data_validade ? formatDateBR(d.data_validade) : '—'}</td>
                      <td className="py-2 text-center">{sitLabel}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <div className="mt-8 text-sm">
            <div className="flex flex-wrap justify-between gap-6">
              <div>Responsável: ______________________________</div>
              <div>Assinatura: ______________________________</div>
            </div>
          </div>
        </div>
      )}

      {/* ============================= MODAL VEÍCULO ============================= */}
      {showVeiculoModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-900 text-white px-3 py-3 md:px-6 md:py-4 flex items-center justify-between">
              <h3 className="font-bold text-lg">
                {veiculoEditingId ? 'Editar Veículo' : 'Novo Veículo'}
              </h3>
              <button
                onClick={() => setShowVeiculoModal(false)}
                className="text-slate-400 hover:text-white text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSubmitVeiculo} className="p-6 space-y-6">
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Dados do Veículo</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="col-span-1">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Modelo *</label>
                    <input
                      type="text"
                      name="modelo"
                      value={veiculoForm.modelo}
                      onChange={(e) => setVeiculoForm(p => ({ ...p, modelo: e.target.value }))}
                      placeholder="Ex.: Fiat Strada"
                      className={inputCls}
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Placa *</label>
                    <input
                      type="text"
                      name="placa"
                      value={veiculoForm.placa}
                      onChange={(e) => setVeiculoForm(p => ({ ...p, placa: e.target.value }))}
                      placeholder="Ex.: ABC-1234"
                      className={`${inputCls} uppercase font-mono font-bold`}
                    />
                  </div>
                  <div className="col-span-1 md:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Observação</label>
                    <textarea
                      name="observacao"
                      value={veiculoForm.observacao}
                      onChange={(e) => setVeiculoForm(p => ({ ...p, observacao: e.target.value }))}
                      placeholder="Informações adicionais do veículo..."
                      rows={2}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowVeiculoModal(false)}
                  className="px-4 py-2 min-h-11 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingVeiculo}
                  className="px-4 py-2 min-h-11 flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
                >
                  {submittingVeiculo ? (
                    <>
                      <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    veiculoEditingId ? 'Salvar Alterações' : 'Cadastrar Veículo'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================= MODAL MANUTENÇÃO ============================= */}
      {showManutModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-900 text-white px-3 py-3 md:px-6 md:py-4 flex items-center justify-between">
              <h3 className="font-bold text-lg">
                {manutEditingId ? 'Editar Manutenção' : 'Nova Manutenção'}
              </h3>
              <button
                onClick={() => setShowManutModal(false)}
                className="text-slate-400 hover:text-white text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSubmitManut} className="p-6 space-y-6">
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {veiculoSelecionado.modelo} — {veiculoSelecionado.placa}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="col-span-1">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Tipo de serviço *</label>
                    <input
                      type="text"
                      list="sugestoes-manutencao"
                      name="tipo"
                      value={manutForm.tipo}
                      onChange={(e) => setManutForm(p => ({ ...p, tipo: e.target.value }))}
                      placeholder="Ex.: Troca de pneus"
                      className={inputCls}
                    />
                    <datalist id="sugestoes-manutencao">
                      {TIPOS_MANUTENCAO.map((t) => <option key={t} value={t} />)}
                    </datalist>
                  </div>
                  <div className="col-span-1">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Data do serviço *</label>
                    <input
                      type="date"
                      name="data_servico"
                      value={manutForm.data_servico}
                      onChange={(e) => setManutForm(p => ({ ...p, data_servico: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Oficina</label>
                    <input
                      type="text"
                      name="oficina"
                      value={manutForm.oficina}
                      onChange={(e) => setManutForm(p => ({ ...p, oficina: e.target.value }))}
                      placeholder="Nome da oficina"
                      className={inputCls}
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Valor (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      name="valor"
                      value={manutForm.valor}
                      onChange={(e) => setManutForm(p => ({ ...p, valor: e.target.value }))}
                      placeholder="0,00"
                      className={inputCls}
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Km do odômetro</label>
                    <input
                      type="number"
                      min="0"
                      name="km_odometro"
                      value={manutForm.km_odometro}
                      onChange={(e) => setManutForm(p => ({ ...p, km_odometro: e.target.value }))}
                      placeholder="Ex.: 45000"
                      className={inputCls}
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">O que foi feito</label>
                    <input
                      type="text"
                      name="descricao"
                      value={manutForm.descricao}
                      onChange={(e) => setManutForm(p => ({ ...p, descricao: e.target.value }))}
                      placeholder="Descrição do serviço"
                      className={inputCls}
                    />
                  </div>
                  <div className="col-span-1 md:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Observação</label>
                    <textarea
                      name="observacao"
                      value={manutForm.observacao}
                      onChange={(e) => setManutForm(p => ({ ...p, observacao: e.target.value }))}
                      placeholder="Informações adicionais..."
                      rows={2}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowManutModal(false)}
                  className="px-4 py-2 min-h-11 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingManut}
                  className="px-4 py-2 min-h-11 flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
                >
                  {submittingManut ? (
                    <>
                      <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    manutEditingId ? 'Salvar Alterações' : 'Registrar Manutenção'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================= MODAL EQUIPAMENTO ============================= */}
      {showEquipModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-900 text-white px-3 py-3 md:px-6 md:py-4 flex items-center justify-between">
              <h3 className="font-bold text-lg">
                {equipEditingId ? 'Editar Equipamento' : 'Adicionar Equipamento'}
              </h3>
              <button
                onClick={() => setShowEquipModal(false)}
                className="text-slate-400 hover:text-white text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSubmitEquip} className="p-6 space-y-6">
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {veiculoSelecionado.modelo} — {veiculoSelecionado.placa}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="col-span-1 md:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Equipamento *</label>
                    <input
                      type="text"
                      name="equipamento"
                      value={equipForm.equipamento}
                      onChange={(e) => setEquipForm(p => ({ ...p, equipamento: e.target.value }))}
                      placeholder="Ex.: Macaco, estepe, triângulo, extintor..."
                      className={inputCls}
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Quantidade</label>
                    <input
                      type="number"
                      min="1"
                      name="quantidade"
                      value={equipForm.quantidade}
                      onChange={(e) => setEquipForm(p => ({ ...p, quantidade: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Observação</label>
                    <input
                      type="text"
                      name="observacao"
                      value={equipForm.observacao}
                      onChange={(e) => setEquipForm(p => ({ ...p, observacao: e.target.value }))}
                      placeholder="Ex.: Verificar estado"
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowEquipModal(false)}
                  className="px-4 py-2 min-h-11 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingEquip}
                  className="px-4 py-2 min-h-11 flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
                >
                  {submittingEquip ? (
                    <>
                      <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    equipEditingId ? 'Salvar Alterações' : 'Adicionar'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================= MODAL HISTÓRICO DE REPOSIÇÕES ============================= */}
      {showReposModal && reposEquip && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-900 text-white px-3 py-3 md:px-6 md:py-4 flex items-center justify-between">
              <h3 className="font-bold text-lg">Histórico de Reposições</h3>
              <button
                onClick={() => setShowReposModal(false)}
                className="text-slate-400 hover:text-white text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Equipamento</h4>
                <p className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Package size={16} className="text-primary-600" />
                  {reposEquip.equipamento}
                </p>
                <p className="text-xs text-slate-500">
                  {veiculoSelecionado.modelo} — {veiculoSelecionado.placa} · Quantidade atual: {reposEquip.quantidade}
                </p>
              </div>

              {/* Formulário de nova reposição */}
              <form onSubmit={handleSubmitRepos} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Registrar reposição</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Data *</label>
                    <input
                      type="date"
                      name="data_reposicao"
                      value={reposForm.data_reposicao}
                      onChange={(e) => setReposForm(p => ({ ...p, data_reposicao: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Quantidade</label>
                    <input
                      type="number"
                      min="1"
                      name="quantidade"
                      value={reposForm.quantidade}
                      onChange={(e) => setReposForm(p => ({ ...p, quantidade: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Observação</label>
                    <input
                      type="text"
                      name="observacao"
                      value={reposForm.observacao}
                      onChange={(e) => setReposForm(p => ({ ...p, observacao: e.target.value }))}
                      placeholder="Ex.: Troca por desgaste"
                      className={inputCls}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submittingRepos}
                    className="px-4 py-2 min-h-11 flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
                  >
                    {submittingRepos ? (
                      <>
                        <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      <>
                        <RefreshCcw size={16} /> Registrar reposição
                      </>
                    )}
                  </button>
                </div>
              </form>

              {/* Histórico */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Histórico ({reposicoes.length})</h4>
                {reposLista.status === 'loading' ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-8 text-slate-400">
                    <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs">Carregando histórico...</p>
                  </div>
                ) : reposLista.status === 'error' ? (
                  <ErroCarregamento mensagem={reposLista.erro} onTentarNovamente={() => fetchReposicoes(reposEquip.id)} />
                ) : reposicoes.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <History className="mx-auto mb-2 text-slate-300" size={32} />
                    <p className="text-xs">Nenhuma reposição registrada para este equipamento.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                    {reposicoes.map((r) => (
                      <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1 flex items-center gap-3">
                          <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-primary-50 text-primary-700 border border-primary-100 shrink-0">
                            <RefreshCcw size={15} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900">{formatDateBR(r.data_reposicao)}</p>
                            <p className="text-xs text-slate-500">
                              Quantidade: <span className="font-semibold text-slate-700">{r.quantidade}</span>
                              {r.observacao && <> · {r.observacao}</>}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => excluirReposicao(r.id)}
                          disabled={removendoRepos}
                          className="w-10 h-10 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors cursor-pointer disabled:opacity-50"
                          title="Excluir reposição"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================= MODAL DOCUMENTO ============================= */}
      {showDocModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-900 text-white px-3 py-3 md:px-6 md:py-4 flex items-center justify-between">
              <h3 className="font-bold text-lg">Anexar Documento</h3>
              <button
                onClick={() => setShowDocModal(false)}
                className="text-slate-400 hover:text-white text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSubmitDoc} className="p-6 space-y-6">
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {veiculoSelecionado.modelo} — {veiculoSelecionado.placa}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="col-span-1 md:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Tipo do documento *</label>
                    <input
                      type="text"
                      list="sugestoes-documento"
                      name="tipo"
                      value={docForm.tipo}
                      onChange={(e) => setDocForm(p => ({ ...p, tipo: e.target.value }))}
                      placeholder="Ex.: CRLV, Certificado do Cronotacógrafo..."
                      className={inputCls}
                    />
                    <datalist id="sugestoes-documento">
                      {TIPOS_DOCUMENTO.map((t) => <option key={t} value={t} />)}
                    </datalist>
                  </div>
                  <div className="col-span-1">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Data de validade</label>
                    <input
                      type="date"
                      name="data_validade"
                      value={docForm.data_validade}
                      onChange={(e) => setDocForm(p => ({ ...p, data_validade: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Observação</label>
                    <input
                      type="text"
                      name="observacao"
                      value={docForm.observacao}
                      onChange={(e) => setDocForm(p => ({ ...p, observacao: e.target.value }))}
                      placeholder="Ex.: Vencimento do CRLV"
                      className={inputCls}
                    />
                  </div>
                  <div className="col-span-1 md:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Arquivo * (PDF, JPG, PNG ou WEBP — máx. 15 MB)</label>
                    <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-xl px-4 py-6 cursor-pointer hover:border-primary-500 hover:bg-primary-50/40 transition-all text-center">
                      <Upload size={20} className="text-slate-400" />
                      {docArquivo ? (
                        <span className="text-sm font-semibold text-primary-700">{docArquivo.name}</span>
                      ) : (
                        <span className="text-xs text-slate-500">Clique para selecionar o arquivo do documento</span>
                      )}
                      <input
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        onChange={(e) => setDocArquivo(e.target.files?.[0] || null)}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowDocModal(false)}
                  className="px-4 py-2 min-h-11 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingDoc}
                  className="px-4 py-2 min-h-11 flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
                >
                  {submittingDoc ? (
                    <>
                      <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Upload size={16} /> Anexar Documento
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de confirmação de exclusão */}
      <ModalConfirmacao
        aberto={confirmarAcao != null}
        titulo={confirmarAcao?.tipo === 'veiculo' ? 'Excluir veículo' : confirmarAcao?.tipo === 'manutencao' ? 'Excluir manutenção' : 'Excluir equipamento'}
        mensagem={confirmarAcao ? `Tem certeza que deseja excluir "${confirmarAcao.nome}"? Esta ação não pode ser desfeita.` : ''}
        loading={excluindo}
        onConfirmar={confirmarExecucao}
        onCancelar={() => setConfirmarAcao(null)}
      />
    </div>
  );
}

export default Manutencao;