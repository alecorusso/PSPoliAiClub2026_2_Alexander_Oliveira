import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // O cliente nunca fala com o banco: tudo passa pela API do servidor Express.
    proxy: {
      '/api': { target: 'http://localhost:3333', changeOrigin: true },
    },
  },
});
