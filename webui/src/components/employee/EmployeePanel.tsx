'use client';

import { useRef, useCallback, useState } from 'react';
import { Plus } from 'lucide-react';
import { useHermesStore } from '@/lib/store';
import EmployeeCard from './EmployeeCard';
import EmployeeDialog from './EmployeeDialog';

export default function EmployeePanel() {
  const {
    employees, selectedEmployeeId,
    selectEmployee, updateEmployeePosition,
  } = useHermesStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [showDialog, setShowDialog] = useState(false);

  // Handle drag end — update position relative to the panel
  const handleDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      updateEmployeePosition(id, x, y);
    },
    [updateEmployeePosition]
  );

  // Click on empty space deselects
  const handlePanelClick = (e: React.MouseEvent) => {
    if (e.target === containerRef.current || (e.target as HTMLElement).classList.contains('panel-bg')) {
      selectEmployee(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">员工面板</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {employees.length} 名员工 · {employees.filter((e) => e.status === 'working' || e.status === 'thinking').length} 工作中
          </p>
        </div>
        <button
          onClick={() => setShowDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/10 text-amber-400 text-xs hover:bg-amber-400/20 transition-colors"
        >
          <Plus size={14} />
          添加员工
        </button>
      </div>

      {/* Canvas Area */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-auto panel-bg"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(63,63,70,0.3) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
        onClick={handlePanelClick}
      >
        {/* Grid background */}
        <div className="absolute inset-0 panel-bg" />

        {/* Employee Cards */}
        {employees.map((emp) => (
          <EmployeeCard
            key={emp.id}
            employee={emp}
            isSelected={selectedEmployeeId === emp.id}
            onSelect={() => selectEmployee(emp.id)}
            onDragEnd={handleDragEnd}
          />
        ))}

        {/* Empty state */}
        {employees.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl mb-3">🏢</div>
              <p className="text-zinc-500 text-sm">还没有员工</p>
              <p className="text-zinc-600 text-xs mt-1">点击"添加员工"开始</p>
            </div>
          </div>
        )}
      </div>

      {/* Employee Dialog */}
      {showDialog && (
        <EmployeeDialog onClose={() => setShowDialog(false)} />
      )}
    </div>
  );
}
