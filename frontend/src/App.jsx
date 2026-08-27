import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Users,
  Contact,
  Palmtree,
  LineChart,
  FileText,
  Bell,
  Menu,
  LogOut,
  User as UserIcon,
  Receipt,
  Banknote,
  Settings,
  ShieldCheck,
  Check,
  Trash2,
  Wrench,
  ClipboardList,
} from 'lucide-react';

// Importando as páginas
import Dashboard from './pages/Dashboard';
import Clientes from './pages/Clientes';
import Funcionarios from './pages/Funcionarios';
import Ferias from './pages/Ferias';
import FluxoCaixa from './pages/FluxoCaixa';
import GeradorDocumentos from './pages/GeradorDocumentos';
import Comprovantes from './pages/Comprovantes';
import Recebimentos from './pages/Recebimentos';
import Manutencao from './pages/Manutencao';
import Sst from './pages/Sst';
import OrdensServico from './pages/OrdensServico';
import Configuracoes from './pages/Configuracoes';
import Login from './pages/Login';
import { MODULOS } from './modules';
import { API_URL, apiFetch, getToken, setToken, clearToken, segundosAteExpiracao, renovarSessao } from './api';
import ModalConfirmacao from './components/ModalConfirmacao';

const ICONES = {
  dashboard: LayoutDashboard,
  clientes: Users,
  funcionarios: Contact,
  ferias: Palmtree,
  fluxo: LineChart,
  documentos: FileText,
  comprovantes: Receipt,
  recebimentos: Banknote,
  manutencao: Wrench,
  sst: ShieldCheck,
  os: ClipboardList,
  configuracoes: Settings,
};

