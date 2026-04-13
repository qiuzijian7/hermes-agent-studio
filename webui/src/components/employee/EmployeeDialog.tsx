'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useHermesStore } from '@/lib/store';
import type { Employee } from '@/lib/types';

const AVATARS = ['🤖', '👩‍💻', '🧑‍🔬', '👨‍🎨', '👩‍🔧', '🧙‍♂️', '🦊', '🐱', '🐶', '🦁', '🐼', '🦄', '🐸', '🦉', '🐝'];
const ROLES = [
  '通用助手', '代码工程师', '数据分析师', '内容创作者',
  '测试专家', '运维工程师', '产品经理', '设计顾问',
  '架构师', '安全专家', 'DBA', 'AI 工程师',
];

interface EmployeeDialogProps {
  employee?: Employee | null;
  onClose: () => void;
}

export default function EmployeeDialog({ employee, onClose }: EmployeeDialogProps) {
  const { addEmployee, updateEmployee, skills, assignSkillToEmployee } = useHermesStore();
  const isEdit = !!employee;

  const [name, setName] = useState(employee?.name || '');
  const [role, setRole] = useState(employee?.role || ROLES[0]);
  const [avatar, setAvatar] = useState(employee?.avatar || AVATARS[0]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(
    employee?.skills.map((s) => s.name) || []
  );

  const handleSubmit = () => {
    if (!name.trim()) return;

    if (isEdit && employee) {
      updateEmployee(employee.id, { name, role, avatar });
      // Sync skills
      const currentSkills = new Set(employee.skills.map((s) => s.name));
      selectedSkills.forEach((sk) => {
        if (!currentSkills.has(sk)) assignSkillToEmployee(employee.id, sk);
      });
    } else {
      const emp = addEmployee(name, role);
      emp.avatar = avatar;
      updateEmployee(emp.id, { avatar });
      selectedSkills.forEach((sk) => assignSkillToEmployee(emp.id, sk));
    }
    onClose();
  };

  const toggleSkill = (skillName: string) => {
    setSelectedSkills((prev) =>
      prev.includes(skillName)
        ? prev.filter((s) => s !== skillName)
        : [...prev, skillName]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-200">
            {isEdit ? '编辑员工' : '创建新员工'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Avatar */}
          <div>
            <label className="block text-xs text-zinc-500 mb-2">头像</label>
            <div className="flex flex-wrap gap-2">
              {AVATARS.map((av) => (
                <button
                  key={av}
                  onClick={() => setAvatar(av)}
                  className={`text-2xl p-1.5 rounded-lg transition-colors ${
                    avatar === av
                      ? 'bg-amber-400/20 ring-2 ring-amber-400/50'
                      : 'bg-zinc-800 hover:bg-zinc-700'
                  }`}
                >
                  {av}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入员工名称"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-400/50"
            />
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">角色</label>
            <div className="flex flex-wrap gap-1.5">
              {ROLES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                    role === r
                      ? 'bg-amber-400/20 text-amber-400 ring-1 ring-amber-400/30'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Skills */}
          {skills.length > 0 && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">技能</label>
              <div className="flex flex-wrap gap-1.5">
                {skills.map((sk) => (
                  <button
                    key={sk.name}
                    onClick={() => toggleSkill(sk.name)}
                    className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                      selectedSkills.includes(sk.name)
                        ? 'bg-amber-400/20 text-amber-400 ring-1 ring-amber-400/30'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    {sk.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm hover:bg-zinc-700 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="flex-1 px-4 py-2 rounded-lg bg-amber-400 text-zinc-900 text-sm font-medium hover:bg-amber-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {isEdit ? '保存' : '创建'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}


