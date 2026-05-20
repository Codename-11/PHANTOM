// Root React component for the A8.0 infrastructure bundle.
//
// One placeholder route — `/react/health` — renders a Tailwind-styled card
// that proves the bundle ships, mounts, and consumes the cool-slate token
// palette via the Tailwind theme. Real route migrations land in A8.1+.
import { BrowserRouter, Route, Routes } from 'react-router-dom';

function HealthCard() {
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6 font-mono">
      <section
        className="max-w-md w-full rounded-md border border-border bg-card text-card-foreground p-6 shadow-lg"
        role="status"
        aria-live="polite"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          PHANTOM SEC · React Bundle
        </p>
        <h1 className="text-2xl font-semibold text-primary mb-3">
          PHANTOM React Bundle · Ready
        </h1>
        <p className="text-sm text-muted-foreground">
          The React + Vite + Tailwind + shadcn/ui infrastructure is wired.
          No routes have been migrated yet — the legacy vanilla bundle
          continues to serve every page.
        </p>
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block w-2 h-2 rounded-full bg-primary" aria-hidden="true" />
          <span>Phase A8.0 · infrastructure only</span>
        </div>
      </section>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/react/health" element={<HealthCard />} />
        <Route path="*" element={<HealthCard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
