/**
 * Hermes API Client — connects to the Hermes Agent API server
 * Default: http://localhost:8642/v1
 */

import type { ChatCompletionRequest, ChatCompletionChunk, Skill, ModelInfo, ConversationMessage, MessageRole } from './types';

const DEFAULT_BASE_URL = 'http://localhost:8642/v1';

class HermesAPI {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || (typeof window !== 'undefined'
      ? (localStorage.getItem('hermes-api-url') || DEFAULT_BASE_URL)
      : DEFAULT_BASE_URL);
  }

  setBaseUrl(url: string) {
    this.baseUrl = url;
    if (typeof window !== 'undefined') {
      localStorage.setItem('hermes-api-url', url);
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  // ─── Health ──────────────────────────────────────────────────────

  async health(): Promise<{ status: string }> {
    const res = await fetch(`${this.baseUrl}/health`);
    return res.json();
  }

  // ─── Models ──────────────────────────────────────────────────────

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/models`);
    const data = await res.json();
    return (data.data || []).map((m: Record<string, string>) => ({
      id: m.id,
      name: m.id,
      provider: m.owned_by || 'hermes',
    }));
  }

  // ─── Chat ────────────────────────────────────────────────────────

  async chatCompletion(
    messages: Array<{ role: MessageRole; content: string }>,
    options?: { model?: string; stream?: boolean; sessionId?: string },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (options?.sessionId) {
      headers['X-Hermes-Session-Id'] = options.sessionId;
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: options?.model || 'hermes-agent',
        messages,
        stream: options?.stream ?? true,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`API error: ${res.status} — ${error}`);
    }

    return res;
  }

  /**
   * Stream chat completion, yields text chunks via callback
   */
  async streamChat(
    messages: Array<{ role: MessageRole; content: string }>,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (err: Error) => void,
    options?: { model?: string; sessionId?: string },
  ): Promise<AbortController> {
    const controller = new AbortController();

    try {
      const res = await this.chatCompletion(messages, {
        ...options,
        stream: true,
      });

      if (!res.body) {
        throw new Error('No response body for streaming');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              const data = trimmed.slice(6);
              if (data === '[DONE]') {
                onDone();
                return;
              }
              try {
                const chunk: ChatCompletionChunk = JSON.parse(data);
                const content = chunk.choices?.[0]?.delta?.content;
                if (content) onChunk(content);
              } catch {
                // skip malformed chunks
              }
            }
          }
          onDone();
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
            onError(err as Error);
          }
        }
      };

      processStream();
    } catch (err) {
      onError(err as Error);
    }

    return controller;
  }

  // ─── Skills (via API extensions) ────────────────────────────────

  async listSkills(): Promise<Skill[]> {
    // Try the skills API endpoint if available
    try {
      const res = await fetch(`${this.baseUrl}/skills`);
      if (res.ok) {
        const data = await res.json();
        return data.skills || data || [];
      }
    } catch {
      // fallback to local skills
    }

    // Fallback: load from local static file
    try {
      const res = await fetch('/api/skills');
      if (res.ok) {
        const data = await res.json();
        return data.skills || [];
      }
    } catch {
      // empty
    }

    return [];
  }

  async getSkillDetail(name: string): Promise<Skill | null> {
    try {
      const res = await fetch(`${this.baseUrl}/skills/${encodeURIComponent(name)}`);
      if (res.ok) return res.json();
    } catch {
      // fallback
    }
    return null;
  }
}

export const hermesAPI = new HermesAPI();
export { HermesAPI };
