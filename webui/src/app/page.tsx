'use client';

import { useEffect, useState } from 'react';
import { useHermesStore } from '@/lib/store';
import Sidebar from '@/components/sidebar/Sidebar';
import EmployeePanel from '@/components/employee/EmployeePanel';
import RightPanel from '@/components/RightPanel';
import SkillPanel from '@/components/skill/SkillPanel';
import SettingsPanel from '@/components/SettingsPanel';

type TabView = 'employees' | 'skills' | 'dashboard' | 'settings';

export default function Home() {
  const { loadSkills, setApiConnected, apiUrl } = useHermesStore();
  const [activeTab, setActiveTab] = useState<TabView>('employees');

  // Check API connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const baseUrl = apiUrl.replace('/v1', '');
        const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
        setApiConnected(res.ok);
      } catch {
        setApiConnected(false);
      }
    };
    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, [apiUrl, setApiConnected]);

  // Load skills on mount
  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  // Determine center panel content based on active tab
  const centerPanel = (() => {
    switch (activeTab) {
      case 'employees':
        return <EmployeePanel />;
      case 'skills':
        return <SkillPanel />;
      case 'settings':
        return <SettingsPanel />;
      case 'dashboard':
        return <DashboardPanel />;
      default:
        return <EmployeePanel />;
    }
  })();

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Left Sidebar */}
      <Sidebar onNavigate={(tab) => setActiveTab(tab as TabView)} activeTab={activeTab} />

      {/* Center Panel */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {centerPanel}
      </div>

      {/* Right Panel — only show for employees/skills tabs */}
      {(activeTab === 'employees' || activeTab === 'skills') && (
        <div className="w-[420px] border-l border-zinc-800 overflow-hidden flex-shrink-0">
          <RightPanel />
        </div>
      )}
    </div>
  );
}

// Simple dashboard placeholder
function DashboardPanel() {
  const { employees, conversations, skills } = useHermesStore();

  const stats = [
    { label: '员工总数', value: employees.length, icon: '👥', color: 'text-amber-400' },
    { label: '工作中', value: employees.filter((e) => e.status === 'working' || e.status === 'thinking').length, icon: '⚡', color: 'text-blue-400' },
    { label: '对话数', value: conversations.size, icon: '💬', color: 'text-emerald-400' },
    { label: '技能数', value: skills.length, icon: '🔧', color: 'text-purple-400' },
  ];

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
        <h2 className="text-sm font-semibold text-zinc-200">仪表盘</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="grid grid-cols-2 gap-4 max-w-2xl">
          {stats.map((s) => (
            <div key={s.label} className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{s.icon}</span>
                <div>
                  <p className="text-2xl font-bold text-zinc-100">{s.value}</p>
                  <p className="text-xs text-zinc-500">{s.label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Recent Activity */}
        <div className="mt-8 max-w-2xl">
          <h3 className="text-xs font-medium text-zinc-400 mb-3">员工状态</h3>
          <div className="space-y-2">
            {employees.map((emp) => (
              <div key={emp.id} className="flex items-center gap-3 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
                <span className="text-xl">{emp.avatar}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200">{emp.name}</p>
                  <p className="text-xs text-zinc-500">{emp.role}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  emp.status === 'working' ? 'bg-amber-400/10 text-amber-400' :
                  emp.status === 'thinking' ? 'bg-blue-400/10 text-blue-400' :
                  emp.status === 'error' ? 'bg-red-400/10 text-red-400' :
                  'bg-zinc-800 text-zinc-500'
                }`}>
                  {emp.status === 'idle' ? '空闲' :
                   emp.status === 'working' ? '工作中' :
                   emp.status === 'thinking' ? '思考中' :
                   emp.status === 'error' ? '出错' : '离线'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
