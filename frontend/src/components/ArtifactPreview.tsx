// ArtifactPreview — right-hand Sheet drawer that previews a selected
// artifact in-page (the parity gap vs. the legacy /artifacts page).
//
// Render strategy comes from previewKind() in lib/artifacts:
//   - 'iframe' → sandboxed <iframe> for html/pdf (untrusted content)
//   - 'image'  → <img src={contentUrl}>
//   - 'text'   → fetch the body and show it in a <pre>
//
// SECURITY: artifact content is operator-supplied / tool-generated and is
// treated as hostile. The iframe carries an explicit `sandbox` attribute
// with NO `allow-same-origin` — that keeps framed HTML in an opaque origin
// so it cannot read cookies, localStorage, or call same-origin APIs as the
// PHANTOM app. We allow scripts/forms/popups so legitimate report previews
// still work, but the opaque-origin sandbox neuters credential theft.

import type * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { previewKind, useArtifactText } from '@/lib/artifacts';
import type { ArtifactRecord } from '@/lib/types';

// sandbox tokens — deliberately omits allow-same-origin so framed content
// stays in an opaque origin and can't reach the PHANTOM app's storage/APIs.
const IFRAME_SANDBOX = 'allow-scripts allow-forms allow-popups';

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 break-all text-[12px] text-foreground">{value}</span>
    </div>
  );
}

function TextPreview({ artifact }: { artifact: ArtifactRecord }) {
  const { data, isLoading, isError, error } = useArtifactText(artifact.contentUrl, true);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" data-testid="artifact-preview-loading">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }
  if (isError) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive"
        data-testid="artifact-preview-error"
      >
        Failed to load preview: {(error as Error)?.message ?? 'unknown error'}. Try{' '}
        <a
          href={artifact.contentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          opening in a new tab
        </a>
        .
      </div>
    );
  }
  return (
    <pre
      data-testid="artifact-preview-text"
      className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-[var(--bg-1)] p-3 font-mono text-[11px] leading-relaxed text-foreground"
    >
      {data}
    </pre>
  );
}

function PreviewBody({ artifact }: { artifact: ArtifactRecord }) {
  const kind = previewKind(artifact);
  const title = artifact.title || 'Artifact preview';

  if (kind === 'iframe') {
    return (
      <iframe
        src={artifact.contentUrl}
        title={title}
        sandbox={IFRAME_SANDBOX}
        referrerPolicy="no-referrer"
        data-testid="artifact-preview-iframe"
        className="h-[60vh] w-full rounded-md border border-border bg-white"
      />
    );
  }
  if (kind === 'image') {
    return (
      <img
        src={artifact.contentUrl}
        alt={title}
        data-testid="artifact-preview-image"
        className="max-h-[60vh] w-full rounded-md border border-border object-contain bg-[var(--bg-1)]"
      />
    );
  }
  return <TextPreview artifact={artifact} />;
}

export function ArtifactPreview({
  artifact,
  open,
  onOpenChange,
}: {
  artifact: ArtifactRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        data-testid="artifact-preview-sheet"
        className="gap-0 p-0"
      >
        {artifact ? (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  {artifact.type || 'artifact'}
                </Badge>
                <SheetTitle className="truncate">
                  {artifact.title || '(untitled)'}
                </SheetTitle>
              </div>
              <SheetDescription>
                {artifact.mimeType || 'unknown mime'} · preview is read-only and sandboxed
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-auto px-4 py-3">
              <div className="mb-3 flex flex-col gap-1.5">
                <Tooltip content={artifact.id}>
                  <span>
                    <MetaRow label="ID" value={<span className="font-mono">{artifact.id}</span>} />
                  </span>
                </Tooltip>
                <MetaRow label="Run" value={<span className="font-mono">{artifact.runId || '—'}</span>} />
                <MetaRow
                  label="Conversation"
                  value={<span className="font-mono">{artifact.conversationId || '—'}</span>}
                />
              </div>
              <PreviewBody artifact={artifact} />
            </div>

            <SheetFooter>
              <Button variant="ghost" size="sm" asChild>
                <a href={artifact.contentUrl} target="_blank" rel="noopener noreferrer">
                  Open in new tab
                </a>
              </Button>
              <Button variant="primary" size="sm" asChild>
                <a href={artifact.downloadUrl}>Download</a>
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export default ArtifactPreview;
