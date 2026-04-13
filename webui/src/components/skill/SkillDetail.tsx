'use client';

import { ArrowLeft, Tag, Globe, User, Wrench, FileText } from 'lucide-react';
import { useHermesStore } from '@/lib/store';

export default function SkillDetail() {
  const { skills, selectedSkillName, selectSkill, selectedEmployeeId, assignSkillToEmployee } = useHermesStore();
  const skill = skills.find((s) => s.name === selectedSkillName);

  if (!skill) {
    return (
      <div className="flex items-center justify-center h-full bg-zinc-950">
        <div className="text-center">
          <Wrench size={32} className="mx-auto text-zinc-700 mb-3" />
          <p className="text-zinc-500 text-sm">选择一个技能查看详情</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => selectSkill(null)}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <h2 className="text-sm font-semibold text-zinc-200 flex-1">{skill.name}</h2>
        </div>
        <p className="text-xs text-zinc-500">{skill.description}</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Metadata */}
        <div className="grid grid-cols-2 gap-3">
          <MetaItem icon={Tag} label="分类" value={skill.categoryLabel} />
          <MetaItem icon={Globe} label="来源" value={skill.source} />
          <MetaItem icon={User} label="作者" value={skill.author} />
          <MetaItem icon={FileText} label="版本" value={skill.version} />
        </div>

        {/* Tags */}
        {skill.tags.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-zinc-400 mb-2">标签</h3>
            <div className="flex flex-wrap gap-1.5">
              {skill.tags.map((tag) => (
                <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Platforms */}
        {skill.platforms.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-zinc-400 mb-2">支持平台</h3>
            <div className="flex flex-wrap gap-1.5">
              {skill.platforms.map((p) => (
                <span key={p} className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Full Content */}
        {skill.content && (
          <div>
            <h3 className="text-xs font-medium text-zinc-400 mb-2">技能内容</h3>
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
              <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">
                {skill.content}
              </pre>
            </div>
          </div>
        )}

        {/* References */}
        {skill.references && skill.references.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-zinc-400 mb-2">参考文件</h3>
            <div className="space-y-1.5">
              {skill.references.map((ref) => (
                <div key={ref.path} className="flex items-center gap-2 p-2 rounded-md bg-zinc-900 border border-zinc-800">
                  <FileText size={12} className="text-zinc-500" />
                  <span className="text-xs text-zinc-300">{ref.name}</span>
                  <span className="text-[10px] text-zinc-600 ml-auto">{ref.path}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {selectedEmployeeId && (
        <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-900/50">
          <button
            onClick={() => assignSkillToEmployee(selectedEmployeeId, skill.name)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-400 text-zinc-900 text-sm font-medium hover:bg-amber-300 transition-colors"
          >
            <Wrench size={14} />
            分配给当前员工
          </button>
        </div>
      )}
    </div>
  );
}

function MetaItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-md bg-zinc-900/50 border border-zinc-800">
      <Icon size={12} className="text-zinc-500" />
      <div>
        <p className="text-[10px] text-zinc-600">{label}</p>
        <p className="text-xs text-zinc-300">{value}</p>
      </div>
    </div>
  );
}
