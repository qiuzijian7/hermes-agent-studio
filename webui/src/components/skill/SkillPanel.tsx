'use client';

import { useState, useEffect } from 'react';
import { Search, RefreshCw, Tag, ExternalLink, Plus, Check } from 'lucide-react';
import { useHermesStore } from '@/lib/store';
import type { Skill } from '@/lib/types';

export default function SkillPanel() {
  const {
    skills, skillsLoading, selectedSkillName,
    loadSkills, selectSkill,
    selectedEmployeeId, assignSkillToEmployee,
    employees,
  } = useHermesStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterSource, setFilterSource] = useState<string>('all');

  useEffect(() => {
    if (skills.length === 0) loadSkills();
  }, []);

  const filteredSkills = skills.filter((sk) => {
    const matchSearch = !searchQuery ||
      sk.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sk.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sk.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchSource = filterSource === 'all' || sk.source === filterSource;
    return matchSearch && matchSource;
  });

  const sources = ['all', ...new Set(skills.map((s) => s.source))];
  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId);

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-zinc-200">技能库</h2>
          <button
            onClick={() => loadSkills()}
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw size={14} className={skillsLoading ? 'animate-spin' : ''} />
          </button>
        </div>
        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索技能..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-400/50"
          />
        </div>
        {/* Source Filters */}
        <div className="flex gap-1 mt-2 flex-wrap">
          {sources.map((src) => (
            <button
              key={src}
              onClick={() => setFilterSource(src)}
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                filterSource === src
                  ? 'bg-amber-400/20 text-amber-400'
                  : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {src === 'all' ? '全部' : src}
            </button>
          ))}
        </div>
      </div>

      {/* Skill List */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {skillsLoading && (
          <div className="flex items-center justify-center py-8">
            <RefreshCw size={20} className="animate-spin text-zinc-500" />
          </div>
        )}

        {!skillsLoading && filteredSkills.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <p className="text-zinc-600 text-xs">
              {searchQuery ? '没有匹配的技能' : '暂无技能数据'}
            </p>
          </div>
        )}

        {filteredSkills.map((skill) => (
          <SkillItem
            key={skill.name}
            skill={skill}
            isSelected={selectedSkillName === skill.name}
            onSelect={() => selectSkill(skill.name)}
            employeeHasSkill={selectedEmployee?.skills.some((s) => s.name === skill.name)}
            onAssign={selectedEmployeeId ? () => assignSkillToEmployee(selectedEmployeeId, skill.name) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function SkillItem({
  skill, isSelected, onSelect, employeeHasSkill, onAssign,
}: {
  skill: Skill;
  isSelected: boolean;
  onSelect: () => void;
  employeeHasSkill?: boolean;
  onAssign?: () => void;
}) {
  const sourceColor: Record<string, string> = {
    'built-in': 'text-emerald-400 bg-emerald-400/10',
    optional: 'text-blue-400 bg-blue-400/10',
    custom: 'text-purple-400 bg-purple-400/10',
    anthropic: 'text-orange-400 bg-orange-400/10',
    lobehub: 'text-cyan-400 bg-cyan-400/10',
  };

  return (
    <div
      onClick={onSelect}
      className={`p-3 rounded-lg border cursor-pointer transition-all ${
        isSelected
          ? 'border-amber-400/40 bg-amber-400/5'
          : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-800/50'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-medium text-zinc-200 truncate">{skill.name}</h4>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${sourceColor[skill.source] || 'text-zinc-500 bg-zinc-800'}`}>
              {skill.source}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 mt-1 line-clamp-2">{skill.description}</p>
        </div>
        {onAssign && (
          <button
            onClick={(e) => { e.stopPropagation(); onAssign(); }}
            className={`ml-2 p-1 rounded transition-colors ${
              employeeHasSkill
                ? 'text-emerald-400 bg-emerald-400/10'
                : 'text-zinc-500 hover:text-amber-400 hover:bg-zinc-800'
            }`}
            title={employeeHasSkill ? '已分配' : '分配给当前员工'}
          >
            {employeeHasSkill ? <Check size={12} /> : <Plus size={12} />}
          </button>
        )}
      </div>

      {skill.tags.length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {skill.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 flex items-center gap-0.5">
              <Tag size={8} />
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
