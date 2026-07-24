// Worker bindings & environment. Kept in one place so route handlers stay tidy.
export interface Env {
  // Bindings
  CACHE: KVNamespace;

  // Public vars (from wrangler.toml [vars])
  CORS_ORIGIN: string;
  OSRM_URL: string;
  GEOCODER: 'nominatim' | 'locationiq' | 'geoapify';
  NOMINATIM_URL: string;
  ROUTER: 'osrm' | 'ors';
  WEBHOOK_SIGNING_VERSION: string;

  // Secrets (set via `wrangler secret put ...`)
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  SHARE_TOKEN_SECRET: string;
  ORS_KEY?: string;
  GEOCODER_KEY?: string;
  // Firebase Cloud Messaging (optional — feature no-ops when absent)
  // FIREBASE_PROJECT_ID: e.g. "goride-app"
  // FIREBASE_SERVICE_ACCOUNT_JSON: whole downloaded service-account JSON
  //   as a single string secret.
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
}

// Hono ContextVariableMap — populated by middleware, read by handlers.
export type Vars = {
  userId?: string;
  userRole?: 'customer' | 'rider' | 'admin' | 'restaurant_partner';
  partnerId?: string;
};

export type AppEnv = { Bindings: Env; Variables: Vars };
