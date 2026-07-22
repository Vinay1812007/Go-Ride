// GoRide Worker entry point.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv, Env } from './lib/env';
import { sweepOffers } from './lib/dispatch';
import auth from './routes/auth';
import fare from './routes/fare';
import orders from './routes/orders';
import rides from './routes/rides';
import riders from './routes/riders';
import adminRoute from './routes/admin';
import partner from './routes/partner';
import tracking from './routes/tracking';
import geo from './routes/geo';
import { admin as sbAdmin } from './lib/supabase';

const app = new Hono<AppEnv>();

app.use('*', cors({
  origin: (o, c) => c.env.CORS_ORIGIN === '*' ? '*' : c.env.CORS_ORIGIN,
  allowHeaders: ['Authorization', 'Content-Type', 'X-API-Key'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.get('/', (c) => c.json({ service: 'goride-api', version: '0.1.0' }));
app.get('/health', (c) => c.json({ ok: true }));

app.route('/auth', auth);
app.route('/fare', fare);
app.route('/orders', orders);
app.route('/rides', rides);
app.route('/riders', riders);
app.route('/admin', adminRoute);
app.route('/geo', geo);
app.route('/partner/v1', partner);
app.route('/t', tracking);

app.onError((err, c) => {
  console.error('unhandled', err);
  return c.json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
});
app.notFound((c) => c.json({ error: { code: 'not_found' } }, 404));

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Daily 3am UTC → prune old rider_locations
    if (event.cron === '0 3 * * *') {
      const { data } = await sbAdmin(env).rpc('prune_rider_locations');
      console.log('pruned', data, 'rider_locations rows');
      return;
    }
    // Every minute → sweep expired offers + widen dispatch
    if (event.cron === '* * * * *') {
      try {
        const r = await sweepOffers(env);
        if (r.expired || r.noRider) console.log('sweep', r);
      } catch (e) {
        console.warn('sweep failed', e);
      }
    }
  },
};
