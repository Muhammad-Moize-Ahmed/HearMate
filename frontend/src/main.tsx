import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';
import './index.css';
import { syncWithBrowser } from './lib/network';
import { listenForInstallPrompt } from './pwa/install';

// Opened without a connection (e.g. from the home screen): start out offline.
syncWithBrowser();
// The install prompt can arrive before any screen renders.
listenForInstallPrompt();
// The service worker exists only in a production build; `pnpm dev` (and HMR) never sees one.
if (import.meta.env.PROD) {
  void import('./pwa/register').then(({ registerServiceWorker }) => registerServiceWorker());
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
