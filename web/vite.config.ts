import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // wspólny kontrakt typów leży poza katalogiem web/ (jedno źródło prawdy)
    alias: { '@shared': path.resolve(__dirname, '../shared') },
  },
  server: {
    // pozwól importować z ../shared
    fs: { allow: ['..'] },
    // proxy do backendu CAP (dev) — SSE działa bo http-proxy streamuje
    proxy: {
      '/chat': {
        target: 'http://localhost:4004',
        changeOrigin: true,
      },
    },
  },
});
