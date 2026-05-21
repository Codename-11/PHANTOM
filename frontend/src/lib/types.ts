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

// ── Runs (from /api/runs and /api/runs/:id) ──────────────────────────
//
// Mirrors `normalizeRun` in server/memory/store.js. Fields are the raw
// columns plus the parsed prompt_snapshot blob and the lazily-joined
// scope summary. The server also augments /api/runs/:id with `events`
// and `artifacts` arrays.

export interface RunScopeSummary {
  id: string;
  name: string;
  expires_at?: string | null;
  archived_at?: string | null;
}

export interface RunRecord {
  id: string;
  conversation_id: string | null;
  title: string | null;
  goal: string | null;
  status: RunStatus;
  model: string | null;
  provider_route: string | null;
  scope_id: string | null;
  risk_level: string | null;
  summary: string | null;
  started_at: string | null;
  ended_at: string | null;
  prompt_snapshot: Record<string, unknown> | null;
  scope: RunScopeSummary | null;
}

// Trace event row — `normalizeTraceEvent` shape from store.js. Server
// returns `output_preview` (snake_case) on the wire; we accept both
// forms because some upstream renderers use camelCase.
export interface TraceEvent {
  id: string;
  run_id: string;
  parent_event_id: string | null;
  seq: number;
  type: string;
  phase: string | null;
  status: string | null;
  tool_name: string | null;
  input?: unknown;
  output_ref: string | null;
  output_preview: string | null;
  outputPreview?: string | null;
  metadata?: Record<string, unknown> | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  created_at: string;
}

// /api/runs/:id/evidence — buildRunEvidence shape (already redacted).
export interface EvidenceRunSummary {
  id: string;
  title: string | null;
  goal: string | null;
  status: RunStatus;
  model: string | null;
  provider_route: string | null;
  conversation_id: string | null;
  scope_id: string | null;
  risk_level: string | null;
  started_at: string | null;
  ended_at: string | null;
  summary: string | null;
  notes: string | null;
}

export interface EvidenceScope {
  id: string;
  name?: string;
  allowed_actions?: string[];
  blocked_actions?: string[];
  targets?: ScopeTargets;
  expires_at?: string | null;
}

export interface EvidenceFinding {
  id?: string;
  title: string | null;
  severity: string | null;
  status: string | null;
}

export interface EvidenceArtifactRow {
  id: string;
  title: string | null;
  type: string | null;
  mime_type?: string | null;
  created_at?: string | null;
}

export interface EvidenceSummary {
  eventCount: number;
  toolCalls: number;
  blockedCount: number;
  findingCount: number;
  artifactCount: number;
  errorCount: number;
}

export interface EvidenceBundle {
  run: EvidenceRunSummary;
  scope: EvidenceScope | null;
  promptSnapshot: Record<string, unknown> | null;
  artifacts: EvidenceArtifactRow[];
  findings: EvidenceFinding[];
  events: TraceEvent[] | null;
  summary: EvidenceSummary;
  generatedAt: string;
}

// /api/artifacts — public-shape rows from artifactToPublic().
export interface ArtifactRecord {
  id: string;
  runId: string | null;
  conversationId: string | null;
  type: string | null;
  title: string | null;
  mimeType: string | null;
  createdAt: string | null;
  publishedAt: string | null;
  contentUrl: string;
  downloadUrl: string;
  metadata?: Record<string, unknown>;
}

// Operator-friendly artifact filter buckets — maps to the existing
// `type` column values in the database.
export type ArtifactFilter = 'all' | 'reports' | 'evidence' | 'trace' | 'other';

// Aliased re-export for the mega-plan deliverables — keeps the public
// surface name `RunSummary` while reusing the existing EvidenceSummary
// shape (event/tool/finding/artifact counts).
export type RunSummary = EvidenceSummary;

// ── Onboarding (A1 + A8.4 React port) ────────────────────────────────
//
// /api/onboarding/checklist returns the 5-item readiness checklist
// derived in server/onboarding/onboarding-status.js.
export interface OnboardingItems {
  toolpacksInstalled: boolean;
  hasAsset: boolean;
  hasScope: boolean;
  hasRun: boolean;
  demoLoaded: boolean;
}

export interface OnboardingChecklist {
  checklist: OnboardingItems;
  complete: boolean;
}

