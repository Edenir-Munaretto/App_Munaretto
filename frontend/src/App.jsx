import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  Palmtree, 
  LineChart, 
  FileText, 
  Bell, 
  Menu, 
  Sun, 
  Moon, 
  LogOut, 
  User as UserIcon,
  ShieldAlert,
  Receipt
} from 'lucide-react';

// Importando as páginas
import Dashboard from './pages/Dashboard';
import Clientes from './pages/Clientes';
import Ferias from './pages/Ferias';
import FluxoCaixa from './pages/FluxoCaixa';
import GeradorDocumentos from './pages/GeradorDocumentos';
import Comprovantes from './pages/Comprovantes';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [alerts, setAlerts] = useState([]);
  const [showAlertModal, setShowAlertModal] = useState(false);

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

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, component: Dashboard },
    { id: 'clientes', label: 'Clientes', icon: Users, component: Clientes },
    { id: 'ferias', label: 'Gestão Férias', icon: Palmtree, component: Ferias },
    { id: 'fluxo', label: 'Gestão Usinas', icon: LineChart, component: FluxoCaixa },
    { id: 'documentos', label: 'Documentos', icon: FileText, component: GeradorDocumentos },
    { id: 'comprovantes', label: 'Contabilidade', icon: Receipt, component: Comprovantes },
  ];

  const ActiveComponent = tabs.find(t => t.id === activeTab)?.component || Dashboard;

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
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 z-10">
          
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-slate-800 capitalize">
              {tabs.find(t => t.id === activeTab)?.label}
            </h1>
          </div>

          <div className="flex items-center gap-4">
            
            {/* Alertas Bell */}
            <div className="relative">
              <button 
                onClick={() => setShowAlertModal(true)} 
                className="p-2 rounded-full hover:bg-slate-100 text-slate-600 relative transition-all"
              >
                <Bell size={20} />
                {alerts.length > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center animate-pulse">
                    {alerts.length}
                  </span>
                )}
              </button>
            </div>

            <div className="h-8 w-[1px] bg-slate-200" />

            {/* Perfil Simples */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 border border-slate-200">
                <UserIcon size={18} />
              </div>
              <div className="hidden md:block">
                <p className="text-sm font-semibold text-slate-700">Administrador</p>
                <p className="text-xs text-slate-400">Escritório Munaretto</p>
              </div>
            </div>
          </div>
        </header>

        {/* VIEW CONTAINER */}
        <div className="flex-1 overflow-y-auto p-6">
          <ActiveComponent alerts={alerts} fetchAlerts={fetchAlerts} />
        </div>
      </main>

      {/* MODAL DE ALERTAS */}
      {showAlertModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="text-rose-500" />
                <h3 className="font-bold text-lg">Alertas de Prazos de Férias</h3>
              </div>
              <button 
                onClick={() => setShowAlertModal(false)} 
                className="text-slate-400 hover:text-white text-xl font-bold"
              >
                &times;
              </button>
            </div>
            
            <div className="p-6 max-h-[400px] overflow-y-auto space-y-3">
              {alerts.length === 0 ? (
                <p className="text-center text-slate-500 py-8">✅ Nenhum alerta de férias pendente no momento.</p>
              ) : (
                alerts.map((alert, idx) => (
                  <div 
                    key={idx} 
                    className={`p-3 rounded-lg border flex gap-3 text-sm ${
                      alert.gravidade === 'danger' 
                        ? 'bg-rose-50 border-rose-200 text-rose-800' 
                        : alert.gravidade === 'expired'
                        ? 'bg-red-100 border-red-300 text-red-950 font-semibold'
                        : 'bg-amber-50 border-amber-200 text-amber-800'
                    }`}
                  >
                    <span className="text-lg">
                      {alert.gravidade === 'danger' || alert.gravidade === 'expired' ? '🚨' : '⚠️'}
                    </span>
                    <div>
                      <p>{alert.mensagem}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="bg-slate-50 p-4 flex justify-end border-t border-slate-100">
              <button 
                onClick={() => setShowAlertModal(false)} 
                className="px-4 py-2 bg-slate-900 text-white font-semibold rounded-lg text-sm hover:bg-slate-800 transition-all"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
