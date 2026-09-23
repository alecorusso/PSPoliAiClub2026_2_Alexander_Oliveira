import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// O projeto não instala @types/node: basta declarar o pedaço usado aqui.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // O cliente nunca fala com o banco: tudo passa pela API do servidor Express.
    proxy: {
      // API_ALVO aponta para outra instancia do servidor (ex.: uma de testes).
      '/api': { target: process.env.API_ALVO || 'http://localhost:3333', changeOrigin: true },
    },
  },
});
