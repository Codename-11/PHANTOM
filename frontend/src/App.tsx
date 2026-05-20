// Root React component for the A8.x migration bundle.
//
// A8.0 shipped the /react/health placeholder; A8.1 added the Campaigns
// surface; A8.2 added Settings + Scope; A8.3 added Runs + Graph +
// Artifacts; A8.4 (this commit) adds Dash + Onboarding + Approvals +
// Alerts. Each of these routes is a side-by-side preview — the legacy
// vanilla `/dash`, `/approvals`, `/alerts`, etc. continue to render the
// vanilla bundle until REACT_PAGES in server/index.js is updated.
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import CampaignsPage from './pages/Campaigns';
import CampaignDetailRoute from './pages/CampaignDetail';
import CampaignCreateRoute from './pages/CampaignCreate';
import SettingsPage from './pages/Settings';
import ScopesPage, { ScopeDetailRoute } from './pages/Scope';
import ScopeCreateRoute from './pages/ScopeCreate';
import RunsPage, { RunDetailRoute } from './pages/Runs';
import GraphPage from './pages/Graph';
import ArtifactsPage from './pages/Artifacts';
import DashPage from './pages/Dash';
import OnboardingPage from './pages/Onboarding';
import ApprovalsPage, { ApprovalDetailRoute } from './pages/Approvals';
import AlertsPage, { AlertDetailRoute } from './pages/Alerts';

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
          <code className="font-mono">/react/dash</code> for the migrated operations
          surface; the legacy <code className="font-mono">/dash</code> route still
          serves the vanilla bundle.
        </p>
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block w-2 h-2 rounded-full bg-primary" aria-hidden="true" />
          <span>Phase A8.4 · Dash · Onboarding · Approvals · Alerts</span>
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
        <Route path="/react/dash" element={<DashPage />} />
        <Route path="/react/onboarding" element={<OnboardingPage />} />
        <Route path="/react/approvals" element={<ApprovalsPage />}>
          <Route path=":id" element={<ApprovalDetailRoute />} />
        </Route>
        <Route path="/react/alerts" element={<AlertsPage />}>
          <Route path=":id" element={<AlertDetailRoute />} />
        </Route>
        <Route path="/react/campaigns" element={<CampaignsPage />}>
          <Route path="new" element={<CampaignCreateRoute />} />
          <Route path=":id" element={<CampaignDetailRoute />} />
        </Route>
        <Route path="/react/settings" element={<SettingsPage />} />
        <Route path="/react/scope" element={<ScopesPage />}>
          <Route path="new" element={<ScopeCreateRoute />} />
          <Route path=":id" element={<ScopeDetailRoute />} />
        </Route>
        <Route path="/react/runs" element={<RunsPage />}>
          <Route path=":id" element={<RunDetailRoute />} />
        </Route>
        <Route path="/react/graph" element={<GraphPage />} />
        <Route path="/react/graph/:runId" element={<GraphPage />} />
        <Route path="/react/artifacts" element={<ArtifactsPage />} />
        <Route path="/react" element={<Navigate to="/react/dash" replace />} />
        <Route path="*" element={<HealthCard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
