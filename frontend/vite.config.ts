import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Bind IPv4 loopback explicitly. Left to itself Vite binds whatever
    // `localhost` resolves to, and on Windows that is `::1` alone - so
    // http://127.0.0.1:5173 is refused while http://localhost:5173 works, and
    // whichever of the two you had bookmarked decided whether the app ran.
    // Docker overrides this with `--host 0.0.0.0` on the command line.
    host: '127.0.0.1',
    // This project lives in a OneDrive-synced folder, where Windows file
    // events are unreliable: renames and quick rewrites can leave Vite
    // serving a stale or empty module while the file on disk is correct.
    // Polling costs a little CPU and makes HMR dependable here.
    watch: { usePolling: true, interval: 300 },
    proxy: {
      // Keeps local development same-origin, so cookies and CORS behave the
      // way they do behind Azure Application Gateway.
      '/api': {
        target: process.env.VITE_DEV_API_PROXY ?? 'http://localhost:8000',
        changeOrigin: true,
      },
      // Uploaded photos and documents are served by Django in development.
      '/media': {
        target: process.env.VITE_DEV_API_PROXY ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  // `npm run build && npm run preview` serves the real production bundle with
  // the same API proxy - no dev server, no module fetching per navigation. That
  // is the sturdier way to run a demo.
  preview: {
    port: 4173,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_PROXY ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/media': {
        target: process.env.VITE_DEV_API_PROXY ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          mui: ['@mui/material', '@mui/icons-material'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
    // The component tests drive MUI through userEvent, which is slow in jsdom:
    // a grid test can take 8s when the suites run in parallel. The 5s default
    // failed intermittently, which is worse than useless - it teaches people to
    // re-run rather than to read.
    testTimeout: 20_000,
  },
});
