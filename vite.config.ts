import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['yuxis-mac-mini'],
  },
  build: {
    outDir: 'dist-web',
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
});
