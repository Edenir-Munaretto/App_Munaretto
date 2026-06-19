import React, { useState, useEffect } from 'react';
import { Users, Palmtree, LineChart, ShieldAlert, ArrowUpRight, TrendingUp } from 'lucide-react';
import { API_URL } from '../App';

function Dashboard({ alerts }) {
  const [stats, setStats] = useState({
    clientes: 0,
    ferias: 0,
    lucroMensal: '0,00',
    mesRef: 'N/A'
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      // Busca clientes
      const cliRes = await fetch(`${API_URL}/clientes/`);
      const cliData = cliRes.ok ? await cliRes.json() : [];

      // Busca férias
      const ferRes = await fetch(`${API_URL}/ferias/`);
      const ferData = ferRes.ok ? await ferRes.json() : [];

      // Busca fluxos para obter o último
      const fluxRes = await fetch(`${API_URL}/fluxo-caixa/`);
      const fluxData = fluxRes.ok ? await fluxRes.json() : [];

      let ultimoLucro = '0,00';
      let ultimoMes = 'N/A';
      if (fluxData && fluxData.length > 0) {
        // Ordena por data_registro decrescente para pegar o mais recente
        const ultimo = fluxData[0];
        ultimoLucro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(ultimo.total_liquido);
        ultimoMes = ultimo.mes_referencia;
      }

      setStats({
        clientes: cliData.length,
        ferias: ferData.filter(f => f.status === 'Agendado' || f.status === 'Em Férias').length,
        lucroMensal: ultimoLucro,
        mesRef: ultimoMes
      });
    } catch (err) {
      console.error('Erro ao buscar estatísticas do dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      title: 'Clientes Cadastrados',
      value: stats.clientes,
      desc: 'Clientes ativos no sistema',
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
      title: `Último Saldo Líquido (${stats.mesRef})`,
      value: stats.lucroMensal,
      desc: 'Fechamento consolidado das usinas',
      icon: LineChart,
      color: 'from-emerald-500 to-teal-600',
      iconColor: 'text-emerald-500'
    }
  ];

  return (
    <div className="space-y-6">
      
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
              {alerts.length} Alertas
            </span>
          </div>

          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
            {alerts.length === 0 ? (
              <div className="text-center py-12 text-slate-400 space-y-2">
                <span className="text-3xl">🎉</span>
                <p className="text-sm font-semibold">Tudo em ordem!</p>
                <p className="text-xs">Não há nenhuma data limite de férias próxima do vencimento.</p>
              </div>
            ) : (
              alerts.slice(0, 5).map((alert, idx) => (
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

        {/* Quick Links / Rules */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-4">
          <h4 className="font-bold text-slate-800 flex items-center gap-2 pb-2 border-b border-slate-100">
            <TrendingUp className="text-primary-500" />
            Regra Societária de Lucro
          </h4>
          
          <div className="space-y-3">
            <p className="text-xs text-slate-500 leading-relaxed">
              O lucro líquido do fechamento mensal das usinas (Usinas Solar - Ouro Energia) é automaticamente partilhado de acordo com as seguintes cota-partes:
            </p>
            
            <div className="divide-y divide-slate-100 text-xs">
              {[
                { name: 'Marlene', share: '30%', color: 'border-emerald-500' },
                { name: 'João B.', share: '30%', color: 'border-blue-500' },
                { name: 'Demarco', share: '25%', color: 'border-amber-500' },
                { name: 'Nei Rigo', share: '10%', color: 'border-purple-500' },
                { name: 'Gilmar T.', share: '5%', color: 'border-rose-500' }
              ].map((socio, idx) => (
                <div key={idx} className="flex justify-between items-center py-2.5">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full bg-slate-900 border-l-4 ${socio.color}`} />
                    <span className="font-bold text-slate-700">{socio.name}</span>
                  </div>
                  <span className="bg-slate-100 text-slate-800 font-extrabold px-2 py-0.5 rounded text-[10px]">
                    {socio.share}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}

export default Dashboard;
