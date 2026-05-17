export function artifactToPublic(artifact, { includeMetadata = false } = {}) {
  if (!artifact) return null;
  const publicArtifact = {
    id: artifact.id,
    runId: artifact.run_id,
    conversationId: artifact.conversation_id,
    type: artifact.type,
    title: artifact.title,
    mimeType: artifact.mime_type,
    createdAt: artifact.created_at,
    publishedAt: artifact.published_at,
    contentUrl: `/api/artifacts/${artifact.id}/content`,
    downloadUrl: `/api/artifacts/${artifact.id}/download`,
  };

  if (includeMetadata) {
    publicArtifact.metadata = redactMetadata(artifact.metadata || {});
  }

  return publicArtifact;
}

export function redactMetadata(metadata) {
  const blocked = new Set(['secret', 'apiKey', 'api_key', 'password', 'token', 'authorization']);
  const output = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (blocked.has(key) || /secret|password|token|api[_-]?key|authorization/i.test(key)) continue;
    output[key] = value;
  }
  return output;
}
