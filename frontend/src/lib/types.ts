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

export interface Scope {
  id: string;
  name: string;
}

export interface PromptProfile {
  id: string;
  name: string;
}

export interface Toolpack {
  id: string;
  name?: string;
  risks?: string[];
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
