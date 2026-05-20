// Multi-select toolpack picker. Wraps Radix ToggleGroup (multi-mode) so
// each chip toggles independently. Backs the legacy `.cf-chip-picker`.
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { cn } from '@/lib/utils';
import type { Toolpack } from '@/lib/types';

interface ToolpackPickerProps {
  options: Toolpack[];
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
}

export function ToolpackPicker({
  options,
  selected,
  onChange,
  className,
}: ToolpackPickerProps) {
  if (!options.length) {
    return (
      <div
        className={cn(
          'rounded-md border border-dashed border-border bg-[var(--bg-2)] px-3 py-2 text-xs text-muted-foreground',
          className,
        )}
        data-testid="toolpack-picker-empty"
      >
        No toolpacks available.
      </div>
    );
  }

  return (
    <ToggleGroup
      type="multiple"
      variant="chip"
      value={selected}
      onValueChange={(next) => onChange(next)}
      className={className}
      aria-label="Toolpacks"
      data-testid="toolpack-picker"
    >
      {options.map((t) => {
        const label = t.name || t.id;
        const isOn = selected.includes(t.id);
        return (
          <ToggleGroupItem
            key={t.id}
            value={t.id}
            data-cf-chip={t.id}
            aria-label={label}
            aria-checked={isOn}
            data-on={isOn || undefined}
          >
            <span aria-hidden="true" className="font-mono text-[11px]">
              {isOn ? '✓' : '+'}
            </span>
            <span>{label}</span>
            {t.risks && t.risks.length > 0 ? (
              <span className="font-mono text-[10px] text-[var(--fg-3)]">
                {t.risks.slice(0, 2).join(', ')}
              </span>
            ) : null}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
