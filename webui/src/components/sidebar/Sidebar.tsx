'use client';

import {
  Users, Settings, Wrench, LayoutDashboard, ChevronLeft, ChevronRight,
  Wifi, WifiOff, Plus,
} from 'lucide-react';
import { useHermesStore } from '@/lib/store';

const NAV_ITEMS = [
  { id: 'employees', label: '员工', icon: Users },
  { id: 'skills', label: '技能', icon: Wrench },
  { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
  { id: 'settings', label: '设置', icon: Settings },
];

interface SidebarProps {
  onNavigate: (tab: string) => void;
  activeTab: string;
}

export default function Sidebar({ onNavigate, activeTab }: SidebarProps) {
  const {
    sidebarCollapsed, toggleSidebar,
    selectedEmployeeId, employees,
    apiConnected,
    selectEmployee, addEmployee,
  } = useHermesStore();

  const workingCount = employees.filter((e) => e.status === 'working' || e.status === 'thinking').length;

  return (
    <aside
      className={`flex flex-col h-full bg-zinc-900 border-r border-zinc-800 transition-all duration-300 ${
        sidebarCollapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-zinc-800">
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2">
            <span className="text-xl">⚡</span>
            <h1 className="text-sm font-bold text-amber-400 tracking-wide">Hermes Studio</h1>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Connection Status */}
      <div className={`flex items-center gap-2 px-3 py-2 ${sidebarCollapsed ? 'justify-center' : ''}`}>
        {apiConnected ? (
          <Wifi size={14} className="text-emerald-400" />
        ) : (
          <WifiOff size={14} className="text-red-400" />
        )}
        {!sidebarCollapsed && (
          <span className={`text-xs ${apiConnected ? 'text-emerald-400' : 'text-red-400'}`}>
            {apiConnected ? '已连接' : '未连接'}
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-2 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-zinc-800 text-amber-400'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              } ${sidebarCollapsed ? 'justify-center' : ''}`}
            >
              <Icon size={18} />
              {!sidebarCollapsed && <span>{item.label}</span>}
              {item.id === 'employees' && !sidebarCollapsed && (
                <span className="ml-auto text-xs bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded-full">
                  {employees.length}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Employee Quick Access */}
      {!sidebarCollapsed && (
        <div className="px-3 py-2 border-t border-zinc-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-500 font-medium">活跃员工</span>
            {workingCount > 0 && (
              <span className="text-xs text-amber-400">
                {workingCount} 工作中
              </span>
            )}
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {employees.slice(0, 8).map((emp) => (
              <button
                key={emp.id}
                onClick={() => {
                  selectEmployee(emp.id);
                  onNavigate('employees');
                }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                  selectedEmployeeId === emp.id
                    ? 'bg-amber-400/10 text-amber-400'
                    : 'text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                <span className="text-base">{emp.avatar}</span>
                <span className="truncate flex-1 text-left">{emp.name}</span>
                <StatusDot status={emp.status} />
              </button>
            ))}
          </div>
          <button
            onClick={() => addEmployee()}
            className="w-full flex items-center justify-center gap-1 mt-2 px-2 py-1.5 rounded-md text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <Plus size={12} />
            <span>添加员工</span>
          </button>
        </div>
      )}

      {/* Collapsed employee indicators */}
      {sidebarCollapsed && (
        <div className="px-2 py-2 border-t border-zinc-800 space-y-2">
          {employees.slice(0, 5).map((emp) => (
            <button
              key={emp.id}
              onClick={() => {
                selectEmployee(emp.id);
                onNavigate('employees');
              }}
              className={`w-full flex justify-center relative p-1.5 rounded-md transition-colors ${
                selectedEmployeeId === emp.id ? 'bg-amber-400/10' : 'hover:bg-zinc-800'
              }`}
              title={emp.name}
            >
              <span className="text-lg">{emp.avatar}</span>
              <StatusDot status={emp.status} className="absolute top-0.5 right-0.5" />
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

function StatusDot({ status, className = '' }: { status: string; className?: string }) {
  const colorMap: Record<string, string> = {
    idle: 'bg-zinc-500',
    working: 'bg-amber-400 animate-pulse',
    thinking: 'bg-blue-400 animate-pulse',
    error: 'bg-red-400',
    offline: 'bg-zinc-700',
  };

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colorMap[status] || 'bg-zinc-600'} ${className}`}
    />
  );
}
