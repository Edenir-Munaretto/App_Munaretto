import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Edit2,
  Package,
  Plus,
  Printer,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';
import ModalConfirmacao from '../components/ModalConfirmacao';
import ErroCarregamento from '../components/ErroCarregamento';
import { useFetchState } from '../hooks/useFetchState';
import { parseDecimalBR } from '../utils/numeros';

const CATEGORIAS = [
  { id: 'cabo', label: 'Cabos', cor: 'bg-sky-50 text-sky-700 border-sky-200' },
  { id: 'poste', label: 'Poste', cor: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'trafo', label: 'Trafo', cor: 'bg-violet-50 text-violet-700 border-violet-200' },
];

const CATEGORIA_POR_ID = CATEGORIAS.reduce((mapa, categoria) => {
  mapa[categoria.id] = categoria;
  return mapa;
}, {});

const ORDEM_CATEGORIAS = CATEGORIAS.reduce((mapa, categoria, indice) => {
  mapa[categoria.id] = indice;
  return mapa;
}, {});

const FILTROS = [
  { id: 'todas', label: 'Todas' },
  ...CATEGORIAS.map(({ id, label }) => ({ id, label })),
];

const FORM_VAZIO = {
  cliente_nome: '',
  categoria: 'cabo',
  quantidade: '',
  descricao: '',
};

const normalizar = (valor) => String(valor || '').toLocaleLowerCase('pt-BR');

