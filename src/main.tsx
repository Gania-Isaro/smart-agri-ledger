import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './state/store';
import { PrefsProvider } from './i18n';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrefsProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </PrefsProvider>
  </StrictMode>,
);

/*
 * Register the service worker so the app keeps loading with no network. Only in
 * a production build: in dev it would serve stale modules and make every change
 * look like it did not apply.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    // BASE_URL, not '/': on GitHub Pages the app lives under /smart-agri-ledger/,
    // and a worker registered at the domain root would be out of scope.
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch((e) => console.warn('Service worker not registered', e));
  });
}
