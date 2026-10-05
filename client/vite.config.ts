import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const API_TARGET = process.env.VITE_API_PROXY ?? 'http://localhost:3002';

// The dashboard calls /api on its own origin; Vite proxies it to the API in development.
const proxy = { '/api': API_TARGET, '/docs': API_TARGET, '/health': API_TARGET };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5178, proxy },
  preview: { port: 4178, proxy },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\/](react|react-dom|scheduler|react-router)[\/]/,
            },
            {
              name: 'data',
              test: /node_modules[\/](@tanstack|zod|react-hook-form|@hookform)[\/]/,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
