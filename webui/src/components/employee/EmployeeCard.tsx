'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Trash2, Settings, MessageSquare, Wrench } from 'lucide-react';
import { useHermesStore } from '@/lib/store';
import type { Employee, EmployeeStatus } from '@/lib/types';

interface EmployeeCardProps {
  employee: Employee;
  isSelected: boolean;
  onSelect: () => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}

export default function EmployeeCard({ employee, isSelected, onSelect, onDragEnd }: EmployeeCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showMenu, setShowMenu] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ x: 0, y: 0, mx: 0, my: 0 });

  const removeEmployee = useHermesStore((s) => s.removeEmployee);
  const assignSkillToEmployee = useHermesStore((s) => s.assignSkillToEmployee);
  const skills = useHermesStore((s) => s.skills);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = {
      x: employee.position.x,
      y: employee.position.y,
      mx: e.clientX,
      my: e.clientY,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.mx;
      const dy = e.clientY - dragStart.current.my;
      setDragOffset({ x: dx, y: dy });
    };

    const handleMouseUp = () => {
      const newX = Math.max(0, dragStart.current.x + dragOffset.x);
      const newY = Math.max(0, dragStart.current.y + dragOffset.y);
      onDragEnd(employee.id, newX, newY);
      setIsDragging(false);
      setDragOffset({ x: 0, y: 0 });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, employee.id, onDragEnd]);

  const statusConfig: Record<EmployeeStatus, { label: string; color: string; bg: string }> = {
    idle: { label: '空闲', color: 'text-zinc-400', bg: 'bg-zinc-800' },
    working: { label: '工作中', color: 'text-amber-400', bg: 'bg-amber-400/10' },
    thinking: { label: '思考中', color: 'text-blue-400', bg: 'bg-blue-400/10' },
    error: { label: '出错', color: 'text-red-400', bg: 'bg-red-400/10' },
    offline: { label: '离线', color: 'text-zinc-600', bg: 'bg-zinc-900' },
  };

  const st = statusConfig[employee.status];
  const isActive = employee.status === 'working' || employee.status === 'thinking';

  return (
    <motion.div
      ref={cardRef}
      className={`absolute select-none group ${
        isDragging ? 'z-50 cursor-grabbing' : 'cursor-grab'
      }`}
      style={{
        left: employee.position.x + dragOffset.x,
        top: employee.position.y + dragOffset.y,
      }}
      onMouseDown={handleMouseDown}
      whileHover={{ scale: isDragging ? 1.02 : 1.01 }}
      layout
    >
      <div
        className={`relative w-56 rounded-xl border transition-all duration-200 overflow-hidden ${
          isSelected
            ? 'border-amber-400/60 shadow-lg shadow-amber-400/10 bg-zinc-800/90'
            : 'border-zinc-700/50 bg-zinc-800/70 hover:border-zinc-600/60'
        } ${isDragging ? 'shadow-2xl shadow-black/50' : ''} backdrop-blur-sm`}
      >
        {/* Status bar */}
        <div className={`h-1 ${isActive ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-zinc-700'}`}>
          {isActive && (
            <motion.div
              className="h-full bg-white/30"
              animate={{ x: ['-100%', '200%'] }}
              transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
            />
          )}
        </div>

        <div className="p-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={`text-3xl p-2 rounded-lg ${st.bg}`}>
                {employee.avatar}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-100 leading-tight">
                  {employee.name}
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">{employee.role}</p>
              </div>
            </div>
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-700 text-zinc-500 transition-all"
            >
              <Settings size={14} />
            </button>
          </div>

          {/* Status Badge */}
          <div className="mt-3 flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full ${
              isActive ? 'bg-amber-400 animate-pulse' : employee.status === 'error' ? 'bg-red-400' : 'bg-zinc-500'
            }`} />
            <span className={`text-xs ${st.color}`}>{st.label}</span>
          </div>

          {/* Skills Tags */}
          {employee.skills.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {employee.skills.slice(0, 3).map((sk) => (
                <span
                  key={sk.name}
                  className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    sk.enabled
                      ? 'bg-amber-400/10 text-amber-400'
                      : 'bg-zinc-700 text-zinc-500'
                  }`}
                >
                  {sk.name}
                </span>
              ))}
              {employee.skills.length > 3 && (
                <span className="text-[10px] text-zinc-500">
                  +{employee.skills.length - 3}
                </span>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(); }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-400/10 text-amber-400 text-xs hover:bg-amber-400/20 transition-colors"
            >
              <MessageSquare size={12} />
              对话
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(); }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-700 text-zinc-300 text-xs hover:bg-zinc-600 transition-colors"
            >
              <Wrench size={12} />
              技能
            </button>
          </div>
        </div>

        {/* Context Menu */}
        {showMenu && (
          <div className="absolute right-2 top-8 z-10 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[120px]">
            <button
              onClick={() => {
                setShowMenu(false);
                removeEmployee(employee.id);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-zinc-700 transition-colors"
            >
              <Trash2 size={12} />
              删除
            </button>
            {skills.length > 0 && (
              <div className="border-t border-zinc-700 mt-1 pt-1">
                <span className="px-3 text-[10px] text-zinc-500">分配技能</span>
                {skills.slice(0, 5).map((sk) => (
                  <button
                    key={sk.name}
                    onClick={() => {
                      assignSkillToEmployee(employee.id, sk.name);
                      setShowMenu(false);
                    }}
                    className="w-full text-left px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    {sk.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
