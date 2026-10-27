import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

import { pwaOptions } from './src/pwa/options.ts';

export default defineConfig(({ mode }) => {
  // Empty prefix loads non-VITE_ vars too; they stay in this config and never reach the bundle.
  const env = loadEnv(mode, process.cwd(), '');
  // In development the API is reached through this proxy, so the app always calls
  // relative `/api/...` URLs and never hardcodes a backend host.
  const apiTarget = env.API_PROXY_TARGET || 'http://localhost:8000';

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Builds the manifest and service worker. The worker is only registered by a production
      // build (`pnpm build && pnpm preview`), so `pnpm dev` and HMR never see it.
      ...(process.env.VITEST ? [] : [VitePWA(pwaOptions)]),
    ],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
