/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_API_URL: string;
  readonly VITE_APP_TARGET: 'customer' | 'rider' | 'admin';
  readonly VITE_MAP_TILES_URL: string;
  readonly VITE_DEFAULT_CITY: string;
  readonly VITE_DEFAULT_LAT: string;
  readonly VITE_DEFAULT_LNG: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
