// Firebase Cloud Messaging service worker.
//
// Firebase looks for this file at /firebase-messaging-sw.js by convention.
// It runs on its own thread (not the app's), so the Firebase config is
// injected at build time via importScripts of a config file we generate —
// but to keep things simple we hardcode a lightweight fallback that reads
// config from the URL params passed at register time.
//
// Because Vite doesn't process files under /public, we use the FCM
// compat build via CDN (small, cached across origins).

importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-messaging-compat.js');

// Optional config file — the Vite build emits this at deploy time from
// VITE_FIREBASE_CONFIG. Wrapped in try/catch so a missing file during
// pre-Firebase-setup deploys doesn't kill the SW.
try {
  importScripts('/firebase-messaging-sw-config.js');
} catch (_e) { /* config not deployed yet */ }

// SW-side Firebase config. This is the SAME config the client uses at
// runtime; because Firebase config is public (project id, apiKey, etc.)
// hardcoding here at build time is fine. To customize per environment,
// swap this block at deploy time or replace the file with one built by
// Vite that reads env vars.
//
// If you're testing before Firebase is wired up, this SW loads harmlessly
// and does nothing — the client never registers a token.
try {
  // Placeholder — replaced by the deploy pipeline if FIREBASE_CONFIG is set.
  // eslint-disable-next-line no-undef
  const cfg = self.__GORIDE_FIREBASE_CONFIG__ || null;
  if (cfg) {
    firebase.initializeApp(cfg);
    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      const title = (payload.notification && payload.notification.title) || 'GoRide';
      const body  = (payload.notification && payload.notification.body)  || '';
      const link  = (payload.data && payload.data.click_action) || '/';
      self.registration.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { link },
      });
    });
  }
} catch (e) {
  // Never let the SW crash the app.
  console.warn('goride SW init failed', e);
}

// Deep-link click handler — focus an existing tab, or open a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(link);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    }),
  );
});
