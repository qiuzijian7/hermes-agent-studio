'use client';

import { useState, useEffect } from 'react';
import { useHermesStore } from '@/lib/store';
import { hermesAPI } from '@/lib/api';

export default function SettingsPanel() {
  const { apiUrl, modelName, setApiUrl, setModelName, setApiConnected } = useHermesStore();
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [localUrl, setLocalUrl] = useState(apiUrl);
  const [localModel, setLocalModel] = useState(modelName);

  useEffect(() => {
    setLocalUrl(apiUrl);
    setLocalModel(modelName);
  }, [apiUrl, modelName]);

  const handleSave = () => {
    setApiUrl(localUrl);
    setModelName(localModel);
  };

  const handleTest = async () => {
    setTestStatus('testing');
    try {
      const api = new (await import('@/lib/api')).HermesAPI(localUrl);
      const res = await fetch(`${localUrl.replace('/v1', '')}/health`);
      if (res.ok) {
        setTestStatus('ok');
        setApiConnected(true);
      } else {
        setTestStatus('fail');
        setApiConnected(false);
      }
    } catch {
      setTestStatus('fail');
      setApiConnected(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
        <h2 className="text-sm font-semibold text-zinc-200">设置</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {/* API Connection */}
        <section>
          <h3 className="text-xs font-medium text-zinc-400 mb-3">API 连接</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">API 地址</label>
              <input
                type="text"
                value={localUrl}
                onChange={(e) => setLocalUrl(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-amber-400/50"
                placeholder="http://localhost:8642/v1"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">模型名称</label>
              <input
                type="text"
                value={localModel}
                onChange={(e) => setLocalModel(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-amber-400/50"
                placeholder="hermes-agent"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleTest}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                {testStatus === 'testing' ? '测试中...' : '测试连接'}
              </button>
              <button
                onClick={handleSave}
                className="px-3 py-1.5 rounded-lg bg-amber-400 text-zinc-900 text-xs font-medium hover:bg-amber-300 transition-colors"
              >
                保存
              </button>
              {testStatus === 'ok' && (
                <span className="text-xs text-emerald-400 self-center">✓ 连接成功</span>
              )}
              {testStatus === 'fail' && (
                <span className="text-xs text-red-400 self-center">✗ 连接失败</span>
              )}
            </div>
          </div>
        </section>

        {/* About */}
        <section>
          <h3 className="text-xs font-medium text-zinc-400 mb-3">关于</h3>
          <div className="space-y-2 text-xs text-zinc-500">
            <p>Hermes Agent Studio v0.1.0</p>
            <p>可视化 AI 员工管理平台</p>
            <p className="text-zinc-600">基于 Hermes Agent API 构建</p>
          </div>
        </section>
      </div>
    </div>
  );
}
