// TweaksMenu — the kit's "Tweaks" display controls (theme + density) as a
// topbar affordance. A gear button opens a small Display dialog with two
// segmented controls; choices persist via useUiPrefs and apply instantly
// as data-theme / data-density on <html>.
import * as React from 'react';

import { ButtonGroup } from '@/components/ui/kit';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { IcSettings } from '@/components/ui/icons';
import { useUiPrefs, type Density, type Theme } from '@/lib/uiPrefs';

export function TweaksMenu() {
  const [open, setOpen] = React.useState(false);
  const theme = useUiPrefs((s) => s.theme);
  const density = useUiPrefs((s) => s.density);
  const setTheme = useUiPrefs((s) => s.setTheme);
  const setDensity = useUiPrefs((s) => s.setDensity);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Display settings"
        aria-label="Display settings"
        data-testid="tweaks-trigger"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line-1)] text-[var(--fg-3)] transition-colors hover:border-[var(--line-2)] hover:text-[var(--fg-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <IcSettings size={15} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="tweaks-dialog">
          <DialogHeader>
            <DialogTitle>Display</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-5 py-4">
            <label className="flex items-center justify-between gap-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--fg-3)]">
                Theme
              </span>
              <ButtonGroup<Theme>
                value={theme}
                onChange={setTheme}
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
              />
            </label>
            <label className="flex items-center justify-between gap-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--fg-3)]">
                Density
              </span>
              <ButtonGroup<Density>
                value={density}
                onChange={setDensity}
                options={[
                  { value: 'operator', label: 'Operator' },
                  { value: 'compact', label: 'Compact' },
                ]}
              />
            </label>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default TweaksMenu;
