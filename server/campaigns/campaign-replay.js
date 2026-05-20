// Campaign replay + evidence bundle (Task 9).
//
// A "campaign replay" is the cross-run reviewable equivalent of a single
// run's replay: campaign metadata + every goal + every linked child run's
// trace/artifact/finding rollup + the evaluator verdicts + budget summary.
//
// Two export shapes:
//   - generateCampaignReport(campaignId) → markdown artifact (operator-readable)
//   - generateCampaignEvidenceBundle(campaignId) → zip with one folder per
//     child run (trace.jsonl + artifacts.json + raw files) + a top-level
//     campaign.json + report.md so the bundle is self-describing.
//
// Storage convention: both artifacts attach to the FIRST linked child run
// (so they appear in the existing artifacts index) with metadata.source
// set to 'campaign_report' / 'campaign_evidence_bundle' and a campaignId
// pointer. If there are no child runs yet (operator clicked too early)
// both functions throw a clear error rather than creating a phantom run.

import AdmZip from 'adm-zip';
import {
  getCampaign, listCampaignGoals, listCampaignRuns, countCampaignRuns,
} from './campaign-store.js';
import {
  getRun, getTraceEvents,
} from '../memory/store.js';
import { getArtifactsForRun } from '../memory/store.js';
import { getFindings } from '../assets/asset-store.js';
import { writeArtifact, writeBinaryArtifact } from '../artifacts/artifact-store.js';

const EVENT_LIMIT_PER_RUN = 2000;

/**
 * Build the replay bundle in memory — the same shape the detail page
 * reads. Pure data fetch + roll-up; no artifacts written.
 *
 * @returns {{
 *   campaign, goals: [], runs: [{ run, goal, link, events, artifacts, findings, blockedCount, evaluator }],
 *   summary: { totalRuns, totalFindings, totalArtifacts, totalBlocked, budgetUsed }
 * }}
 */
export function buildCampaignReplay(campaignId) {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error(`campaign not found: ${campaignId}`);

  const goals = listCampaignGoals(campaignId);
  const goalById = new Map(goals.map((g) => [g.id, g]));

  const links = listCampaignRuns(campaignId);
  const runs = [];
  let totalFindings = 0;
  let totalArtifacts = 0;
  let totalBlocked = 0;

  for (const link of links) {
    const run = getRun(link.run_id);
    if (!run) continue;
    const events = getTraceEvents(link.run_id, { limit: EVENT_LIMIT_PER_RUN });
    const artifacts = getArtifactsForRun(link.run_id) || [];
    let findings = [];
    try { findings = getFindings({ runId: link.run_id, limit: 200 }) || []; }
    catch { findings = []; }
    const blockedCount = events.filter((ev) => ev.type === 'tool.call.blocked').length;

    totalFindings += findings.length;
    totalArtifacts += artifacts.length;
    totalBlocked += blockedCount;

    const goal = goalById.get(link.goal_id) || null;
    runs.push({
      run, goal, link, events, artifacts, findings, blockedCount,
      evaluator: goal?.evaluator_result || null,
    });
  }

  return {
    campaign,
    goals,
    runs,
    summary: {
      totalRuns: countCampaignRuns(campaignId),
      totalFindings,
      totalArtifacts,
      totalBlocked,
      budgetUsed: {
        runs: countCampaignRuns(campaignId),
        maxRuns: campaign.run_budget?.maxChildRuns ?? 10,
      },
    },
  };
}

/**
 * Render the bundle into a markdown report. Pure string output — caller
 * decides where to persist it.
 */
