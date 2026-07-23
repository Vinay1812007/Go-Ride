// Firebase Cloud Messaging — web-push token acquisition and register.
//
// The whole file is a no-op when VITE_FIREBASE_CONFIG or VITE_FIREBASE_VAPID_KEY
// are missing, so a deployment without Firebase configured behaves exactly
// like the pre-push app.
//
// Order of operations on the client:
//   1. Detect support (secure context, Notification API, ServiceWorker, PushManager)
//   2. Request Notification permission (only if 'default' — never re-prompt after a deny)
//   3. Init firebase-app + firebase-messaging
//   4. Register the service worker at /firebase-messaging-sw.js
//   5. getToken({ vapidKey, serviceWorkerRegistration }) → POST /push/register
//   6. onMessage — foreground listener that shows a small toast (background is
//      handled by the SW showing a native notification)
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, type Messaging } from 'firebase/messaging';
import { api } from './api';

interface PushConfig {
  firebaseConfig: Record<string, string>;
  vapidKey: string;
}

function readConfig(): PushConfig | null {
  const configRaw = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
  if (!configRaw || !vapidKey) return null;
  try {
    return { firebaseConfig: JSON.parse(configRaw), vapidKey };
  } catch {
    console.warn('VITE_FIREBASE_CONFIG is not valid JSON — push disabled');
    return null;
  }
}

function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

let app: FirebaseApp | null = null;
let messaging: Messaging | null = null;
let currentToken: string | null = null;

function detectPlatform(): 'web' | 'android' | 'ios' {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return 'web';
}

// Idempotent — safe to call multiple times per session.
export async function initPush(): Promise<void> {
  const config = readConfig();
  if (!config) return;
  if (!pushSupported()) return;

  // Never re-prompt if the user denied. Only ask on first visit ('default').
  if (Notification.permission === 'denied') return;
  if (Notification.permission === 'default') {
    // Ask lazily — most apps do this after a user action, but for a
    // ride-hailing app the value proposition is obvious.
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
  }
  if (Notification.permission !== 'granted') return;

  try {
    app ??= initializeApp(config.firebaseConfig);
    messaging ??= getMessaging(app);

    // Register the SW ourselves so we control the scope + can pass query
    // params in the future. Firebase looks for /firebase-messaging-sw.js
    // by convention.
    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });

    const token = await getToken(messaging, {
      vapidKey: config.vapidKey,
      serviceWorkerRegistration: swReg,
    });
    if (!token) return;

    // Only POST if the token changed since last register — keeps traffic tidy.
    const cached = localStorage.getItem('goride:push:token');
    if (cached !== token) {
      await api.post('/push/register', {
        token,
        platform: detectPlatform(),
        user_agent: navigator.userAgent.slice(0, 300),
      });
      localStorage.setItem('goride:push:token', token);
    }
    currentToken = token;

    // Foreground handler — when the app has focus, notifications come here
    // rather than through the SW. Show a mild toast; the SW's showNotification
    // handles the background case.
    onMessage(messaging, (payload) => {
      const title = payload.notification?.title;
      if (!title) return;
      // Emit a custom event so any Toast provider can render it.
      window.dispatchEvent(new CustomEvent('goride:push', { detail: payload }));
    });
  } catch (e) {
    console.warn('push init failed', e);
  }
}

// Called on sign-out — best-effort unregister.
export async function revokePush(): Promise<void> {
  const token = currentToken ?? localStorage.getItem('goride:push:token');
  if (!token) return;
  try { await api.post('/push/unregister', { token }); } catch { /* noop */ }
  localStorage.removeItem('goride:push:token');
  currentToken = null;
}
