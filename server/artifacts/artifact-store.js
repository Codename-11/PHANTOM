import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import AdmZip from 'adm-zip';
import config from '../config.js';
import { createArtifact, getArtifactsForRun, getTraceEvents } from '../memory/store.js';

function sanitizeFilename(value, fallback = 'artifact') {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80) || fallback;
}

function normalizeExtension(extension, mimeType = '') {
  if (extension) return extension.startsWith('.') ? extension : `.${extension}`;
  if (mimeType === 'text/html') return '.html';
  if (mimeType === 'text/markdown') return '.md';
  if (mimeType === 'application/json') return '.json';
  if (mimeType === 'text/plain') return '.txt';
  return '.bin';
}

export function getRunDirectory(runId) {
  if (!runId) throw new Error('runId is required');
  return join(config.workspace, 'runs', runId);
}

export function ensureRunDirectory(runId) {
  const dir = getRunDirectory(runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureArtifactsDirectory(runId) {
  const dir = join(ensureRunDirectory(runId), 'artifacts');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeArtifact({
  runId,
  conversationId = null,
  type,
  title,
  mimeType,
  extension,
  content,
  metadata = {},
}) {
  const ext = normalizeExtension(extension, mimeType);
  const dir = ensureArtifactsDirectory(runId);
  const idPrefix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const filename = `${idPrefix}-${sanitizeFilename(title)}${ext}`;
  const filePath = join(dir, filename);
  writeFileSync(filePath, content ?? '', 'utf8');

  return createArtifact({
    runId,
    conversationId,
    type,
    title,
    mimeType,
    path: filePath,
    metadata,
  });
}

export function writeBinaryArtifact({
  runId,
  conversationId = null,
  type,
  title,
  mimeType,
  extension,
  content,
  metadata = {},
}) {
  const ext = normalizeExtension(extension, mimeType);
  const dir = ensureArtifactsDirectory(runId);
  const idPrefix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const filename = `${idPrefix}-${sanitizeFilename(title)}${ext}`;
  const filePath = join(dir, filename);
  writeFileSync(filePath, content);

  return createArtifact({
    runId,
    conversationId,
    type,
    title,
    mimeType,
    path: filePath,
    metadata,
  });
}

export function exportRunTrace(runId, conversationId = null) {
  const dir = ensureRunDirectory(runId);
  const tracePath = join(dir, 'trace.jsonl');
  const events = getTraceEvents(runId, { limit: 2000 });
  const jsonl = events.map(event => JSON.stringify(event)).join('\n') + (events.length ? '\n' : '');
  writeFileSync(tracePath, jsonl, 'utf8');

  return createArtifact({
    runId,
    conversationId,
    type: 'jsonl',
    title: 'Trace log',
    mimeType: 'application/x-ndjson',
    path: tracePath,
    metadata: {
      source: 'trace_export',
      eventCount: events.length,
    },
  });
}

export function writePreviewArtifact({ runId, conversationId, title = 'Preview', htmlContent, traceEventId = null }) {
  return writeArtifact({
    runId,
    conversationId,
    type: 'html',
    title,
    mimeType: 'text/html',
    extension: '.html',
    content: htmlContent,
    metadata: {
      source: 'show_preview_window',
      traceEventId,
    },
  });
}

export function exportEvidenceBundle(run, events = getTraceEvents(run.id, { limit: 2000 }), artifacts = getArtifactsForRun(run.id)) {
  const zip = new AdmZip();
  zip.addFile('run.json', Buffer.from(JSON.stringify(run, null, 2), 'utf8'));
  zip.addFile('trace.jsonl', Buffer.from(events.map(event => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''), 'utf8'));
  zip.addFile('artifacts.json', Buffer.from(JSON.stringify(artifacts.map(({ path, ...artifact }) => artifact), null, 2), 'utf8'));
  artifacts.forEach((artifact) => {
    if (!artifact.path || artifact.type === 'evidence') return;
    try {
      zip.addLocalFile(artifact.path, 'files');
    } catch {
      // Skip missing or inaccessible files; metadata remains in artifacts.json.
    }
  });

  return writeBinaryArtifact({
    runId: run.id,
    conversationId: run.conversation_id,
    type: 'evidence',
    title: 'Evidence bundle',
    mimeType: 'application/zip',
    extension: '.zip',
    content: zip.toBuffer(),
    metadata: {
      source: 'evidence_bundle',
      eventCount: events.length,
      artifactCount: artifacts.length,
    },
  });
}
