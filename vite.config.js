import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const { PORT = '8787' } = loadEnv(mode, process.cwd(), 'PORT');
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${PORT}`,
          changeOrigin: true,
          timeout: 30_000,
          proxyTimeout: 30_000,
        },
      },
    },
  };
});
