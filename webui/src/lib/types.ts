/**
 * Hermes WebUI — Core Type Definitions
 * Inspired by OpenOffice's office-store.ts architecture
 */

// ─── Agent (Employee) ────────────────────────────────────────────────

export type EmployeeStatus = 'idle' | 'working' | 'thinking' | 'error' | 'offline';

export interface EmployeeSkill {
  name: string;
  description: string;
  enabled: boolean;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  avatar: string;           // emoji or image URL
  status: EmployeeStatus;
  skills: EmployeeSkill[];
  createdAt: number;
  lastActiveAt: number;
  position: { x: number; y: number };  // drag position
  metadata?: Record<string, unknown>;
}

// ─── Conversation ────────────────────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  reasoning?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface Conversation {
  id: string;
  employeeId: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: number;
  updatedAt: number;
  tokenUsage?: {
    input: number;
    output: number;
  };
}

// ─── Skill ───────────────────────────────────────────────────────────

export interface Skill {
  name: string;
  description: string;
  category: string;
  categoryLabel: string;
  source: 'built-in' | 'optional' | 'custom' | 'anthropic' | 'lobehub';
  tags: string[];
  platforms: string[];
  author: string;
  version: string;
  content?: string;          // full instructions (loaded on demand)
  references?: SkillReference[];
}

export interface SkillReference {
  name: string;
  path: string;
  content?: string;
}

// ─── UI State ────────────────────────────────────────────────────────

export type RightPanelView = 'chat' | 'skill-detail' | 'settings' | 'none';

export interface LeftNavItem {
  id: string;
  label: string;
  icon: string;              // lucide icon name
  badge?: number;
}

// ─── API Types ───────────────────────────────────────────────────────

export interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: MessageRole;
    content: string;
  }>;
  stream?: boolean;
  temperature?: number;
}

export interface ChatCompletionChunk {
  id: string;
  choices: Array<{
    delta: {
      content?: string;
      role?: string;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string | null;
  }>;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}