const COMPONENTES = {
  dashboard: Dashboard,
  clientes: Clientes,
  funcionarios: Funcionarios,
  ferias: Ferias,
  fluxo: FluxoCaixa,
  documentos: GeradorDocumentos,
  comprovantes: Comprovantes,
  recebimentos: Recebimentos,
  manutencao: Manutencao,
  sst: Sst,
  os: OrdensServico,
  configuracoes: Configuracoes,
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { erro: null };
  }

  static getDerivedStateFromError(erro) {
    return { erro };
  }

  componentDidCatch(error, info) {
    console.error('Erro capturado pelo ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.erro) {
      return (
        <div className="flex h-screen items-center justify-center bg-slate-50 p-6">
          <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full border border-rose-200">
            <p className="text-2xl">⚠️</p>
            <h2 className="text-lg font-bold text-slate-800 mt-2">Ocorreu um erro inesperado</h2>
            <p className="text-sm text-slate-500 mt-1">Recarregue a página (F5). Se persistir, verifique o console (F12).</p>
            <pre className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 overflow-x-auto whitespace-pre-wrap">
              {String(this.state.erro.message || this.state.erro)}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-semibold cursor-pointer"
            >
              Recarregar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [sstAlerts, setSstAlerts] = useState([]);
  const [notificacoes, setNotificacoes] = useState([]);
  const [notifErro, setNotifErro] = useState('');
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [notifExcluir, setNotifExcluir] = useState(null); // id da notificação a excluir
  const [excluindoNotif, setExcluindoNotif] = useState(false);
  const [usuario, setUsuario] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('munaretto_usuario') || 'null');
    } catch {
      return null;
    }
  });
  const [sessaoExpirada, setSessaoExpirada] = useState(false);
  const [segundosRestantes, setSegundosRestantes] = useState(null);
  const [renovando, setRenovando] = useState(false);

  // Monitora a expiração do token e avisa 10 minutos antes (item 3.3 do plano).
  useEffect(() => {
    if (!getToken()) return;
    const atualizarTempo = () => {
      const seg = segundosAteExpiracao();
      if (seg <= 0) return; // expirou: o apiFetch já trata com 401
      setSegundosRestantes(seg);
    };
    atualizarTempo();
    const interval = setInterval(atualizarTempo, 15000); // a cada 15s
    return () => clearInterval(interval);
  }, [usuario]);

  const handleRenovarSessao = async () => {
    if (renovando) return;
    setRenovando(true);
    try {
      const resultado = await renovarSessao();
      if (resultado.ok) {
        const dados = resultado.data;
        const { token, ...dadosUsuario } = dados;
        localStorage.setItem('munaretto_usuario', JSON.stringify(dadosUsuario));
        setUsuario(dadosUsuario);
        setSegundosRestantes(segundosAteExpiracao());
      } else {
        setSessaoExpirada(true);
        setUsuario(null);
        clearToken();
        localStorage.removeItem('munaretto_usuario');
      }
    } catch (err) {
      console.error('Erro ao renovar sessão:', err);
    } finally {
      setRenovando(false);
    }
  };

  const avisoExpiracao = segundosRestantes != null && segundosRestantes > 0 && segundosRestantes <= 600;

  // Encerra a sessão automaticamente quando o token expira (401)
  useEffect(() => {
    const handleUnauthorized = () => {
      setSessaoExpirada(true);
      setUsuario(null);
      setActiveTab('dashboard');
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_URL}/ferias/alertas`);
      if (res.ok) {
        const data = await res.json();
        setAlerts(data);
      }
    } catch (err) {
      console.error('Erro ao buscar alertas:', err);
    }
    try {
      if (usuario?.permissoes?.includes('sst')) {
        const res = await apiFetch(`${API_URL}/sst/alertas`);
        if (res.ok) {
          const data = await res.json();
          setSstAlerts(data.alertas || []);
        }
      }
    } catch (err) {
      console.error('Erro ao buscar alertas de SST:', err);
    }
  }, [usuario]);

  // Busca alertas de férias ao carregar
  useEffect(() => {
    if (!usuario) return;
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 100000); // 1.5 minutos
    return () => clearInterval(interval);
  }, [usuario, fetchAlerts]);

  const fetchNotifications = useCallback(async () => {
    if (!usuario?.email) return;
    try {
      // Busca apenas as NÃO LIDAS: ao marcar como lida, a notificação some do painel
      const res = await apiFetch(`${API_URL}/notificacoes/?lida=false&destinatario=${encodeURIComponent(usuario.email)}`);
      if (res.ok) {
        const data = await res.json();
        setNotificacoes(data);
      }
    } catch (err) {
      console.error('Erro ao buscar notificações:', err);
    }
  }, [usuario?.email]);

  // Busca notificações do usuário logado ao carregar e periodicamente
  useEffect(() => {
    if (!usuario) return;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000); // 1 minuto
    return () => clearInterval(interval);
  }, [usuario, fetchNotifications]);

  const mostrarNotifErro = (msg) => {
    setNotifErro(msg);
    setTimeout(() => setNotifErro(''), 4000);
  };

  const marcarNotifLida = async (id) => {
    try {
      const res = await apiFetch(`${API_URL}/notificacoes/${id}/lida`, { method: 'PATCH' });
      if (res.ok) {
        // Remove imediatamente do painel (só lista não lidas)
        setNotificacoes(prev => prev.filter(n => n.id !== id));
      } else {
        mostrarNotifErro('Não foi possível marcar a notificação como lida. Tente novamente.');
      }
    } catch (err) {
      console.error('Erro ao marcar notificação como lida:', err);
      mostrarNotifErro('Erro de conexão ao marcar a notificação como lida.');
    }
  };

  const marcarTodasNotifLidas = async () => {
    if (!usuario?.email) return;
    try {
      const res = await apiFetch(`${API_URL}/notificacoes/marcar-todas-lidas?destinatario=${encodeURIComponent(usuario.email)}`, { method: 'POST' });
      if (res.ok) {
        setNotificacoes([]);
      } else {
        mostrarNotifErro('Não foi possível marcar todas como lidas. Tente novamente.');
      }
    } catch (err) {
      console.error('Erro ao marcar notificações como lidas:', err);
      mostrarNotifErro('Erro de conexão ao marcar todas como lidas.');
    }
  };

  const excluirNotif = async (id) => {
    if (id == null) return;
    try {
      setExcluindoNotif(true);
      const res = await apiFetch(`${API_URL}/notificacoes/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setNotificacoes(prev => prev.filter(n => n.id !== id));
      } else {
        mostrarNotifErro('Não foi possível excluir a notificação. Tente novamente.');
      }
    } catch (err) {
      console.error('Erro ao excluir notificação:', err);
      mostrarNotifErro('Erro de conexão ao excluir a notificação.');
    } finally {
      setExcluindoNotif(false);
      setNotifExcluir(null);
    }
  };

  const abrirNotificacao = (n) => {
    marcarNotifLida(n.id);
    setShowNotifPanel(false);
    if (n.tipo === 'ferias' && n.ferias_id) {
      setActiveTab('ferias');
    }
    if (n.tipo === 'documento_veiculo' && n.veiculo_documento_id) {
      setActiveTab('manutencao');
    }
  };

  const formatDateBR = (isoStr) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch {
      return isoStr;
    }
  };

  const notificacoesNaoLidas = notificacoes.filter(n => !n.lida).length;
  const totalSinos = notificacoesNaoLidas + alerts.length + sstAlerts.length;

  const handleLogin = (user) => {
    if (user?.token) setToken(user.token);
    const { token, ...dadosUsuario } = user || {};
    localStorage.setItem('munaretto_usuario', JSON.stringify(dadosUsuario));
    setUsuario(dadosUsuario);
    setSessaoExpirada(false);
    setActiveTab('dashboard');
  };

  const handleLogout = () => {
    clearToken();
    localStorage.removeItem('munaretto_usuario');
    setUsuario(null);
    setActiveTab('dashboard');
  };

  // Busca os dados ATUAIS do usuário no backend e atualiza a sessão.
  // Permite que mudanças de permissão (feitas pelo admin) valham sem logout/login.
  const atualizarUsuarioAtual = useCallback(async () => {
    if (!getToken()) return;
    try {
      const res = await apiFetch(`${API_URL}/usuarios/me`);
      if (res.ok) {
        const dados = await res.json();
        setUsuario(dados);
        localStorage.setItem('munaretto_usuario', JSON.stringify(dados));
      }
    } catch (err) {
      console.error('Erro ao atualizar dados do usuário:', err);
    }
  }, []);

  // Ao carregar, ao focar a janela (com debounce de 30s) e a cada minuto, sincroniza as permissões.
  useEffect(() => {
    if (!getToken()) return;
    atualizarUsuarioAtual();
    let ultimoFocus = 0;
    const onFocus = () => {
      const agora = Date.now();
      // Ignora eventos de foco se a última atualização foi há menos de 30 segundos
      if (agora - ultimoFocus < 30000) return;
      ultimoFocus = agora;
      atualizarUsuarioAtual();
    };
    window.addEventListener('focus', onFocus);
    const interval = setInterval(atualizarUsuarioAtual, 60000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, [atualizarUsuarioAtual]);

  // O Dashboard é um módulo próprio liberado pelo administrador na aba
  // Configurações. Quem tiver a permissão "dashboard" tem acesso total aos
  // dados agregados (funcionários, férias, ASOs e cursos).
  const permissoes = usuario?.permissoes || [];
  const podeDashboard = permissoes.includes('dashboard');

  const tabs = [
    ...(podeDashboard ? [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, component: Dashboard }] : []),
    ...MODULOS
      // "os_campo" não gera aba própria: quem tem essa permissão vê a MESMA
      // aba "Controle de O.S" (com a UI restrita às ações de campo).
      .filter(m => m.id !== 'dashboard' && m.id !== 'os_campo' && (permissoes.includes(m.id) || (m.id === 'os' && permissoes.includes('os_campo'))))
      .map(m => ({
        id: m.id,
        label: m.label,
        icon: ICONES[m.id] || FileText,
        component: COMPONENTES[m.id] || Dashboard
      }))
  ];

  if (!usuario || !getToken()) {
    return <Login onLogin={handleLogin} mensagemExpirada={sessaoExpirada} />;
  }

  if (tabs.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm text-center border border-slate-200">
          <p className="text-lg font-bold text-slate-800">Sem permissões de acesso</p>
          <p className="text-sm text-slate-500 mt-2">
            Seu usuário não possui módulos liberados. Fale com o administrador.
          </p>
          <button
            onClick={handleLogout}
            className="mt-6 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700"
          >
            Sair
          </button>
        </div>
      </div>
    );
  }

  const ActiveComponent = tabs.find(t => t.id === activeTab)?.component || tabs[0].component;

  return (
    <ErrorBoundary>
      <div className="flex h-dvh bg-slate-50 overflow-hidden">

      {/* Overlay para fechar o menu no mobile */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* SIDEBAR: drawer no mobile, coluna fixa no desktop */}
      <aside className={`bg-slate-900 text-white flex flex-col transition-all duration-300 fixed inset-y-0 left-0 z-40 lg:static lg:translate-x-0 lg:shadow-none ${mobileMenuOpen ? 'translate-x-0 shadow-2xl max-lg:w-64' : '-translate-x-full'} ${sidebarOpen ? 'w-64' : 'w-20'}`}>
        
        {/* Logo/Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800">
          <div className="flex items-center gap-3 overflow-hidden">
            <img src="/logo-munaretto.png" alt="Munaretto" className="w-9 h-9 object-contain shrink-0" />
            {sidebarOpen && (
              <span className="font-extrabold text-lg tracking-wider bg-gradient-to-r from-primary-400 to-emerald-400 bg-clip-text text-transparent uppercase">
                Munaretto
              </span>
            )}
          </div>
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)} 
            className="hidden lg:block p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <Menu size={20} />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setMobileMenuOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-semibold transition-all duration-200 ${
                  isActive 
                    ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/20' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon size={20} className={isActive ? 'text-white' : 'text-slate-400'} />
                {sidebarOpen && <span>{tab.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Footer Sidebar */}
        {sidebarOpen && (
          <div className="p-4 border-t border-slate-800 text-xs text-slate-500 overflow-hidden">
            <span>Desenvolvido por Munaretto & Co. Tecnologia</span>
          </div>
        )}
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Aviso de sessão prestes a expirar */}
        {avisoExpiracao && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 md:px-6 py-2.5 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-amber-800 flex items-center gap-2">
              <span>⏰</span>
              Sua sessão expira em{' '}
              <span className="font-bold">{Math.ceil(segundosRestantes / 60)} minuto(s)</span>.
              Clique em &quot;Renovar sessão&quot; para continuar sem perder o que está fazendo.
            </p>
            <button
              onClick={handleRenovarSessao}
              disabled={renovando}
              className="px-3 py-1.5 min-h-11 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shrink-0"
            >
              {renovando ? (
                <>
                  <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Renovando...
                </>
              ) : (
                'Renovar sessão'
              )}
            </button>
          </div>
        )}

        {/* HEADER */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6 z-10">
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden w-11 h-11 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-600"
              title="Abrir menu"
            >
              <Menu size={22} />
            </button>
            <h1 className="text-lg sm:text-xl font-bold text-slate-800 capitalize">
              {tabs.find(t => t.id === activeTab)?.label}
            </h1>
          </div>

          <div className="flex items-center gap-4">
            
            {/* Central de Notificações (sino único) */}
            <div className="relative">
              <button 
                onClick={() => setShowNotifPanel(!showNotifPanel)} 
                className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-600 relative transition-all"
                title="Notificações e alertas"
              >
                <Bell size={20} />
                {totalSinos > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center animate-pulse">
                    {totalSinos}
                  </span>
                )}
              </button>

              {showNotifPanel && (
                <div className="absolute right-0 top-12 w-[calc(100vw-2rem)] max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden animate-in slide-in-from-top-2 duration-200">
                  <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bell size={16} className="text-primary-400" />
                      <h3 className="font-bold text-sm">Central de Notificações</h3>
                    </div>
                    {notificacoesNaoLidas > 0 && (
                      <button 
                        onClick={marcarTodasNotifLidas}
                        className="text-[11px] font-semibold text-primary-300 hover:text-white transition-colors"
                      >
                        Marcar todas como lidas
                      </button>
                    )}
                  </div>

                  {notifErro && (
                    <div className="px-4 py-2 bg-rose-50 border-b border-rose-100 text-rose-700 text-xs font-semibold">
                      {notifErro}
                    </div>
                  )}

                  <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                    
                    {/* Seção: Notificações */}
                    <div className="py-2">
                      <div className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <span>🔔</span> Notificações
                        {notificacoesNaoLidas > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700 text-[9px]">
                            {notificacoesNaoLidas} novas
                          </span>
                        )}
                      </div>
                      {notificacoes.length === 0 ? (
                        <p className="px-4 pb-3 text-center text-slate-400 text-sm">Nenhuma notificação pendente.</p>
                      ) : (
                        notificacoes.map((n) => (
                          <div
                            key={n.id}
                            className={`w-full text-left px-4 py-3 flex gap-3 transition-colors items-center ${
                              n.lida ? 'bg-white hover:bg-slate-50' : 'bg-primary-50/60 hover:bg-primary-50'
                            }`}
                          >
                            <button
                              onClick={() => abrirNotificacao(n)}
                              className="flex gap-3 items-center flex-1 min-w-0 text-left cursor-pointer"
                            >
                              <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${n.lida ? 'bg-slate-200' : 'bg-primary-500'}`} />
                              <span className="flex-1 min-w-0">
                                <span className="block text-xs font-bold text-slate-800">{n.titulo}</span>
                                <span className="block text-xs text-slate-600 mt-0.5">{n.mensagem}</span>
                                <span className="block text-[10px] text-slate-400 mt-1">{formatDateBR(n.created_at)}</span>
                              </span>
                              {n.tipo === 'ferias' && (
                                <span className="text-lg">🌴</span>
                              )}
                              {n.tipo === 'documento_veiculo' && (
                                <span className="text-lg">🚗</span>
                              )}
                            </button>
                            {!n.lida && (
                              <button
                                onClick={(e) => { e.stopPropagation(); marcarNotifLida(n.id); }}
                                className="flex items-center gap-1 px-2.5 py-1.5 min-h-11 rounded-lg bg-white text-primary-600 border border-primary-200 text-[10px] font-bold hover:bg-primary-50 transition-colors shrink-0 cursor-pointer"
                                title="Marcar como lida"
                              >
                                <Check size={12} />
                                Marcar como lida
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); setNotifExcluir(n.id); }}
                              className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0 cursor-pointer"
                              title="Excluir notificação"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Seção: Alertas de prazos de férias */}
                    <div className="py-2">
                      <div className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <span>⚠️</span> Alertas de Prazos de Férias
                        {alerts.length > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[9px]">
                            {alerts.length}
                          </span>
                        )}
                      </div>
                      {alerts.length === 0 ? (
                        <p className="px-4 pb-3 text-center text-slate-400 text-sm">✅ Nenhum alerta pendente.</p>
                      ) : (
                        alerts.map((alert, idx) => (
                          <div
                            key={idx}
                            className={`px-4 py-3 text-xs border-t flex gap-2 ${
                              alert.gravidade === 'danger' || alert.gravidade === 'expired'
                                ? 'bg-rose-50 text-rose-800'
                                : 'bg-amber-50 text-amber-800'
                            }`}
                          >
                            <span>{alert.gravidade === 'danger' || alert.gravidade === 'expired' ? '🚨' : '⚠️'}</span>
                            <span>{typeof alert.mensagem === 'string' ? alert.mensagem : ''}</span>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Seção: Alertas de SST */}
                    {sstAlerts.length > 0 && (
                      <div className="py-2">
                        <div className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                          <span>🦺</span> Alertas de Segurança do Trabalho
                          <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[9px]">
                            {sstAlerts.length}
                          </span>
                        </div>
                        {sstAlerts.map((alert, idx) => (
                          <div
                            key={idx}
                            className={`px-4 py-3 text-xs border-t flex gap-2 ${
                              alert.gravidade === 'danger' || alert.gravidade === 'expired'
                                ? 'bg-rose-50 text-rose-800'
                                : 'bg-amber-50 text-amber-800'
                            }`}
                          >
                            <span>{alert.gravidade === 'danger' || alert.gravidade === 'expired' ? '🚨' : '⚠️'}</span>
                            <span>{typeof alert.mensagem === 'string' ? alert.mensagem : ''}</span>
                          </div>
                        ))}
                      </div>
                    )}

                  </div>
                </div>
              )}
            </div>

            <div className="h-8 w-[1px] bg-slate-200" />

            {/* Perfil + Logout */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 border border-slate-200">
                <UserIcon size={18} />
              </div>
              <div className="hidden md:block">
                <p className="text-sm font-semibold text-slate-700">{usuario?.nome || 'Usuário'}</p>
                <p className="text-xs text-slate-400">{usuario?.email || 'Escritório Munaretto'}</p>
              </div>
              <button
                onClick={handleLogout}
                title="Sair"
                className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-rose-50 text-slate-500 hover:text-rose-600 transition-all cursor-pointer"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </header>

        {/* VIEW CONTAINER */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <ActiveComponent
            alerts={alerts}
            fetchAlerts={fetchAlerts}
            fetchNotifications={fetchNotifications}
            usuarioAtual={usuario}
            onUsuarioAtualizado={atualizarUsuarioAtual}
          />
        </div>
      </main>
      </div>

      {/* Modal de confirmação de exclusão de notificação */}
      <ModalConfirmacao
        aberto={notifExcluir != null}
        titulo="Excluir notificação"
        mensagem="Tem certeza que deseja excluir esta notificação? Esta ação não pode ser desfeita."
        loading={excluindoNotif}
        onConfirmar={() => excluirNotif(notifExcluir)}
        onCancelar={() => setNotifExcluir(null)}
      />
    </ErrorBoundary>
  );
}

export default App;
