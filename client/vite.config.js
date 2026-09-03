import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on LAN too, so friends on WiFi can hit your IP
    port: 5173,
  },
});
