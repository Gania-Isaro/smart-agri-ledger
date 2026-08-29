import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/*
 * GitHub Pages serves a project site from /<repo>/, not from the domain root,
 * so every built asset URL has to carry that prefix. Local dev stays at '/'
 * because there is no prefix there — hard-coding the repo name into the dev
 * server would just make `npm run dev` serve 404s.
 */
const base = process.env.GITHUB_ACTIONS ? '/smart-agri-ledger/' : '/';

export default defineConfig({
  base,
  plugins: [react()],
  build: { target: 'es2022', sourcemap: true },
  server: { port: 5173 },
});
