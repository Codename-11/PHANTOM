// shadcn/ui's canonical class-merge helper.
//
// Standard shadcn ships `cn` as `twMerge(clsx(inputs))` so conflicting
// Tailwind utilities (`px-2 px-4` → `px-4`) get deduped. tailwind-merge
// adds ~25 KB to the bundle to embed the class taxonomy. PHANTOM owns
// every className in this tree, so we author them to not conflict and
// ship a clsx-only `cn` instead. If we ever need conflict-merge,
// swapping back to `twMerge(clsx(...))` is the only line of change.
//
// Every shadcn primitive scaffolded into components/ui/ imports this
// from '@/lib/utils' — the path alias is wired in vite.config.react.ts
// and tsconfig.frontend.json.
import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