const formatarQuantidade = (valor) =>
  Number(valor || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const quantidadeParaInput = (valor) => {
  if (valor === null || valor === undefined || valor === '') return '';
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '';
  return numero.toLocaleString('pt-BR', { maximumFractionDigits: 3, useGrouping: false });
};

const formatarDataHora = () => new Date().toLocaleString('pt-BR');

const resumirDescricao = (descricao, limite = 100) => {
  const texto = String(descricao || '');
  return texto.length > limite ? `${texto.slice(0, limite)}...` : texto;
};

function MateriaisPorCliente({ usuarioAtual }) {
  const [materiais, setMateriais] = useState([]);
  const [busca, setBusca] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('todas');
  const [loading, setLoading] = useState(true);
  const { status: listaStatus, erro: listaErro, iniciar, sucesso, falhar } = useFetchState();
  const [toast, setToast] = useState(null);

  const [clientesSugeridos, setClientesSugeridos] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState(FORM_VAZIO);
  const [excluindo, setExcluindo] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchMateriais = useCallback(async () => {
    iniciar();
    setLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/materiais/`, { retry: 2 });
      if (res.ok) {
        setMateriais(await res.json());
        sucesso();
      } else {
        falhar(erroDaResposta(await res.json().catch(() => null), 'Erro ao buscar materiais.'));
      }
    } catch (err) {
      console.error('Erro ao buscar materiais:', err);
      falhar('Erro de conexão ao buscar materiais.');
    } finally {
      setLoading(false);
    }
  }, [iniciar, sucesso, falhar]);

  useEffect(() => {
    fetchMateriais();
  }, [fetchMateriais]);

  // Sugestões de nomes de clientes: usa o endpoint já existente de clientes,
  // sem criar vínculo nem serviço novo. Se o usuário não tiver permissão para
  // clientes, o campo continua funcionando como texto livre.
  useEffect(() => {
    const podeVerClientes = (usuarioAtual?.permissoes || []).includes('clientes');
    if (!podeVerClientes) {
      setClientesSugeridos([]);
      return undefined;
    }

    let cancelado = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/clientes/`, { retry: 1 });
        if (!res.ok) return;
        const dados = await res.json();
        if (cancelado) return;
        const nomes = [...new Set((dados || []).map((cliente) => cliente.nome).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, 'pt-BR'));
        setClientesSugeridos(nomes);
      } catch {
        // As sugestões são opcionais; sem elas o campo segue como texto livre.
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [usuarioAtual]);

  // Impressão pelo navegador: a lista filtrada completa é exibida no bloco
  // `.materiais-impressao` somente durante o @media print.
  useEffect(() => {
    if (!imprimindo) return undefined;
    const afterPrint = () => setImprimindo(false);
    window.addEventListener('afterprint', afterPrint);
    const timer = setTimeout(() => window.print(), 100);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', afterPrint);
    };
  }, [imprimindo]);

  const materiaisFiltrados = useMemo(() => {
    const termo = normalizar(busca).trim();
    return materiais.filter((material) => {
      if (categoriaFiltro !== 'todas' && material.categoria !== categoriaFiltro) return false;
      if (!termo) return true;
      return (
        normalizar(material.cliente_nome).includes(termo)
        || normalizar(material.descricao).includes(termo)
      );
    });
  }, [materiais, busca, categoriaFiltro]);

  const grupos = useMemo(() => {
    const mapa = new Map();
    materiaisFiltrados.forEach((material) => {
      const chave = material.cliente_nome || 'Sem cliente';
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave).push(material);
    });

    return [...mapa.entries()]
      .sort(([a], [b]) => normalizar(a).localeCompare(normalizar(b), 'pt-BR'))
      .map(([cliente, itens]) => ({
        cliente,
        itens: [...itens].sort((a, b) => {
          const ordemA = ORDEM_CATEGORIAS[a.categoria] ?? 99;
          const ordemB = ORDEM_CATEGORIAS[b.categoria] ?? 99;
          return ordemA - ordemB || (a.id || 0) - (b.id || 0);
        }),
      }));
  }, [materiaisFiltrados]);

  const totais = useMemo(() => {
    const porCategoria = { cabo: 0, poste: 0, trafo: 0 };
    materiaisFiltrados.forEach((material) => {
      if (porCategoria[material.categoria] !== undefined) porCategoria[material.categoria] += 1;
    });
    return {
      registros: materiaisFiltrados.length,
      clientes: new Set(materiaisFiltrados.map((material) => material.cliente_nome || 'Sem cliente')).size,
      porCategoria,
    };
  }, [materiaisFiltrados]);

  const resumoFiltros = useMemo(() => {
    const partes = [];
    if (busca.trim()) partes.push(`Busca: "${busca.trim()}"`);
    if (categoriaFiltro !== 'todas') {
      partes.push(`Categoria: ${CATEGORIA_POR_ID[categoriaFiltro]?.label || categoriaFiltro}`);
    }
    return partes.length ? partes.join(' · ') : 'Nenhum';
  }, [busca, categoriaFiltro]);

  const abrirNovo = () => {
    setEditingId(null);
    setFormData({ ...FORM_VAZIO });
    setShowModal(true);
  };

  const abrirEdicao = (material) => {
    setEditingId(material.id);
    setFormData({
      cliente_nome: material.cliente_nome || '',
      categoria: material.categoria || 'cabo',
      quantidade: quantidadeParaInput(material.quantidade),
      descricao: material.descricao || '',
    });
    setShowModal(true);
  };

  const fecharModal = () => {
    if (!submitting) setShowModal(false);
  };

  const atualizarCampo = (event) => {
    const { name, value } = event.target;
    setFormData((atual) => ({ ...atual, [name]: value }));
  };

  const salvarMaterial = async (adicionarOutro = false) => {
    const clienteNome = formData.cliente_nome.trim();
    const descricao = formData.descricao.trim();
    const quantidade = parseDecimalBR(formData.quantidade);

    if (!clienteNome) {
      showToast('Informe o nome do cliente.', 'error');
      return;
    }
    if (!descricao) {
      showToast('Informe a descrição do material.', 'error');
      return;
    }
    if (!quantidade || quantidade <= 0) {
      showToast('Informe uma quantidade maior que zero.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const editando = Boolean(editingId);
      const url = editando ? `${API_URL}/materiais/${editingId}` : `${API_URL}/materiais/`;
      const res = await apiFetch(url, {
        method: editando ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_nome: clienteNome,
          categoria: formData.categoria,
          quantidade,
          descricao,
        }),
      });

      if (!res.ok) {
        showToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao salvar material.'), 'error');
        return;
      }

      showToast(editando ? 'Material atualizado.' : 'Material cadastrado.');
      await fetchMateriais();

      if (editando || !adicionarOutro) {
        setShowModal(false);
        setEditingId(null);
        setFormData({ ...FORM_VAZIO });
      } else {
        setFormData((atual) => ({ ...atual, quantidade: '', descricao: '' }));
      }
    } catch (err) {
      console.error('Erro ao salvar material:', err);
      showToast('Erro de conexão ao salvar material.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    salvarMaterial(false);
  };

  const excluirMaterial = async () => {
    if (!excluindo) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`${API_URL}/materiais/${excluindo.id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Material excluído.');
        await fetchMateriais();
      } else {
        showToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao excluir material.'), 'error');
      }
    } catch (err) {
      console.error('Erro ao excluir material:', err);
      showToast('Erro de conexão ao excluir material.', 'error');
    } finally {
      setDeleting(false);
      setExcluindo(null);
    }
  };

  const imprimirLista = () => {
    if (materiaisFiltrados.length === 0) {
      showToast('Não há materiais para imprimir com os filtros atuais.', 'error');
      return;
    }
    setImprimindo(true);
  };

  return (
    <div className="space-y-6 print:space-y-2">
      <style dangerouslySetInnerHTML={{ __html: `
        .materiais-impressao {
          display: none;
        }
        @media print {
          @page {
            margin: 8mm;
          }
          body {
            background-color: white !important;
            color: black !important;
          }
          aside, header, .print\\:hidden, .no-print {
            display: none !important;
          }
          main {
            padding: 0 !important;
            margin: 0 !important;
          }
          html, body {
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
          }
          .flex-1.overflow-y-auto {
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
          }
          .flex.h-dvh.overflow-hidden,
          .flex.h-screen.overflow-hidden,
          main {
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
            min-height: 0 !important;
          }
          .materiais-impressao {
            display: block !important;
            width: 100% !important;
          }
          .materiais-impressao table {
            width: 100% !important;
            border-collapse: collapse !important;
          }
          .materiais-impressao th,
          .materiais-impressao td {
            border: 1px solid #cbd5e1 !important;
            padding: 4px 6px !important;
            font-size: 8px !important;
            vertical-align: top !important;
          }
          .materiais-impressao thead {
            display: table-header-group;
          }
          .materiais-impressao tr {
            break-inside: avoid;
          }
        }
      ` }} />

      {toast && (
        <div className={`print:hidden fixed top-4 right-4 z-50 p-4 rounded-xl shadow-xl flex items-center gap-3 border text-sm max-w-sm ${
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

      <datalist id="clientes-sugeridos">
        {clientesSugeridos.map((nome) => (
          <option key={nome} value={nome} />
        ))}
      </datalist>

      {/* Bloco exclusivo da impressão (lista filtrada completa) */}
      <div className="materiais-impressao">
        <h1 className="text-xl font-black text-slate-900">Materiais por Cliente</h1>
        <p className="text-[10px] text-slate-500 mt-1">Gerado em {formatarDataHora()}</p>
        <p className="text-[10px] text-slate-500">Filtros: {resumoFiltros}</p>

        <table className="mt-3 w-full text-left">
          <thead>
            <tr>
              <th className="font-bold">Cliente</th>
              <th className="font-bold">Categoria</th>
              <th className="font-bold">Qtd.</th>
              <th className="font-bold">Descrição</th>
            </tr>
          </thead>
          <tbody>
            {materiaisFiltrados.map((material) => (
              <tr key={material.id}>
                <td className="font-semibold">{material.cliente_nome}</td>
                <td>{CATEGORIA_POR_ID[material.categoria]?.label || material.categoria}</td>
                <td className="font-semibold whitespace-nowrap">{formatarQuantidade(material.quantidade)}</td>
                <td className="whitespace-pre-line">{material.descricao}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="print:hidden space-y-6">
        <div className="flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex flex-col sm:flex-row gap-3 flex-1">
            <div className="relative flex-1 max-w-xl">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Search size={18} />
              </span>
              <input
                type="text"
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                placeholder="Buscar por cliente ou material..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm"
              />
            </div>

            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto">
              {FILTROS.map((filtro) => (
                <button
                  key={filtro.id}
                  type="button"
                  onClick={() => setCategoriaFiltro(filtro.id)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    categoriaFiltro === filtro.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {filtro.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={imprimirLista}
              disabled={imprimindo || materiaisFiltrados.length === 0}
              title="Imprimir a lista filtrada"
              className="flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl font-semibold text-sm hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-40"
            >
              <Printer size={16} />
              {imprimindo ? 'Abrindo...' : 'Imprimir'}
            </button>
            <button
              type="button"
              onClick={abrirNovo}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl font-semibold text-sm hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer"
            >
              <Plus size={18} />
              Novo material
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="bg-white border border-slate-100 rounded-2xl p-3 shadow-sm">
            <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Registros</p>
            <p className="text-2xl font-black text-slate-700 leading-tight">{totais.registros}</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-3 shadow-sm">
            <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Clientes</p>
            <p className="text-2xl font-black text-slate-700 leading-tight">{totais.clientes}</p>
          </div>
          <div className="bg-sky-50 border border-sky-100 rounded-2xl p-3">
            <p className="text-[9px] font-extrabold uppercase tracking-wider text-sky-500">Cabos</p>
            <p className="text-2xl font-black text-sky-700 leading-tight">{totais.porCategoria.cabo}</p>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-3">
            <p className="text-[9px] font-extrabold uppercase tracking-wider text-amber-500">Postes</p>
            <p className="text-2xl font-black text-amber-700 leading-tight">{totais.porCategoria.poste}</p>
          </div>
          <div className="bg-violet-50 border border-violet-100 rounded-2xl p-3">
            <p className="text-[9px] font-extrabold uppercase tracking-wider text-violet-500">Trafos</p>
            <p className="text-2xl font-black text-violet-700 leading-tight">{totais.porCategoria.trafo}</p>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center gap-3 py-16">
            <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-semibold text-slate-400">Carregando materiais...</p>
          </div>
        ) : listaStatus === 'error' ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
            <ErroCarregamento mensagem={listaErro} onTentarNovamente={fetchMateriais} />
          </div>
        ) : grupos.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm text-center py-16 text-slate-400">
            <Package className="mx-auto mb-3 text-slate-300" size={42} />
            <p className="font-semibold text-slate-500">Nenhum material encontrado.</p>
            <p className="text-xs mt-1">
              {materiais.length === 0
                ? 'Cadastre o primeiro material no botão acima.'
                : 'Ajuste a busca ou o filtro de categoria.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {grupos.map((grupo) => (
              <div key={grupo.cliente} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-slate-800 truncate">{grupo.cliente}</p>
                    <p className="text-[10px] font-semibold text-slate-400">
                      {grupo.itens.length} material(is)
                    </p>
                  </div>
                  <Package size={17} className="text-slate-300 shrink-0" />
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-white border-b border-slate-100 text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                        <th className="px-4 py-3 w-28">Categoria</th>
                        <th className="px-4 py-3 w-32">Quantidade</th>
                        <th className="px-4 py-3">Descrição</th>
                        <th className="px-4 py-3 w-28 text-center print:hidden">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {grupo.itens.map((material) => {
                        const categoria = CATEGORIA_POR_ID[material.categoria] || {
                          label: material.categoria,
                          cor: 'bg-slate-50 text-slate-600 border-slate-200',
                        };
                        return (
                          <tr key={material.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-1 rounded-full border text-[10px] font-extrabold ${categoria.cor}`}>
                                {categoria.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-black text-slate-800 whitespace-nowrap">
                              {formatarQuantidade(material.quantidade)}
                            </td>
                            <td className="px-4 py-3 text-slate-700 whitespace-pre-line break-words min-w-[280px]">
                              {material.descricao}
                            </td>
                            <td className="px-4 py-3 print:hidden">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => abrirEdicao(material)}
                                  title="Editar material"
                                  className="w-10 h-10 flex items-center justify-center rounded-lg bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors cursor-pointer"
                                >
                                  <Edit2 size={15} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setExcluindo(material)}
                                  title="Excluir material"
                                  className="w-10 h-10 flex items-center justify-center rounded-lg bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors cursor-pointer"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="md:hidden divide-y divide-slate-100">
                  {grupo.itens.map((material) => {
                    const categoria = CATEGORIA_POR_ID[material.categoria] || {
                      label: material.categoria,
                      cor: 'bg-slate-50 text-slate-600 border-slate-200',
                    };
                    return (
                      <div key={material.id} className="px-4 py-3 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-extrabold ${categoria.cor}`}>
                              {categoria.label}
                            </span>
                            <span className="text-sm font-black text-slate-800">
                              {formatarQuantidade(material.quantidade)}
                            </span>
                          </div>
                          <p className="text-sm text-slate-700 mt-1 whitespace-pre-line break-words">
                            {material.descricao}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => abrirEdicao(material)}
                            title="Editar material"
                            className="w-10 h-10 flex items-center justify-center rounded-lg bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors cursor-pointer"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setExcluindo(material)}
                            title="Excluir material"
                            className="w-10 h-10 flex items-center justify-center rounded-lg bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors cursor-pointer"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="print:hidden">
        {showModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden animate-in fade-in zoom-in duration-200">
              <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
                <h3 className="font-bold text-lg">
                  {editingId ? 'Editar material' : 'Novo material'}
                </h3>
                <button
                  type="button"
                  onClick={fecharModal}
                  disabled={submitting}
                  className="text-slate-400 hover:text-white p-1 cursor-pointer disabled:opacity-40"
                  title="Fechar"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5" htmlFor="material-cliente">
                    Cliente *
                  </label>
                  <input
                    id="material-cliente"
                    type="text"
                    name="cliente_nome"
                    list="clientes-sugeridos"
                    value={formData.cliente_nome}
                    onChange={atualizarCampo}
                    required
                    maxLength={255}
                    autoComplete="off"
                    autoFocus
                    placeholder="Digite ou selecione o nome do cliente"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                  />
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    O nome é apenas informativo e não cria vínculo com o cadastro de clientes.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5" htmlFor="material-categoria">
                      Categoria *
                    </label>
                    <select
                      id="material-categoria"
                      name="categoria"
                      value={formData.categoria}
                      onChange={atualizarCampo}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm bg-white"
                    >
                      {CATEGORIAS.map((categoria) => (
                        <option key={categoria.id} value={categoria.id}>
                          {categoria.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5" htmlFor="material-quantidade">
                      Quantidade *
                    </label>
                    <input
                      id="material-quantidade"
                      type="text"
                      name="quantidade"
                      inputMode="decimal"
                      value={formData.quantidade}
                      onChange={atualizarCampo}
                      required
                      placeholder="Ex.: 1.064,35"
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5" htmlFor="material-descricao">
                    Descrição do material *
                  </label>
                  <textarea
                    id="material-descricao"
                    name="descricao"
                    value={formData.descricao}
                    onChange={atualizarCampo}
                    required
                    rows={5}
                    placeholder="Cole aqui a descrição do material..."
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm resize-y"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={fecharModal}
                    disabled={submitting}
                    className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-40"
                  >
                    Cancelar
                  </button>
                  {!editingId && (
                    <button
                      type="button"
                      onClick={() => salvarMaterial(true)}
                      disabled={submitting}
                      className="px-4 py-2 border border-primary-200 text-primary-700 bg-primary-50 rounded-xl text-sm font-semibold hover:bg-primary-100 transition-all cursor-pointer disabled:opacity-40"
                    >
                      Salvar e adicionar outro
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {submitting ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      editingId ? 'Salvar alterações' : 'Cadastrar material'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <ModalConfirmacao
          aberto={excluindo != null}
          titulo="Excluir material"
          mensagem={excluindo
            ? `Tem certeza que deseja excluir "${resumirDescricao(excluindo.descricao)}" do cliente "${excluindo.cliente_nome}"? Esta ação não pode ser desfeita.`
            : ''}
          loading={deleting}
          onConfirmar={excluirMaterial}
          onCancelar={() => setExcluindo(null)}
        />
      </div>
    </div>
  );
}

export default MateriaisPorCliente;
