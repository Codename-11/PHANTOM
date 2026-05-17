export function renderPentestReport(run, events = [], artifacts = []) {
  return `# PHANTOM Pentest Report — ${run.title || run.id}

## Run Metadata

- **Run ID:** ${run.id}
- **Conversation ID:** ${run.conversation_id || '—'}
- **Status:** ${run.status || 'unknown'}
- **Model:** ${run.model || '—'}
- **Route:** ${run.provider_route || '—'}
- **Started:** ${run.started_at || '—'}
- **Ended:** ${run.ended_at || '—'}

## Goal

${run.goal || 'No goal recorded.'}

## Summary

${run.summary || 'No summary recorded.'}

## Evidence Artifacts

${artifacts.length ? artifacts.map(a => `- ${a.title} (${a.type}, ${a.mime_type}) — ${a.id}`).join('\n') : 'No artifacts recorded.'}

## Trace Timeline

${events.length ? events.map(event => `### #${event.seq} ${event.type}\n\n- **Phase:** ${event.phase || 'general'}\n- **Status:** ${event.status || 'unknown'}${event.tool_name ? `\n- **Tool:** ${event.tool_name}` : ''}\n\n${event.output_preview ? '```\n' + event.output_preview + '\n```' : '_No output preview recorded._'}`).join('\n\n') : 'No trace events recorded.'}
`;
}

export function renderExecutiveSummary(run, events = [], artifacts = []) {
  const toolEvents = events.filter(event => event.type?.startsWith('tool.'));
  const errors = events.filter(event => event.status === 'failed' || event.type?.includes('error'));
  return `# Executive Summary — ${run.title || run.id}

PHANTOM completed run \`${run.id}\` with status **${run.status || 'unknown'}**.

## Objective

${run.goal || 'No objective recorded.'}

## Outcome

${run.summary || 'No run summary recorded.'}

## Activity Snapshot

- Trace events: ${events.length}
- Tool-related events: ${toolEvents.length}
- Artifacts captured: ${artifacts.length}
- Errors/failures: ${errors.length}

## Notable Outputs

${artifacts.length ? artifacts.slice(0, 10).map(a => `- ${a.title} (${a.type})`).join('\n') : 'No durable outputs were captured.'}

## Follow-up Notes

Review the full pentest report and evidence bundle before sharing externally.
`;
}
