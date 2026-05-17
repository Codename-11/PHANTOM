import { getRun, getTraceEvents, getArtifactsForRun } from '../memory/store.js';
import { artifactToPublic } from '../artifacts/renderers.js';
import { deriveRunGraph } from '../graph/graph-derive.js';

function summarizeToolCalls(events) {
  const calls = new Map();
  for (const event of events) {
    if (!event.type?.startsWith('tool.call')) continue;
    const key = event.metadata?.toolCallId || event.parent_event_id || event.id || `${event.tool_name}:${event.seq}`;
    const current = calls.get(key) || {
      toolCallId: key,
      name: event.tool_name,
      startSeq: null,
      finishSeq: null,
      status: 'unknown',
      blocked: false,
      failed: false,
    };
    current.name = current.name || event.tool_name;
    if (event.type === 'tool.call.started') {
      current.startSeq = event.seq;
      current.status = 'started';
    }
    if (event.type === 'tool.call.completed') {
      current.finishSeq = event.seq;
      current.status = 'completed';
    }
    if (event.type === 'tool.call.failed') {
      current.finishSeq = event.seq;
      current.status = 'failed';
      current.failed = true;
    }
    if (event.type === 'tool.call.blocked') {
      current.finishSeq = event.seq;
      current.status = 'blocked';
      current.blocked = true;
      current.risk = event.metadata?.risk || event.metadata?.decision?.risk;
      current.reason = event.metadata?.decision?.reason || event.output_preview;
    }
    calls.set(key, current);
  }
  return Array.from(calls.values()).sort((a, b) => (a.startSeq || a.finishSeq || 0) - (b.startSeq || b.finishSeq || 0));
}

function summarizeReplay({ run, events, artifacts }) {
  const sequence = events.map(event => event.seq);
  const toolCalls = summarizeToolCalls(events);
  const hasStarted = events.some(event => event.type === 'run.started');
  const hasTerminal = events.some(event => ['run.completed', 'run.failed', 'run.stopped'].includes(event.type));
  const incompleteToolCalls = toolCalls.filter(call => call.startSeq && !call.finishSeq).length;
  return {
    runId: run.id,
    eventCount: events.length,
    artifactCount: artifacts.length,
    sequence,
    sequenceComplete: sequence.every((seq, index) => seq === index + 1),
    hasRunStarted: hasStarted,
    hasTerminalEvent: hasTerminal,
    complete: hasStarted && hasTerminal && incompleteToolCalls === 0,
    toolCalls,
    incompleteToolCalls,
    blockedActions: toolCalls.filter(call => call.blocked).length,
    failedToolCalls: toolCalls.filter(call => call.failed).length,
  };
}

export function buildRunReplay(runId, { eventLimit = 2000 } = {}) {
  const run = getRun(runId);
  if (!run) return null;
  const events = getTraceEvents(runId, { limit: eventLimit });
  const artifacts = getArtifactsForRun(runId).map(artifact => artifactToPublic(artifact, { includeMetadata: true }));
  const graph = deriveRunGraph({ run, events, artifacts });
  return {
    run,
    events,
    artifacts,
    graph,
    replay: summarizeReplay({ run, events, artifacts }),
  };
}
