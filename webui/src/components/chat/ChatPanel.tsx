'use client';

import { useRef, useEffect, useState } from 'react';
import { Send, Square, Trash2, BookDown } from 'lucide-react';
import { useHermesStore } from '@/lib/store';

export default function ChatPanel() {
  const {
    selectedEmployeeId, employees,
    conversations, getConversation,
    sendMessage, stopStreaming,
    clearConversation,
    streamingEmployeeId,
    consolidateConversationToSkill,
  } = useHermesStore();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const employee = employees.find((e) => e.id === selectedEmployeeId);
  const conv = selectedEmployeeId ? getConversation(selectedEmployeeId) : null;
  const isStreaming = streamingEmployeeId === selectedEmployeeId;

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conv?.messages.length]);

  // Focus input when employee selected
  useEffect(() => {
    if (selectedEmployeeId) {
      inputRef.current?.focus();
    }
  }, [selectedEmployeeId]);

  const handleSend = () => {
    if (!input.trim() || !selectedEmployeeId || isStreaming) return;
    const content = input.trim();
    setInput('');
    sendMessage(selectedEmployeeId, content);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!employee) {
    return (
      <div className="flex items-center justify-center h-full bg-zinc-950">
        <div className="text-center">
          <div className="text-5xl mb-4">💬</div>
          <p className="text-zinc-500 text-sm">选择一个员工开始对话</p>
          <p className="text-zinc-600 text-xs mt-1">点击左侧面板中的员工卡片</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Chat Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{employee.avatar}</span>
          <div>
            <h3 className="text-sm font-semibold text-zinc-200">{employee.name}</h3>
            <p className="text-xs text-zinc-500">
              {employee.role}
              {employee.skills.length > 0 && (
                <span className="ml-2 text-amber-400/60">
                  [{employee.skills.filter((s) => s.enabled).map((s) => s.name).join(', ')}]
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              const name = prompt('沉淀为技能，输入技能名称：');
              if (name && selectedEmployeeId) consolidateConversationToSkill(selectedEmployeeId, name);
            }}
            className="p-1.5 rounded-md text-zinc-500 hover:text-amber-400 hover:bg-zinc-800 transition-colors"
            title="沉淀为技能"
          >
            <BookDown size={16} />
          </button>
          <button
            onClick={() => selectedEmployeeId && clearConversation(selectedEmployeeId)}
            className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
            title="清空对话"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {conv?.messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <span className="text-3xl">{employee.avatar}</span>
              <p className="text-zinc-500 text-sm mt-3">
                向 {employee.name} 发送消息开始对话
              </p>
              {employee.skills.length > 0 && (
                <div className="mt-3 flex flex-wrap justify-center gap-1">
                  {employee.skills.filter((s) => s.enabled).map((sk) => (
                    <span key={sk.name} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400">
                      {sk.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {conv?.messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <span className="text-lg mt-0.5 flex-shrink-0">{employee.avatar}</span>
            )}
            <div
              className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-amber-400/10 text-zinc-200 border border-amber-400/20'
                  : 'bg-zinc-800/80 text-zinc-300 border border-zinc-700/50'
              }`}
            >
              {msg.content || (
                <span className="inline-flex items-center gap-1 text-zinc-500">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  思考中...
                </span>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs text-zinc-300 flex-shrink-0 mt-0.5">
                你
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-900/50">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`向 ${employee.name} 发送消息...`}
              rows={1}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/20 transition-colors"
              style={{ maxHeight: '120px' }}
              onInput={(e) => {
                const t = e.target as HTMLTextAreaElement;
                t.style.height = 'auto';
                t.style.height = Math.min(t.scrollHeight, 120) + 'px';
              }}
            />
          </div>
          {isStreaming ? (
            <button
              onClick={stopStreaming}
              className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-400 text-zinc-900 hover:bg-amber-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
