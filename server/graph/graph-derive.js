import { createHash } from 'crypto';

function shortHash(value) {
  return createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);
}

function safeText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value, max = 140) {
  const text = safeText(value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLikelyDomain(value) {
  if (!value || value.length > 253) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) return false;
  if (!value.includes('.')) return false;
  if (/^\d+(\.\d+)+$/.test(value)) return false;
  const labels = value.split('.');
  const tld = labels[labels.length - 1];
  if (!/[a-z]/i.test(tld) || /^\d+$/.test(tld)) return false;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value);
}

function addNode(nodes, node) {
  const existing = nodes.get(node.id);
  if (!existing) {
    nodes.set(node.id, {
      status: 'observed',
      ...node,
      metadata: node.metadata || {},
    });
    return nodes.get(node.id);
  }

  const statusPriority = { failed: 5, error: 5, completed: 4, running: 3, started: 2, observed: 1, unknown: 0 };
  const nextStatus = statusPriority[node.status] >= statusPriority[existing.status] ? node.status : existing.status;
  nodes.set(node.id, {
    ...existing,
    ...node,
    status: nextStatus || existing.status,
    metadata: { ...(existing.metadata || {}), ...(node.metadata || {}) },
  });
  return nodes.get(node.id);
}

function addEdge(edges, edge) {
  if (!edge.source || !edge.target || edge.source === edge.target) return;
  const id = edge.id || `${edge.type}:${edge.source}->${edge.target}`;
  if (edges.has(id)) return;
  edges.set(id, { id, ...edge });
}

function extractObservations(text) {
  const observations = [];
  const seen = new Set();

  function push(item) {
    const key = `${item.type}:${item.value}:${item.port || ''}:${item.host || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    observations.push(item);
  }

  const source = safeText(text);
  const urlRegex = /\bhttps?:\/\/[^\s'"<>`),]+/gi;
  for (const match of source.matchAll(urlRegex)) {
    const raw = match[0].replace(/[.,;:!?]+$/g, '');
    const url = parseUrl(raw);
    if (!url) continue;
    push({ type: 'url', value: raw, host: url.hostname, port: url.port || '' });
    if (url.hostname) push({ type: /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) ? 'host' : 'domain', value: url.hostname });
    if (url.port) push({ type: 'port', value: url.port, host: url.hostname });
  }

  const hostPortRegex = /\b((?:\d{1,3}\.){3}\d{1,3}|[a-z0-9][a-z0-9.-]*\.[a-z]{2,})[:\s]+(\d{1,5})\b/gi;
  for (const match of source.matchAll(hostPortRegex)) {
    const host = match[1].toLowerCase();
    const port = match[2];
    if (Number(port) < 1 || Number(port) > 65535) continue;
    push({ type: /^\d+\.\d+\.\d+\.\d+$/.test(host) ? 'host' : 'domain', value: host });
    push({ type: 'port', value: port, host });
  }

  const ipRegex = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
  for (const match of source.matchAll(ipRegex)) {
    push({ type: 'host', value: match[0] });
  }

  const domainRegex = /\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b/gi;
  for (const match of source.matchAll(domainRegex)) {
    const domain = match[0].toLowerCase();
    if (isLikelyDomain(domain)) push({ type: 'domain', value: domain });
  }

  return observations;
}

function observationNodeId(observation) {
  if (observation.type === 'port') {
    return observation.host ? `port:${observation.host}:${observation.value}` : `port:${observation.value}`;
  }
  return `${observation.type === 'domain' ? 'host' : observation.type}:${observation.value}`;
}

function addObservation(nodes, edges, sourceNodeId, observation, event = null) {
  const nodeType = observation.type === 'domain' ? 'host' : observation.type;
  const nodeId = observationNodeId(observation);
  addNode(nodes, {
    id: nodeId,
    type: nodeType,
    label: observation.value,
    status: 'observed',
    refId: observation.value,
    metadata: {
      host: observation.host,
      sourceEventId: event?.id,
      sourceSeq: event?.seq,
    },
  });
  addEdge(edges, {
    type: 'observed',
    source: sourceNodeId,
    target: nodeId,
    label: 'observed',
    eventId: event?.id,
  });

  if (observation.type === 'url' && observation.host) {
    const hostNodeId = `host:${observation.host}`;
    addNode(nodes, {
      id: hostNodeId,
      type: 'host',
      label: observation.host,
      status: 'observed',
      refId: observation.host,
      metadata: { sourceEventId: event?.id, sourceSeq: event?.seq },
    });
    addEdge(edges, {
      type: 'connected_to',
      source: nodeId,
      target: hostNodeId,
      label: 'host',
      eventId: event?.id,
    });
  }

  if (observation.type === 'port' && observation.host) {
    const hostNodeId = `host:${observation.host}`;
    addNode(nodes, {
      id: hostNodeId,
      type: 'host',
      label: observation.host,
      status: 'observed',
      refId: observation.host,
      metadata: { sourceEventId: event?.id, sourceSeq: event?.seq },
    });
    addEdge(edges, {
      type: 'connected_to',
      source: hostNodeId,
      target: nodeId,
      label: 'port',
      eventId: event?.id,
    });
  }
}

