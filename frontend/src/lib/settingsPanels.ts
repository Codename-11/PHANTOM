// Page-scoped read-only data hooks for the three Settings tabs that the
// A8.2 build left as placeholders — Prompts, Security & Scope, and
// Tools / MCP / Skills. These wrap existing /api endpoints only:
//
//   GET /api/prompts/profiles   → PromptProfileRow[]
//   GET /api/prompts/fragments  → PromptFragmentRow[]
//   GET /api/mcp/servers        → McpServerRow[]
//   GET /api/skills             → SkillRow[]
//
// Scope data reuses the shared useScopes() hook in lib/scopes.ts. No new
// endpoints are invented; write paths (create/delete) are intentionally
// out of scope for this parity-close — the panels are read surfaces with
// deep links to the dedicated builders.
//
// Local types live here (not lib/types.ts) per the A8.5b file-ownership
// rule. If these graduate to first-class shapes a follow-up should hoist
// them into lib/types.ts.
import { useQuery } from '@tanstack/react-query';

import { apiFetch } from './api';

// ── Prompts ────────────────────────────────────────────────────────────

export interface PromptProfileRow {
  id: string;
  name: string;
  description?: string;
  mode?: string;
  is_default?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface PromptFragmentRow {
  id: string;
  profile_id: string | null;
  kind: string;
  name: string;
  body?: string;
  enabled?: boolean;
  position?: number;
}

export function usePromptProfiles() {
  return useQuery<PromptProfileRow[], Error>({
    queryKey: ['prompt-profiles'],
    queryFn: async () => {
      const data = await apiFetch<PromptProfileRow[]>('/api/prompts/profiles');
      return Array.isArray(data) ? data : [];
    },
  });
}

export function usePromptFragments() {
  return useQuery<PromptFragmentRow[], Error>({
    queryKey: ['prompt-fragments'],
    queryFn: async () => {
      const data = await apiFetch<PromptFragmentRow[]>('/api/prompts/fragments');
      return Array.isArray(data) ? data : [];
    },
  });
}

// ── MCP servers ──────────────────────────────────────────────────────--

export interface McpServerRow {
  id: string;
  name: string;
  transport?: string;
  command?: string | null;
  args?: string | null;
  url?: string | null;
  created_at?: string;
}

export function useMcpServers() {
  return useQuery<McpServerRow[], Error>({
    queryKey: ['mcp-servers'],
    queryFn: async () => {
      const data = await apiFetch<McpServerRow[]>('/api/mcp/servers');
      return Array.isArray(data) ? data : [];
    },
  });
}

// ── Skills ───────────────────────────────────────────────────────────--

export interface SkillRow {
  name: string;
  description?: string;
  files?: string[];
}

export function useSkills() {
  return useQuery<SkillRow[], Error>({
    queryKey: ['skills'],
    queryFn: async () => {
      const data = await apiFetch<SkillRow[]>('/api/skills');
      return Array.isArray(data) ? data : [];
    },
  });
}
