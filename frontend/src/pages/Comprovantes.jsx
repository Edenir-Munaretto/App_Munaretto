import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { FileText, Plus, Trash2, Edit2, Search, X, Check, AlertTriangle, Printer, Download, Upload, ChevronLeft, ChevronRight, FileSpreadsheet } from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';
import ModalConfirmacao from '../components/ModalConfirmacao';

const NUMERIC_FIELDS = [
  'valor_total', 'base_calculo', 'valor_inss', 'valor_iss', 'valor_liquido',
  'valor_pago', 'valor_juros'
];

const FORM_INICIAL = {
  numero_nf: '',
  data_emissao: '',
  nome: '',
  cnpj: '',
  local_servico: '',
  valor_total: 0,
  base_calculo: 0,
  valor_inss: 0,
  valor_iss: 0,
  valor_liquido: 0,
  data_pagamento: '',
  data_vencimento: '',
  descricao: '',
  forma_pagamento: 'boleto',
  valor_pago: 0,
  valor_juros: 0
};

const LABEL_CAMPOS = {
  nome: 'Nome',
  cnpj: 'CNPJ',
  data_emissao: 'Data de Emissão',
  data_pagamento: 'Data de Pagamento',
  data_vencimento: 'Data de Vencimento',
  descricao: 'Descrição',
  valor_pago: 'Valor Pago',
};

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

