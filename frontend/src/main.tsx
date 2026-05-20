// React entrypoint for PHANTOM's incremental React/Tailwind/shadcn migration.
//
// Phase A8.0 (this commit): infrastructure only. The bundle ships a single
// health route so we can prove the React build is wired end-to-end. The
// legacy vanilla bundle continues to serve every routed page until
// REACT_PAGES is populated in server/index.js.
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';

import { App } from './App';
import { queryClient } from './lib/queryClient';
import './styles/globals.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('PHANTOM React bundle: #root element is missing from index.html');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
