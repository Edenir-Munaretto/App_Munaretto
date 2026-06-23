import React, { useState, useEffect, useRef } from 'react';
import { FileText, FileSpreadsheet, Plus, Upload, Check, AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { API_URL } from '../App';

function GeradorDocumentos() {
  const [clientes, setClientes] = useState([]);
  const [selectedClienteId, setSelectedClienteId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);

  const [templates, setTemplates] = useState({ word: [], excel: [] });
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [formato, setFormato] = useState('word');

  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState(null);

  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    fetchTemplates();
    fetchClientes();
    
    // Fecha dropdown de clientes ao clicar fora
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowClientDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchClientes = async () => {
    try {
      const res = await fetch(`${API_URL}/clientes/`);
      if (res.ok) {
        const data = await res.json();
        setClientes(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await fetch(`${API_URL}/documentos/templates`);
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao carregar modelos de templates.', 'error');
    }
  };

  const filteredClientes = clientSearch.trim()
    ? clientes.filter(c => c.nome.toLowerCase().includes(clientSearch.toLowerCase()) || c.cpf_cnpj.includes(clientSearch))
    : clientes;

  const handleSelectClient = (c) => {
    setSelectedClienteId(c.id);
    setClientSearch(c.nome);
    setShowClientDropdown(false);
  };

  const handleFormatChange = (e) => {
    setFormato(e.target.value);
  };

  const handleUploadClick = () => {
    fileInputRef.current.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'docx' && ext !== 'xlsx') {
      showToast('Apenas arquivos .docx ou .xlsx são permitidos.', 'error');
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_URL}/documentos/templates/upload`, {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        showToast(`Template "${file.name}" enviado com sucesso!`);
        fetchTemplates();
      } else {
        showToast('Falha ao fazer upload do modelo.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao enviar arquivo.', 'error');
    } finally {
      setUploading(false);
      e.target.value = ''; // Limpa input
    }
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!selectedClienteId) {
      showToast('Selecione um cliente para gerar o documento.', 'error');
      return;
    }
    if (!selectedTemplate) {
      showToast('Selecione um modelo de template.', 'error');
      return;
    }

    try {
      setGenerating(true);
      const formData = new FormData();
      formData.append('cliente_id', selectedClienteId);
      formData.append('template_name', selectedTemplate);
      formData.append('formato', formato);

      const res = await fetch(`${API_URL}/documentos/gerar`, {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        // Pega o blob do stream e faz download
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        const selectedClient = clientes.find(c => c.id === selectedClienteId);
        const clientName = selectedClient ? selectedClient.nome : '';
        let filename = `${selectedTemplate} - ${clientName || 'gerado'}.${formato === 'word' ? 'docx' : formato === 'excel' ? 'xlsx' : 'pdf'}`;
        
        // Pega nome do arquivo do Header Content-Disposition se existir
        const disposition = res.headers.get('content-disposition');
        if (disposition && disposition.indexOf('attachment') !== -1) {
          const filenameStarRegex = /filename\*\s*=\s*([^;]+)/i;
          const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i;

          const filenameStarMatch = filenameStarRegex.exec(disposition);
          if (filenameStarMatch && filenameStarMatch[1]) {
            let value = filenameStarMatch[1].trim().replace(/['"]/g, '');
            const rfc5987 = value.match(/^[^']*'[^']*'(.*)$/);
            if (rfc5987) {
              value = rfc5987[1];
            }
            // Remove prefix variants like utf-8'' or malformed utf-81
            value = value.replace(/^utf-8(?:''|['"])?/i, '');
            value = value.replace(/^utf-81(?:''|['"])?/i, '');
            try {
              value = decodeURIComponent(value);
            } catch (error) {
              console.warn('Falha ao decodificar filename*:', error);
            }
            filename = value;
          } else {
            const matches = filenameRegex.exec(disposition);
            if (matches != null && matches[1]) {
              filename = matches[1].replace(/['"]/g, '');
              try {
                filename = decodeURIComponent(filename);
              } catch (error) {
                // keep original filename if not percent-encoded
              }
            }
          }
        }

        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        
        showToast('Documento gerado e baixado com sucesso!');
      } else {
        const errJson = await res.json();
        showToast(errJson.detail || 'Erro ao gerar documento.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao gerar documento.', 'error');
    } finally {
      setGenerating(false);
    }
  };

  // Seletor dinâmico baseado nos formatos dos templates disponíveis
  const isExcelTemplate = templates.excel.includes(selectedTemplate);
  const isWordTemplate = templates.word.includes(selectedTemplate);

  useEffect(() => {
    if (isExcelTemplate) {
      setFormato('excel');
    } else if (isWordTemplate && formato === 'excel') {
      setFormato('word');
    }
  }, [selectedTemplate]);

  return (
    <div className="space-y-6 relative">
      
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-xl shadow-xl flex items-center gap-3 border text-sm max-w-sm animate-in slide-in-from-top-4 duration-300 ${
          toast.type === 'error' 
            ? 'bg-rose-50 border-rose-200 text-rose-800' 
            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          <div className={`p-1 rounded-full ${toast.type === 'error' ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>
            {toast.type === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}
          </div>
          <p className="font-semibold">{toast.message}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Form: Client selection and document generator config */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm lg:col-span-2 space-y-6">
          <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <FileText className="text-primary-500" />
              Geração de Documentos Personalizados
            </h3>
          </div>

          <form onSubmit={handleGenerate} className="space-y-6">
            
            {/* Auto-complete Busca de Clientes */}
            <div className="relative" ref={dropdownRef}>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">1. Selecione o Cliente *</label>
              <input
                type="text"
                placeholder="Pesquise por nome ou CPF/CNPJ do cliente..."
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setSelectedClienteId(''); // Reseta ID se alterar busca
                  setShowClientDropdown(true);
                }}
                onFocus={() => setShowClientDropdown(true)}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
              />
              
              {/* Dropdown Options */}
              {showClientDropdown && filteredClientes.length > 0 && (
                <div className="absolute top-[76px] left-0 right-0 max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-20 divide-y divide-slate-100">
                  {filteredClientes.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => handleSelectClient(c)}
                      className="px-4 py-2.5 text-xs hover:bg-primary-50 cursor-pointer flex justify-between items-center"
                    >
                      <span className="font-bold text-slate-800">{c.nome}</span>
                      <span className="text-slate-400 font-mono">{c.cpf_cnpj}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Template Selection Grid */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">2. Selecione o Modelo de Template *</label>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto p-1">
                
                {/* Word Templates (.docx) */}
                {templates.word.map((temp) => (
                  <div
                    key={temp}
                    onClick={() => setSelectedTemplate(temp)}
                    className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${
                      selectedTemplate === temp
                        ? 'border-primary-500 bg-primary-50/10'
                        : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="p-2 bg-blue-50 text-blue-500 rounded-lg">
                      <FileText size={18} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800 truncate max-w-[180px]">{temp.replace(/_/g, ' ')}</p>
                      <p className="text-[10px] text-slate-400">Modelo Word (.docx)</p>
                    </div>
                  </div>
                ))}

                {/* Excel Templates (.xlsx) */}
                {templates.excel.map((temp) => (
                  <div
                    key={temp}
                    onClick={() => setSelectedTemplate(temp)}
                    className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${
                      selectedTemplate === temp
                        ? 'border-emerald-500 bg-emerald-50/10'
                        : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="p-2 bg-emerald-50 text-emerald-500 rounded-lg">
                      <FileSpreadsheet size={18} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800 truncate max-w-[180px]">{temp.replace(/_/g, ' ')}</p>
                      <p className="text-[10px] text-slate-400">Modelo Planilha (.xlsx)</p>
                    </div>
                  </div>
                ))}

              </div>
            </div>

            {/* Format Selection (Only available for docx templates) */}
            {selectedTemplate && (
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-2">
                <label className="block text-xs font-bold text-slate-700">3. Formato de Saída</label>
                
                {isExcelTemplate ? (
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-700">
                    <FileSpreadsheet size={16} />
                    <span>Este modelo será baixado no formato Excel (.xlsx).</span>
                  </div>
                ) : (
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
                      <input
                        type="radio"
                        value="word"
                        checked={formato === 'word'}
                        onChange={handleFormatChange}
                        className="accent-primary-600"
                      />
                      Documento Word (.docx)
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
                      <input
                        type="radio"
                        value="pdf"
                        checked={formato === 'pdf'}
                        onChange={handleFormatChange}
                        className="accent-primary-600"
                      />
                      Documento PDF (.pdf)
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* Action Submit */}
            <button
              type="submit"
              disabled={generating || !selectedClienteId || !selectedTemplate}
              className={`w-full py-3 flex items-center justify-center gap-2 font-bold text-sm rounded-xl transition-all shadow-md cursor-pointer ${
                generating || !selectedClienteId || !selectedTemplate
                  ? 'bg-slate-200 text-slate-400 border border-slate-200 shadow-none cursor-not-allowed'
                  : formato === 'excel'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-900/10'
                  : 'bg-primary-600 text-white hover:bg-primary-700 shadow-primary-900/10'
              }`}
            >
              {generating ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  Preenchendo e convertendo documento...
                </>
              ) : (
                <>
                  <Download size={16} />
                  Gerar e Baixar Documento
                </>
              )}
            </button>

          </form>

        </div>

        {/* Right Side: Upload new template files */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4 h-fit">
          <h3 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2.5">
            <Upload className="text-amber-500" />
            Importar Modelo
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Envie novos modelos de contratos ou planilhas de preenchimento. Coloque os marcadores <code className="bg-slate-100 px-1 rounded text-primary-700 font-mono font-bold">{"{{placeholder}}"}</code> nos arquivos para preenchimento automático.
          </p>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".docx,.xlsx"
            className="hidden"
          />

          <button
            onClick={handleUploadClick}
            disabled={uploading}
            className="w-full flex flex-col items-center justify-center border-2 border-dashed border-slate-350 hover:border-primary-500 rounded-2xl py-8 px-4 bg-slate-50 hover:bg-primary-50/10 text-slate-600 hover:text-primary-700 transition-all cursor-pointer gap-2 disabled:bg-slate-200 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <RefreshCw size={24} className="animate-spin text-primary-500" />
                <span className="text-xs font-bold mt-1">Carregando arquivo...</span>
              </>
            ) : (
              <>
                <Upload size={28} className="text-slate-400" />
                <span className="text-xs font-bold">Clique para importar</span>
                <span className="text-[10px] text-slate-400">Apenas arquivos Word (.docx) ou Excel (.xlsx)</span>
              </>
            )}
          </button>
        </div>

      </div>

    </div>
  );
}

export default GeradorDocumentos;
