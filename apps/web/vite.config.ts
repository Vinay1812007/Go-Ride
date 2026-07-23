import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Vite plugin: emit `firebase-messaging-sw-config.js` at build time so the
// Firebase Cloud Messaging service worker can pick up the (public) Firebase
// config without a hardcoded rebuild. When VITE_FIREBASE_CONFIG is unset
// we simply don't emit — the SW file itself is present but no-ops.
function firebaseSwConfigPlugin() {
  return {
    name: 'goride-firebase-sw-config',
    apply: 'build' as const,
    generateBundle() {
      const raw = process.env.VITE_FIREBASE_CONFIG;
      if (!raw) return;
      let parsed: Record<string, unknown> | null = null;
      try { parsed = JSON.parse(raw); } catch { /* invalid */ }
      if (!parsed) return;
      // Serialised into a plain JS assignment the service worker can read.
      const source = `self.__GORIDE_FIREBASE_CONFIG__ = ${JSON.stringify(parsed)};\n`;
      // Emit as a top-level asset so it lives next to the SW at /firebase-messaging-sw-config.js
      // The SW imports it via importScripts('/firebase-messaging-sw-config.js').
      (this as unknown as {
        emitFile: (o: { type: 'asset'; fileName: string; source: string }) => void;
      }).emitFile({
        type: 'asset',
        fileName: 'firebase-messaging-sw-config.js',
        source,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), firebaseSwConfigPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
