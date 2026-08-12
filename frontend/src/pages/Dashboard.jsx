import React, { useState, useEffect } from 'react';
import { Users, Palmtree, Stethoscope, ShieldAlert, GraduationCap } from 'lucide-react';
import { API_URL, apiFetch } from '../api';

function Dashboard({ alerts }) {
  const [stats, setStats] = useState({
    funcionarios: 0,
    ferias: 0,
    asoVencidos: 0,
    asoProximos: 0,
    cursosVigentes: 0,
    cursosProximos: 0,
    cursosVencidos: 0
  });
  const [dashboardAlerts, setDashboardAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await apiFetch(`${API_URL}/dashboard/resumo`);
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = await res.json();

      const asos = data.asos || {};
      const cursos = data.cursos || {};

      setStats({
        funcionarios: data.funcionarios?.total ?? 0,
        ferias: data.ferias?.ativas ?? 0,
        asoVencidos: asos['Vencido'] || 0,
        asoProximos: asos['Próximo ao Vencimento'] || 0,
        cursosVigentes: cursos['Vigente'] || 0,
        cursosProximos: cursos['Próximo ao Vencimento'] || 0,
        cursosVencidos: cursos['Vencido'] || 0
      });
      setDashboardAlerts(data.alertas_ferias || []);
    } catch (err) {
      console.error('Erro ao buscar estatísticas do dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  // Mantém compatibilidade com o prop de alertas (App.jsx) misturando
  // os alertas de férias do resumo agregado.
  const allAlerts = [...(alerts || []), ...dashboardAlerts];

  const statCards = [
    {
      title: 'Colaboradores Cadastrados',
      value: stats.funcionarios,
      desc: 'Funcionários ativos no sistema',
      icon: Users,
      color: 'from-blue-500 to-primary-600',
      iconColor: 'text-blue-500'
    },
    {
      title: 'Férias Programadas',
      value: stats.ferias,
      desc: 'Colaboradores agendados/gozando',
      icon: Palmtree,
      color: 'from-amber-500 to-orange-600',
      iconColor: 'text-amber-500'
    },
    {
      title: 'ASO Vencidos e Próximos',
      value: stats.asoVencidos + stats.asoProximos,
      desc: `${stats.asoVencidos} vencido(s) • ${stats.asoProximos} próximo(s)`,
      icon: Stethoscope,
      color: 'from-rose-500 to-red-600',
      iconColor: 'text-rose-500'
    }
  ];

  return (
    <div className="space-y-6 relative pb-28">

      {/* Boneco / marca d'água */}
      <img
        src="/boneco-munaretto.png"
        alt="Boneco Munaretto"
        className="absolute bottom-0 right-0 h-40 w-auto object-contain opacity-90 pointer-events-none select-none"
      />
      
      {/* Welcome Card */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-primary-950 text-white rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 bottom-0 top-0 w-1/3 bg-[radial-gradient(circle_at_right,rgba(14,144,233,0.15),transparent)] pointer-events-none" />
        <div className="relative z-10 max-w-2xl">
          <span className="bg-primary-500/20 text-primary-300 text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider">
            Painel Geral
          </span>
          <h2 className="text-3xl font-extrabold mt-3 tracking-tight">
            Olá, Bem-vindo ao App Munaretto!
          </h2>
          <p className="text-slate-300 mt-2 leading-relaxed text-sm md:text-base">
            Gerencie contratos de clientes, calcule lançamentos mensais das usinas solares com divisões societárias automáticas e acompanhe as datas limites de férias de sua equipe em uma única plataforma web centralizada.
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div key={idx} className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm flex items-center justify-between hover:shadow-md transition-all duration-200">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{card.title}</p>
                {loading ? (
                  <div className="h-8 w-16 bg-slate-100 animate-pulse rounded" />
                ) : (
                  <h3 className="text-2xl font-black text-slate-800">{card.value}</h3>
                )}
                <p className="text-xs text-slate-500">{card.desc}</p>
              </div>
              <div className={`p-4 rounded-xl bg-slate-50 ${card.iconColor}`}>
                <Icon size={24} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Alerts Section */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h4 className="font-bold text-slate-800 flex items-center gap-2">
              <ShieldAlert className="text-rose-500" />
              Notificações e Prazos de Férias
            </h4>
            <span className="text-xs bg-rose-50 text-rose-600 px-2.5 py-0.5 rounded-full font-bold">
              {allAlerts.length} Alertas
            </span>
          </div>

          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
            {allAlerts.length === 0 ? (
              <div className="text-center py-12 text-slate-400 space-y-2">
                <span className="text-3xl">🎉</span>
                <p className="text-sm font-semibold">Tudo em ordem!</p>
                <p className="text-xs">Não há nenhuma data limite de férias próxima do vencimento.</p>
              </div>
            ) : (
              allAlerts.slice(0, 5).map((alert, idx) => (
                <div 
                  key={idx} 
                  className={`p-3.5 rounded-xl border flex gap-3 text-xs justify-between items-start transition-all ${
                    alert.gravidade === 'danger' 
                      ? 'bg-rose-50/50 border-rose-100 text-rose-900' 
                      : alert.gravidade === 'expired'
                      ? 'bg-red-50 border-red-200 text-red-950 font-medium'
                      : 'bg-amber-50/50 border-amber-100 text-amber-900'
                  }`}
                >
                  <div className="flex gap-2">
                    <span className="text-base mt-0.5">
                      {alert.gravidade === 'danger' || alert.gravidade === 'expired' ? '🚨' : '⚠️'}
                    </span>
                    <div>
                      <p className="font-bold text-slate-800">{alert.nome}</p>
                      <p className="mt-0.5 text-slate-600">{alert.mensagem}</p>
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                    alert.gravidade === 'danger' || alert.gravidade === 'expired'
                      ? 'bg-rose-100 text-rose-700' 
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {alert.gravidade === 'expired' ? 'Expirado' : `${alert.dias_restantes} dias`}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Cursos / Treinamentos */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-4">
          <h4 className="font-bold text-slate-800 flex items-center gap-2 pb-2 border-b border-slate-100">
            <GraduationCap className="text-primary-500" />
            Cursos e Treinamentos
          </h4>

          <div className="space-y-3">
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2].map(i => <div key={i} className="h-8 bg-slate-100 animate-pulse rounded" />)}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 text-xs">
                {[
                  { label: 'Vigentes', value: stats.cursosVigentes, colorDot: 'border-emerald-500', colorBadge: 'bg-emerald-50 text-emerald-700' },
                  { label: 'Próximos ao Vencimento', value: stats.cursosProximos, colorDot: 'border-amber-500', colorBadge: 'bg-amber-50 text-amber-700' },
                  { label: 'Vencidos', value: stats.cursosVencidos, colorDot: 'border-rose-500', colorBadge: 'bg-rose-50 text-rose-700' }
                ].map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center py-2.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full bg-slate-900 border-l-4 ${item.colorDot}`} />
                      <span className="font-bold text-slate-700">{item.label}</span>
                    </div>
                    <span className={`${item.colorBadge} font-extrabold px-2 py-0.5 rounded text-[10px]`}>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}

export default Dashboard;