export function renderCampaignMarkdownReport(replay) {
  const { campaign, goals, runs, summary } = replay;
  const lines = [];
  lines.push(`# Campaign: ${campaign.title}`);
  lines.push('');
  lines.push(`> ${campaign.objective}`);
  lines.push('');
  lines.push('## Header');
  lines.push('');
  lines.push(`- **ID:** \`${campaign.id}\``);
  lines.push(`- **Status:** ${campaign.status}`);
  lines.push(`- **Worker backend:** ${campaign.worker_backend}`);
  lines.push(`- **Scope:** ${campaign.scope_id || '—'}`);
  lines.push(`- **Toolpacks:** ${(campaign.toolpack_ids || []).join(', ') || '—'}`);
  lines.push(`- **Started:** ${campaign.started_at || '—'}`);
  lines.push(`- **Ended:** ${campaign.ended_at || '—'}`);
  lines.push('');
  lines.push('## Budget');
  lines.push('');
  const rb = campaign.run_budget || {};
  const risk = campaign.risk_budget || {};
  lines.push(`- **Runs:** ${summary.budgetUsed.runs} / ${summary.budgetUsed.maxRuns}`);
  lines.push(`- **Attempts/goal cap:** ${rb.maxAttemptsPerGoal ?? '—'}`);
  lines.push(`- **Wall-clock cap (min):** ${rb.maxWallClockMinutes ?? '—'}`);
  lines.push(`- **Allowed risk classes:** ${(risk.allowedRiskClasses || []).join(', ') || '—'}`);
  lines.push(`- **Blocked risk classes:** ${(risk.blockedRiskClasses || []).join(', ') || '—'}`);
  lines.push('');
  lines.push('## Roll-up');
  lines.push('');
  lines.push(`- **Findings:** ${summary.totalFindings}`);
  lines.push(`- **Artifacts:** ${summary.totalArtifacts}`);
  lines.push(`- **Blocked actions:** ${summary.totalBlocked}`);
  lines.push('');
  lines.push('## Goals');
  lines.push('');
  if (!goals.length) {
    lines.push('_No goals queued._');
  } else {
    for (const g of goals) {
      lines.push(`### ${g.title}`);
      lines.push('');
      lines.push(`- **Status:** ${g.status}`);
      lines.push(`- **Attempts:** ${g.attempt_count}/${g.max_attempts}`);
      lines.push(`- **Priority:** ${g.priority}`);
      if (g.evaluator_result) {
        lines.push(`- **Evaluator decision:** ${g.evaluator_result.decision}`);
        if (g.evaluator_result.summary) {
          lines.push(`- **Evaluator note:** ${g.evaluator_result.summary}`);
        }
      }
      lines.push('');
      lines.push('> ' + (g.prompt || '').replace(/\n/g, '\n> '));
      lines.push('');
    }
  }
  lines.push('## Child runs');
  lines.push('');
  if (!runs.length) {
    lines.push('_No child runs yet._');
  } else {
    lines.push('| Run | Goal | Status | Findings | Artifacts | Blocked |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const r of runs) {
      lines.push(
        `| \`${r.run.id.slice(0, 8)}\` | ${r.goal?.title || '—'} | ${r.run.status} | ${r.findings.length} | ${r.artifacts.length} | ${r.blockedCount} |`
      );
    }
    lines.push('');
    for (const r of runs) {
      lines.push(`### Run \`${r.run.id}\``);
      lines.push('');
      lines.push(`- **Goal:** ${r.goal?.title || '—'}`);
      lines.push(`- **Status:** ${r.run.status}`);
      lines.push(`- **Started:** ${r.run.started_at || '—'}`);
      lines.push(`- **Ended:** ${r.run.ended_at || '—'}`);
      if (r.evaluator) {
        lines.push(`- **Verdict:** ${r.evaluator.decision} — ${r.evaluator.summary || ''}`);
      }
      if (r.findings.length) {
        lines.push('');
        lines.push('**Findings:**');
        for (const f of r.findings) lines.push(`- \`${f.id}\` · sev=${f.severity || '?'}${f.title ? ' · ' + f.title : ''}`);
      }
      if (r.artifacts.length) {
        lines.push('');
        lines.push('**Artifacts:**');
        for (const a of r.artifacts) lines.push(`- \`${a.id}\` · ${a.type || '?'} · ${a.title || '(untitled)'}`);
      }
      lines.push('');
    }
  }
  lines.push('---');
  lines.push(`_Generated by PHANTOM campaign-replay · ${new Date().toISOString()}_`);
  return lines.join('\n');
}

