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
}

// Hono ContextVariableMap — populated by middleware, read by handlers.
export type Vars = {
  userId?: string;
  userRole?: 'customer' | 'rider' | 'admin';
  partnerId?: string;
};

export type AppEnv = { Bindings: Env; Variables: Vars };
