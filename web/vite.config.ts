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
    // dev zdalny: '.ts.net' = hosty Tailscale (osiągalne tylko z własnego tailnetu).
    // Inne hosty dorzuca się przez VITE_ALLOWED_HOSTS=host1,host2.
    allowedHosts: ['.ts.net', ...(process.env.VITE_ALLOWED_HOSTS?.split(',').filter(Boolean) ?? [])],
    // proxy do backendu CAP (dev) — SSE działa bo http-proxy streamuje.
    // Port da się nadpisać (CAP_PORT), gdy 4004 zajmuje inny projekt.
    proxy: {
      '/chat': {
        target: `http://localhost:${process.env.CAP_PORT ?? 4004}`,
        changeOrigin: true,
      },
    },
  },
});
