import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search, Plus, Edit2, Trash2, X, Check, AlertTriangle,
  HardHat, GraduationCap, Stethoscope, Link2, Unlink, Briefcase, FileText, User, Printer, ListChecks, FolderOpen, Download, Upload
} from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';
import ModalConfirmacao from '../components/ModalConfirmacao';
import PaginacaoControle from '../components/PaginacaoControle';
import ErroCarregamento from '../components/ErroCarregamento';
import { usePaginacao } from '../hooks/usePaginacao';
import { useFetchState } from '../hooks/useFetchState';

const STATUS_STYLES = {
  'Vigente': 'bg-emerald-50 text-emerald-700 border-emerald-100',
  'Próximo ao Vencimento': 'bg-amber-50 text-amber-700 border-amber-100',
  'Vencido': 'bg-rose-50 text-rose-700 border-rose-100',
  'Sem validade': 'bg-slate-50 text-slate-500 border-slate-200',
};

const TITULOS_CONFIRMACAO = {
  cargo: 'Excluir cargo',
  curso: 'Excluir curso',
  desvincular: 'Desvincular curso',
  ft: 'Excluir registro',
  aso: 'Excluir ASO',
  epi: 'Excluir EPI',
  fe: 'Excluir ficha de entrega',
};

const MENSAGENS_CONFIRMACAO = {
  cargo: (n) => `Tem certeza que deseja excluir o cargo "${n}"?`,
  curso: (n) => `Tem certeza que deseja excluir o curso "${n}"?`,
  desvincular: (n) => `Desvincular "${n}" deste cargo?`,
  ft: (n) => `Excluir o registro de "${n}"?`,
  aso: (n) => `Excluir o ASO de "${n}"?`,
  epi: (n) => `Tem certeza que deseja excluir o EPI "${n}"?`,
  fe: (n) => `Excluir a ficha de entrega de "${n}"?`,
};

const RESULTADO_ASO = [
  { value: 'apto', label: 'Apto' },
  { value: 'apto_com_restricao', label: 'Apto com Restrição' },
  { value: 'inapto', label: 'Inapto' },
];

const TIPOS_EXAME = [
  { value: 'admissional', label: 'Admissional' },
  { value: 'periodico', label: 'Periódico' },
  { value: 'retorno_trabalho', label: 'Retorno ao Trabalho' },
  { value: 'mudanca_funcao', label: 'Mudança de Função' },
  { value: 'demissional', label: 'Demissional' },
];

