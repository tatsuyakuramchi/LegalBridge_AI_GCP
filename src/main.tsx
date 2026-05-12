// IMPORTANT: apiRouter must load BEFORE anything that calls fetch(),
// so its `window.fetch` monkey-patch is in place when components mount.
// See src/lib/apiRouter.ts for the routing rules.
import './lib/apiRouter';

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Defensive cleanup for users who still have a Service Worker / Cache Storage
// registered from a previous deployment. The legacy bundle redirected `/` to
// `/admin` and intercepted navigations from a Service Worker, which kept users
// stuck on stale HTML even after we shipped the new bundle.
//
// Running this on every load is cheap (no-op when nothing is registered) and
// guarantees that anyone landing here after the redeploy gets a clean slate.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => Promise.all(regs.map((r) => r.unregister())))
    .catch(() => {});
}
if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
  caches
    .keys()
    .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    .catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