/**
 * Write the markdown report as an artifact attached to the first linked
 * child run. Throws if the campaign has no runs yet.
 */
export function generateCampaignReport(campaignId) {
  const replay = buildCampaignReplay(campaignId);
  if (!replay.runs.length) {
    throw new Error('Cannot generate a campaign report before any child run exists. Spawn at least one goal first.');
  }
  const host = replay.runs[0].run;
  const md = renderCampaignMarkdownReport(replay);
  return writeArtifact({
    runId: host.id,
    conversationId: host.conversation_id,
    type: 'markdown',
    title: `Campaign report · ${replay.campaign.title}`,
    mimeType: 'text/markdown',
    extension: '.md',
    content: md,
    metadata: {
      source: 'campaign_report',
      campaignId: replay.campaign.id,
      goalCount: replay.goals.length,
      runCount: replay.runs.length,
      findingCount: replay.summary.totalFindings,
      artifactCount: replay.summary.totalArtifacts,
      generatedAt: new Date().toISOString(),
    },
  });
}

/**
 * Build a zip containing per-run evidence subfolders + a top-level
 * campaign.json + report.md. Attaches the resulting binary artifact to
 * the first linked child run, mirroring the report convention.
 */
export function generateCampaignEvidenceBundle(campaignId) {
  const replay = buildCampaignReplay(campaignId);
  if (!replay.runs.length) {
    throw new Error('Cannot build an evidence bundle before any child run exists.');
  }
  const zip = new AdmZip();

  // Top-level descriptors so the bundle is self-explaining.
  zip.addFile(
    'campaign.json',
    Buffer.from(JSON.stringify({
      campaign: replay.campaign,
      goals: replay.goals,
      summary: replay.summary,
      generated_at: new Date().toISOString(),
    }, null, 2), 'utf8')
  );
  zip.addFile('report.md', Buffer.from(renderCampaignMarkdownReport(replay), 'utf8'));

  // Per-run folder: runs/<runId>/{run.json, trace.jsonl, artifacts.json, findings.json, files/}
  for (const r of replay.runs) {
    const base = `runs/${r.run.id}`;
    zip.addFile(`${base}/run.json`, Buffer.from(JSON.stringify(r.run, null, 2), 'utf8'));
    zip.addFile(
      `${base}/trace.jsonl`,
      Buffer.from(r.events.map((e) => JSON.stringify(e)).join('\n') + (r.events.length ? '\n' : ''), 'utf8')
    );
    zip.addFile(
      `${base}/artifacts.json`,
      Buffer.from(JSON.stringify(r.artifacts.map(({ path, ...a }) => a), null, 2), 'utf8')
    );
    zip.addFile(
      `${base}/findings.json`,
      Buffer.from(JSON.stringify(r.findings, null, 2), 'utf8')
    );
    for (const a of r.artifacts) {
      // Skip the prior campaign artifacts (avoid recursive embedding) and
      // any missing files.
      const isCampaignArtifact = a.metadata?.source === 'campaign_report'
        || a.metadata?.source === 'campaign_evidence_bundle';
      if (!a.path || isCampaignArtifact || a.type === 'evidence') continue;
      try { zip.addLocalFile(a.path, `${base}/files`); } catch { /* skip */ }
    }
  }

  const host = replay.runs[0].run;
  return writeBinaryArtifact({
    runId: host.id,
    conversationId: host.conversation_id,
    type: 'evidence',
    title: `Campaign evidence · ${replay.campaign.title}`,
    mimeType: 'application/zip',
    extension: '.zip',
    content: zip.toBuffer(),
    metadata: {
      source: 'campaign_evidence_bundle',
      campaignId: replay.campaign.id,
      runCount: replay.runs.length,
      findingCount: replay.summary.totalFindings,
      artifactCount: replay.summary.totalArtifacts,
      generatedAt: new Date().toISOString(),
    },
  });
}