function Comprovantes() {
  const [comprovantes, setComprovantes] = useState([]);
  const [busca, setBusca] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [ordenarPor, setOrdenarPor] = useState('data_registro');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);
  const [preview, setPreview] = useState(null); // { data, file, importing } da simulação

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [comprovanteParaEditar, setComprovanteParaEditar] = useState(null);

  // Exclusão com confirmação customizada
  const [excluindoId, setExcluindoId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Paginação visual (50 registros por página)
  const REGISTROS_POR_PAGINA = 50;
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [exportando, setExportando] = useState(false);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchComprovantes = useCallback(async (tipo = tipoFiltro, inicio = dataInicio, fim = dataFim) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('ordenar_por', ordenarPor);
      if (tipo) params.append('tipo_documento', tipo);
      if (inicio) params.append('data_inicio', inicio);
      if (fim) params.append('data_fim', fim);
      
      const query = params.toString() ? `?${params.toString()}` : '';
      const res = await apiFetch(`${API_URL}/comprovantes/${query}`);
      if (res.ok) {
        const data = await res.json();
        setComprovantes(data);
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao buscar comprovantes.', 'error');
    } finally {
      setLoading(false);
    }
  }, [ordenarPor, tipoFiltro, dataInicio, dataFim]);

  useEffect(() => {
    fetchComprovantes();
  }, [fetchComprovantes]);

  // Quando o tipo selecionado é Nota Fiscal, ordena por data de emissão automaticamente
  useEffect(() => {
    if (tipoFiltro === 'Nota Fiscal') {
      setOrdenarPor('data_emissao');
    }
  }, [tipoFiltro]);

  const baixarModelo = async () => {
    try {
      const res = await apiFetch(`${API_URL}/comprovantes/modelo`);
      if (!res.ok) {
        showToast('Erro ao baixar o modelo.', 'error');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'modelo_comprovantes.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao baixar o modelo.', 'error');
    }
  };

  const importarPlanilha = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      showToast('Apenas arquivos .xlsx são permitidos.', 'error');
      e.target.value = '';
      return;
    }

    try {
      // 1ª etapa: simula a importação (não grava nada no banco)
      const formData = new FormData();
      formData.append('file', file);
      formData.append('simular', 'true');

      const res = await apiFetch(`${API_URL}/comprovantes/importar`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (!res.ok) {
        showToast(erroDaResposta(data, 'Erro ao validar planilha.'), 'error');
        return;
      }

      if (data.importados === 0 && (data.erros || []).length === 0) {
        showToast('Nenhuma linha com dados foi encontrada na planilha.', 'error');
        return;
      }

      setPreview({ data, file });
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao validar planilha.', 'error');
    } finally {
      e.target.value = '';
    }
  };

  const confirmarImportacao = async () => {
    if (!preview) return;
    const { data, file } = preview;

    try {
      setPreview(prev => ({ ...prev, importing: true }));
      const formData = new FormData();
      formData.append('file', file);
      formData.append('simular', 'false');

      const res = await apiFetch(`${API_URL}/comprovantes/importar`, {
        method: 'POST',
        body: formData
      });

      const resData = await res.json();

      if (res.ok) {
        const numErros = (resData.erros || []).length;
        if (resData.importados > 0 && numErros === 0) {
          showToast(`${resData.importados} lançamento(s) importado(s) com sucesso!`);
        } else if (resData.importados > 0 && numErros > 0) {
          showToast(`${resData.importados} importado(s), ${numErros} com erro. Confira o relatório.`, 'error');
        } else {
          showToast('Nenhum lançamento importado. Verifique os erros.', 'error');
        }
        fetchComprovantes();
        setPreview(null);
      } else {
        showToast(erroDaResposta(resData, 'Erro ao importar planilha.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao importar planilha.', 'error');
    } finally {
      setPreview(prev => (prev ? { ...prev, importing: false } : prev));
    }
  };

  const openAddModal = () => {
    setComprovanteParaEditar(null);
    setShowModal(true);
  };

  const openEditModal = (c) => {
    setComprovanteParaEditar(c);
    setShowModal(true);
  };

  const handleModalSalvo = () => {
    setShowModal(false);
    setComprovanteParaEditar(null);
    fetchComprovantes();
  };

  const handleDelete = async () => {
    if (excluindoId == null) return;
    try {
      setDeleting(true);
      const res = await apiFetch(`${API_URL}/comprovantes/${excluindoId}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Lançamento excluído com sucesso.');
        fetchComprovantes();
      } else {
        showToast('Erro ao excluir lançamento.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao excluir lançamento.', 'error');
    } finally {
      setDeleting(false);
      setExcluindoId(null);
    }
  };

  const exportarXlsx = async () => {
    try {
      setExportando(true);
      const params = new URLSearchParams();
      params.append('ordenar_por', ordenarPor);
      if (tipoFiltro) params.append('tipo_documento', tipoFiltro);
      if (dataInicio) params.append('data_inicio', dataInicio);
      if (dataFim) params.append('data_fim', dataFim);
      const query = params.toString() ? `?${params.toString()}` : '';

      const res = await apiFetch(`${API_URL}/comprovantes/exportar${query}`);
      if (!res.ok) {
        showToast('Erro ao exportar comprovantes.', 'error');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'comprovantes.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      showToast('Exportação concluída!');
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao exportar.', 'error');
    } finally {
      setExportando(false);
    }
  };

  // Filtragem local
  const filteredComprovantes = useMemo(() => {
    const searchLower = busca.toLowerCase();
    return comprovantes.filter(c => {
      const typeMatch = c.tipo_documento.toLowerCase().includes(searchLower);
      const nameMatch = (c.nome || '').toLowerCase().includes(searchLower);
      const descMatch = (c.descricao || '').toLowerCase().includes(searchLower);
      const nfMatch = (c.numero_nf || '').toLowerCase().includes(searchLower);
      const textMatch = typeMatch || nameMatch || descMatch || nfMatch;

      if (!textMatch) return false;

      // Filtro por tipo
      if (tipoFiltro && c.tipo_documento !== tipoFiltro) return false;

      // Filtragem por período
      const itemDate = c.tipo_documento === 'Nota Fiscal' ? c.data_emissao : c.data_pagamento || c.data_vencimento;
      if (dataInicio && itemDate && itemDate < dataInicio) return false;
      if (dataFim && itemDate && itemDate > dataFim) return false;
      return true;
    });
  }, [comprovantes, busca, tipoFiltro, dataInicio, dataFim]);

  // Totais do tipo filtrado (somente quando um tipo específico está selecionado)
  const totaisTipo = useMemo(() => {
    if (!tipoFiltro) return null;
    return filteredComprovantes.reduce((acc, c) => ({
      base_calculo: acc.base_calculo + (c.base_calculo || 0),
      valor_inss: acc.valor_inss + (c.valor_inss || 0),
      valor_iss: acc.valor_iss + (c.valor_iss || 0),
      valor_liquido: acc.valor_liquido + (c.valor_liquido || 0),
      valor_pago: acc.valor_pago + (c.valor_pago || 0),
      valor_juros: acc.valor_juros + (c.valor_juros || 0),
    }), { base_calculo: 0, valor_inss: 0, valor_iss: 0, valor_liquido: 0, valor_pago: 0, valor_juros: 0 });
  }, [tipoFiltro, filteredComprovantes]);

  // Paginação visual: corta a lista filtrada em páginas de 50 registros
  const totalPaginas = Math.max(1, Math.ceil(filteredComprovantes.length / REGISTROS_POR_PAGINA));
  const paginaAtualSegura = Math.min(paginaAtual, totalPaginas);
  const comprovantesPagina = useMemo(() => {
    const inicio = (paginaAtualSegura - 1) * REGISTROS_POR_PAGINA;
    return filteredComprovantes.slice(inicio, inicio + REGISTROS_POR_PAGINA);
  }, [filteredComprovantes, paginaAtualSegura]);

  // Ao filtrar/buscar, volta para a primeira página
  useEffect(() => {
    setPaginaAtual(1);
  }, [busca, tipoFiltro, dataInicio, dataFim, comprovantes]);

  return (
    <div className="space-y-6 print:space-y-2">
      
      {/* Estilos para impressão */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          @page {
            margin: 8mm;
          }
          body {
            background-color: white !important;
            color: black !important;
          }
          aside, header, button, input, select, .print\\:hidden, .no-print {
            display: none !important;
          }
          main {
            padding: 0 !important;
            margin: 0 !important;
          }
          .flex-1.overflow-y-auto {
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
          }
          .flex.h-screen.overflow-hidden,
          main {
            overflow: visible !important;
            height: auto !important;
            min-height: 0 !important;
          }
          .print-full-width {
            width: 100% !important;
            max-width: 100% !important;
            border: none !important;
            box-shadow: none !important;
          }
          table {
            width: 100% !important;
            border-collapse: collapse !important;
          }
          th, td {
            border: 1px solid #cbd5e1 !important;
            padding: 4px 6px !important;
            font-size: 8px !important;
          }
        }
      `}} />

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[100] p-4 rounded-xl shadow-xl flex items-center gap-3 border text-sm max-w-sm animate-in slide-in-from-top-4 duration-300 ${
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

      {/* Cabeçalho exclusivo para Impressão */}
      <div className="hidden print:block mb-6 border-b border-slate-300 pb-4 print:mb-2 print:pb-2">
        <h2 className="text-2xl font-bold text-slate-800 uppercase tracking-wide print:text-lg">Relatório de Contabilidade</h2>
        <p className="text-xs text-slate-500 mt-1 print:mt-0.5">
          Gerado em: {new Date().toLocaleDateString('pt-BR')} 
          {busca && ` | Busca: "${busca}"`}
          {tipoFiltro && ` | Tipo: ${tipoFiltro}`}
          {(dataInicio || dataFim) && ` | Período: ${formatDate(dataInicio) || 'Início'} até ${formatDate(dataFim) || 'Fim'}`}
        </p>
      </div>

      {/* Header Actions (Filtros e Botões) */}
      <div className="flex flex-col gap-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm print:hidden">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="relative flex-1 w-full max-w-md">
            <Search className="absolute left-3.5 top-3 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Pesquise por tipo, nome, descrição ou NF..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-medium"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <button
              onClick={exportarXlsx}
              disabled={exportando}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-xl transition-all border border-slate-200 cursor-pointer w-full sm:w-auto disabled:opacity-50"
              title="Exportar comprovantes filtrados para .xlsx"
            >
              <FileSpreadsheet size={16} />
              {exportando ? 'Exportando...' : 'Exportar'}
            </button>
            <button
              onClick={baixarModelo}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-xl transition-all border border-slate-200 cursor-pointer w-full sm:w-auto"
              title="Baixar modelo .xlsx para preenchimento"
            >
              <Download size={16} />
              Baixar modelo
            </button>
            <button
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-xl transition-all border border-slate-200 cursor-pointer w-full sm:w-auto"
              title="Enviar planilha preenchida para lançamento em lote"
            >
              <Upload size={16} />
              Importar
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={importarPlanilha}
            />
            <button
              onClick={() => window.print()}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-xl transition-all border border-slate-200 cursor-pointer w-full sm:w-auto"
            >
              <Printer size={16} />
              Imprimir
            </button>
            <button
              onClick={openAddModal}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-primary-900/10 cursor-pointer w-full sm:w-auto"
            >
              <Plus size={16} />
              Novo Lançamento
            </button>
          </div>
        </div>

        {/* Linha de Filtro por Período */}
          <div className="flex flex-wrap items-center gap-4 pt-3.5 border-t border-slate-100">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Filtrar Tipo:</span>
            <select
              value={tipoFiltro}
              onChange={(e) => setTipoFiltro(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            >
              <option value="">Todos</option>
              <option value="Nota Fiscal">Nota Fiscal</option>
              <option value="Boleto">Boleto</option>
              <option value="Pix">Pix</option>
              <option value="Diversas">Diversas</option>
              <option value="Aluguel">Aluguel</option>
              <option value="Imposto">Imposto</option>
            </select>
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ordenar:</span>
            <select
              value={ordenarPor}
              onChange={(e) => setOrdenarPor(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            >
              <option value="data_registro">Data de Lançamento (mais recente)</option>
              <option value="data_pagamento">Data de Pagamento (mais recente)</option>
              <option value="data_emissao">Data de Emissão (mais recente)</option>
            </select>
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Filtrar Período:</span>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500">De:</label>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500">Até:</label>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
          </div>
          {(dataInicio || dataFim) && (
            <button
              onClick={() => {
                setDataInicio('');
                setDataFim('');
              }}
              className="text-xs font-bold text-primary-600 hover:text-primary-700 hover:underline cursor-pointer"
            >
              Limpar Período
            </button>
          )}
          </div>
        </div>

      {/* Listagem de Itens */}
      <div className="space-y-4 print-full-width print:space-y-1">
        {loading ? (
          <div className="bg-white p-8 text-center text-slate-400 rounded-2xl border border-slate-100 shadow-sm">
            Carregando lançamentos...
          </div>
        ) : filteredComprovantes.length === 0 ? (
          <div className="bg-white p-8 text-center text-slate-400 rounded-2xl border border-slate-100 shadow-sm">
            Nenhum comprovante encontrado.
          </div>
        ) : (
          comprovantesPagina.map((c) => (
            <ComprovanteCard
              key={c.id}
              c={c}
              onEditar={() => openEditModal(c)}
              onExcluir={() => setExcluindoId(c.id)}
            />
          ))
        )}
      </div>

      {/* Paginação visual */}
      {!loading && filteredComprovantes.length > REGISTROS_POR_PAGINA && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm print:hidden">
          <p className="text-xs text-slate-500 font-semibold">
            Mostrando {((paginaAtualSegura - 1) * REGISTROS_POR_PAGINA) + 1}–
            {Math.min(paginaAtualSegura * REGISTROS_POR_PAGINA, filteredComprovantes.length)} de{' '}
            {filteredComprovantes.length} registro(s)
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPaginaAtual(p => Math.max(1, p - 1))}
              disabled={paginaAtualSegura === 1}
              className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-40 flex items-center gap-1"
            >
              <ChevronLeft size={14} />
              Anterior
            </button>
            <span className="text-xs font-bold text-slate-600 px-2">
              {paginaAtualSegura} / {totalPaginas}
            </span>
            <button
              onClick={() => setPaginaAtual(p => Math.min(totalPaginas, p + 1))}
              disabled={paginaAtualSegura === totalPaginas}
              className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-40 flex items-center gap-1"
            >
              Próximo
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Totais do Tipo Filtrado */}
      {totaisTipo && filteredComprovantes.length > 0 && (
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm print-full-width print:break-inside-avoid print:p-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
            <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wider">Totais {tipoFiltro}</h3>
            <span className="text-xs text-slate-400 font-semibold">{filteredComprovantes.length} registro(s)</span>
          </div>
          {tipoFiltro === 'Nota Fiscal' ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-x-4 gap-y-2 text-xs">
              <div className="hidden lg:block"></div>
              <div className="hidden lg:block"></div>
              <div className="hidden lg:block"></div>
              <div className="hidden lg:block"></div>
              <div>
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Base de Cálculo</span>
                <span className="font-bold text-slate-750">{formatCurrency(totaisTipo.base_calculo)}</span>
              </div>
              <div>
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Total INSS</span>
                <span className="font-bold text-slate-750">{formatCurrency(totaisTipo.valor_inss)}</span>
              </div>
              <div>
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Total ISS</span>
                <span className="font-bold text-slate-750">{formatCurrency(totaisTipo.valor_iss)}</span>
              </div>
              <div className="bg-primary-50/20 px-2 py-0.5 rounded border border-primary-50 print:bg-transparent print:border-none print:px-0">
                <span className="block text-[9px] text-primary-600 font-bold uppercase tracking-wider print:text-slate-400">Valor Líquido</span>
                <span className="font-extrabold text-primary-750 print:text-black">{formatCurrency(totaisTipo.valor_liquido)}</span>
              </div>
            </div>
          ) : tipoFiltro === 'Imposto' ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-2 text-xs">
              <div className="hidden lg:block"></div>
              <div className="hidden lg:block"></div>
              <div className="hidden lg:block"></div>
              <div className="hidden lg:block"></div>
              <div className="bg-primary-50/20 px-2 py-0.5 rounded border border-primary-50 print:bg-transparent print:border-none print:px-0">
                <span className="block text-[9px] text-primary-600 font-bold uppercase tracking-wider print:text-slate-400">Total Valor</span>
                <span className="font-extrabold text-primary-750 print:text-black">{formatCurrency(totaisTipo.valor_pago)}</span>
              </div>
              <div className="hidden lg:block"></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-2 text-xs">
              <div className="hidden lg:block"></div>
              <div className="hidden lg:block"></div>
              <div className="hidden lg:block"></div>
              <div>
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Total Valor Pago</span>
                <span className="font-bold text-slate-750">{formatCurrency(totaisTipo.valor_pago)}</span>
              </div>
              <div>
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Total Valor Juros</span>
                <span className="font-semibold text-amber-600">{formatCurrency(totaisTipo.valor_juros)}</span>
              </div>
              <div className="hidden lg:block"></div>
            </div>
          )}
        </div>
      )}

      {/* Modal Pré-visualização da Importação */}
      {preview && (
<div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-200 my-8">
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Upload className="text-primary-400" />
                Pré-visualizar Importação
              </h3>
              <button
                onClick={() => setPreview(null)}
                disabled={preview.importing}
                className="text-slate-400 hover:text-white text-xl font-bold p-1 cursor-pointer disabled:opacity-40"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <p className="text-sm text-slate-600">
                A planilha <span className="font-bold text-slate-800">{preview.file.name}</span> foi validada.
                Nada foi gravado ainda — confira o resultado abaixo antes de confirmar.
              </p>

              <div className="grid grid-cols-4 gap-3">
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-center">
                  <span className="block text-2xl font-extrabold text-emerald-700">{preview.data.importados}</span>
                  <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">Serão importados</span>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-center">
                  <span className="block text-2xl font-extrabold text-amber-700">{(preview.data.erros || []).length}</span>
                  <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">Com erro</span>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-center">
                  <span className="block text-2xl font-extrabold text-slate-700">{preview.data.total}</span>
                  <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">Linhas com dados</span>
                </div>
                <div className="bg-slate-100 border border-slate-200 rounded-xl p-4 text-center">
                  <span className="block text-2xl font-extrabold text-slate-500">{preview.data.ignoradas || 0}</span>
                  <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">Vazias ignoradas</span>
                </div>
              </div>

              {(preview.data.erros || []).length > 0 && (
                <div className="bg-rose-50 border border-rose-100 rounded-xl p-4">
                  <p className="text-xs font-bold text-rose-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <AlertTriangle size={14} /> Linhas com erro
                  </p>
                  <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                    {(preview.data.erros || []).map((erro, i) => (
                      <li key={i} className="text-xs text-rose-800 flex gap-2">
                        <span className="font-bold shrink-0">Linha {erro.linha}:</span>
                        <span>{erro.mensagem}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  disabled={preview.importing}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-40"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmarImportacao}
                  disabled={preview.importing || preview.data.importados === 0}
                  className="px-5 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer disabled:opacity-40 flex items-center gap-2"
                >
                  {preview.importing ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Importando...
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      Confirmar e Importar
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Lançamento */}
      <ModalLancamento
        aberto={showModal}
        comprovante={comprovanteParaEditar}
        onFechar={() => setShowModal(false)}
        onSalvo={handleModalSalvo}
        mostrarToast={showToast}
      />

    {/* Modal de confirmação de exclusão */}
      <ModalConfirmacao
        aberto={excluindoId != null}
        titulo="Excluir lançamento"
        mensagem="Tem certeza que deseja excluir este lançamento? Esta ação não pode ser desfeita."
        loading={deleting}
        onConfirmar={handleDelete}
        onCancelar={() => setExcluindoId(null)}
      />

    </div>
  );
}

// Card individual memoizado: só re-renderiza se `c` (ou as callbacks) mudarem.
const ComprovanteCard = React.memo(({ c, onEditar, onExcluir }) => {
  const isNF = c.tipo_documento === 'Nota Fiscal';
  const isImposto = c.tipo_documento === 'Imposto';

  const borderLeftColor =
    c.tipo_documento === 'Nota Fiscal' ? 'border-l-blue-500' :
    c.tipo_documento === 'Boleto' ? 'border-l-amber-500' :
    c.tipo_documento === 'Pix' ? 'border-l-teal-500' :
    c.tipo_documento === 'Aluguel' ? 'border-l-purple-500' :
    c.tipo_documento === 'Imposto' ? 'border-l-rose-500' :
    'border-l-slate-400';

  const badgeColor =
    c.tipo_documento === 'Nota Fiscal' ? 'bg-blue-50 text-blue-700 border-blue-100' :
    c.tipo_documento === 'Boleto' ? 'bg-amber-50 text-amber-700 border-amber-100' :
    c.tipo_documento === 'Pix' ? 'bg-teal-50 text-teal-700 border-teal-100' :
    c.tipo_documento === 'Aluguel' ? 'bg-purple-50 text-purple-700 border-purple-100' :
    c.tipo_documento === 'Imposto' ? 'bg-rose-50 text-rose-700 border-rose-100' :
    'bg-slate-50 text-slate-700 border-slate-100';

  return (
    <div
      className={`bg-white p-4 rounded-2xl border border-slate-100 ${borderLeftColor} border-l-4 shadow-sm hover:shadow transition-all space-y-3 print:border print:border-slate-300 print:shadow-none print:break-inside-avoid print:p-2 print:space-y-1.5`}
    >
      {/* Cabeçalho do Cartão */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full border ${badgeColor}`}>
            {c.tipo_documento}
          </span>
          <h4 className="font-bold text-slate-800 text-sm print:text-xs print:leading-tight">
            {isNF ? c.nome : c.descricao}
          </h4>
          {c.numero_nf && (
            <span className="text-xs text-slate-400 font-mono">
              (NF: {c.numero_nf})
            </span>
          )}
        </div>
        <div className="flex gap-1 print:hidden">
          <button
            onClick={onEditar}
            className="p-1 text-slate-400 hover:text-primary-600 rounded hover:bg-slate-50 transition-all cursor-pointer"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={onExcluir}
            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-50 transition-all cursor-pointer"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Grid de Campos Específicos para o Tipo: Nota Fiscal */}
      {isNF ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-x-4 gap-y-2 text-xs pt-2 border-t border-slate-50 print:gap-y-0.5 print:pt-1 print:text-[10px]">
          <div>
            <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">CNPJ</span>
            <span className="font-semibold font-mono text-slate-750">{c.cnpj || '-'}</span>
          </div>
          <div>
            <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Data Emissão</span>
            <span className="font-semibold text-slate-750">{formatDate(c.data_emissao)}</span>
          </div>
          <div>
            <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Local do Serviço</span>
            <span className="font-semibold text-slate-700 truncate block" title={c.local_servico || ''}>
              {c.local_servico || '-'}
            </span>
          </div>
          <div>
            <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Valor Total</span>
            <span className="font-bold text-slate-750">{formatCurrency(c.valor_total)}</span>
          </div>
          <div>
            <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Base Cálculo</span>
            <span className="font-semibold text-slate-700">{formatCurrency(c.base_calculo)}</span>
          </div>
          <div>
            <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">INSS</span>
            <span className="font-semibold text-slate-700">{formatCurrency(c.valor_inss)}</span>
          </div>
          <div>
            <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">ISS</span>
            <span className="font-semibold text-slate-700">{formatCurrency(c.valor_iss)}</span>
          </div>
          <div className="bg-primary-50/20 px-2 py-0.5 rounded border border-primary-50 print:bg-transparent print:border-none print:px-0">
            <span className="block text-[9px] text-primary-600 font-bold uppercase tracking-wider print:text-slate-400">Valor Líquido</span>
            <span className="font-extrabold text-primary-750 print:text-black">{formatCurrency(c.valor_liquido)}</span>
          </div>
        </div>
      ) : isImposto ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-2 text-xs pt-2 border-t border-slate-50 print:gap-y-0.5 print:pt-1 print:text-[10px]">
          <div>
            <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Data de Vencimento</span>
            <span className="font-semibold text-slate-750">{formatDate(c.data_vencimento)}</span>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Descrição</span>
            <span className="font-semibold text-slate-750">{c.descricao || '-'}</span>
          </div>
          <div>
            <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Data de Pagamento</span>
            <span className="font-semibold text-slate-750">{formatDate(c.data_pagamento)}</span>
          </div>
          <div className="bg-primary-50/20 px-2 py-0.5 rounded border border-primary-50 print:bg-transparent print:border-none print:px-0">
            <span className="block text-[9px] text-primary-600 font-bold uppercase tracking-wider print:text-slate-400">Valor</span>
            <span className="font-extrabold text-primary-750 print:text-black">{formatCurrency(c.valor_pago)}</span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-2 text-xs pt-2 border-t border-slate-50 print:gap-y-0.5 print:pt-1 print:text-[10px]">
          <div>
            <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Vencimento</span>
            <span className="font-semibold text-slate-750">{formatDate(c.data_vencimento)}</span>
          </div>
          <div>
            <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Pagamento</span>
            <span className="font-semibold text-slate-750">{formatDate(c.data_pagamento)}</span>
          </div>
          <div>
            <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Forma Pagamento</span>
            <span className="font-semibold capitalize text-slate-750">{c.forma_pagamento || '-'}</span>
          </div>
          <div>
            <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Valor Pago</span>
            <span className="font-bold text-slate-750">{formatCurrency(c.valor_pago)}</span>
          </div>
          <div>
            <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Valor Juros</span>
            <span className="font-semibold text-amber-600">{formatCurrency(c.valor_juros)}</span>
          </div>
        </div>
      )}
    </div>
  );
});

// Modal de lançamento/edição: mantém o estado do formulário isolado para que
// a digitação re-renderize apenas o modal, não a página inteira.
function ModalLancamento({ aberto, comprovante, onFechar, onSalvo, mostrarToast }) {
  const [tipoDocumento, setTipoDocumento] = useState('Nota Fiscal');
  const [formData, setFormData] = useState(FORM_INICIAL);
  const [erros, setErros] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    if (comprovante) {
      setTipoDocumento(comprovante.tipo_documento);
      setFormData({
        numero_nf: comprovante.numero_nf || '',
        data_emissao: comprovante.data_emissao || '',
        nome: comprovante.nome || '',
        cnpj: comprovante.cnpj || '',
        local_servico: comprovante.local_servico || '',
        valor_total: comprovante.valor_total || 0,
        base_calculo: comprovante.base_calculo || 0,
        valor_inss: comprovante.valor_inss || 0,
        valor_iss: comprovante.valor_iss || 0,
        valor_liquido: comprovante.valor_liquido || 0,
        data_pagamento: comprovante.data_pagamento || '',
        data_vencimento: comprovante.data_vencimento || '',
        descricao: comprovante.descricao || '',
        forma_pagamento: comprovante.forma_pagamento || 'boleto',
        valor_pago: comprovante.valor_pago || 0,
        valor_juros: comprovante.valor_juros || 0
      });
    } else {
      setTipoDocumento('Nota Fiscal');
      setFormData(FORM_INICIAL);
    }
    setErros({});
  }, [aberto, comprovante]);

  if (!aberto) return null;

  const erroCampo = (campo) => erros[campo]
    ? ' border-rose-400 bg-rose-50/40 focus:border-rose-500 focus:ring-rose-500/20'
    : '';

  const msgErro = (campo) => erros[campo]
    ? <p className="text-[10px] text-rose-600 font-bold mt-1">Preencha {LABEL_CAMPOS[campo]}.</p>
    : null;

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: NUMERIC_FIELDS.includes(name) ? parseFloat(value) || 0 : value
    }));
    setErros(prev => {
      if (!(name in prev)) return prev;
      const novos = { ...prev };
      delete novos[name];
      return novos;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    let camposObrigatorios = ['data_pagamento', 'descricao', 'valor_pago'];
    if (tipoDocumento === 'Nota Fiscal') {
      camposObrigatorios = ['nome', 'cnpj', 'data_emissao'];
    } else if (tipoDocumento === 'Imposto') {
      camposObrigatorios = ['data_vencimento', 'descricao', 'valor_pago'];
    }

    const camposFaltando = camposObrigatorios.filter(campo => {
      const v = formData[campo];
      return v === '' || v === null || v === undefined || v === 0;
    });

    if (camposFaltando.length > 0) {
      const novosErros = {};
      camposFaltando.forEach(campo => { novosErros[campo] = true; });
      setErros(novosErros);

      const nomes = camposFaltando.map(campo => LABEL_CAMPOS[campo]).join(', ');
      mostrarToast(`Preencha o(s) campo(s) obrigatório(s): ${nomes}.`, 'error');
      return;
    }

    const dataSanitizada = {};
    Object.keys(formData).forEach(key => {
      dataSanitizada[key] = formData[key] === "" ? null : formData[key];
    });

    const payload = {
      tipo_documento: tipoDocumento,
      ...dataSanitizada
    };

    try {
      setSubmitting(true);
      const method = comprovante ? 'PUT' : 'POST';
      const url = comprovante ? `${API_URL}/comprovantes/${comprovante.id}` : `${API_URL}/comprovantes/`;

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        mostrarToast(comprovante ? 'Lançamento atualizado!' : 'Lançamento cadastrado com sucesso!');
        onSalvo();
      } else {
        const errorData = await res.json();
        mostrarToast(erroDaResposta(errorData, 'Erro ao salvar comprovante.'), 'error');
      }
    } catch (err) {
      console.error(err);
      mostrarToast('Erro de conexão ao salvar comprovante.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-200 my-8">
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
          <h3 className="font-bold text-base flex items-center gap-2">
            <FileText className="text-primary-400" />
            {comprovante ? 'Editar Lançamento' : 'Novo Lançamento'}
          </h3>
          <button
            onClick={onFechar}
            className="text-slate-400 hover:text-white text-xl font-bold p-1 cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">

          {/* Seleção do Tipo */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Tipo do Documento *</label>
            <select
              value={tipoDocumento}
              disabled={!!comprovante}
              onChange={(e) => {
                const tipo = e.target.value;
                setTipoDocumento(tipo);
                const formaPorTipo = {
                  'Nota Fiscal': 'boleto',
                  'Boleto': 'boleto',
                  'Pix': 'pix',
                  'Diversas': 'boleto',
                  'Aluguel': 'boleto',
                  'Imposto': 'boleto',
                };
                setFormData(prev => ({ ...prev, forma_pagamento: formaPorTipo[tipo] || 'boleto' }));
              }}
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
            >
              <option value="Nota Fiscal">Nota Fiscal</option>
              <option value="Boleto">Boleto</option>
              <option value="Pix">Pix</option>
              <option value="Diversas">Diversas</option>
              <option value="Aluguel">Aluguel</option>
              <option value="Imposto">Imposto</option>
            </select>
          </div>

          {/* Formulário Dinâmico: Nota Fiscal */}
          {tipoDocumento === 'Nota Fiscal' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-750">Número NF</label>
                <input
                  type="text"
                  name="numero_nf"
                  value={formData.numero_nf}
                  onChange={handleInputChange}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-750">Data Emissão *</label>
                <input
                  type="date"
                  name="data_emissao"
                  value={formData.data_emissao}
                  onChange={handleInputChange}
                  className={`w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold${erroCampo('data_emissao')}`}
                />
                {msgErro('data_emissao')}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="block text-xs font-bold text-slate-750">Nome *</label>
                <input
                  type="text"
                  name="nome"
                  value={formData.nome}
                  onChange={handleInputChange}
                  className={`w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold${erroCampo('nome')}`}
                />
                {msgErro('nome')}
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-750">CNPJ *</label>
                <input
                  type="text"
                  name="cnpj"
                  value={formData.cnpj}
                  onChange={handleInputChange}
                  placeholder="00.000.000/0000-00"
                  className={`w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold${erroCampo('cnpj')}`}
                />
                {msgErro('cnpj')}
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-750">Local do Serviço</label>
                <input
                  type="text"
                  name="local_servico"
                  value={formData.local_servico}
                  onChange={handleInputChange}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-750">Valor Total</label>
                <input
                  type="number"
                  step="0.01"
                  name="valor_total"
                  value={formData.valor_total}
                  onChange={handleInputChange}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-750">Base de Cálculo</label>
                <input
                  type="number"
                  step="0.01"
                  name="base_calculo"
                  value={formData.base_calculo}
                  onChange={handleInputChange}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-750">Valor INSS</label>
                <input
                  type="number"
                  step="0.01"
                  name="valor_inss"
                  value={formData.valor_inss}
                  onChange={handleInputChange}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-750">Valor ISS</label>
                <input
                  type="number"
                  step="0.01"
                  name="valor_iss"
                  value={formData.valor_iss}
                  onChange={handleInputChange}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="block text-xs font-bold text-slate-750">Valor Líquido</label>
                <input
                  type="number"
                  step="0.01"
                  name="valor_liquido"
                  value={formData.valor_liquido}
                  onChange={handleInputChange}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold font-bold text-primary-700 bg-primary-50/20"
                />
              </div>
            </div>
          ) : (
            /* Outros tipos */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-755">Data de Pagamento {tipoDocumento !== 'Imposto' && '*'}</label>
                <input
                  type="date"
                  name="data_pagamento"
                  value={formData.data_pagamento}
                  onChange={handleInputChange}
                  className={`w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold${erroCampo('data_pagamento')}`}
                />
                {msgErro('data_pagamento')}
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-755">Data de Vencimento {tipoDocumento === 'Imposto' && '*'}</label>
                <input
                  type="date"
                  name="data_vencimento"
                  value={formData.data_vencimento}
                  onChange={handleInputChange}
                  className={`w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold${erroCampo('data_vencimento')}`}
                />
                {msgErro('data_vencimento')}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="block text-xs font-bold text-slate-755">Descrição *</label>
                <input
                  type="text"
                  name="descricao"
                  value={formData.descricao}
                  onChange={handleInputChange}
                  placeholder="Ex: Mensalidade de internet da usina 1"
                  className={`w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold${erroCampo('descricao')}`}
                />
                {msgErro('descricao')}
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-755">Forma de Pagamento</label>
                <select
                  name="forma_pagamento"
                  value={formData.forma_pagamento}
                  onChange={handleInputChange}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                >
                  <option value="boleto">Boleto</option>
                  <option value="dda">DDA</option>
                  <option value="pix">Pix</option>
                  <option value="ted">TED</option>
                  <option value="dinheiro">Dinheiro</option>
                  <option value="cartao">Cartão</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-755">Número da NF (Opcional)</label>
                <input
                  type="text"
                  name="numero_nf"
                  value={formData.numero_nf}
                  onChange={handleInputChange}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-755">Valor Pago *</label>
                <input
                  type="number"
                  step="0.01"
                  name="valor_pago"
                  value={formData.valor_pago}
                  onChange={handleInputChange}
                  className={`w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-bold text-primary-750${erroCampo('valor_pago')}`}
                />
                {msgErro('valor_pago')}
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-755">Valor Juros</label>
                <input
                  type="number"
                  step="0.01"
                  name="valor_juros"
                  value={formData.valor_juros}
                  onChange={handleInputChange}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                />
              </div>
            </div>
          )}

          {/* Botões do Modal */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onFechar}
              className="px-4 py-2 border border-slate-200 text-slate-600 font-bold text-xs rounded-xl hover:bg-slate-50 transition-all cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-primary-600 hover:bg-primary-700 text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-primary-900/10 cursor-pointer disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Salvando...
                </>
              ) : (
                comprovante ? 'Atualizar Lançamento' : 'Salvar Lançamento'
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

export default Comprovantes;
