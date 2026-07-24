// GoRide Worker entry point.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv, Env } from './lib/env';
import { sweepOffers, promoteScheduled } from './lib/dispatch';
import auth from './routes/auth';
import fare from './routes/fare';
import orders from './routes/orders';
import rides from './routes/rides';
import riders from './routes/riders';
import adminRoute from './routes/admin';
import partner from './routes/partner';
import tracking from './routes/tracking';
import geo from './routes/geo';
import food from './routes/food';
import wallet, { promo } from './routes/wallet';
import push from './routes/push';
import restaurantPartner from './routes/restaurantPartner';
import support from './routes/support';
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
app.route('/food', food);
app.route('/promo', promo);
app.route('/wallet', wallet);
app.route('/push', push);
app.route('/partner-restaurant', restaurantPartner);
app.route('/support', support);
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
    // Every 2 minutes → dynamic surge recompute for auto_surge=true cards.
    if (event.cron === '*/2 * * * *') {
      try {
        const { data, error } = await sbAdmin(env).rpc('run_surge');
        if (error) console.warn('surge run failed', error);
        else if (data) console.log('surge run: updated', data, 'rate_card(s)');
      } catch (e) {
        console.warn('surge run threw', e);
      }
      return;
    }
    // Monday 4am UTC → weekly rider payout run.
    // run_payouts() defaults to the previous Mon-Sun window and skips any
    // transactions already covered by an existing payout, so a duplicate
    // firing (Cloudflare quirk) is a safe no-op.
    if (event.cron === '0 4 * * 1') {
      try {
        const { data, error } = await sbAdmin(env).rpc('run_payouts', { p_from: null, p_to: null });
        if (error) console.warn('payouts run failed', error);
        else console.log('payouts run created', data, 'row(s)');
      } catch (e) {
        console.warn('payouts run threw', e);
      }
      return;
    }
    // Every minute → sweep expired offers, widen dispatch, promote scheduled
    if (event.cron === '* * * * *') {
      try {
        const r = await sweepOffers(env);
        if (r.expired || r.noRider) console.log('sweep', r);
      } catch (e) {
        console.warn('sweep failed', e);
      }
      try {
        const p = await promoteScheduled(env);
        if (p.promoted) console.log('promoted', p.promoted, 'scheduled orders');
      } catch (e) {
        console.warn('promoteScheduled failed', e);
      }
    }
  },
};
