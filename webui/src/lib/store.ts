/**
 * Hermes WebUI — Zustand Store
 * Inspired by OpenOffice's office-store.ts event-driven pattern
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Employee,
  EmployeeStatus,
  Conversation,
  ConversationMessage,
  Skill,
  RightPanelView,
} from '@/lib/types';
import { hermesAPI } from '@/lib/api';

// ─── Employee Helpers ────────────────────────────────────────────────

const AVATARS = ['🤖', '👩‍💻', '🧑‍🔬', '👨‍🎨', '👩‍🔧', '🧙‍♂️', '🦊', '🐱', '🐶', '🦁'];
const ROLES = [
  '通用助手', '代码工程师', '数据分析师', '内容创作者',
  '测试专家', '运维工程师', '产品经理', '设计顾问',
];

function generateId(): string {
  return `emp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Store Interface ─────────────────────────────────────────────────

interface HermesStore {
  // ─── Employees ────────────────────────────────────────────────
  employees: Employee[];
  selectedEmployeeId: string | null;

  addEmployee: (name?: string, role?: string) => Employee;
  removeEmployee: (id: string) => void;
  updateEmployee: (id: string, updates: Partial<Employee>) => void;
  setEmployeeStatus: (id: string, status: EmployeeStatus) => void;
  updateEmployeePosition: (id: string, x: number, y: number) => void;
  assignSkillToEmployee: (employeeId: string, skillName: string) => void;
  removeSkillFromEmployee: (employeeId: string, skillName: string) => void;
  toggleEmployeeSkill: (employeeId: string, skillName: string) => void;
  selectEmployee: (id: string | null) => void;

  // ─── Conversations ────────────────────────────────────────────
  conversations: Map<string, Conversation>;
  currentConversationId: string | null;

  getConversation: (employeeId: string) => Conversation;
  addMessage: (employeeId: string, message: Omit<ConversationMessage, 'id' | 'timestamp'>) => void;
  updateLastAssistantMessage: (employeeId: string, content: string) => void;
  clearConversation: (employeeId: string) => void;
  setCurrentConversation: (id: string | null) => void;

  // ─── Streaming ────────────────────────────────────────────────
  streamingEmployeeId: string | null;
  streamingContent: string;
  abortController: AbortController | null;

  sendMessage: (employeeId: string, content: string) => Promise<void>;
  stopStreaming: () => void;

  // ─── Skills ───────────────────────────────────────────────────
  skills: Skill[];
  selectedSkillName: string | null;
  skillsLoading: boolean;

  loadSkills: () => Promise<void>;
  selectSkill: (name: string | null) => void;
  consolidateConversationToSkill: (employeeId: string, skillName: string) => void;

  // ─── UI ───────────────────────────────────────────────────────
  rightPanelView: RightPanelView;
  sidebarCollapsed: boolean;
  apiConnected: boolean;

  setRightPanelView: (view: RightPanelView) => void;
  toggleSidebar: () => void;
  setApiConnected: (connected: boolean) => void;

  // ─── Config ───────────────────────────────────────────────────
  apiUrl: string;
  modelName: string;
  setApiUrl: (url: string) => void;
  setModelName: (name: string) => void;
}

// ─── Store Implementation ────────────────────────────────────────────

export const useHermesStore = create<HermesStore>()(
  persist(
    (set, get) => ({
      // ─── Employees ────────────────────────────────────────────
      employees: [
        {
          id: 'emp_default',
          name: 'Hermes',
          role: '通用助手',
          avatar: '🤖',
          status: 'idle',
          skills: [],
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          position: { x: 0, y: 0 },
        },
      ],
      selectedEmployeeId: null,

      addEmployee: (name, role) => {
        const emp: Employee = {
          id: generateId(),
          name: name || `员工 ${get().employees.length + 1}`,
          role: role || ROLES[Math.floor(Math.random() * ROLES.length)],
          avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
          status: 'idle',
          skills: [],
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          position: {
            x: 20 + Math.random() * 300,
            y: 20 + Math.random() * 300,
          },
        };
        set((s) => ({ employees: [...s.employees, emp] }));
        return emp;
      },

      removeEmployee: (id) => {
        set((s) => ({
          employees: s.employees.filter((e) => e.id !== id),
          selectedEmployeeId: s.selectedEmployeeId === id ? null : s.selectedEmployeeId,
          conversations: new Map([...s.conversations].filter(([k]) => k !== id)),
        }));
      },

      updateEmployee: (id, updates) => {
        set((s) => ({
          employees: s.employees.map((e) =>
            e.id === id ? { ...e, ...updates, lastActiveAt: Date.now() } : e
          ),
        }));
      },

      setEmployeeStatus: (id, status) => {
        set((s) => ({
          employees: s.employees.map((e) =>
            e.id === id ? { ...e, status, lastActiveAt: Date.now() } : e
          ),
        }));
      },

      updateEmployeePosition: (id, x, y) => {
        set((s) => ({
          employees: s.employees.map((e) =>
            e.id === id ? { ...e, position: { x, y } } : e
          ),
        }));
      },

      assignSkillToEmployee: (employeeId, skillName) => {
        set((s) => ({
          employees: s.employees.map((e) => {
            if (e.id !== employeeId) return e;
            if (e.skills.some((sk) => sk.name === skillName)) return e;
            const skill = s.skills.find((sk) => sk.name === skillName);
            return {
              ...e,
              skills: [
                ...e.skills,
                { name: skillName, description: skill?.description || '', enabled: true },
              ],
            };
          }),
        }));
      },

      removeSkillFromEmployee: (employeeId, skillName) => {
        set((s) => ({
          employees: s.employees.map((e) =>
            e.id === employeeId
              ? { ...e, skills: e.skills.filter((sk) => sk.name !== skillName) }
              : e
          ),
        }));
      },

      toggleEmployeeSkill: (employeeId, skillName) => {
        set((s) => ({
          employees: s.employees.map((e) =>
            e.id === employeeId
              ? {
                  ...e,
                  skills: e.skills.map((sk) =>
                    sk.name === skillName ? { ...sk, enabled: !sk.enabled } : sk
                  ),
                }
              : e
          ),
        }));
      },

      selectEmployee: (id) => {
        set((s) => {
          if (id) {
            const conv = s.conversations.get(id);
            return {
              selectedEmployeeId: id,
              rightPanelView: 'chat' as RightPanelView,
              currentConversationId: conv?.id || null,
            };
          }
          return {
            selectedEmployeeId: null,
            rightPanelView: 'none' as RightPanelView,
            currentConversationId: null,
          };
        });
      },

      // ─── Conversations ────────────────────────────────────────
      conversations: new Map(),
      currentConversationId: null,

      getConversation: (employeeId) => {
        const state = get();
        let conv = state.conversations.get(employeeId);
        if (!conv) {
          conv = {
            id: generateConversationId(),
            employeeId,
            title: '新对话',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          set((s) => {
            const next = new Map(s.conversations);
            next.set(employeeId, conv!);
            return { conversations: next };
          });
        }
        return conv;
      },

      addMessage: (employeeId, message) => {
        const fullMessage: ConversationMessage = {
          ...message,
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
        };
        set((s) => {
          const next = new Map(s.conversations);
          let conv = next.get(employeeId);
          if (!conv) {
            conv = {
              id: generateConversationId(),
              employeeId,
              title: '新对话',
              messages: [],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
          }
          const updated = {
            ...conv,
            messages: [...conv.messages, fullMessage],
            updatedAt: Date.now(),
            title: conv.messages.length === 0 && message.role === 'user'
              ? message.content.slice(0, 30) + (message.content.length > 30 ? '...' : '')
              : conv.title,
          };
          next.set(employeeId, updated);
          return { conversations: next, currentConversationId: updated.id };
        });
      },

      updateLastAssistantMessage: (employeeId, content) => {
        set((s) => {
          const next = new Map(s.conversations);
          const conv = next.get(employeeId);
          if (!conv) return {};
          const msgs = [...conv.messages];
          const lastIdx = msgs.length - 1;
          if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
            msgs[lastIdx] = { ...msgs[lastIdx], content };
          }
          next.set(employeeId, { ...conv, messages: msgs, updatedAt: Date.now() });
          return { conversations: next };
        });
      },

      clearConversation: (employeeId) => {
        set((s) => {
          const next = new Map(s.conversations);
          next.set(employeeId, {
            id: generateConversationId(),
            employeeId,
            title: '新对话',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          return { conversations: next };
        });
      },

      setCurrentConversation: (id) => set({ currentConversationId: id }),

      // ─── Streaming ────────────────────────────────────────────
      streamingEmployeeId: null,
      streamingContent: '',
      abortController: null,

      sendMessage: async (employeeId, content) => {
        const state = get();
        const employee = state.employees.find((e) => e.id === employeeId);
        if (!employee) return;

        // Add user message
        state.addMessage(employeeId, { role: 'user', content });

        // Prepare messages for API
        const conv = state.getConversation(employeeId);
        const apiMessages = [...conv.messages, { role: 'user' as const, content }].map((m) => ({
          role: m.role,
          content: m.content,
        }));

        // Add assistant placeholder
        state.addMessage(employeeId, { role: 'assistant', content: '' });

        // Update status
        state.setEmployeeStatus(employeeId, 'working');
        set({ streamingEmployeeId: employeeId, streamingContent: '' });

        const controller = new AbortController();
        set({ abortController: controller });

        try {
          await hermesAPI.streamChat(
            apiMessages,
            // onChunk
            (text) => {
              set((s) => {
                const newContent = s.streamingContent + text;
                // Update the conversation in place
                const next = new Map(s.conversations);
                const conv = next.get(employeeId);
                if (conv) {
                  const msgs = [...conv.messages];
                  const lastIdx = msgs.length - 1;
                  if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
                    msgs[lastIdx] = { ...msgs[lastIdx], content: newContent };
                  }
                  next.set(employeeId, { ...conv, messages: msgs });
                }
                return { conversations: next, streamingContent: newContent };
              });
            },
            // onDone
            () => {
              state.setEmployeeStatus(employeeId, 'idle');
              set({ streamingEmployeeId: null, streamingContent: '', abortController: null });
            },
            // onError
            (err) => {
              console.error('Stream error:', err);
              state.setEmployeeStatus(employeeId, 'error');
              state.updateLastAssistantMessage(
                employeeId,
                `[错误] ${err.message}`
              );
              set({ streamingEmployeeId: null, streamingContent: '', abortController: null });
            },
            { model: state.modelName, sessionId: employeeId },
          );
        } catch (err) {
          console.error('Send message error:', err);
          state.setEmployeeStatus(employeeId, 'error');
          set({ streamingEmployeeId: null, streamingContent: '', abortController: null });
        }
      },

      stopStreaming: () => {
        const { abortController, streamingEmployeeId } = get();
        abortController?.abort();
        if (streamingEmployeeId) {
          get().setEmployeeStatus(streamingEmployeeId, 'idle');
        }
        set({ streamingEmployeeId: null, streamingContent: '', abortController: null });
      },

      // ─── Skills ───────────────────────────────────────────────
      skills: [],
      selectedSkillName: null,
      skillsLoading: false,

      loadSkills: async () => {
        set({ skillsLoading: true });
        try {
          const skills = await hermesAPI.listSkills();
          set({ skills, skillsLoading: false });
        } catch {
          set({ skillsLoading: false });
        }
      },

      selectSkill: (name) => {
        set((s) => ({
          selectedSkillName: name,
          rightPanelView: name ? 'skill-detail' as RightPanelView : s.rightPanelView,
        }));
      },

      consolidateConversationToSkill: (employeeId, skillName) => {
        const state = get();
        const conv = state.conversations.get(employeeId);
        if (!conv || conv.messages.length === 0) return;

        const content = conv.messages
          .map((m) => `## ${m.role === 'user' ? '用户' : '助手'}\n${m.content}`)
          .join('\n\n');

        const newSkill: Skill = {
          name: skillName,
          description: `从员工 ${state.employees.find((e) => e.id === employeeId)?.name || ''} 的对话中沉淀`,
          category: 'custom',
          categoryLabel: '自定义',
          source: 'custom',
          tags: ['沉淀', '对话'],
          platforms: [],
          author: 'hermes',
          version: '1.0.0',
          content,
        };

        set((s) => ({
          skills: [...s.skills, newSkill],
        }));

        // Also assign to the employee
        get().assignSkillToEmployee(employeeId, skillName);
      },

      // ─── UI ───────────────────────────────────────────────────
      rightPanelView: 'none',
      sidebarCollapsed: false,
      apiConnected: false,

      setRightPanelView: (view) => set({ rightPanelView: view }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setApiConnected: (connected) => set({ apiConnected: connected }),

      // ─── Config ───────────────────────────────────────────────
      apiUrl: 'http://localhost:8642/v1',
      modelName: 'hermes-agent',

      setApiUrl: (url) => {
        set({ apiUrl: url });
        hermesAPI.setBaseUrl(url);
      },
      setModelName: (name) => set({ modelName: name }),
    }),
    {
      name: 'hermes-webui-store',
      partialize: (state) => ({
        employees: state.employees,
        conversations: Array.from(state.conversations.entries()),
        skills: state.skills,
        apiUrl: state.apiUrl,
        modelName: state.modelName,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const parsed = JSON.parse(str);
          if (parsed.state?.conversations && Array.isArray(parsed.state.conversations)) {
            parsed.state.conversations = new Map(
              parsed.state.conversations as [string, Conversation][]
            );
          }
          return parsed;
        },
        setItem: (name, value) => {
          const state = { ...value };
          if (state.state?.conversations instanceof Map) {
            state.state.conversations = Array.from(
              (state.state.conversations as Map<string, Conversation>).entries()
            );
          }
          localStorage.setItem(name, JSON.stringify(state));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);
