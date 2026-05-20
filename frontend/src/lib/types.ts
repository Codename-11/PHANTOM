// TypeScript surface for PHANTOM's campaign API. These types mirror what
// `/api/campaigns/*` actually returns; the legacy vanilla JS code consumes
// the same shapes untyped, so any drift here would be caught by either
// the integration tests or runtime errors in the React surface.

export type CampaignStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'paused'
  | 'needs_approval'
  | 'completed'
  | 'failed'
  | 'canceled';

export type WorkerBackend = 'phantom-native' | 'codex-exec';

export interface RunBudget {
  maxChildRuns: number;
  maxAttemptsPerGoal: number;
  maxWallClockMinutes: number;
}

export interface RiskBudget {
  allowedRiskClasses: string[];
  blockedRiskClasses: string[];
  pauseOnNewFinding: boolean;
  pauseOnApprovalRequired: boolean;
}

export interface NotificationPolicy {
  workdir?: string;
}

export interface Campaign {
  id: string;
  title: string;
  objective: string;
  status: CampaignStatus;
  scope_id: string | null;
  prompt_profile_id: string | null;
  toolpack_ids: string[];
  worker_backend: WorkerBackend;
  run_budget: Partial<RunBudget>;
  risk_budget: Partial<RiskBudget>;
  notification_policy: NotificationPolicy | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export type GoalStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'needs_approval'
  | 'blocked';

export interface EvaluatorResult {
  decision: string;
  summary: string;
}

export interface CampaignGoal {
  id: string;
  campaign_id: string;
  title: string;
  prompt: string;
  status: GoalStatus;
  attempt_count: number;
  max_attempts: number;
  parent_goal_id: string | null;
  priority: number;
  evaluator_result: EvaluatorResult | null;
  created_at: string;
}

export type RunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'unknown';

export interface CampaignRun {
  run: {
    id: string;
    title: string;
    status: RunStatus;
    started_at: string | null;
    ended_at: string | null;
    conversation_id: string | null;
  };
  goal: { id: string; title: string; status: GoalStatus } | null;
  link: unknown | null;
  artifactCount: number;
  findingCount: number;
  blockedCount: number;
  evaluator: EvaluatorResult | null;
}

export interface CampaignReplaySummary {
  totalRuns: number;
  totalFindings: number;
  totalArtifacts: number;
  totalBlocked: number;
  budgetUsed: { runs: number; maxRuns: number };
}

export interface CampaignReplay {
  campaign: Campaign;
  goals: CampaignGoal[];
  runs: CampaignRun[];
  summary: CampaignReplaySummary;
}

// ── Reference data (for the create form) ──────────────────────────────

// The /api/scopes response includes a lot more than {id, name} — but the
// campaign create form only needs those two fields, so the rich shape lives
// on a separate ScopeRecord (below) and Scope stays the minimal projection.
export interface Scope {
  id: string;
  name: string;
}

// ── Scope (full record from /api/scopes/:id) ──────────────────────────
//
// Mirrors `normalizeScope` in server/scope/scope-store.js. The fields
// are deliberately permissive (most policy fields can be null on a
// brand-new scope) so the React surface can render partial drafts.

export interface ScopeTargets {
  hosts?: string[];
  domains?: string[];
  cidrs?: string[];
  urls?: string[];
  hostPorts?: string[];
  assetIds?: string[];
  toolpackIds?: string[];
}

export type ScopeActionMode = 'auto' | 'ask' | 'deny';
export type ScopeActionModes = Record<string, ScopeActionMode>;

export interface ScopeRecord {
  id: string;
  name: string;
  targets: ScopeTargets;
  raw_targets?: ScopeTargets;
  allowed_actions: string[];
  blocked_actions: string[];
  action_modes: ScopeActionModes | null;
  active_hours: unknown | null;
  blackout_windows: unknown | null;
  rate_caps: unknown | null;
  rules_of_engagement: string;
  credential_refs: string[];
  notes: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string | null;
  archived_at: string | null;
}

export interface ScopeTemplate {
  id: string;
  name: string;
  summary?: string;
  allowedActions?: string[];
  blockedActions?: string[];
  nameSuffix?: string;
  notes?: string;
  toolpackIds?: string[];
}

// Status surface for the scope-list pill. Derived client-side from
// `expires_at` + `archived_at` since the server doesn't store one.
export type ScopeStatus = 'active' | 'expired' | 'archived';

// Allowed/blocked action class identifiers used by the create form.
// Mirrors the canonical safe set in server/scope/templates.js — exploit
// + destructive + credentialed + online-bruteforce stay pinned to the
// blocked list.
export const SCOPE_ALLOWED_ACTIONS = [
  'recon',
  'network-scan',
  'web-vuln',
  'offline-password-audit',
] as const;
export const SCOPE_BLOCKED_ACTIONS = [
  'exploit',
  'destructive',
  'credentialed',
  'online-bruteforce',
] as const;

// Target rows returned from /api/scopes/parse-targets.
export interface ParsedTarget {
  id: string;
  type: 'host' | 'domain' | 'cidr' | 'url' | 'host_port';
  value: string;
}
export interface ParseTargetsResponse {
  targets: ParsedTarget[];
  errors: Array<{ input: string; reason: string }>;
  scopeFields: ScopeTargets;
}

// ── Settings (from /api/settings) ─────────────────────────────────────

export interface AppSettings {
  provider: string;
  baseUrl: string;
  apiKey: string;
  apiKeySet: boolean;
  model: string;
  temperature: number;
  maxTokens: number;
  workspace: string;
  elevationMode?: 'root' | 'sudo' | 'admin' | 'user';
  sudoConfigured?: boolean;
  synthesisLlmEnabled?: boolean;
  docsEnabled?: boolean;
}

// Partial — only fields the React surface actually writes.
export interface SettingsPatch {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  workspace?: string;
  synthesisLlmEnabled?: boolean;
  docsEnabled?: boolean;
}

// Provider state — surfaced by the Provider state pill near the top of
// every Settings tab. The five values map to the mega-plan A6 spec.
export type ProviderState =
  | 'configured'
  | 'reachable'
  | 'missing'
  | 'proxy-backed'
  | 'failed';

// ── Diagnostics (from /api/diagnostics) ───────────────────────────────

export type DiagnosticsOverall = 'ok' | 'needs_setup' | 'degraded' | 'blocked';

export interface DiagnosticsCheck {
  id: string;
  status: DiagnosticsOverall;
  detail?: string;
  elapsedMs: number;
}

export interface DiagnosticsResult {
  overall: DiagnosticsOverall;
  checks: DiagnosticsCheck[];
  elapsedMs: number;
  generatedAt: string;
  // Per-check `.data` blobs — opaque to the surface; not used directly.
  runtime?: Record<string, unknown> | null;
  db?: Record<string, unknown> | null;
  workspace?: Record<string, unknown> | null;
  provider?: Record<string, unknown> | null;
  docs?: Record<string, unknown> | null;
  toolpacks?: Record<string, unknown> | null;
  campaigns?: Record<string, unknown> | null;
  registry?: Record<string, unknown> | null;
  parity?: Record<string, unknown> | null;
}

export interface PromptProfile {
  id: string;
  name: string;
}

export interface ToolpackTool {
  name: string;
  command: string;
  risk: string;
  installHint?: string;
  scopeRequired?: boolean;
  available?: boolean;
}

export interface Toolpack {
  id: string;
  name?: string;
  summary?: string;
  category?: string;
  risks?: string[];
  allowedActions?: string[];
  blockedByDefault?: string[];
  tools?: ToolpackTool[];
  policy?: {
    scopeRequired?: boolean;
    passiveOnly?: boolean;
    allowNetworkScan?: boolean;
    allowCredentialUse?: boolean;
    allowExploit?: boolean;
  };
}

export interface BackendDescriptor {
  id: WorkerBackend;
  available: boolean;
  reason?: string;
}

// ── Create-form state shape ───────────────────────────────────────────

export interface CampaignFormState {
  title: string;
  objective: string;
  scopeId: string;
  profileId: string;
  toolpackIds: string[];
  backend: WorkerBackend;
  workdir: string;
  runBudget: { maxChildRuns: number; maxAttemptsPerGoal: number; maxWallClockMinutes: number };
  riskBudget: {
    allowedRiskClasses: string[];
    blockedRiskClasses: string[];
    pauseOnNewFinding: boolean;
    pauseOnApprovalRequired: boolean;
  };
}

export interface CreateCampaignBody {
  title: string;
  objective: string;
  scopeId: string | null;
  promptProfileId: string | null;
  toolpackIds: string[];
  workerBackend: WorkerBackend;
  runBudget: RunBudget;
  riskBudget: RiskBudget;
  notificationPolicy: NotificationPolicy | null;
}

// ── Artifact result for report / evidence ─────────────────────────────

export interface Artifact {
  id: string;
  title: string;
  type: string;
}

export interface CampaignListResponse {
  campaigns: Campaign[];
}

export interface CampaignBackendsResponse {
  backends: BackendDescriptor[];
}
