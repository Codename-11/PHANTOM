// Shared open-state for the ⌘K command palette.
//
// A tiny zustand store so the palette (CommandPalette.tsx), the topbar
// ⌘K trigger (AppShell), and the global keydown listener can all drive the
// same open/closed state without prop-drilling or a context provider.
import { create } from 'zustand';

interface CommandState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useCommandPalette = create<CommandState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
