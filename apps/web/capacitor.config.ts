import type { CapacitorConfig } from '@capacitor/cli';

const target = process.env.VITE_APP_TARGET ?? 'customer';

const config: CapacitorConfig = {
  appId: target === 'rider' ? 'in.goride.captain' : 'in.goride.app',
  appName: target === 'rider' ? 'GoRide Captain' : 'GoRide',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    Geolocation: {
      // Rider APK requires background; customer only foreground.
      permissions: target === 'rider' ? ['location', 'coarseLocation'] : ['location'],
    },
  },
};

export default config;
