import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' so the built app also opens from a file inside Electron.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true },
  test: { environment: 'jsdom' },
});
