// Root React component for the A8.x migration bundle.
//
// A8.0 shipped the /react/health placeholder; A8.1 added the Campaigns
// surface; A8.2 added Settings + Scope; A8.3 added Runs + Graph +
// Artifacts; A8.4 (this commit) adds Dash + Onboarding + Approvals +
// Alerts. Each of these routes is a side-by-side preview — the legacy
// vanilla `/dash`, `/approvals`, `/alerts`, etc. continue to render the
// vanilla bundle until REACT_PAGES in server/index.js is updated.
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './components/AppShell';
import { ToastProvider } from './components/ui/toast';
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
import RegistryPage from './pages/Registry';

// Chat lazy-loads: its markdown stack (marked + highlight.js + DOMPurify)
// is ~heavy and only needed when the operator opens /chat, so it ships as
// a separate chunk instead of bloating the initial bundle.
const ChatPage = lazy(() => import('./pages/Chat'));

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
          Page not found
        </h1>
        <p className="text-sm text-muted-foreground">
          That route doesn&apos;t exist. Head back to{' '}
          <a href="/dash" className="text-[var(--cy-2)] hover:underline">
            Dash
          </a>{' '}
          for the operations surface.
        </p>
      </section>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppShell>
          <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
          <Routes>
        {/* React is the only frontend bundle (A8.5b removed the legacy
            vanilla bundle). Every surface mounts at its bare canonical
            path; server/index.js serves this SPA shell for all non-API
            routes. */}
        {[
          ['/dash', <DashPage />],
          ['/chat', <ChatPage />],
          ['/registry', <RegistryPage />],
          ['/onboarding', <OnboardingPage />],
          ['/settings', <SettingsPage />],
          ['/graph', <GraphPage />],
          ['/artifacts', <ArtifactsPage />],
        ].map(([path, el]) => (
          <Route key={path as string} path={path as string} element={el as JSX.Element} />
        ))}

        <Route path="/" element={<Navigate to="/dash" replace />} />

        <Route path="/campaigns" element={<CampaignsPage />}>
          <Route path="new" element={<CampaignCreateRoute />} />
          <Route path=":id" element={<CampaignDetailRoute />} />
        </Route>
        <Route path="/scope" element={<ScopesPage />}>
          <Route path="new" element={<ScopeCreateRoute />} />
          <Route path=":id" element={<ScopeDetailRoute />} />
        </Route>
        <Route path="/runs" element={<RunsPage />}>
          <Route path=":id" element={<RunDetailRoute />} />
        </Route>
        <Route path="/approvals" element={<ApprovalsPage />}>
          <Route path=":id" element={<ApprovalDetailRoute />} />
        </Route>
        <Route path="/alerts" element={<AlertsPage />}>
          <Route path=":id" element={<AlertDetailRoute />} />
        </Route>
        <Route path="/graph/:runId" element={<GraphPage />} />

            <Route path="*" element={<HealthCard />} />
          </Routes>
          </Suspense>
        </AppShell>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