// Each onboarding checklist row presented on the standalone page +
// Dash widget. `id` matches a key on OnboardingItems.
export interface OnboardingItem {
  id: keyof OnboardingItems;
  title: string;
  help: string;
  ctaLabel: string;
  ctaRoute?: string;       // legacy hash route; React maps to /react/<route>
  ctaAction?: 'load-demo'; // mutation-driven CTAs
}

// ── Approvals (A3 explained shape) ───────────────────────────────────

export type ApprovalType = 'scope' | 'install' | 'registry' | 'elevated';
export type ApprovalStatus = 'pending' | 'approved' | 'denied';

// EXPLAINED shape produced by server/approvals/explain.js. The raw
// upstream record is preserved verbatim under `rawDetails`.
export interface ApprovalRecord {
  id: string;
  type: ApprovalType;
  target: string;
  riskClass: string;
  actionClass: string;
  policyReason: string;
  expectedEffect: string;
  sideEffects: string[];
  rawDetails: Record<string, unknown> | unknown;
  createdAt: string | null;
  status: ApprovalStatus;
  denialReason: string | null;
}

// Decision-audit row returned by /api/approvals (under `events`). Used
// by the Dash "Policy decisions 24h" card.
export interface ApprovalEvent {
  id: string;
  decision: 'granted' | 'denied' | 'allow-once' | 'override' | 'timeout' | string;
  toolName: string | null;
  risk: string | null;
  scopeId: string | null;
  scopeName: string | null;
  reason: string | null;
  operatorNote: string | null;
  runId: string | null;
  runTitle: string | null;
  occurredAt: string;
  args: unknown;
  gate?: string;
  policyMode?: string;
}

export interface ApprovalsListResponse {
  count: number;
  events: ApprovalEvent[];
  explained: ApprovalRecord[];
}

// Pending install-request row returned by /api/installer/requests with
// explained=1. Only the fields the Approvals page reads.
export interface InstallRequest {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
  toolIds: string[];
  plan: Array<{ id?: string; backend?: string; command?: string; args?: string[]; reason?: string }>;
  requested_at: string | null;
  denial_reason?: string | null;
}

export interface InstallRequestsResponse {
  requests: InstallRequest[];
  explained: ApprovalRecord[];
}

// ── Findings (A7 + A8.4 React port) ──────────────────────────────────

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info' | string;
export type FindingTriageStatus =
  | 'new'
  | 'acknowledged'
  | 'in_progress'
  | 'dismissed'
  | 'closed';

// `getFindings` row from server/assets/asset-store.js. `metadata` may
// arrive as a JSON string from SQLite; consumers should pre-parse.
export interface FindingRecord {
  id: string;
  title: string;
  description: string | null;
  severity: FindingSeverity;
  status: string;
  assetId: string | null;
  serviceId?: string | null;
  runId: string | null;
  traceEventId?: string | null;
  scopeId?: string | null;
  recommendation: string | null;
  evidence: unknown;
  metadata: Record<string, unknown> | string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  fixed_at: string | null;
  triage_status?: FindingTriageStatus | null;
  dismissal_note?: string | null;
}

// /api/findings/:id/history — read-only lifecycle reconstruction. Mirrors
// `getFindingHistory` in server/assets/asset-store.js: the finding's own
// timestamps + triage state joined with the originating run's trace_events.
export type FindingHistoryEventKind =
  | 'detected'
  | 'trace'
  | 'updated'
  | 'fixed'
  | 'triage';

export interface FindingHistoryEvent {
  kind: FindingHistoryEventKind;
  label: string;
  at: string | null;
  detail?: string;
  eventType?: string;
  seq?: number;
  isOrigin?: boolean;
  dismissalNote?: string | null;
}

export interface FindingHistory {
  findingId: string;
  runId: string | null;
  traceEventId: string | null;
  scopeId: string | null;
  severity: FindingSeverity;
  triageStatus: FindingTriageStatus | string;
  dismissalNote: string | null;
  events: FindingHistoryEvent[];
}

// ── Dash hero (A5 next-action cascade, ported from dash-hero.js) ─────

export type DashHeroTone = 'crit' | 'cy' | 'warn' | 'ok';

export interface DashHeroAction {
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaRoute?: string;
  ctaScroll?: string;
  tone: DashHeroTone;
}

// localStorage payload for the "Continue where you left off" pill.
export interface ContinueWhereLeftOff {
  kind: 'conversation' | 'campaign' | 'run';
  id: string;
  label: string;
  route?: string;
}
