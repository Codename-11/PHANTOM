import { getRun, getTraceEvents, getArtifactsForRun } from '../memory/store.js';
import { artifactToPublic } from '../artifacts/renderers.js';
import { deriveRunGraph } from '../graph/graph-derive.js';

const TOOL_NAME_MAP = {
  execute_command: 'Shell command',
  python_execute: 'Python execution',
  web_request: 'Web request',
  show_preview_window: 'Preview window',
  read_file: 'Read file',
  write_file: 'Write file',
  search_files: 'Search files',
  create_artifact: 'Create artifact',
};

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function formatToolName(name) {
  const key = String(name || '').trim();
  if (!key) return 'Tool call';
  return TOOL_NAME_MAP[key] || titleCase(key);
}

function terminalStatus(event) {
  if (event.type === 'tool.call.blocked') return 'blocked';
  if (event.type === 'tool.call.failed' || event.status === 'failed') return 'failed';
  if (event.type === 'tool.call.completed' || event.status === 'completed') return 'completed';
  if (event.type === 'tool.call.started' || event.status === 'started') return 'started';
  return event.status || 'observed';
}

function summarizeToolCalls(events) {
  const calls = new Map();
  for (const event of events) {
    if (!event.type?.startsWith('tool.call')) continue;
    const key = event.metadata?.toolCallId || event.parent_event_id || event.id || `${event.tool_name}:${event.seq}`;
    const current = calls.get(key) || {
      toolCallId: key,
      name: event.tool_name,
      displayName: formatToolName(event.tool_name),
      startSeq: null,
      finishSeq: null,
      status: 'unknown',
      blocked: false,
      failed: false,
    };
    current.name = current.name || event.tool_name;
    current.displayName = current.displayName || formatToolName(event.tool_name);
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

function graphNodeIdsForEvent(graph, event) {
  const ids = new Set();
  const toolCallId = event.metadata?.toolCallId;
  for (const node of graph.nodes || []) {
    const metadata = node.metadata || {};
    const directMatch = node.refId === event.id
      || metadata.eventId === event.id
      || metadata.sourceEventId === event.id;
    const toolMatch = toolCallId && metadata.toolCallId === toolCallId;
    if (directMatch || toolMatch) ids.add(node.id);
  }
  if (event.type?.startsWith('run.')) ids.add(`run:${event.run_id}`);
  return Array.from(ids);
}

function primaryNodeIdForStep(graph, event, nodeIds) {
  const toolCallId = event.metadata?.toolCallId;
  if (toolCallId) {
    const toolNode = (graph.nodes || []).find(node => node.type === 'tool' && node.metadata?.toolCallId === toolCallId);
    if (toolNode) return toolNode.id;
  }
  const exact = (graph.nodes || []).find(node => node.refId === event.id || node.metadata?.eventId === event.id);
  if (exact) return exact.id;
  if (event.type?.startsWith('run.')) return `run:${event.run_id}`;
  return nodeIds[0] || `run:${event.run_id}`;
}

function artifactsForEvent(artifacts, event) {
  return artifacts.filter((artifact) => {
    const metadata = artifact.metadata || {};
    return metadata.traceEventId === event.id || metadata.artifactId === artifact.id || event.metadata?.artifactId === artifact.id;
  });
}

function titleForEvent(event) {
  if (event.type?.startsWith('tool.call')) {
    return `${formatToolName(event.tool_name)} ${terminalStatus(event)}`;
  }
  if (event.type === 'artifact.created') return 'Artifact created';
  if (event.type?.startsWith('run.')) return titleCase(event.type.replace('.', ' '));
  return titleCase(event.type || 'trace event');
}

function explanationForEvent(event) {
  const decision = event.metadata?.decision;
  if (decision?.allowed === false) return decision.reason || event.output_preview || 'Blocked by policy';
  if (event.output_preview) return event.output_preview;
  if (event.type === 'tool.call.started') return 'Tool execution started.';
  if (event.type === 'run.started') return 'Run started.';
  if (event.type === 'run.completed') return 'Run completed.';
  return event.phase ? `Phase: ${event.phase}` : 'Trace event recorded.';
}

function buildReplaySteps({ events, artifacts, graph }) {
  return events.map((event) => {
    const nodeIds = graphNodeIdsForEvent(graph, event);
    const status = terminalStatus(event);
    const eventArtifacts = artifactsForEvent(artifacts, event);
    return {
      seq: event.seq,
      eventId: event.id,
      type: event.type,
      phase: event.phase,
      status,
      title: titleForEvent(event),
      toolName: event.tool_name || null,
      toolDisplayName: event.tool_name ? formatToolName(event.tool_name) : null,
      primaryNodeId: primaryNodeIdForStep(graph, event, nodeIds),
      nodeIds,
      edgeIds: (graph.edges || [])
        .filter(edge => edge.eventId === event.id || eventArtifacts.some(artifact => edge.artifactId === artifact.id))
        .map(edge => edge.id),
      input: event.input || null,
      outputPreview: event.output_preview || '',
      policy: event.metadata?.decision || null,
      risk: event.metadata?.risk || event.metadata?.decision?.risk || null,
      explanation: explanationForEvent(event),
      artifacts: eventArtifacts,
      durationMs: event.duration_ms ?? event.durationMs ?? null,
      occurredAt: event.created_at,
    };
  });
}

function summarizeReplay({ run, events, artifacts, graph }) {
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
    steps: buildReplaySteps({ events, artifacts, graph }),
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
    replay: summarizeReplay({ run, events, artifacts, graph }),
  };
}

export const replayPresentation = {
  formatToolName,
  buildReplaySteps,
};
