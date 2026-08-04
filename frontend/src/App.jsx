import React, { useState, useEffect, useCallback } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  Palmtree, 
  LineChart, 
  FileText, 
  Bell, 
  Menu, 
  LogOut, 
  User as UserIcon,
  Receipt,
  Banknote,
  Settings
} from 'lucide-react';

// Importando as páginas
import Dashboard from './pages/Dashboard';
import Clientes from './pages/Clientes';
import Ferias from './pages/Ferias';
import FluxoCaixa from './pages/FluxoCaixa';
import GeradorDocumentos from './pages/GeradorDocumentos';
import Comprovantes from './pages/Comprovantes';
import Recebimentos from './pages/Recebimentos';
import Configuracoes from './pages/Configuracoes';
import Login from './pages/Login';
import { MODULOS } from './modules';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const ICONES = {
  dashboard: LayoutDashboard,
  clientes: Users,
  ferias: Palmtree,
  fluxo: LineChart,
  documentos: FileText,
  comprovantes: Receipt,
  recebimentos: Banknote,
  configuracoes: Settings,
};

const COMPONENTES = {
  dashboard: Dashboard,
  clientes: Clientes,
  ferias: Ferias,
  fluxo: FluxoCaixa,
  documentos: GeradorDocumentos,
  comprovantes: Comprovantes,
  recebimentos: Recebimentos,
  configuracoes: Configuracoes,
};

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [alerts, setAlerts] = useState([]);
  const [notificacoes, setNotificacoes] = useState([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [usuario, setUsuario] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('munaretto_usuario') || 'null');
    } catch {
      return null;
    }
  });

  // Busca alertas de férias ao carregar
  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 100000); // 1.5 minutos
    return () => clearInterval(interval);
  }, []);

  const fetchAlerts = async () => {
    try {
      const res = await fetch(`${API_URL}/ferias/alertas`);
      if (res.ok) {
        const data = await res.json();
        setAlerts(data);
      }
    } catch (err) {
      console.error('Erro ao buscar alertas:', err);
    }
  };

  const fetchNotifications = useCallback(async () => {
    if (!usuario?.email) return;
    try {
      const res = await fetch(`${API_URL}/notificacoes/?destinatario=${encodeURIComponent(usuario.email)}`);
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

  const marcarNotifLida = async (id) => {
    try {
      await fetch(`${API_URL}/notificacoes/${id}/lida`, { method: 'PATCH' });
      fetchNotifications();
    } catch (err) {
      console.error('Erro ao marcar notificação como lida:', err);
    }
  };

  const marcarTodasNotifLidas = async () => {
    if (!usuario?.email) return;
    try {
      await fetch(`${API_URL}/notificacoes/marcar-todas-lidas?destinatario=${encodeURIComponent(usuario.email)}`, { method: 'POST' });
      fetchNotifications();
    } catch (err) {
      console.error('Erro ao marcar notificações como lidas:', err);
    }
  };

  const abrirNotificacao = (n) => {
    marcarNotifLida(n.id);
    setShowNotifPanel(false);
    if (n.tipo === 'ferias' && n.ferias_id) {
      setActiveTab('ferias');
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
  const totalSinos = notificacoesNaoLidas + alerts.length;

  const handleLogin = (user) => {
    localStorage.setItem('munaretto_usuario', JSON.stringify(user));
    setUsuario(user);
    setActiveTab('dashboard');
  };

  const handleLogout = () => {
    localStorage.removeItem('munaretto_usuario');
    setUsuario(null);
    setActiveTab('dashboard');
  };

  const tabs = MODULOS
    .filter(m => (usuario?.permissoes || []).includes(m.id))
    .map(m => ({
      id: m.id,
      label: m.label,
      icon: ICONES[m.id] || FileText,
      component: COMPONENTES[m.id] || Dashboard
    }));

  const ActiveComponent = tabs.find(t => t.id === activeTab)?.component || (tabs[0]?.component || Dashboard);

  if (!usuario) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      
      {/* SIDEBAR */}
      <aside className={`bg-slate-900 text-white flex flex-col transition-all duration-300 ${sidebarOpen ? 'w-64' : 'w-20'}`}>
        
        {/* Logo/Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800">
          <div className="flex items-center gap-3 overflow-hidden">
            <span className="text-2xl">📄</span>
            {sidebarOpen && (
              <span className="font-extrabold text-lg tracking-wider bg-gradient-to-r from-primary-400 to-emerald-400 bg-clip-text text-transparent uppercase">
                Munaretto
              </span>
            )}
          </div>
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)} 
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
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
                onClick={() => setActiveTab(tab.id)}
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
        <div className="p-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500 overflow-hidden">
          {sidebarOpen ? (
            <>
              <span>v1.0.0 Web</span>
              <span>Desenvolvido com ❤️</span>
            </>
          ) : (
            <span className="mx-auto">❤️</span>
          )}
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col overflow-hidden">
        
        {/* HEADER */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6 z-10">
          
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-slate-800 capitalize">
              {tabs.find(t => t.id === activeTab)?.label}
            </h1>
          </div>

          <div className="flex items-center gap-4">
            
            {/* Central de Notificações (sino único) */}
            <div className="relative">
              <button 
                onClick={() => setShowNotifPanel(!showNotifPanel)} 
                className="p-2 rounded-full hover:bg-slate-100 text-slate-600 relative transition-all"
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
                        <p className="px-4 pb-3 text-center text-slate-400 text-sm">Nenhuma notificação.</p>
                      ) : (
                        notificacoes.map((n) => (
                          <button
                            key={n.id}
                            onClick={() => abrirNotificacao(n)}
                            className={`w-full text-left px-4 py-3 flex gap-3 transition-colors ${
                              n.lida ? 'bg-white hover:bg-slate-50' : 'bg-primary-50/60 hover:bg-primary-50'
                            }`}
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
                          </button>
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
                            <span>{alert.mensagem}</span>
                          </div>
                        ))
                      )}
                    </div>

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
                className="p-2 rounded-lg hover:bg-rose-50 text-slate-500 hover:text-rose-600 transition-all cursor-pointer"
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
          />
        </div>
      </main>
    </div>
  );
}

export default App;
