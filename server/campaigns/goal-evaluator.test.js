import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGoal, summarizeRunForEvaluator } from './goal-evaluator.js';

const baseBudget = {
  maxChildRuns: 5,
  maxAttemptsPerGoal: 2,
};
const baseRisk = {
  pauseOnNewFinding: true,
  pauseOnApprovalRequired: true,
};

describe('goal evaluator', () => {
  test('blocked tool call → needs_approval with approvalRequest payload', () => {
    const result = evaluateGoal({
      goal: { attempt_count: 0 },
      runSummary: {
        run: { status: 'completed' },
        blockedEvents: [{ toolName: 'execute_command', riskClass: 'exploit', reason: 'out of scope', target: 'evil.example.com' }],
      },
      riskBudget: baseRisk,
      runBudget: baseBudget,
    });
    assert.strictEqual(result.decision, 'needs_approval');
    assert.strictEqual(result.approvalRequest.riskClass, 'exploit');
    assert.strictEqual(result.approvalRequest.target, 'evil.example.com');
    assert.ok(result.confidence >= 0.8);
  });

  test('new finding with pauseOnNewFinding=true → pause', () => {
    const result = evaluateGoal({
      goal: { attempt_count: 0 },
      runSummary: {
        run: { status: 'completed' },
        findings: [{ id: 'f1', severity: 'high' }],
        artifacts: [{ id: 'a1', type: 'html' }],
      },
      riskBudget: { ...baseRisk, pauseOnNewFinding: true },
      runBudget: baseBudget,
    });
    assert.strictEqual(result.decision, 'pause');
    assert.strictEqual(result.stopReason, 'new-finding');
    assert.ok(result.evidence.includes('finding:f1'));
    assert.ok(result.evidence.includes('artifact:a1'));
  });

  test('new finding with pauseOnNewFinding=false → complete', () => {
    const result = evaluateGoal({
      goal: { attempt_count: 0 },
      runSummary: {
        run: { status: 'completed' },
        findings: [{ id: 'f1', severity: 'medium' }],
      },
      riskBudget: { ...baseRisk, pauseOnNewFinding: false },
      runBudget: baseBudget,
    });
    assert.strictEqual(result.decision, 'complete');
  });

  test('budget exhausted (maxChildRuns) → pause', () => {
    const result = evaluateGoal({
      goal: { attempt_count: 0 },
      runSummary: { run: { status: 'completed' } },
      riskBudget: baseRisk,
      runBudget: { ...baseBudget, maxChildRuns: 2 },
      totalRunsSoFar: 2,
    });
    assert.strictEqual(result.decision, 'pause');
    assert.strictEqual(result.stopReason, 'max-child-runs');
  });

  test('exhausted attempts with no progress → fail', () => {
    const result = evaluateGoal({
      goal: { attempt_count: 1 },
      runSummary: { run: { status: 'completed' }, toolCalls: { total: 3 } },
      riskBudget: baseRisk,
      runBudget: { ...baseBudget, maxAttemptsPerGoal: 2 },
    });
    assert.strictEqual(result.decision, 'fail');
    assert.strictEqual(result.stopReason, 'max-attempts-no-progress');
  });

  test('run failure with attempts remaining → retry', () => {
    const result = evaluateGoal({
      goal: { attempt_count: 0 },
      runSummary: {
        run: { status: 'failed' },
        errors: [{ tool: 'execute_command', preview: 'segfault' }],
      },
      riskBudget: baseRisk,
      runBudget: { ...baseBudget, maxAttemptsPerGoal: 3 },
    });
    assert.strictEqual(result.decision, 'retry');
  });

  test('artifacts but no findings → complete with low confidence', () => {
    const result = evaluateGoal({
      goal: { attempt_count: 0 },
      runSummary: {
        run: { status: 'completed' },
        artifacts: [{ id: 'art-1', type: 'json' }, { id: 'art-2', type: 'markdown' }],
      },
      riskBudget: baseRisk,
      runBudget: baseBudget,
    });
    assert.strictEqual(result.decision, 'complete');
    assert.strictEqual(result.evidence.length, 2);
    assert.ok(result.confidence <= 0.65);
  });

  test('no progress, attempts remaining → retry', () => {
    const result = evaluateGoal({
      goal: { attempt_count: 0 },
      runSummary: { run: { status: 'completed' }, toolCalls: { total: 1 } },
      riskBudget: baseRisk,
      runBudget: { ...baseBudget, maxAttemptsPerGoal: 3 },
    });
    assert.strictEqual(result.decision, 'retry');
  });

  test('missing runSummary → fail', () => {
    const result = evaluateGoal({ goal: { attempt_count: 0 } });
    assert.strictEqual(result.decision, 'fail');
    assert.strictEqual(result.stopReason, 'missing-run-summary');
  });

  test('summarizeRunForEvaluator: counts tool call types and extracts blocked metadata', () => {
    const events = [
      { type: 'tool.call.started', tool_name: 'execute_command' },
      { type: 'tool.call.completed', tool_name: 'execute_command' },
      { type: 'tool.call.started', tool_name: 'web_request' },
      { type: 'tool.call.failed', tool_name: 'web_request', output_preview: 'timeout' },
      { type: 'tool.call.blocked', tool_name: 'execute_command',
        metadata: { risk: 'destructive', reason: 'denied by scope', target: 'prod.example.com' } },
    ];
    const summary = summarizeRunForEvaluator({
      run: { id: 'r1', status: 'completed' },
      events,
      artifacts: [{ id: 'a1', type: 'json' }],
      findings: [],
    });
    assert.strictEqual(summary.toolCalls.total, 2);
    assert.strictEqual(summary.toolCalls.succeeded, 1);
    assert.strictEqual(summary.toolCalls.failed, 1);
    assert.strictEqual(summary.toolCalls.blocked, 1);
    assert.strictEqual(summary.blockedEvents[0].riskClass, 'destructive');
    assert.strictEqual(summary.errors[0].tool, 'web_request');
  });
});