function Sst() {
  const [tab, setTab] = useState('matriz');
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const listaTrein = useFetchState();
  const listaPend = useFetchState();
  const listaAso = useFetchState();
  const listaFe = useFetchState();
  const [confirmarAcao, setConfirmarAcao] = useState(null);
  const [showDocsModal, setShowDocsModal] = useState(false);

  // ---- Dados compartilhados ----
  const [funcionarios, setFuncionarios] = useState([]);

  // ---- Aba Matriz ----
  const [cargos, setCargos] = useState([]);
  const [treinamentos, setTreinamentos] = useState([]);
  const [matriz, setMatriz] = useState([]);
  const [cargoSelecionado, setCargoSelecionado] = useState(null);
  const [showCargoModal, setShowCargoModal] = useState(false);
  const [cargoEditingId, setCargoEditingId] = useState(null);
  const [cargoForm, setCargoForm] = useState({ nome: '', descricao: '' });
  const [showCatalogoModal, setShowCatalogoModal] = useState(false);
  const [showTreinamentoModal, setShowTreinamentoModal] = useState(false);
  const [treinamentoEditingId, setTreinamentoEditingId] = useState(null);
  const [treinamentoForm, setTreinamentoForm] = useState({
    nome: '', norma: '', tipo: '', validade_meses: '', carga_horaria: '', instituicao: ''
  });
  const [showVincularModal, setShowVincularModal] = useState(false);
  const [vincularForm, setVincularForm] = useState({ treinamento_id: '' });

  // ---- Aba Treinamentos ----
  const [funcTreinamentos, setFuncTreinamentos] = useState([]);
  const [ftView, setFtView] = useState('vencimentos'); // vencimentos | pendencias
  const [pendencias, setPendencias] = useState([]);
  const [pendBusca, setPendBusca] = useState('');
  const [ftBusca, setFtBusca] = useState('');
  const [ftStatus, setFtStatus] = useState('');
  const [showFtModal, setShowFtModal] = useState(false);
  const [ftEditingId, setFtEditingId] = useState(null);
  const [ftForm, setFtForm] = useState({
    funcionario_id: '', treinamento_id: '', data_realizacao: '',
    data_validade: '', carga_horaria: '', observacao: ''
  });
  const [ftCertificado, setFtCertificado] = useState(null);
  const [ftCertificadoAtual, setFtCertificadoAtual] = useState(null);
  const [buscaFuncFt, setBuscaFuncFt] = useState('');
  const [sugestoesFtAbertas, setSugestoesFtAbertas] = useState(false);
  const [sugestoesMatriz, setSugestoesMatriz] = useState([]);

  // ---- Aba ASO ----
  const [asos, setAsos] = useState([]);
  const [asoBusca, setAsoBusca] = useState('');
  const [asoStatus, setAsoStatus] = useState('');
  const [asoTipo, setAsoTipo] = useState('');
  const [showAsoModal, setShowAsoModal] = useState(false);
  const [asoEditingId, setAsoEditingId] = useState(null);
  const [asoForm, setAsoForm] = useState({
    funcionario_id: '', tipo_exame: 'admissional', data_exame: '',
    data_validade: '', validade_meses: '', medico_responsavel: '',
    clinica: '', resultado: 'apto', observacao: ''
  });
  const [asoCertificado, setAsoCertificado] = useState(null);
  const [asoCertificadoAtual, setAsoCertificadoAtual] = useState(null);
  const [buscaFuncAso, setBuscaFuncAso] = useState('');
  const [sugestoesAsoAbertas, setSugestoesAsoAbertas] = useState(false);

  // ---- Aba EPI ----
  const [epiAba, setEpiAba] = useState('catalogo'); // catalogo | fichas
  const [epis, setEpis] = useState([]);
  const [showEpiModal, setShowEpiModal] = useState(false);
  const [epiEditingId, setEpiEditingId] = useState(null);
  const [epiForm, setEpiForm] = useState({
    nome: '', categoria: '', ca_numero: '', fabricante: '', ca_validade: ''
  });
  const [funcEpis, setFuncEpis] = useState([]);
  const [feBusca, setFeBusca] = useState('');
  const [feStatus, setFeStatus] = useState('');
  const [showFeModal, setShowFeModal] = useState(false);
  const [feEditingId, setFeEditingId] = useState(null);
  const [feForm, setFeForm] = useState({
    funcionario_id: '', epi_id: '', data_entrega: '', data_devolucao: '',
    quantidade: 1, observacao: ''
  });
  const [buscaFuncFe, setBuscaFuncFe] = useState('');
  const [sugestoesFeAbertas, setSugestoesFeAbertas] = useState(false);

  useEffect(() => {
    fetchFuncionarios();
    if (tab === 'matriz') fetchMatriz();
    if (tab === 'treinamentos') { fetchFuncTreinamentos(); fetchPendencias(); }
    if (tab === 'aso') fetchAsos();
    if (tab === 'epi') { fetchEpis(); fetchFuncEpis(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ============================= Helpers =============================
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const formatDateBR = (dateStr) => {
    if (!dateStr) return '-';
    const parts = String(dateStr).split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return dateStr;
  };

  const addMonths = (dateStr, months) => {
    if (!dateStr || !months) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return '';
    const diasPorMes = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const mesIndex = m - 1 + months;
    const ano = y + Math.floor(mesIndex / 12);
    const mes = ((mesIndex % 12) + 12) % 12;
    const dia = Math.min(d, diasPorMes[mes]);
    return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  };

  const StatusBadge = ({ status }) => (
    <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold border ${STATUS_STYLES[status] || STATUS_STYLES['Sem validade']}`}>
      {status}
    </span>
  );

  const buscarFuncionarios = (termo, lista) =>
    termo.trim()
      ? lista.filter(f => f.nome.toLowerCase().includes(termo.toLowerCase())).slice(0, 8)
      : [];

  // ============================= Fetch =============================
  const fetchFuncionarios = async () => {
    try {
      const res = await apiFetch(`${API_URL}/funcionarios/`);
      if (res.ok) setFuncionarios(await res.json());
    } catch (err) {
      console.error('Erro ao buscar funcionários:', err);
    }
  };

  const fetchMatriz = async () => {
    try {
      setLoading(true);
      const [cargosRes, treinRes, matrizRes] = await Promise.all([
        apiFetch(`${API_URL}/sst/cargos`),
        apiFetch(`${API_URL}/sst/treinamentos`),
        apiFetch(`${API_URL}/sst/matriz`),
      ]);
      if (cargosRes.ok) setCargos(await cargosRes.json());
      if (treinRes.ok) setTreinamentos(await treinRes.json());
      if (matrizRes.ok) setMatriz(await matrizRes.json());
    } catch (err) {
      console.error(err);
      showToast('Erro ao carregar matriz de treinamentos.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchFuncTreinamentos = async () => {
    try {
      setLoading(true);
      listaTrein.iniciar();
      const res = await apiFetch(`${API_URL}/sst/funcionario-treinamentos`);
      if (res.ok) {
        setFuncTreinamentos(await res.json());
        listaTrein.sucesso();
      } else {
        listaTrein.falhar('Erro ao carregar treinamentos.');
      }
    } catch (err) {
      console.error(err);
      listaTrein.falhar('Erro de conexão ao carregar treinamentos.');
    } finally {
      setLoading(false);
    }
  };

  const fetchPendencias = async () => {
    try {
      listaPend.iniciar();
      const res = await apiFetch(`${API_URL}/sst/pendencias`);
      if (res.ok) {
        setPendencias(await res.json());
        listaPend.sucesso();
      } else {
        listaPend.falhar('Erro ao carregar pendências da matriz.');
      }
    } catch (err) {
      console.error(err);
      listaPend.falhar('Erro de conexão ao carregar pendências da matriz.');
    }
  };

  const fetchAsos = async () => {
    try {
      setLoading(true);
      listaAso.iniciar();
      const res = await apiFetch(`${API_URL}/sst/aso`);
      if (res.ok) {
        setAsos(await res.json());
        listaAso.sucesso();
      } else {
        listaAso.falhar('Erro ao carregar ASOs.');
      }
    } catch (err) {
      console.error(err);
      listaAso.falhar('Erro de conexão ao carregar ASOs.');
    } finally {
      setLoading(false);
    }
  };

  const fetchEpis = async () => {
    try {
      const res = await apiFetch(`${API_URL}/sst/epis`);
      if (res.ok) setEpis(await res.json());
    } catch (err) {
      console.error(err);
      showToast('Erro ao carregar EPIs.', 'error');
    }
  };

  const fetchFuncEpis = async () => {
    try {
      listaFe.iniciar();
      const res = await apiFetch(`${API_URL}/sst/funcionario-epis`);
      if (res.ok) {
        setFuncEpis(await res.json());
        listaFe.sucesso();
      } else {
        listaFe.falhar('Erro ao carregar fichas de EPI.');
      }
    } catch (err) {
      console.error(err);
      listaFe.falhar('Erro de conexão ao carregar fichas de EPI.');
    }
  };

  // ============================= Aba Matriz =============================
  const openAddCargo = () => {
    setCargoEditingId(null);
    setCargoForm({ nome: '', descricao: '' });
    setShowCargoModal(true);
  };

  const openEditCargo = (c) => {
    setCargoEditingId(c.id);
    setCargoForm({ nome: c.nome, descricao: c.descricao || '' });
    setShowCargoModal(true);
  };

  const handleCargoSubmit = async (e) => {
    e.preventDefault();
    if (!cargoForm.nome) {
      showToast('Nome do cargo é obrigatório.', 'error');
      return;
    }
    try {
      const method = cargoEditingId ? 'PUT' : 'POST';
      const url = cargoEditingId ? `${API_URL}/sst/cargos/${cargoEditingId}` : `${API_URL}/sst/cargos/`;
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cargoForm)
      });
      const resData = await res.json();
      if (res.ok) {
        showToast(cargoEditingId ? 'Cargo atualizado com sucesso!' : 'Cargo cadastrado com sucesso!');
        setShowCargoModal(false);
        fetchMatriz();
      } else {
        showToast(erroDaResposta(resData, 'Erro ao salvar cargo.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao salvar cargo.', 'error');
    }
  };

  const handleDeleteCargo = (id, nome) => {
    setConfirmarAcao({ tipo: 'cargo', id, nome });
  };

  const openAddTreinamento = () => {
    setTreinamentoEditingId(null);
    setTreinamentoForm({ nome: '', norma: '', tipo: '', validade_meses: '', carga_horaria: '', instituicao: '' });
    setShowTreinamentoModal(true);
  };

  const openEditTreinamento = (t) => {
    setTreinamentoEditingId(t.id);
    setTreinamentoForm({
      nome: t.nome, norma: t.norma || '', tipo: t.tipo || '',
      validade_meses: t.validade_meses || '', carga_horaria: t.carga_horaria || '', instituicao: t.instituicao || ''
    });
    setShowTreinamentoModal(true);
  };

  const handleTreinamentoSubmit = async (e) => {
    e.preventDefault();
    if (!treinamentoForm.nome) {
      showToast('Nome do curso é obrigatório.', 'error');
      return;
    }
    const payload = {
      ...treinamentoForm,
      validade_meses: treinamentoForm.validade_meses ? Number(treinamentoForm.validade_meses) : null,
      carga_horaria: treinamentoForm.carga_horaria ? Number(treinamentoForm.carga_horaria) : null,
    };
    try {
      const method = treinamentoEditingId ? 'PUT' : 'POST';
      const url = treinamentoEditingId ? `${API_URL}/sst/treinamentos/${treinamentoEditingId}` : `${API_URL}/sst/treinamentos/`;
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const resData = await res.json();
      if (res.ok) {
        showToast(treinamentoEditingId ? 'Curso atualizado com sucesso!' : 'Curso cadastrado com sucesso!');
        setShowTreinamentoModal(false);
        fetchMatriz();
      } else {
        showToast(erroDaResposta(resData, 'Erro ao salvar curso.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao salvar curso.', 'error');
    }
  };

  const handleDeleteTreinamento = (id, nome) => {
    setConfirmarAcao({ tipo: 'curso', id, nome });
  };

  const openVincular = () => {
    setVincularForm({ treinamento_id: '' });
    setShowVincularModal(true);
  };

  const handleVincularSubmit = async (e) => {
    e.preventDefault();
    if (!vincularForm.treinamento_id) {
      showToast('Selecione um curso.', 'error');
      return;
    }
    try {
      const res = await apiFetch(`${API_URL}/sst/matriz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cargo_id: cargoSelecionado, treinamento_id: Number(vincularForm.treinamento_id) })
      });
      const resData = await res.json();
      if (res.ok) {
        showToast('Curso vinculado ao cargo!');
        setShowVincularModal(false);
        fetchMatriz();
      } else {
        showToast(erroDaResposta(resData, 'Erro ao vincular curso.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao vincular curso.', 'error');
    }
  };

  const handleDesvincular = (vinculoId, cursoNome) => {
    setConfirmarAcao({ tipo: 'desvincular', id: vinculoId, nome: cursoNome });
  };

  const cursosDoCargo = (cargoId) => matriz.filter(m => m.cargo_id === cargoId);
  const cursosLivres = (cargoId) => {
    const vinculados = new Set(cursosDoCargo(cargoId).map(m => m.treinamento_id));
    return treinamentos.filter(t => !vinculados.has(t.id));
  };
  const funcionariosDoCargo = (cargoId) => funcionarios.filter(f => f.cargo_id === cargoId || f.cargo_id_2 === cargoId);

  // ============================= Aba Treinamentos =============================
  const filteredFuncTreinamentos = funcTreinamentos.filter(r => {
    if (ftStatus && r.status !== ftStatus) return false;
    if (ftBusca) {
      const termo = ftBusca.toLowerCase();
      if (!String(r.funcionario_nome || '').toLowerCase().includes(termo) &&
          !String(r.treinamento_nome || '').toLowerCase().includes(termo)) return false;
    }
    return true;
  });

  const pagFt = usePaginacao(filteredFuncTreinamentos, 50, [ftBusca, ftStatus, ftView]);

  const countsTreinamentos = {
    'Vigente': funcTreinamentos.filter(r => r.status === 'Vigente').length,
    'Próximo ao Vencimento': funcTreinamentos.filter(r => r.status === 'Próximo ao Vencimento').length,
    'Vencido': funcTreinamentos.filter(r => r.status === 'Vencido').length,
    'Sem validade': funcTreinamentos.filter(r => r.status === 'Sem validade').length,
  };

  const openAddFt = () => {
    setFtEditingId(null);
    setFtForm({ funcionario_id: '', treinamento_id: '', data_realizacao: '', data_validade: '', carga_horaria: '', observacao: '' });
    setBuscaFuncFt('');
    setSugestoesMatriz([]);
    setFtCertificado(null);
    setFtCertificadoAtual(null);
    setShowFtModal(true);
  };

  const openEditFt = (r) => {
    setFtEditingId(r.id);
    setFtForm({
      funcionario_id: r.funcionario_id, treinamento_id: r.treinamento_id,
      data_realizacao: r.data_realizacao || '', data_validade: r.data_validade || '',
      carga_horaria: r.carga_horaria || '', observacao: r.observacao || ''
    });
    const func = funcionarios.find(f => f.id === r.funcionario_id);
    setBuscaFuncFt(func ? func.nome : r.funcionario_nome || '');
    setSugestoesMatriz([]);
    setFtCertificado(null);
    setFtCertificadoAtual(r.certificado_nome || null);
    setShowFtModal(true);
  };

  const selecionarFuncFt = (func) => {
    setFtForm(prev => ({ ...prev, funcionario_id: func.id }));
    setBuscaFuncFt(func.nome);
    setSugestoesFtAbertas(false);
    const cargosIds = [func.cargo_id, func.cargo_id_2].filter(Boolean);
    if (cargosIds.length === 0) {
      setSugestoesMatriz([]);
      return;
    }
    Promise.all(
      cargosIds.map(cargoId =>
        apiFetch(`${API_URL}/sst/matriz?cargo_id=${cargoId}`)
          .then(res => res.ok ? res.json() : [])
      )
    )
      .then(resultados => {
        const vistos = new Set();
        const sugestoes = [];
        resultados.flat().forEach(sug => {
          if (vistos.has(sug.treinamento_id)) return;
          vistos.add(sug.treinamento_id);
          sugestoes.push(sug);
        });
        setSugestoesMatriz(sugestoes);
      })
      .catch(() => setSugestoesMatriz([]));
  };

  const handleFtCursoChange = (treinamentoId) => {
    setFtForm(prev => {
      const curso = treinamentos.find(t => t.id === Number(treinamentoId));
      let dataValidade = prev.data_validade;
      if (curso?.validade_meses && prev.data_realizacao) {
        dataValidade = addMonths(prev.data_realizacao, curso.validade_meses);
      }
      return { ...prev, treinamento_id: Number(treinamentoId), data_validade: dataValidade };
    });
  };

  const handleFtDataRealizacaoChange = (dateStr) => {
    setFtForm(prev => {
      const curso = treinamentos.find(t => t.id === prev.treinamento_id);
      let dataValidade = prev.data_validade;
      if (curso?.validade_meses && dateStr) {
        dataValidade = addMonths(dateStr, curso.validade_meses);
      }
      return { ...prev, data_realizacao: dateStr, data_validade: dataValidade };
    });
  };

  const adicionarSugestaoMatriz = (sug) => {
    if (!ftForm.data_realizacao) {
      showToast('Informe a data de realização primeiro.', 'error');
      return;
    }
    const curso = treinamentos.find(t => t.id === sug.treinamento_id);
    const dataValidade = curso?.validade_meses ? addMonths(ftForm.data_realizacao, curso.validade_meses) : '';
    setFtForm(prev => ({
      ...prev,
      treinamento_id: sug.treinamento_id,
      data_validade: dataValidade
    }));
  };

  const abrirRegistroPendencia = (p) => {
    setFtEditingId(null);
    setFtForm({
      funcionario_id: p.funcionario_id,
      treinamento_id: p.treinamento_id,
      data_realizacao: '',
      data_validade: '',
      carga_horaria: '',
      observacao: ''
    });
    setBuscaFuncFt(p.funcionario_nome);
    setSugestoesMatriz([]);
    setFtCertificado(null);
    setFtCertificadoAtual(null);
    setShowFtModal(true);
  };

  const filteredPendencias = pendencias.filter(p => {
    if (!pendBusca) return true;
    const termo = pendBusca.toLowerCase();
    return String(p.funcionario_nome || '').toLowerCase().includes(termo) ||
      String(p.treinamento_nome || '').toLowerCase().includes(termo) ||
      String(p.cargo_nome || '').toLowerCase().includes(termo);
  });

  const pagPend = usePaginacao(filteredPendencias, 50, [pendBusca]);

  const qtdPendentes = pendencias.filter(p => p.situacao === 'Pendente').length;
  const qtdVencidos = pendencias.filter(p => p.situacao === 'Vencido').length;

  const MIMES_CERTIFICADO = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

  const baixarCertificado = async (r) => {
    try {
      const res = await apiFetch(`${API_URL}/certificados/treinamento/${r.id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        showToast(erroDaResposta(data, 'Certificado não disponível.'), 'error');
        return;
      }
      const data = await res.json();
      window.open(data.url_temporaria, '_blank');
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao obter certificado.', 'error');
    }
  };

  const handleFtSubmit = async (e) => {
    e.preventDefault();
    if (!ftForm.funcionario_id || !ftForm.treinamento_id || !ftForm.data_realizacao) {
      showToast('Funcionário, curso e data de realização são obrigatórios.', 'error');
      return;
    }
    if (ftCertificado && !MIMES_CERTIFICADO.includes(ftCertificado.type)) {
      showToast('Certificado deve ser PDF, JPG, PNG ou WEBP.', 'error');
      return;
    }
    if (ftCertificado && ftCertificado.size > 15 * 1024 * 1024) {
      showToast('Certificado deve ter no máximo 15 MB.', 'error');
      return;
    }
    const payload = {
      ...ftForm,
      funcionario_id: Number(ftForm.funcionario_id),
      treinamento_id: Number(ftForm.treinamento_id),
      data_validade: ftForm.data_validade || null,
      carga_horaria: ftForm.carga_horaria ? Number(ftForm.carga_horaria) : null,
    };
    try {
      const method = ftEditingId ? 'PUT' : 'POST';
      const url = ftEditingId ? `${API_URL}/sst/funcionario-treinamentos/${ftEditingId}` : `${API_URL}/sst/funcionario-treinamentos/`;
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const resData = await res.json();
      if (!res.ok) {
        showToast(erroDaResposta(resData, 'Erro ao salvar treinamento.'), 'error');
        return;
      }
      if (ftCertificado) {
        const fd = new FormData();
        fd.append('arquivo', ftCertificado);
        const upRes = await apiFetch(`${API_URL}/certificados/treinamento/${resData.id}`, { method: 'POST', body: fd });
        if (!upRes.ok) {
          const upData = await upRes.json().catch(() => null);
          showToast(`Registro salvo, mas falha no upload do certificado: ${erroDaResposta(upData, 'erro no upload')}`, 'error');
          setShowFtModal(false);
          setFtCertificado(null);
          setFtCertificadoAtual(null);
          fetchFuncTreinamentos();
          fetchPendencias();
          return;
        }
      }
      showToast(ftEditingId ? 'Registro atualizado com sucesso!' : 'Treinamento registrado com sucesso!');
      setShowFtModal(false);
      setFtCertificado(null);
      setFtCertificadoAtual(null);
      fetchFuncTreinamentos();
      fetchPendencias();
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao salvar treinamento.', 'error');
    }
  };

  const handleDeleteFt = (id, label) => {
    setConfirmarAcao({ tipo: 'ft', id, nome: label });
  };

  // ============================= Aba ASO =============================
  const filteredAsos = asos.filter(a => {
    if (asoStatus && a.status !== asoStatus) return false;
    if (asoTipo && a.tipo_exame !== asoTipo) return false;
    if (asoBusca && !String(a.funcionario_nome || '').toLowerCase().includes(asoBusca.toLowerCase())) return false;
    return true;
  });

  const pagAso = usePaginacao(filteredAsos, 50, [asoBusca, asoStatus, asoTipo]);

  const countsAsos = {
    'Vigente': asos.filter(a => a.status === 'Vigente').length,
    'Próximo ao Vencimento': asos.filter(a => a.status === 'Próximo ao Vencimento').length,
    'Vencido': asos.filter(a => a.status === 'Vencido').length,
    'Sem validade': asos.filter(a => a.status === 'Sem validade').length,
  };

  const openAddAso = () => {
    setAsoEditingId(null);
    setAsoForm({ funcionario_id: '', tipo_exame: 'admissional', data_exame: '', data_validade: '', validade_meses: '', medico_responsavel: '', clinica: '', resultado: 'apto', observacao: '' });
    setBuscaFuncAso('');
    setAsoCertificado(null);
    setAsoCertificadoAtual(null);
    setShowAsoModal(true);
  };

  const openEditAso = (a) => {
    setAsoEditingId(a.id);
    setAsoForm({
      funcionario_id: a.funcionario_id, tipo_exame: a.tipo_exame || 'admissional',
      data_exame: a.data_exame || '', data_validade: a.data_validade || '',
      validade_meses: a.validade_meses || '', medico_responsavel: a.medico_responsavel || '',
      clinica: a.clinica || '', resultado: a.resultado || 'apto', observacao: a.observacao || ''
    });
    const func = funcionarios.find(f => f.id === a.funcionario_id);
    setBuscaFuncAso(func ? func.nome : a.funcionario_nome || '');
    setAsoCertificado(null);
    setAsoCertificadoAtual(a.documento_nome || null);
    setShowAsoModal(true);
  };

  const selecionarFuncAso = (func) => {
    setAsoForm(prev => ({ ...prev, funcionario_id: func.id }));
    setBuscaFuncAso(func.nome);
    setSugestoesAsoAbertas(false);
  };

  const handleAsoTipoChange = (tipo) => {
    setAsoForm(prev => {
      const novoTipo = tipo;
      if (novoTipo !== 'periodico') {
        return { ...prev, tipo_exame: novoTipo, data_validade: '', validade_meses: '' };
      }
      const validade = prev.validade_meses && prev.data_exame
        ? addMonths(prev.data_exame, Number(prev.validade_meses))
        : prev.data_validade;
      return { ...prev, tipo_exame: novoTipo, data_validade: validade };
    });
  };

  const handleAsoValidadeMesesChange = (meses) => {
    setAsoForm(prev => {
      const dataValidade = meses && prev.data_exame ? addMonths(prev.data_exame, Number(meses)) : prev.data_validade;
      return { ...prev, validade_meses: meses, data_validade: dataValidade };
    });
  };

  const handleAsoDataExameChange = (dateStr) => {
    setAsoForm(prev => {
      const dataValidade = prev.validade_meses && dateStr
        ? addMonths(dateStr, Number(prev.validade_meses))
        : prev.data_validade;
      return { ...prev, data_exame: dateStr, data_validade: dataValidade };
    });
  };

  const baixarDocumentoAso = async (a) => {
    try {
      const res = await apiFetch(`${API_URL}/certificados/aso/${a.id}`);
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

  const handleAsoSubmit = async (e) => {
    e.preventDefault();
    if (!asoForm.funcionario_id || !asoForm.data_exame) {
      showToast('Funcionário e data do exame são obrigatórios.', 'error');
      return;
    }
    if (asoCertificado && !MIMES_CERTIFICADO.includes(asoCertificado.type)) {
      showToast('Documento deve ser PDF, JPG, PNG ou WEBP.', 'error');
      return;
    }
    if (asoCertificado && asoCertificado.size > 15 * 1024 * 1024) {
      showToast('Documento deve ter no máximo 15 MB.', 'error');
      return;
    }
    const payload = {
      ...asoForm,
      funcionario_id: Number(asoForm.funcionario_id),
      validade_meses: asoForm.validade_meses ? Number(asoForm.validade_meses) : null,
      data_validade: asoForm.data_validade || null,
    };
    try {
      const method = asoEditingId ? 'PUT' : 'POST';
      const url = asoEditingId ? `${API_URL}/sst/aso/${asoEditingId}` : `${API_URL}/sst/aso/`;
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const resData = await res.json();
      if (!res.ok) {
        showToast(erroDaResposta(resData, 'Erro ao salvar ASO.'), 'error');
        return;
      }
      if (asoCertificado) {
        const fd = new FormData();
        fd.append('arquivo', asoCertificado);
        const upRes = await apiFetch(`${API_URL}/certificados/aso/${resData.id}`, { method: 'POST', body: fd });
        if (!upRes.ok) {
          const upData = await upRes.json().catch(() => null);
          showToast(`ASO salvo, mas falha no upload do documento: ${erroDaResposta(upData, 'erro no upload')}`, 'error');
          setShowAsoModal(false);
          setAsoCertificado(null);
          setAsoCertificadoAtual(null);
          fetchAsos();
          return;
        }
      }
      showToast(asoEditingId ? 'ASO atualizado com sucesso!' : 'ASO cadastrado com sucesso!');
      setShowAsoModal(false);
      setAsoCertificado(null);
      setAsoCertificadoAtual(null);
      fetchAsos();
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao salvar ASO.', 'error');
    }
  };

  const handleDeleteAso = (id, label) => {
    setConfirmarAcao({ tipo: 'aso', id, nome: label });
  };

  // ============================= Aba EPI =============================
  const openAddEpi = () => {
    setEpiEditingId(null);
    setEpiForm({ nome: '', categoria: '', ca_numero: '', fabricante: '', ca_validade: '' });
    setShowEpiModal(true);
  };

  const openEditEpi = (e) => {
    setEpiEditingId(e.id);
    setEpiForm({
      nome: e.nome, categoria: e.categoria || '', ca_numero: e.ca_numero || '',
      fabricante: e.fabricante || '', ca_validade: e.ca_validade || ''
    });
    setShowEpiModal(true);
  };

  const handleEpiSubmit = async (e) => {
    e.preventDefault();
    if (!epiForm.nome) {
      showToast('Nome do EPI é obrigatório.', 'error');
      return;
    }
    const payload = { ...epiForm, ca_validade: epiForm.ca_validade || null };
    try {
      const method = epiEditingId ? 'PUT' : 'POST';
      const url = epiEditingId ? `${API_URL}/sst/epis/${epiEditingId}` : `${API_URL}/sst/epis/`;
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const resData = await res.json();
      if (res.ok) {
        showToast(epiEditingId ? 'EPI atualizado com sucesso!' : 'EPI cadastrado com sucesso!');
        setShowEpiModal(false);
        fetchEpis();
      } else {
        showToast(erroDaResposta(resData, 'Erro ao salvar EPI.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao salvar EPI.', 'error');
    }
  };

  const handleDeleteEpi = (id, nome) => {
    setConfirmarAcao({ tipo: 'epi', id, nome });
  };

  const epiPorId = (id) => epis.find(e => e.id === Number(id));
  const epiSelecionadoCaVencido = feForm.epi_id && epiPorId(feForm.epi_id)?.ca_status === 'CA Vencido';

  const openAddFe = () => {
    setFeEditingId(null);
    setFeForm({ funcionario_id: '', epi_id: '', data_entrega: '', data_devolucao: '', quantidade: 1, observacao: '' });
    setBuscaFuncFe('');
    setShowFeModal(true);
  };

  const openEditFe = (f) => {
    setFeEditingId(f.id);
    setFeForm({
      funcionario_id: f.funcionario_id, epi_id: f.epi_id, data_entrega: f.data_entrega || '',
      data_devolucao: f.data_devolucao || '', quantidade: f.quantidade || 1, observacao: f.observacao || ''
    });
    const func = funcionarios.find(x => x.id === f.funcionario_id);
    setBuscaFuncFe(func ? func.nome : f.funcionario_nome || '');
    setShowFeModal(true);
  };

  const selecionarFuncFe = (func) => {
    setFeForm(prev => ({ ...prev, funcionario_id: func.id }));
    setBuscaFuncFe(func.nome);
    setSugestoesFeAbertas(false);
  };

  const handleFeSubmit = async (e) => {
    e.preventDefault();
    if (!feForm.funcionario_id || !feForm.epi_id || !feForm.data_entrega) {
      showToast('Funcionário, EPI e data de entrega são obrigatórios.', 'error');
      return;
    }
    const payload = {
      ...feForm,
      funcionario_id: Number(feForm.funcionario_id),
      epi_id: Number(feForm.epi_id),
      quantidade: Number(feForm.quantidade) || 1,
      data_devolucao: feForm.data_devolucao || null,
    };
    try {
      const method = feEditingId ? 'PUT' : 'POST';
      const url = feEditingId ? `${API_URL}/sst/funcionario-epis/${feEditingId}` : `${API_URL}/sst/funcionario-epis/`;
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const resData = await res.json();
      if (res.ok) {
        showToast(feEditingId ? 'Ficha atualizada com sucesso!' : 'Entrega de EPI registrada com sucesso!');
        setShowFeModal(false);
        fetchFuncEpis();
      } else {
        showToast(erroDaResposta(resData, 'Erro ao salvar ficha de EPI.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao salvar ficha de EPI.', 'error');
    }
  };

  const handleDeleteFe = (id, label) => {
    setConfirmarAcao({ tipo: 'fe', id, nome: label });
  };

  const confirmarExecucao = async () => {
    if (!confirmarAcao) return;
    const { tipo, id } = confirmarAcao;
    try {
      let res;
      if (tipo === 'cargo') {
        res = await apiFetch(`${API_URL}/sst/cargos/${id}`, { method: 'DELETE' });
        if (res.ok) {
          showToast('Cargo excluído com sucesso.');
          if (cargoSelecionado === id) setCargoSelecionado(null);
          fetchMatriz();
        } else {
          showToast('Erro ao excluir cargo.', 'error');
        }
      } else if (tipo === 'curso') {
        res = await apiFetch(`${API_URL}/sst/treinamentos/${id}`, { method: 'DELETE' });
        if (res.ok) {
          showToast('Curso excluído com sucesso.');
          fetchMatriz();
        } else {
          showToast('Erro ao excluir curso.', 'error');
        }
      } else if (tipo === 'desvincular') {
        res = await apiFetch(`${API_URL}/sst/matriz/${id}`, { method: 'DELETE' });
        if (res.ok) {
          showToast('Curso desvinculado do cargo.');
          fetchMatriz();
        } else {
          showToast('Erro ao desvincular curso.', 'error');
        }
      } else if (tipo === 'ft') {
        res = await apiFetch(`${API_URL}/sst/funcionario-treinamentos/${id}`, { method: 'DELETE' });
        if (res.ok) {
          showToast('Registro excluído com sucesso.');
          fetchFuncTreinamentos();
          fetchPendencias();
        } else {
          showToast('Erro ao excluir registro.', 'error');
        }
      } else if (tipo === 'aso') {
        res = await apiFetch(`${API_URL}/sst/aso/${id}`, { method: 'DELETE' });
        if (res.ok) {
          showToast('ASO excluído com sucesso.');
          fetchAsos();
        } else {
          showToast('Erro ao excluir ASO.', 'error');
        }
      } else if (tipo === 'epi') {
        res = await apiFetch(`${API_URL}/sst/epis/${id}`, { method: 'DELETE' });
        if (res.ok) {
          showToast('EPI excluído com sucesso.');
          fetchEpis();
        } else {
          showToast('Erro ao excluir EPI.', 'error');
        }
      } else if (tipo === 'fe') {
        res = await apiFetch(`${API_URL}/sst/funcionario-epis/${id}`, { method: 'DELETE' });
        if (res.ok) {
          showToast('Ficha de EPI excluída com sucesso.');
          fetchFuncEpis();
        } else {
          showToast('Erro ao excluir ficha de EPI.', 'error');
        }
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao executar exclusão.', 'error');
    } finally {
      setConfirmarAcao(null);
    }
  };

  const baixarPdfFicha = async (id) => {
    try {
      const res = await apiFetch(`${API_URL}/sst/funcionario-epis/${id}/pdf`);
      if (!res.ok) {
        showToast('Erro ao gerar o PDF.', 'error');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ficha_epi_${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Ficha de EPI em PDF gerada!');
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao gerar o PDF.', 'error');
    }
  };

  const filteredFuncEpis = funcEpis.filter(f => {
    if (feStatus && f.status !== feStatus) return false;
    if (feBusca) {
      const termo = feBusca.toLowerCase();
      if (!String(f.funcionario_nome || '').toLowerCase().includes(termo) &&
          !String(f.epi_nome || '').toLowerCase().includes(termo)) return false;
    }
    return true;
  });

  const pagFe = usePaginacao(filteredFuncEpis, 50, [feBusca, feStatus]);

  // ============================= UI =============================
  return (
    <div className="space-y-6">
      {/* Estilos para impressão */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          @page { margin: 8mm; }
          body { background-color: white !important; color: black !important; }
          aside, header, button, input, select, .print\\:hidden, .no-print { display: none !important; }
          main { padding: 0 !important; margin: 0 !important; }
          html, body { height: auto !important; max-height: none !important; overflow: visible !important; }
          .flex-1.overflow-y-auto { overflow: visible !important; height: auto !important; max-height: none !important; }
          .flex.h-dvh.overflow-hidden,
          .flex.h-screen.overflow-hidden,
          main { overflow: visible !important; height: auto !important; max-height: none !important; min-height: 0 !important; }
          table { width: 100% !important; border-collapse: collapse !important; }
          th, td { border: 1px solid #cbd5e1 !important; padding: 4px 6px !important; font-size: 9px !important; }
          .print-full-width { width: 100% !important; max-width: 100% !important; border: none !important; box-shadow: none !important; overflow: visible !important; }
        }
      `}} />

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-xl shadow-xl flex items-center gap-3 border text-sm max-w-sm animate-in slide-in-from-top-4 duration-300 ${
          toast.type === 'error'
            ? 'bg-rose-50 border-rose-200 text-rose-800'
            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          <div className={`p-1 rounded-full ${toast.type === 'error' ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>
            {toast.type === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}
          </div>
          <p className="font-semibold">{typeof toast.message === 'string' ? toast.message : 'Erro inesperado.'}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'matriz', label: 'Matriz de Treinamentos', icon: Briefcase },
          { id: 'treinamentos', label: 'Vencimentos de Cursos', icon: GraduationCap },
          { id: 'aso', label: 'ASO', icon: Stethoscope },
          { id: 'epi', label: 'Ficha de EPI', icon: HardHat },
        ].map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                tab === t.id
                  ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon size={16} />
              {t.label}
            </button>
          );
        })}
        <button
          onClick={() => setShowDocsModal(true)}
          title="Abrir pasta de Documentos Diversos (upload e download)"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border border-dashed border-primary-300 text-primary-700 bg-primary-50 hover:bg-primary-100 transition-all cursor-pointer"
        >
          <FolderOpen size={16} />
          Documentos Diversos
        </button>
      </div>

      {/* ================= ABAS ================= */}
      {tab === 'matriz' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Cargos */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-700 uppercase tracking-wider">Cargos / Funções</h3>
              <button
                onClick={openAddCargo}
                className="flex items-center gap-1 px-2.5 py-1.5 min-h-11 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
              >
                <Plus size={14} /> Novo
              </button>
            </div>
            <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
              {cargos.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-400">Nenhum cargo cadastrado.</p>
              ) : cargos.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCargoSelecionado(c.id)}
                  className={`w-full text-left px-4 py-3 flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    cargoSelecionado === c.id ? 'bg-primary-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-slate-800 truncate">{c.nome}</p>
                    <p className="text-[11px] text-slate-400 font-semibold">
                      {cursosDoCargo(c.id).length} curso(s) · {funcionariosDoCargo(c.id).length} funcionário(s)
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      onClick={(e) => { e.stopPropagation(); openEditCargo(c); }}
                      className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 text-slate-500 hover:text-amber-700 hover:bg-amber-50 border border-slate-100"
                      title="Editar"
                    >
                      <Edit2 size={13} />
                    </span>
                    <span
                      onClick={(e) => { e.stopPropagation(); handleDeleteCargo(c.id, c.nome); }}
                      className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 text-slate-500 hover:text-rose-700 hover:bg-rose-50 border border-slate-100"
                      title="Excluir"
                    >
                      <Trash2 size={13} />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Cursos do cargo selecionado */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-slate-700 uppercase tracking-wider">
                  {cargoSelecionado ? `Cursos obrigatórios - ${cargos.find(c => c.id === cargoSelecionado)?.nome || ''}` : 'Cursos obrigatórios do cargo'}
                </h3>
                <p className="text-[11px] text-slate-400 font-semibold mt-0.5">
                  Vincule os treinamentos (NR-10, NR-35 etc.) obrigatórios para o cargo selecionado.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCatalogoModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 min-h-11 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer border border-slate-200"
                >
                  <FileText size={14} /> Gerenciar Cursos
                </button>
                {cargoSelecionado && (
                  <button
                    onClick={openVincular}
                    className="flex items-center gap-1.5 px-3 py-2 min-h-11 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    <Link2 size={14} /> Vincular Curso
                  </button>
                )}
              </div>
            </div>

            <div className="p-4">
              {!cargoSelecionado ? (
                <div className="text-center py-14 text-slate-400">
                  <Briefcase className="mx-auto mb-3 text-slate-300" size={40} />
                  <p className="font-semibold text-sm">Selecione um cargo ao lado para ver seus cursos obrigatórios.</p>
                </div>
              ) : cursosDoCargo(cargoSelecionado).length === 0 ? (
                <div className="text-center py-14 text-slate-400">
                  <Link2 className="mx-auto mb-3 text-slate-300" size={40} />
                  <p className="font-semibold text-sm">Nenhum curso vinculado a este cargo ainda.</p>
                  <p className="text-xs mt-1">Clique em &quot;Vincular Curso&quot; para adicionar treinamentos obrigatórios.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {cursosDoCargo(cargoSelecionado).map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/50">
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-slate-800">{m.treinamento_nome}</p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {m.norma && <span className="px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-100 text-[10px] font-bold">{m.norma}</span>}
                          {m.tipo && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold">{m.tipo}</span>}
                          {m.validade_meses && <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100 text-[10px] font-bold">Reciclagem: {m.validade_meses} meses</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDesvincular(m.id, m.treinamento_nome)}
                        className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-100 text-slate-500 hover:text-rose-700 hover:bg-rose-50 border border-slate-200 transition-colors shrink-0 cursor-pointer"
                        title="Desvincular"
                      >
                        <Unlink size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'treinamentos' && (
        <>
          {/* Alternador: Vencimentos / Pendências da Matriz */}
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'vencimentos', label: 'Vencimentos de Cursos', icon: GraduationCap },
              { id: 'pendencias', label: 'Pendências da Matriz', icon: ListChecks },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setFtView(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                  ftView === t.id
                    ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <t.icon size={15} />
                {t.label}
                {t.id === 'pendencias' && (qtdPendentes + qtdVencidos) > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[9px] font-bold">
                    {qtdPendentes + qtdVencidos}
                  </span>
                )}
              </button>
            ))}
          </div>

          {ftView === 'vencimentos' ? (
          <>
          {/* Cards resumo */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(countsTreinamentos).map(([status, qtd]) => (
              <div key={status} className={`rounded-2xl border p-4 ${STATUS_STYLES[status]}`}>
                <span className="block text-2xl font-extrabold">{qtd}</span>
                <span className="block text-[11px] font-bold uppercase tracking-wider mt-1">{status}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
            <div className="relative w-full md:w-96">
              <Search className="absolute left-3.5 top-3 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="Buscar por funcionário ou curso..."
                value={ftBusca}
                onChange={(e) => setFtBusca(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm"
              />
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <select
                value={ftStatus}
                onChange={(e) => setFtStatus(e.target.value)}
                className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              >
                <option value="">Status: Todos</option>
                <option value="Vigente">Vigente</option>
                <option value="Próximo ao Vencimento">Próximo ao Vencimento</option>
                <option value="Vencido">Vencido</option>
                <option value="Sem validade">Sem validade</option>
              </select>
              <button
                onClick={openAddFt}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold text-sm transition-all shadow-md shadow-primary-900/10 cursor-pointer w-full sm:w-auto"
              >
                <Plus size={18} /> Novo Registro
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-xs uppercase tracking-wider">
                    <th className="px-3 py-3 md:px-6 md:py-4">Funcionário</th>
                    <th className="px-3 py-3 md:px-6 md:py-4">Curso</th>
                    <th className="px-3 py-3 md:px-6 md:py-4">Data Realização</th>
                    <th className="px-3 py-3 md:px-6 md:py-4">Validade</th>
                    <th className="px-3 py-3 md:px-6 md:py-4">Status</th>
                    <th className="px-3 py-3 md:px-6 md:py-4 text-center">Certificado</th>
                    <th className="px-3 py-3 md:px-6 md:py-4 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {loading ? (
                    <tr>
                      <td colSpan="7" className="text-center py-12 text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-3">
                          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                          <p className="text-xs">Carregando...</p>
                        </div>
                      </td>
                    </tr>
                  ) : listaTrein.status === 'error' ? (
                    <tr>
                      <td colSpan="7">
                        <ErroCarregamento mensagem={listaTrein.erro} onTentarNovamente={fetchFuncTreinamentos} />
                      </td>
                    </tr>
                  ) : filteredFuncTreinamentos.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="text-center py-16 text-slate-400">
                        <GraduationCap className="mx-auto mb-3 text-slate-300" size={40} />
                        <p className="font-semibold">Nenhum registro encontrado.</p>
                      </td>
                    </tr>
                  ) : (
                    pagFt.itensPagina.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-3 py-3 md:px-6 md:py-4 font-bold text-slate-900">{r.funcionario_nome}</td>
                        <td className="px-3 py-3 md:px-6 md:py-4">
                          {r.treinamento_nome}
                          {r.norma && <span className="ml-2 px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 border border-primary-100 text-[9px] font-bold">{r.norma}</span>}
                        </td>
                        <td className="px-3 py-3 md:px-6 md:py-4">{formatDateBR(r.data_realizacao)}</td>
                        <td className="px-3 py-3 md:px-6 md:py-4">{formatDateBR(r.data_validade)}</td>
                        <td className="px-3 py-3 md:px-6 md:py-4"><StatusBadge status={r.status} /></td>
                        <td className="px-3 py-3 md:px-6 md:py-4">
                          <div className="flex justify-center items-center gap-2">
                            {r.tem_certificado ? (
                              <button onClick={() => baixarCertificado(r)} className="w-11 h-11 flex items-center justify-center p-0 rounded bg-primary-50 hover:bg-primary-100 text-primary-700 border border-primary-100 transition-colors" title={`Baixar certificado (${r.certificado_nome || ''})`}>
                                <Download size={15} />
                              </button>
                            ) : (
                              <button onClick={() => openEditFt(r)} className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-primary-50 text-slate-400 hover:text-primary-600 border border-slate-100 transition-colors" title="Anexar certificado">
                                <Upload size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 md:px-6 md:py-4">
                          <div className="flex justify-center items-center gap-2">
                            <button onClick={() => openEditFt(r)} className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors" title="Editar">
                              <Edit2 size={15} />
                            </button>
                            <button onClick={() => handleDeleteFt(r.id, `${r.funcionario_nome} - ${r.treinamento_nome}`)} className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors" title="Excluir">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <PaginacaoControle
                paginaAtualSegura={pagFt.paginaAtualSegura}
                totalPaginas={pagFt.totalPaginas}
                onAnterior={() => pagFt.setPaginaAtual(p => Math.max(1, p - 1))}
                onProximo={() => pagFt.setPaginaAtual(p => Math.min(pagFt.totalPaginas, p + 1))}
              />
            </div>
          </div>
          </>
        ) : (
          <>
            {/* Cards resumo pendências */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border p-4 bg-rose-50 text-rose-700 border-rose-100">
                <span className="block text-2xl font-extrabold">{qtdPendentes}</span>
                <span className="block text-[11px] font-bold uppercase tracking-wider mt-1">Pendentes (nunca realizados)</span>
              </div>
              <div className="rounded-2xl border p-4 bg-amber-50 text-amber-700 border-amber-100">
                <span className="block text-2xl font-extrabold">{qtdVencidos}</span>
                <span className="block text-[11px] font-bold uppercase tracking-wider mt-1">Vencidos (reciclagem)</span>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <div className="relative w-full md:w-96">
                <Search className="absolute left-3.5 top-3 text-slate-400" size={18} />
                <input
                  type="text"
                  placeholder="Buscar por funcionário, cargo ou curso..."
                  value={pendBusca}
                  onChange={(e) => setPendBusca(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm"
                />
              </div>
              <p className="text-xs text-slate-400 font-semibold">
                Treinamentos obrigatórios da Matriz ainda não realizados ou com reciclagem vencida.
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-xs uppercase tracking-wider">
                      <th className="px-3 py-3 md:px-6 md:py-4">Funcionário</th>
                      <th className="px-3 py-3 md:px-6 md:py-4">Cargo</th>
                      <th className="px-3 py-3 md:px-6 md:py-4">Curso Obrigatório</th>
                      <th className="px-3 py-3 md:px-6 md:py-4">Situação</th>
                      <th className="px-3 py-3 md:px-6 md:py-4">Última Validade</th>
                      <th className="px-3 py-3 md:px-6 md:py-4 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {loading ? (
                      <tr>
                        <td colSpan="6" className="text-center py-12 text-slate-400">
                          <div className="flex flex-col items-center justify-center gap-3">
                            <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-xs">Carregando...</p>
                          </div>
                        </td>
                      </tr>
                    ) : listaPend.status === 'error' ? (
                      <tr>
                        <td colSpan="6">
                          <ErroCarregamento mensagem={listaPend.erro} onTentarNovamente={fetchPendencias} />
                        </td>
                      </tr>
                    ) : filteredPendencias.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="text-center py-16 text-slate-400">
                          <ListChecks className="mx-auto mb-3 text-emerald-300" size={40} />
                          <p className="font-semibold">Nenhuma pendência! Todos os treinamentos obrigatórios estão em dia.</p>
                        </td>
                      </tr>
                    ) : (
                      pagPend.itensPagina.map((p, idx) => (
                        <tr key={`${p.funcionario_id}-${p.treinamento_id}-${idx}`} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-3 py-3 md:px-6 md:py-4 font-bold text-slate-900">{p.funcionario_nome}</td>
                          <td className="px-3 py-3 md:px-6 md:py-4">{p.cargo_nome}</td>
                          <td className="px-3 py-3 md:px-6 md:py-4">
                            {p.treinamento_nome}
                            {p.norma && <span className="ml-2 px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 border border-primary-100 text-[9px] font-bold">{p.norma}</span>}
                            {p.validade_meses && <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100 text-[9px] font-bold">{p.validade_meses}m</span>}
                          </td>
                          <td className="px-3 py-3 md:px-6 md:py-4">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                              p.situacao === 'Pendente'
                                ? 'bg-rose-50 text-rose-700 border-rose-100'
                                : 'bg-amber-50 text-amber-700 border-amber-100'
                            }`}>
                              {p.situacao}
                            </span>
                          </td>
                          <td className="px-3 py-3 md:px-6 md:py-4">{formatDateBR(p.ultima_validade)}</td>
                          <td className="px-3 py-3 md:px-6 md:py-4">
                            <div className="flex justify-center items-center gap-2">
                              <button
                                onClick={() => abrirRegistroPendencia(p)}
                                className="flex items-center gap-1.5 px-3 py-2 min-h-11 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                                title="Registrar treinamento"
                              >
                                <Plus size={13} /> Registrar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                <PaginacaoControle
                  paginaAtualSegura={pagPend.paginaAtualSegura}
                  totalPaginas={pagPend.totalPaginas}
                  onAnterior={() => pagPend.setPaginaAtual(p => Math.max(1, p - 1))}
                  onProximo={() => pagPend.setPaginaAtual(p => Math.min(pagPend.totalPaginas, p + 1))}
                />
              </div>
            </div>
          </>
        )}
        </>
      )}

      {tab === 'aso' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(countsAsos).map(([status, qtd]) => (
              <div key={status} className={`rounded-2xl border p-4 ${STATUS_STYLES[status]}`}>
                <span className="block text-2xl font-extrabold">{qtd}</span>
                <span className="block text-[11px] font-bold uppercase tracking-wider mt-1">{status}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
            <div className="relative w-full md:w-96">
              <Search className="absolute left-3.5 top-3 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="Buscar por funcionário..."
                value={asoBusca}
                onChange={(e) => setAsoBusca(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
              <select value={asoTipo} onChange={(e) => setAsoTipo(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500">
                <option value="">Exame: Todos</option>
                {TIPOS_EXAME.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <select value={asoStatus} onChange={(e) => setAsoStatus(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500">
                <option value="">Status: Todos</option>
                <option value="Vigente">Vigente</option>
                <option value="Próximo ao Vencimento">Próximo ao Vencimento</option>
                <option value="Vencido">Vencido</option>
                <option value="Sem validade">Sem validade</option>
              </select>
              <button onClick={openAddAso} className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold text-sm transition-all shadow-md shadow-primary-900/10 cursor-pointer w-full sm:w-auto">
                <Plus size={18} /> Novo ASO
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-xs uppercase tracking-wider">
                    <th className="px-3 py-3 md:px-6 md:py-4">Funcionário</th>
                    <th className="px-3 py-3 md:px-6 md:py-4">Tipo Exame</th>
                    <th className="px-3 py-3 md:px-6 md:py-4">Data Exame</th>
                    <th className="px-3 py-3 md:px-6 md:py-4">Validade</th>
                    <th className="px-3 py-3 md:px-6 md:py-4">Resultado</th>
                    <th className="px-3 py-3 md:px-6 md:py-4">Status</th>
                    <th className="px-3 py-3 md:px-6 md:py-4 text-center">Documento</th>
                    <th className="px-3 py-3 md:px-6 md:py-4 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {loading ? (
                    <tr>
                      <td colSpan="8" className="text-center py-12 text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-3">
                          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                          <p className="text-xs">Carregando...</p>
                        </div>
                      </td>
                    </tr>
                  ) : listaAso.status === 'error' ? (
                    <tr>
                      <td colSpan="8">
                        <ErroCarregamento mensagem={listaAso.erro} onTentarNovamente={fetchAsos} />
                      </td>
                    </tr>
                  ) : filteredAsos.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="text-center py-16 text-slate-400">
                        <Stethoscope className="mx-auto mb-3 text-slate-300" size={40} />
                        <p className="font-semibold">Nenhum ASO encontrado.</p>
                      </td>
                    </tr>
                  ) : (
                    pagAso.itensPagina.map(a => (
                      <tr key={a.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-3 py-3 md:px-6 md:py-4 font-bold text-slate-900">{a.funcionario_nome}</td>
                        <td className="px-3 py-3 md:px-6 md:py-4">{TIPOS_EXAME.find(t => t.value === a.tipo_exame)?.label || a.tipo_exame}</td>
                        <td className="px-3 py-3 md:px-6 md:py-4">{formatDateBR(a.data_exame)}</td>
                        <td className="px-3 py-3 md:px-6 md:py-4">{formatDateBR(a.data_validade)}</td>
                        <td className="px-3 py-3 md:px-6 md:py-4">
                          <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                            a.resultado === 'apto' ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                              : a.resultado === 'apto_com_restricao' ? 'bg-amber-50 text-amber-700 border-amber-100'
                              : 'bg-rose-50 text-rose-700 border-rose-100'
                          }`}>
                            {RESULTADO_ASO.find(r => r.value === a.resultado)?.label || a.resultado}
                          </span>
                        </td>
                        <td className="px-3 py-3 md:px-6 md:py-4"><StatusBadge status={a.status} /></td>
                        <td className="px-3 py-3 md:px-6 md:py-4">
                          <div className="flex justify-center items-center gap-2">
                            {a.tem_documento ? (
                              <button onClick={() => baixarDocumentoAso(a)} className="w-11 h-11 flex items-center justify-center p-0 rounded bg-primary-50 hover:bg-primary-100 text-primary-700 border border-primary-100 transition-colors" title={`Baixar documento (${a.documento_nome || ''})`}>
                                <Download size={15} />
                              </button>
                            ) : (
                              <button onClick={() => openEditAso(a)} className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-primary-50 text-slate-400 hover:text-primary-600 border border-slate-100 transition-colors" title="Anexar documento do ASO">
                                <Upload size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 md:px-6 md:py-4">
                          <div className="flex justify-center items-center gap-2">
                            <button onClick={() => openEditAso(a)} className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors" title="Editar">
                              <Edit2 size={15} />
                            </button>
                            <button onClick={() => handleDeleteAso(a.id, a.funcionario_nome)} className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors" title="Excluir">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <PaginacaoControle
                paginaAtualSegura={pagAso.paginaAtualSegura}
                totalPaginas={pagAso.totalPaginas}
                onAnterior={() => pagAso.setPaginaAtual(p => Math.max(1, p - 1))}
                onProximo={() => pagAso.setPaginaAtual(p => Math.min(pagAso.totalPaginas, p + 1))}
              />
            </div>
          </div>
        </>
      )}

      {tab === 'epi' && (
        <>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'catalogo', label: 'Catálogo de EPIs (CA)', icon: HardHat },
              { id: 'fichas', label: 'Fichas de Entrega', icon: FileText },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setEpiAba(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                  epiAba === t.id
                    ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <t.icon size={15} />
                {t.label}
              </button>
            ))}
          </div>

          {epiAba === 'catalogo' ? (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-700 uppercase tracking-wider">Catálogo de EPIs</h3>
                  <p className="text-[11px] text-slate-400 font-semibold">Controle do Certificado de Aprovação (CA) por equipamento.</p>
                </div>
                <button onClick={openAddEpi} className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold text-xs transition-all cursor-pointer">
                  <Plus size={15} /> Novo EPI
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-xs uppercase tracking-wider">
                      <th className="px-3 py-3 md:px-6 md:py-4">EPI</th>
                      <th className="px-3 py-3 md:px-6 md:py-4">Categoria</th>
                      <th className="px-3 py-3 md:px-6 md:py-4">CA</th>
                      <th className="px-3 py-3 md:px-6 md:py-4">Fabricante</th>
                      <th className="px-3 py-3 md:px-6 md:py-4">Validade CA</th>
                      <th className="px-3 py-3 md:px-6 md:py-4">Situação CA</th>
                      <th className="px-3 py-3 md:px-6 md:py-4 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {epis.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="text-center py-16 text-slate-400">
                          <HardHat className="mx-auto mb-3 text-slate-300" size={40} />
                          <p className="font-semibold">Nenhum EPI cadastrado.</p>
                        </td>
                      </tr>
                    ) : epis.map(e => (
                      <tr key={e.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-3 py-3 md:px-6 md:py-4 font-bold text-slate-900">{e.nome}</td>
                        <td className="px-3 py-3 md:px-6 md:py-4">{e.categoria || '-'}</td>
                        <td className="px-3 py-3 md:px-6 md:py-4 font-semibold">{e.ca_numero || '-'}</td>
                        <td className="px-3 py-3 md:px-6 md:py-4">{e.fabricante || '-'}</td>
                        <td className="px-3 py-3 md:px-6 md:py-4">{formatDateBR(e.ca_validade)}</td>
                        <td className="px-3 py-3 md:px-6 md:py-4">
                          <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                            e.ca_status === 'Válido'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                              : e.ca_status === 'CA Vencido'
                                ? 'bg-rose-50 text-rose-700 border-rose-100'
                                : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}>
                            {e.ca_status}
                          </span>
                        </td>
                        <td className="px-3 py-3 md:px-6 md:py-4">
                          <div className="flex justify-center items-center gap-2">
                            <button onClick={() => openEditEpi(e)} className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors" title="Editar">
                              <Edit2 size={15} />
                            </button>
                            <button onClick={() => handleDeleteEpi(e.id, e.nome)} className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors" title="Excluir">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <div className="relative w-full md:w-96">
                  <Search className="absolute left-3.5 top-3 text-slate-400" size={18} />
                  <input
                    type="text"
                    placeholder="Buscar por funcionário ou EPI..."
                    value={feBusca}
                    onChange={(e) => setFeBusca(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm"
                  />
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                  <select value={feStatus} onChange={(e) => setFeStatus(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500">
                    <option value="">Status: Todos</option>
                    <option value="Em uso">Em uso</option>
                    <option value="Devolvido">Devolvido</option>
                  </select>
                  <button onClick={openAddFe} className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold text-sm transition-all shadow-md shadow-primary-900/10 cursor-pointer w-full sm:w-auto">
                    <Plus size={18} /> Registrar Entrega
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-xs uppercase tracking-wider">
                        <th className="px-3 py-3 md:px-6 md:py-4">Funcionário</th>
                        <th className="px-3 py-3 md:px-6 md:py-4">EPI</th>
                        <th className="px-3 py-3 md:px-6 md:py-4">CA</th>
                        <th className="px-3 py-3 md:px-6 md:py-4">Qtd</th>
                        <th className="px-3 py-3 md:px-6 md:py-4">Entrega</th>
                        <th className="px-3 py-3 md:px-6 md:py-4">Devolução</th>
                        <th className="px-3 py-3 md:px-6 md:py-4">Status</th>
                        <th className="px-3 py-3 md:px-6 md:py-4 text-center">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {listaFe.status === 'error' ? (
                        <tr>
                          <td colSpan="8">
                            <ErroCarregamento mensagem={listaFe.erro} onTentarNovamente={fetchFuncEpis} />
                          </td>
                        </tr>
                      ) : filteredFuncEpis.length === 0 ? (
                        <tr>
                          <td colSpan="8" className="text-center py-16 text-slate-400">
                            <FileText className="mx-auto mb-3 text-slate-300" size={40} />
                            <p className="font-semibold">Nenhuma ficha de entrega encontrada.</p>
                          </td>
                        </tr>
                      ) : pagFe.itensPagina.map(f => (
                        <tr key={f.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-3 py-3 md:px-6 md:py-4 font-bold text-slate-900">{f.funcionario_nome}</td>
                          <td className="px-3 py-3 md:px-6 md:py-4">
                            {f.epi_nome}
                            {f.ca_status === 'CA Vencido' && <span className="ml-2 px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-100 text-[9px] font-bold">CA VENCIDO</span>}
                          </td>
                          <td className="px-3 py-3 md:px-6 md:py-4">{f.ca_numero || '-'}</td>
                          <td className="px-3 py-3 md:px-6 md:py-4">{f.quantidade}</td>
                          <td className="px-3 py-3 md:px-6 md:py-4">{formatDateBR(f.data_entrega)}</td>
                          <td className="px-3 py-3 md:px-6 md:py-4">{formatDateBR(f.data_devolucao)}</td>
                          <td className="px-3 py-3 md:px-6 md:py-4">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                              f.status === 'Em uso'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                : 'bg-slate-50 text-slate-500 border-slate-200'
                            }`}>
                              {f.status}
                            </span>
                          </td>
                          <td className="px-3 py-3 md:px-6 md:py-4">
                            <div className="flex justify-center items-center gap-2">
                              <button onClick={() => baixarPdfFicha(f.id)} className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-primary-50 text-slate-500 hover:text-primary-700 border border-slate-100 transition-colors" title="Baixar Ficha (PDF)">
                                <Printer size={15} />
                              </button>
                              <button onClick={() => openEditFe(f)} className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors" title="Editar">
                                <Edit2 size={15} />
                              </button>
                              <button onClick={() => handleDeleteFe(f.id, `${f.funcionario_nome} - ${f.epi_nome}`)} className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors" title="Excluir">
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <PaginacaoControle
                    paginaAtualSegura={pagFe.paginaAtualSegura}
                    totalPaginas={pagFe.totalPaginas}
                    onAnterior={() => pagFe.setPaginaAtual(p => Math.max(1, p - 1))}
                    onProximo={() => pagFe.setPaginaAtual(p => Math.min(pagFe.totalPaginas, p + 1))}
                  />
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ================= MODAIS ================= */}

      {/* Modal Cargo */}
      {showCargoModal && (
        <ModalShell titulo={cargoEditingId ? 'Editar Cargo' : 'Novo Cargo'} onClose={() => setShowCargoModal(false)}>
          <form onSubmit={handleCargoSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Nome do Cargo *</label>
              <input
                type="text"
                name="nome"
                value={cargoForm.nome}
                onChange={(e) => setCargoForm(p => ({ ...p, nome: e.target.value }))}
                required
                placeholder="Ex: Pedreiro, Eletricista, Servente"
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Descrição</label>
              <textarea
                name="descricao"
                value={cargoForm.descricao}
                onChange={(e) => setCargoForm(p => ({ ...p, descricao: e.target.value }))}
                rows={3}
                placeholder="Descrição das atividades (opcional)"
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
              />
            </div>
            <ModalActions label={cargoEditingId ? 'Salvar Alterações' : 'Cadastrar Cargo'} onCancel={() => setShowCargoModal(false)} />
          </form>
        </ModalShell>
      )}

      {/* Modal Catálogo de Cursos */}
      {showCatalogoModal && (
        <ModalShell titulo="Catálogo de Cursos" onClose={() => setShowCatalogoModal(false)} largura="max-w-3xl">
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500 font-semibold">Cadastre os cursos obrigatórios (NRs) e defina a periodicidade de reciclagem.</p>
              <button onClick={openAddTreinamento} className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold text-xs transition-all cursor-pointer shrink-0">
                <Plus size={15} /> Novo Curso
              </button>
            </div>
            <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
              {treinamentos.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-400">Nenhum curso cadastrado.</p>
              ) : treinamentos.map(t => (
                <div key={t.id} className="flex items-center justify-between gap-3 p-3.5 hover:bg-slate-50/60">
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-slate-800">{t.nome}</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {t.norma && <span className="px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-100 text-[10px] font-bold">{t.norma}</span>}
                      {t.tipo && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold">{t.tipo}</span>}
                      {t.validade_meses && <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100 text-[10px] font-bold">Reciclagem: {t.validade_meses} meses</span>}
                      {t.carga_horaria && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold">{t.carga_horaria}h</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => openEditTreinamento(t)} className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors cursor-pointer" title="Editar">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => handleDeleteTreinamento(t.id, t.nome)} className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors cursor-pointer" title="Excluir">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ModalShell>
      )}

      {/* Modal Treinamento (curso) */}
      {showTreinamentoModal && (
        <ModalShell titulo={treinamentoEditingId ? 'Editar Curso' : 'Novo Curso'} onClose={() => setShowTreinamentoModal(false)}>
          <form onSubmit={handleTreinamentoSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Nome do Curso *</label>
              <input
                type="text"
                name="nome"
                value={treinamentoForm.nome}
                onChange={(e) => setTreinamentoForm(p => ({ ...p, nome: e.target.value }))}
                required
                placeholder="Ex: NR-10 Básico, NR-35 Trabalho em Altura"
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Norma Regulamentadora</label>
                <input
                  type="text"
                  name="norma"
                  value={treinamentoForm.norma}
                  onChange={(e) => setTreinamentoForm(p => ({ ...p, norma: e.target.value }))}
                  placeholder="Ex: NR-10"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Tipo</label>
                <input
                  type="text"
                  name="tipo"
                  value={treinamentoForm.tipo}
                  onChange={(e) => setTreinamentoForm(p => ({ ...p, tipo: e.target.value }))}
                  placeholder="Inicial / Reciclagem"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Validade (meses)</label>
                <input
                  type="number"
                  min="1"
                  name="validade_meses"
                  value={treinamentoForm.validade_meses}
                  onChange={(e) => setTreinamentoForm(p => ({ ...p, validade_meses: e.target.value }))}
                  placeholder="Ex: 12 (vazio = sem reciclagem)"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Carga Horária (h)</label>
                <input
                  type="number"
                  min="0"
                  name="carga_horaria"
                  value={treinamentoForm.carga_horaria}
                  onChange={(e) => setTreinamentoForm(p => ({ ...p, carga_horaria: e.target.value }))}
                  placeholder="Ex: 40"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Instituição / Credenciada</label>
              <input
                type="text"
                name="instituicao"
                value={treinamentoForm.instituicao}
                onChange={(e) => setTreinamentoForm(p => ({ ...p, instituicao: e.target.value }))}
                placeholder="Ex: SENAI, empresa especializada"
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
              />
            </div>
            <ModalActions label={treinamentoEditingId ? 'Salvar Alterações' : 'Cadastrar Curso'} onCancel={() => setShowTreinamentoModal(false)} />
          </form>
        </ModalShell>
      )}

      {/* Modal Vincular curso ao cargo */}
      {showVincularModal && cargoSelecionado && (
        <ModalShell titulo={`Vincular curso - ${cargos.find(c => c.id === cargoSelecionado)?.nome || ''}`} onClose={() => setShowVincularModal(false)}>
          <form onSubmit={handleVincularSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Curso Obrigatório *</label>
              <select
                value={vincularForm.treinamento_id}
                onChange={(e) => setVincularForm(p => ({ ...p, treinamento_id: e.target.value }))}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
              >
                <option value="">Selecione o curso...</option>
                {cursosLivres(cargoSelecionado).map(t => (
                  <option key={t.id} value={t.id}>
                    {t.nome}{t.norma ? ` (${t.norma})` : ''}
                  </option>
                ))}
              </select>
              {cursosLivres(cargoSelecionado).length === 0 && (
                <p className="text-[11px] text-amber-600 font-semibold mt-2">
                  Todos os cursos já estão vinculados a este cargo. Cadastre novos cursos em &quot;Gerenciar Cursos&quot;.
                </p>
              )}
            </div>
            <ModalActions label="Vincular Curso" onCancel={() => setShowVincularModal(false)} />
          </form>
        </ModalShell>
      )}

      {/* Modal Treinamento do Funcionário */}
      {showFtModal && (
        <ModalShell titulo={ftEditingId ? 'Editar Registro de Treinamento' : 'Registrar Treinamento'} onClose={() => setShowFtModal(false)}>
          <form onSubmit={handleFtSubmit} className="p-6 space-y-4">
            <div className="relative">
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Funcionário *</label>
              <input
                type="text"
                value={buscaFuncFt}
                onChange={(e) => { setBuscaFuncFt(e.target.value); setSugestoesFtAbertas(true); }}
                onFocus={() => setSugestoesFtAbertas(true)}
                onBlur={() => setTimeout(() => setSugestoesFtAbertas(false), 150)}
                placeholder="Digite o nome do funcionário..."
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
              />
              {sugestoesFtAbertas && buscarFuncionarios(buscaFuncFt, funcionarios).length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                  {buscarFuncionarios(buscaFuncFt, funcionarios).map(f => (
                    <button
                      type="button"
                      key={f.id}
                      onMouseDown={(e) => { e.preventDefault(); selecionarFuncFt(f); }}
                      className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-primary-50 cursor-pointer border-b border-slate-50 last:border-b-0"
                    >
                      <span className="font-semibold text-slate-700 flex items-center gap-2">
                        <User size={13} className="text-slate-400" /> {f.nome}
                      </span>
                      {(f.cargo_id || f.cargo_id_2) && (
                        <span className="block text-[10px] text-slate-400">
                          {[f.cargo_id, f.cargo_id_2].filter(Boolean)
                            .map(id => cargos.find(c => c.id === id)?.nome || `Cargo ${id}`)
                            .join(' + ')}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {sugestoesMatriz.length > 0 && (
              <div className="bg-primary-50/60 border border-primary-100 rounded-xl p-3">
                <p className="text-[11px] font-bold text-primary-700 uppercase tracking-wider mb-2">
                  Cursos obrigatórios do cargo (Matriz) - clique para usar
                </p>
                <div className="flex flex-wrap gap-2">
                  {sugestoesMatriz.map(sug => {
                    const jaUsado = ftForm.treinamento_id === sug.treinamento_id;
                    return (
                      <button
                        type="button"
                        key={sug.id}
                        onClick={() => adicionarSugestaoMatriz(sug)}
                        className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                          jaUsado
                            ? 'bg-primary-600 text-white border-primary-600'
                            : 'bg-white text-primary-700 border-primary-200 hover:bg-primary-100'
                        }`}
                      >
                        {sug.treinamento_nome}
                        {sug.validade_meses ? ` (${sug.validade_meses}m)` : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Curso *</label>
                <select
                  value={ftForm.treinamento_id}
                  onChange={(e) => handleFtCursoChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                >
                  <option value="">Selecione o curso...</option>
                  {treinamentos.map(t => (
                    <option key={t.id} value={t.id}>{t.nome}{t.norma ? ` (${t.norma})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Data de Realização *</label>
                <input
                  type="date"
                  name="data_realizacao"
                  value={ftForm.data_realizacao}
                  onChange={(e) => handleFtDataRealizacaoChange(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Data de Validade</label>
                <input
                  type="date"
                  name="data_validade"
                  value={ftForm.data_validade}
                  onChange={(e) => setFtForm(p => ({ ...p, data_validade: e.target.value }))}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
                {treinamentos.find(t => t.id === Number(ftForm.treinamento_id))?.validade_meses && (
                  <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                    Calculada automaticamente conforme a reciclagem do curso.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Carga Horária (h)</label>
                <input
                  type="number"
                  min="0"
                  name="carga_horaria"
                  value={ftForm.carga_horaria}
                  onChange={(e) => setFtForm(p => ({ ...p, carga_horaria: e.target.value }))}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Observação</label>
              <textarea
                name="observacao"
                value={ftForm.observacao}
                onChange={(e) => setFtForm(p => ({ ...p, observacao: e.target.value }))}
                rows={2}
                placeholder="Ex: Certificado nº ..., instituição..."
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Certificado (PDF ou imagem)</label>
              {ftCertificadoAtual && !ftCertificado && (
                <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-xl text-xs font-semibold text-emerald-700">
                  <FileText size={14} />
                  <span className="truncate">Certificado atual: {ftCertificadoAtual}</span>
                </div>
              )}
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => setFtCertificado(e.target.files?.[0] || null)}
                className="w-full text-sm text-slate-500 file:mr-3 file:px-4 file:py-2 file:rounded-xl file:border-0 file:bg-primary-50 file:text-primary-700 file:font-bold file:cursor-pointer hover:file:bg-primary-100 cursor-pointer"
              />
              <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                PDF, JPG, PNG ou WEBP - máximo 15 MB. Ao editar, um novo arquivo substitui o anterior.
              </p>
            </div>
            <ModalActions label={ftEditingId ? 'Salvar Alterações' : 'Registrar Treinamento'} onCancel={() => setShowFtModal(false)} />
          </form>
        </ModalShell>
      )}

      {/* Modal ASO */}
      {showAsoModal && (
        <ModalShell titulo={asoEditingId ? 'Editar ASO' : 'Novo ASO'} onClose={() => setShowAsoModal(false)}>
          <form onSubmit={handleAsoSubmit} className="p-6 space-y-4">
            <div className="relative">
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Funcionário *</label>
              <input
                type="text"
                value={buscaFuncAso}
                onChange={(e) => { setBuscaFuncAso(e.target.value); setSugestoesAsoAbertas(true); }}
                onFocus={() => setSugestoesAsoAbertas(true)}
                onBlur={() => setTimeout(() => setSugestoesAsoAbertas(false), 150)}
                placeholder="Digite o nome do funcionário..."
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
              />
              {sugestoesAsoAbertas && buscarFuncionarios(buscaFuncAso, funcionarios).length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                  {buscarFuncionarios(buscaFuncAso, funcionarios).map(f => (
                    <button
                      type="button"
                      key={f.id}
                      onMouseDown={(e) => { e.preventDefault(); selecionarFuncAso(f); }}
                      className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-primary-50 cursor-pointer border-b border-slate-50 last:border-b-0"
                    >
                      <span className="font-semibold text-slate-700">{f.nome}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Tipo de Exame *</label>
                <select
                  value={asoForm.tipo_exame}
                  onChange={(e) => handleAsoTipoChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                >
                  {TIPOS_EXAME.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Data do Exame *</label>
                <input
                  type="date"
                  name="data_exame"
                  value={asoForm.data_exame}
                  onChange={(e) => handleAsoDataExameChange(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>
              {asoForm.tipo_exame === 'periodico' && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Periodicidade (meses) - grau de risco</label>
                    <select
                      value={asoForm.validade_meses}
                      onChange={(e) => handleAsoValidadeMesesChange(e.target.value)}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                    >
                      <option value="">Selecione...</option>
                      <option value="6">6 meses (risco 4 - semestral)</option>
                      <option value="12">12 meses (risco 3 - anual)</option>
                      <option value="24">24 meses (risco 1 e 2 - bienal)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Data de Validade</label>
                    <input
                      type="date"
                      name="data_validade"
                      value={asoForm.data_validade}
                      onChange={(e) => setAsoForm(p => ({ ...p, data_validade: e.target.value }))}
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                    />
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Resultado</label>
                <select
                  value={asoForm.resultado}
                  onChange={(e) => setAsoForm(p => ({ ...p, resultado: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                >
                  {RESULTADO_ASO.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Médico Responsável</label>
                <input
                  type="text"
                  name="medico_responsavel"
                  value={asoForm.medico_responsavel}
                  onChange={(e) => setAsoForm(p => ({ ...p, medico_responsavel: e.target.value }))}
                  placeholder="Ex: Dr. João"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Clínica</label>
                <input
                  type="text"
                  name="clinica"
                  value={asoForm.clinica}
                  onChange={(e) => setAsoForm(p => ({ ...p, clinica: e.target.value }))}
                  placeholder="Clínica ocupacional"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Observação</label>
              <textarea
                name="observacao"
                value={asoForm.observacao}
                onChange={(e) => setAsoForm(p => ({ ...p, observacao: e.target.value }))}
                rows={2}
                placeholder="Observações médicas (opcional)"
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Documento do ASO (laudo/exame)</label>
              {asoCertificadoAtual && !asoCertificado && (
                <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-xl text-xs font-semibold text-emerald-700">
                  <FileText size={14} />
                  <span className="truncate">Documento atual: {asoCertificadoAtual}</span>
                </div>
              )}
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => setAsoCertificado(e.target.files?.[0] || null)}
                className="w-full text-sm text-slate-500 file:mr-3 file:px-4 file:py-2 file:rounded-xl file:border-0 file:bg-primary-50 file:text-primary-700 file:font-bold file:cursor-pointer hover:file:bg-primary-100 cursor-pointer"
              />
              <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                PDF, JPG, PNG ou WEBP - máximo 15 MB. Ao editar, um novo arquivo substitui o anterior.
              </p>
            </div>
            <ModalActions label={asoEditingId ? 'Salvar Alterações' : 'Cadastrar ASO'} onCancel={() => setShowAsoModal(false)} />
          </form>
        </ModalShell>
      )}

      {/* Modal EPI */}
      {showEpiModal && (
        <ModalShell titulo={epiEditingId ? 'Editar EPI' : 'Novo EPI'} onClose={() => setShowEpiModal(false)}>
          <form onSubmit={handleEpiSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Nome do EPI *</label>
              <input
                type="text"
                name="nome"
                value={epiForm.nome}
                onChange={(e) => setEpiForm(p => ({ ...p, nome: e.target.value }))}
                required
                placeholder="Ex: Capacete de Segurança, Óculos de Proteção"
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Categoria</label>
                <input
                  type="text"
                  name="categoria"
                  value={epiForm.categoria}
                  onChange={(e) => setEpiForm(p => ({ ...p, categoria: e.target.value }))}
                  placeholder="Ex: Proteção da cabeça"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Número do CA</label>
                <input
                  type="text"
                  name="ca_numero"
                  value={epiForm.ca_numero}
                  onChange={(e) => setEpiForm(p => ({ ...p, ca_numero: e.target.value }))}
                  placeholder="Certificado de Aprovação"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Fabricante</label>
                <input
                  type="text"
                  name="fabricante"
                  value={epiForm.fabricante}
                  onChange={(e) => setEpiForm(p => ({ ...p, fabricante: e.target.value }))}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Validade do CA</label>
                <input
                  type="date"
                  name="ca_validade"
                  value={epiForm.ca_validade}
                  onChange={(e) => setEpiForm(p => ({ ...p, ca_validade: e.target.value }))}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
                <p className="text-[10px] text-slate-400 mt-1 font-semibold">Deixe vazio se o CA não possuir validade.</p>
              </div>
            </div>
            <ModalActions label={epiEditingId ? 'Salvar Alterações' : 'Cadastrar EPI'} onCancel={() => setShowEpiModal(false)} />
          </form>
        </ModalShell>
      )}

      {/* Modal Ficha de EPI */}
      {showFeModal && (
        <ModalShell titulo={feEditingId ? 'Editar Ficha de EPI' : 'Registrar Entrega de EPI'} onClose={() => setShowFeModal(false)}>
          <form onSubmit={handleFeSubmit} className="p-6 space-y-4">
            <div className="relative">
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Funcionário *</label>
              <input
                type="text"
                value={buscaFuncFe}
                onChange={(e) => { setBuscaFuncFe(e.target.value); setSugestoesFeAbertas(true); }}
                onFocus={() => setSugestoesFeAbertas(true)}
                onBlur={() => setTimeout(() => setSugestoesFeAbertas(false), 150)}
                placeholder="Digite o nome do funcionário..."
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
              />
              {sugestoesFeAbertas && buscarFuncionarios(buscaFuncFe, funcionarios).length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                  {buscarFuncionarios(buscaFuncFe, funcionarios).map(f => (
                    <button
                      type="button"
                      key={f.id}
                      onMouseDown={(e) => { e.preventDefault(); selecionarFuncFe(f); }}
                      className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-primary-50 cursor-pointer border-b border-slate-50 last:border-b-0"
                    >
                      <span className="font-semibold text-slate-700">{f.nome}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">EPI *</label>
                <select
                  value={feForm.epi_id}
                  onChange={(e) => setFeForm(p => ({ ...p, epi_id: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                >
                  <option value="">Selecione o EPI...</option>
                  {epis.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.nome}{e.ca_numero ? ` (CA ${e.ca_numero})` : ''}{e.ca_status === 'CA Vencido' ? ' - CA VENCIDO' : ''}
                    </option>
                  ))}
                </select>
                {epiSelecionadoCaVencido && (
                  <div className="mt-2 flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-3 py-2">
                    <AlertTriangle size={14} />
                    <p className="text-[11px] font-bold">
                      ATENÇÃO: O CA deste EPI está vencido. A NR-6 proíbe a utilização de EPI com CA vencido.
                    </p>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Data de Entrega *</label>
                <input
                  type="date"
                  name="data_entrega"
                  value={feForm.data_entrega}
                  onChange={(e) => setFeForm(p => ({ ...p, data_entrega: e.target.value }))}
                  required
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Quantidade</label>
                <input
                  type="number"
                  min="1"
                  name="quantidade"
                  value={feForm.quantidade}
                  onChange={(e) => setFeForm(p => ({ ...p, quantidade: e.target.value }))}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Data de Devolução</label>
                <input
                  type="date"
                  name="data_devolucao"
                  value={feForm.data_devolucao}
                  onChange={(e) => setFeForm(p => ({ ...p, data_devolucao: e.target.value }))}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
                <p className="text-[10px] text-slate-400 mt-1 font-semibold">Preencha para marcar como &quot;Devolvido&quot;.</p>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Observação</label>
              <textarea
                name="observacao"
                value={feForm.observacao}
                onChange={(e) => setFeForm(p => ({ ...p, observacao: e.target.value }))}
                rows={2}
                placeholder="Ex: Substituição por desgaste, modelo novo..."
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
              />
            </div>
            <ModalActions label={feEditingId ? 'Salvar Alterações' : 'Registrar Entrega'} onCancel={() => setShowFeModal(false)} />
          </form>
        </ModalShell>
      )}

      <ModalConfirmacao
        aberto={confirmarAcao != null}
        titulo={TITULOS_CONFIRMACAO[confirmarAcao?.tipo] || 'Confirmar exclusão'}
        mensagem={confirmarAcao ? (MENSAGENS_CONFIRMACAO[confirmarAcao.tipo] || (() => ''))(confirmarAcao.nome) : ''}
        confirmarTexto={confirmarAcao?.tipo === 'desvincular' ? 'Desvincular' : 'Excluir'}
        onConfirmar={confirmarExecucao}
        onCancelar={() => setConfirmarAcao(null)}
      />

      <ModalDocumentosDiversos aberto={showDocsModal} onFechar={() => setShowDocsModal(false)} mostrarToast={showToast} />
    </div>
  );
}

// Redimensiona/comprime imagens ANTES do upload (canvas no navegador):
// reduz fotos de celular para no máx. 1600px e converte para JPEG ~82%,
// economizando armazenamento no B2 e tempo de envio no campo.
async function comprimirImagem(arquivo, maxLado = 1600, qualidade = 0.82) {
  if (!arquivo || !arquivo.type || !arquivo.type.startsWith('image/')) return arquivo;
  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    if (escala >= 1) {
      bitmap.close();
      return arquivo;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualidade));
    if (!blob) return arquivo;
    return new File([blob], arquivo.name.replace(/\.(png|webp)$/i, '.jpg') || 'imagem.jpg', { type: 'image/jpeg' });
  } catch {
    return arquivo;
  }
}

function formatarTamanho(bytes) {
  if (!bytes && bytes !== 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function ModalDocumentosDiversos({ aberto, onFechar, mostrarToast }) {
  const [documentos, setDocumentos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [excluirAlvo, setExcluirAlvo] = useState(null);
  const inputRef = useRef(null);

  const MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  const LIMITE_BYTES = 15 * 1024 * 1024;

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await apiFetch(`${API_URL}/sst/documentos-diversos`);
      if (res.ok) setDocumentos(await res.json());
      else mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao carregar documentos.'), 'error');
    } catch {
      mostrarToast('Erro de conexão ao carregar documentos.', 'error');
    } finally {
      setCarregando(false);
    }
  }, [mostrarToast]);

  useEffect(() => {
    if (aberto) carregar();
  }, [aberto, carregar]);

  if (!aberto) return null;

  const enviarArquivos = async (files) => {
    let ok = 0;
    setEnviando(true);
    for (const original of files) {
      if (!MIMES.includes(original.type)) {
        mostrarToast(`"${original.name}" deve ser PDF, JPG, PNG ou WEBP.`, 'error');
        continue;
      }
      if (original.size > LIMITE_BYTES) {
        mostrarToast(`"${original.name}" excede o limite de 15 MB.`, 'error');
        continue;
      }
      const arquivo = await comprimirImagem(original);
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      try {
        const res = await apiFetch(`${API_URL}/sst/documentos-diversos`, { method: 'POST', body: fd });
        if (res.ok) ok += 1;
        else mostrarToast(erroDaResposta(await res.json().catch(() => null), `Falha ao enviar ${arquivo.name}.`), 'error');
      } catch {
        mostrarToast(`Erro de conexão ao enviar ${arquivo.name}.`, 'error');
      }
    }
    if (ok) mostrarToast(`${ok} documento(s) enviado(s).`);
    setEnviando(false);
    carregar();
  };

  const excluir = async (id) => {
    setExcluirAlvo(null);
    try {
      const res = await apiFetch(`${API_URL}/sst/documentos-diversos/${id}`, { method: 'DELETE' });
      if (res.ok) {
        mostrarToast('Documento excluído.');
        carregar();
      } else {
        mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao excluir documento.'), 'error');
      }
    } catch {
      mostrarToast('Erro de conexão ao excluir documento.', 'error');
    }
  };

  const totalBytes = documentos.reduce((soma, d) => soma + Number(d.tamanho_bytes || 0), 0);

  return (
    <ModalShell titulo="Documentos Diversos" onClose={onFechar} largura="max-w-2xl">
      <div className="p-4 md:p-6 space-y-4">
        {/* Resumo */}
        <div className="flex items-center justify-between gap-3 flex-wrap bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
            <FolderOpen size={15} className="text-primary-600" />
            {documentos.length} documento(s) · {formatarTamanho(totalBytes)} na pasta
          </div>
          <p className="text-[10px] text-slate-400 font-semibold">PDFs e imagens são compactados automaticamente.</p>
        </div>

        {/* Upload */}
        <div>
          <button
            type="button"
            disabled={enviando}
            onClick={() => inputRef.current?.click()}
            className="w-full h-20 rounded-2xl border-2 border-dashed border-primary-300 bg-primary-50/60 hover:bg-primary-50 text-primary-700 font-bold flex flex-col items-center justify-center gap-1 disabled:opacity-40 cursor-pointer transition-all"
          >
            <Upload size={22} />
            {enviando ? 'Enviando...' : 'Enviar documentos (PDF ou imagem)'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) enviarArquivos(Array.from(e.target.files));
              e.target.value = '';
            }}
          />
        </div>

        {/* Lista */}
        <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-100 max-h-[45vh] overflow-y-auto">
          {carregando && documentos.length === 0 && (
            <p className="px-4 py-10 text-center text-xs text-slate-400">Carregando documentos...</p>
          )}
          {!carregando && documentos.length === 0 && (
            <p className="px-4 py-10 text-center text-xs text-slate-400 flex flex-col items-center gap-1.5">
              <FileText size={20} />
              Nenhum documento anexado ainda.
            </p>
          )}
          {documentos.map(d => {
            const economizou = d.tamanho_original && d.tamanho_bytes && d.tamanho_original > d.tamanho_bytes;
            return (
              <div key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="w-9 h-9 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                  <FileText size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800 truncate" title={d.nome_original}>{d.nome_original}</p>
                  <p className="text-[10px] text-slate-400 font-semibold flex items-center gap-1.5 flex-wrap">
                    {formatarTamanho(d.tamanho_bytes)}
                    {economizou && (
                      <span className="text-emerald-600" title={`Original: ${formatarTamanho(d.tamanho_original)}`}>
                        ↓ economia de {formatarTamanho(d.tamanho_original - d.tamanho_bytes)}
                      </span>
                    )}
                    <span>·</span>
                    {d.criado_por || 'SST'}
                    <span>·</span>
                    {new Date(d.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </p>
                </div>
                <a
                  href={d.url_temporaria}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Baixar documento"
                  className="w-10 h-10 flex items-center justify-center rounded-lg bg-primary-50 hover:bg-primary-100 text-primary-700 border border-primary-100 transition-colors cursor-pointer shrink-0"
                >
                  <Download size={15} />
                </a>
                <button
                  onClick={() => setExcluirAlvo(d)}
                  title="Excluir"
                  className="w-10 h-10 flex items-center justify-center rounded-lg bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-100 transition-colors cursor-pointer shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <ModalConfirmacao
        aberto={excluirAlvo != null}
        titulo="Excluir documento"
        mensagem={`Excluir "${excluirAlvo?.nome_original}"? Esta ação não pode ser desfeita.`}
        onConfirmar={() => excluir(excluirAlvo?.id)}
        onCancelar={() => setExcluirAlvo(null)}
      />
    </ModalShell>
  );
}

function ModalShell({ titulo, onClose, children, largura = 'max-w-2xl' }) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-2xl shadow-2xl ${largura} w-full overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[92vh] flex flex-col`}>
        <div className="bg-slate-900 text-white px-3 py-3 md:px-6 md:py-4 flex items-center justify-between shrink-0">
          <h3 className="font-bold text-lg">{titulo}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl font-bold cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function ModalActions({ label, onCancel }) {
  return (
    <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
      <button
        type="button"
        onClick={onCancel}
        className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-all cursor-pointer"
      >
        Cancelar
      </button>
      <button
        type="submit"
        className="px-5 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer"
      >
        {label}
      </button>
    </div>
  );
}

export default Sst;