function eventStatus(event) {
  if (event.status === 'failed' || event.type?.includes('error') || event.type?.includes('failed')) return 'failed';
  if (event.status === 'completed' || event.type?.endsWith('.completed')) return 'completed';
  if (event.status === 'started' || event.type?.endsWith('.started')) return 'started';
  return event.status || 'observed';
}

function toolKeyForEvent(event) {
  return event?.metadata?.toolCallId || event?.id || `${event?.tool_name || 'tool'}:${event?.seq || shortHash(safeText(event))}`;
}

export function deriveRunGraph({ run, events = [], artifacts = [] }) {
  if (!run?.id) throw new Error('run is required');

  const nodes = new Map();
  const edges = new Map();
  const eventSourceNode = new Map();
  const toolCallNodes = new Map();
  const runNodeId = `run:${run.id}`;

  addNode(nodes, {
    id: runNodeId,
    type: 'run',
    label: run.title || run.goal || run.id,
    status: run.status || 'unknown',
    refId: run.id,
    metadata: {
      goal: run.goal,
      model: run.model,
      providerRoute: run.provider_route,
      startedAt: run.started_at,
      endedAt: run.ended_at,
    },
  });

  for (const event of events) {
    let sourceNodeId = runNodeId;

    if (event.type?.startsWith('tool.call')) {
      const toolKey = toolKeyForEvent(event);
      const toolNodeId = `tool:${toolKey}`;
      toolCallNodes.set(toolKey, toolNodeId);
      addNode(nodes, {
        id: toolNodeId,
        type: 'tool',
        label: event.tool_name || 'tool',
        status: eventStatus(event),
        seq: event.seq,
        refId: event.id,
        metadata: {
          eventId: event.id,
          toolCallId: event.metadata?.toolCallId,
          input: event.input,
          outputPreview: event.output_preview,
          phase: event.phase,
        },
      });
      addEdge(edges, {
        type: 'called',
        source: runNodeId,
        target: toolNodeId,
        label: event.tool_name || 'tool',
        eventId: event.id,
      });
      sourceNodeId = toolNodeId;

      const command = event.input?.command || event.input?.cmd || event.input?.query || event.input?.url;
      if (command) {
        const commandNodeId = `command:${shortHash(command)}`;
        addNode(nodes, {
          id: commandNodeId,
          type: 'command',
          label: truncate(command, 96),
          status: eventStatus(event),
          refId: event.id,
          metadata: { eventId: event.id, fullCommand: command },
        });
        addEdge(edges, {
          type: 'called',
          source: toolNodeId,
          target: commandNodeId,
          label: 'command',
          eventId: event.id,
        });
        sourceNodeId = commandNodeId;
      }
    } else if (event.type?.startsWith('run.')) {
      sourceNodeId = runNodeId;
    } else if (event.type?.includes('error') || event.status === 'failed') {
      const errorNodeId = `error:${event.id || event.seq}`;
      addNode(nodes, {
        id: errorNodeId,
        type: 'error',
        label: truncate(event.output_preview || event.type || 'Error'),
        status: 'failed',
        refId: event.id,
        metadata: { eventId: event.id, seq: event.seq },
      });
      addEdge(edges, { type: 'blocked_by', source: runNodeId, target: errorNodeId, label: 'error', eventId: event.id });
      sourceNodeId = errorNodeId;
    }

    eventSourceNode.set(event.id, sourceNodeId);
    const observationText = [event.input, event.output_preview, event.metadata].map(safeText).filter(Boolean).join('\n');
    for (const observation of extractObservations(observationText)) {
      addObservation(nodes, edges, sourceNodeId, observation, event);
    }
  }

  for (const artifact of artifacts) {
    const artifactNodeId = `artifact:${artifact.id}`;
    addNode(nodes, {
      id: artifactNodeId,
      type: 'artifact',
      label: artifact.title || artifact.id,
      status: 'completed',
      refId: artifact.id,
      metadata: {
        type: artifact.type,
        mimeType: artifact.mime_type || artifact.mimeType,
        contentUrl: artifact.contentUrl,
        downloadUrl: artifact.downloadUrl,
        source: artifact.metadata?.source,
        traceEventId: artifact.metadata?.traceEventId,
      },
    });

    const traceEventId = artifact.metadata?.traceEventId;
    const source = traceEventId && eventSourceNode.has(traceEventId) ? eventSourceNode.get(traceEventId) : runNodeId;
    addEdge(edges, {
      type: 'generated',
      source,
      target: artifactNodeId,
      label: 'artifact',
      artifactId: artifact.id,
    });

    for (const observation of extractObservations(`${artifact.title || ''}\n${safeText(artifact.metadata)}`)) {
      addObservation(nodes, edges, artifactNodeId, observation, null);
    }
  }

  return {
    runId: run.id,
    generatedAt: new Date().toISOString(),
    stats: {
      nodes: nodes.size,
      edges: edges.size,
      events: events.length,
      artifacts: artifacts.length,
    },
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}
