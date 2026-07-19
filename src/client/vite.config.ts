import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Backend URL used by the dev server proxy (mirrors the old CRA setupProxy.js).
const apiUrl = process.env.VITE_API_URL || 'http://localhost:3101';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3100,
    proxy: {
      '/api': { target: apiUrl, changeOrigin: true },
      '/socket.io': { target: apiUrl, changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: 'build',
  },
});
