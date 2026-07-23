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
        manualChunks(id: string) {
          // Route-level lazy chunks are handled by React.lazy in App.tsx;
          // these manualChunks separate the big npm vendors so their
          // cache-lifetime is independent of app code changes.
          if (id.includes('node_modules')) {
            if (id.includes('maplibre-gl'))                    return 'maplibre';
            if (id.includes('firebase') || id.includes('@firebase')) return 'firebase';
            if (id.includes('@supabase'))                      return 'supabase';
            if (id.includes('react-router') || id.includes('react-dom') || (id.includes('/react/') && !id.includes('react-router'))) return 'react';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
