// Root React component for the A8.x migration bundle.
//
// A8.0 shipped the /react/health placeholder; A8.1 adds the Campaigns
// surface as a side-by-side preview at /react/campaigns. The legacy
// `/campaigns` route still serves the vanilla bundle until a follow-up
// commit flips it over by adding 'campaigns' to REACT_PAGES in
// server/index.js.
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import CampaignsPage from './pages/Campaigns';
import CampaignDetailRoute from './pages/CampaignDetail';
import CampaignCreateRoute from './pages/CampaignCreate';

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
          The React + Vite + Tailwind + shadcn/ui infrastructure is wired. Visit{' '}
          <code className="font-mono">/react/campaigns</code> to preview the migrated
          Campaigns surface; the legacy <code className="font-mono">/campaigns</code> route
          continues to serve the vanilla bundle.
        </p>
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block w-2 h-2 rounded-full bg-primary" aria-hidden="true" />
          <span>Phase A8.1 · Campaigns preview</span>
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
        <Route path="/react/campaigns" element={<CampaignsPage />}>
          <Route path="new" element={<CampaignCreateRoute />} />
          <Route path=":id" element={<CampaignDetailRoute />} />
        </Route>
        <Route path="/react" element={<Navigate to="/react/health" replace />} />
        <Route path="*" element={<HealthCard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
