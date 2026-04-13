'use client';

import { useHermesStore } from '@/lib/store';
import ChatPanel from '@/components/chat/ChatPanel';
import SkillDetail from '@/components/skill/SkillDetail';
import SkillPanel from '@/components/skill/SkillPanel';
import { Wrench, MessageSquare, X } from 'lucide-react';

export default function RightPanel() {
  const { rightPanelView, setRightPanelView, selectedEmployeeId, selectedSkillName } = useHermesStore();

  // Determine what to show
  const hasEmployeeChat = rightPanelView === 'chat' && !!selectedEmployeeId;
  const hasSkillDetail = rightPanelView === 'skill-detail' && !!selectedSkillName;
  const hasSkillList = rightPanelView === 'skill-detail' && !selectedSkillName;

  // If no view is active, show a default view
  if (rightPanelView === 'none' || (!hasEmployeeChat && !hasSkillDetail && !hasSkillList)) {
    return (
      <div className="flex flex-col h-full bg-zinc-950">
        <div className="flex items-center justify-center h-full">
          <div className="text-center space-y-4">
            <div className="text-5xl">⚡</div>
            <p className="text-zinc-500 text-sm">Hermes Agent Studio</p>
            <p className="text-zinc-600 text-xs max-w-xs">
              选择一个员工开始对话，或浏览技能库
            </p>
            <div className="flex gap-3 justify-center mt-4">
              <button
                onClick={() => setRightPanelView('skill-detail')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-xs hover:bg-zinc-700 transition-colors border border-zinc-700"
              >
                <Wrench size={14} />
                浏览技能
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Tab Bar when employee is selected */}
      {hasEmployeeChat && (
        <div className="flex items-center border-b border-zinc-800 bg-zinc-900/30">
          <button
            onClick={() => setRightPanelView('chat')}
            className="flex items-center gap-1.5 px-4 py-2 text-xs border-b-2 border-amber-400 text-amber-400"
          >
            <MessageSquare size={12} />
            对话
          </button>
          <button
            onClick={() => setRightPanelView('skill-detail')}
            className="flex items-center gap-1.5 px-4 py-2 text-xs border-b-2 border-transparent text-zinc-500 hover:text-zinc-300"
          >
            <Wrench size={12} />
            技能
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setRightPanelView('none')}
            className="p-1.5 mr-2 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Panel Content */}
      <div className="flex-1 overflow-hidden">
        {hasEmployeeChat && <ChatPanel />}
        {hasSkillDetail && <SkillDetail />}
        {hasSkillList && <SkillPanel />}
      </div>
    </div>
  );
}
