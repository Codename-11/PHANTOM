// PHANTOM SEC — SplitPane: list + persistent inline detail column.
//
// Restores the kit's master-detail topology (kit/kit.css `.main { display:
// flex }` + `.drawer` as an inline column with `border-left`), replacing the
// shadcn Sheet modal overlays the A8 migration used for every detail surface.
//
//   Desktop (md+): list fills the remaining space; when `detailOpen` the
//   detail renders as a fixed-width sibling column on the right — the list
//   stays visible and keeps its scroll/selection context.
//
//   Mobile (<md): master-detail — when `detailOpen` the detail takes the
//   full width and the list is hidden (the modal's one genuine advantage,
//   preserved without a focus-trapping overlay).
//
// Routes are unchanged: callers pass `detailOpen` derived from the active
// `/:id` child route and render the detail (typically <Outlet/>) into the
// column, so deep-linking and the browser back button keep working.
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface SplitPaneProps {
  /** The list / master view — always rendered. */
  list: React.ReactNode;
  /** The detail view (e.g. <Outlet />) — rendered in the right column when open. */
  detail: React.ReactNode;
  /** Whether a detail item is selected (drives column sizing + mobile takeover). */
  detailOpen: boolean;
  /** Detail column width on desktop. Defaults to the kit's 420px alert drawer. */
  detailWidth?: number | string;
  className?: string;
  /** Optional className for the list region. */
  listClassName?: string;
  /** Optional className for the detail region. */
  detailClassName?: string;
}

export function SplitPane({
  list,
  detail,
  detailOpen,
  detailWidth = 420,
  className,
  listClassName,
  detailClassName,
}: SplitPaneProps) {
  const width = typeof detailWidth === 'number' ? `${detailWidth}px` : detailWidth;
  return (
    <div className={cn('flex h-full min-h-0 w-full', className)}>
      {/* List — hidden on mobile while a detail is open (master-detail). */}
      <div
        className={cn(
          'min-w-0 flex-1 overflow-y-auto',
          detailOpen && 'hidden md:block',
          listClassName,
        )}
      >
        {list}
      </div>

      {/* Detail — full-width takeover on mobile, fixed-width inline column on
          desktop. `width` is threaded through a CSS var so an arbitrary px
          value works; the md: variant wins over `w-full` only at md+ (so the
          detail node mounts exactly once). */}
      {detailOpen ? (
        <aside
          className={cn(
            'min-h-0 w-full overflow-hidden md:flex-none md:[width:var(--detail-w)]',
            detailClassName,
          )}
          style={{ ['--detail-w' as string]: width }}
        >
          {detail}
        </aside>
      ) : null}
    </div>
  );
}

export default SplitPane;
