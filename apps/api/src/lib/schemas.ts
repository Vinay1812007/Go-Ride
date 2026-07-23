import { z } from 'zod';

// Shared building blocks
export const latLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const serviceType = z.enum([
  'bike',
  'scooter',
  'auto',
  'cab_4',
  'cab_7',
  'parcel_bike',
  'parcel_scooter',
  'parcel_auto',
  'parcel_truck',
  'food',
]);

// POST /fare/quote
export const fareQuoteBody = z.object({
  pickup: latLng,
  drop: latLng,
  service: serviceType,
  city: z.string().min(2).default('Hyderabad'),
});

// POST /orders (customer)
// scheduled_at: optional ISO8601 timestamp. When set, the order is created
// with status='scheduled' and dispatch is deferred. A cron on the Worker
// promotes it to 'searching' as the pickup time approaches.
export const createOrderBody = z.object({
  service: serviceType,
  city: z.string().min(2).default('Hyderabad'),
  pickup: latLng.extend({ address: z.string().min(3) }),
  drop: latLng.extend({ address: z.string().min(3) }),
  payment_method: z.enum(['cash', 'upi', 'wallet']).default('cash'),
  scheduled_at: z.string().datetime().optional(),
  parcel: z
    .object({
      weight_kg: z.number().positive().max(1000),
      contents: z.string().min(1).max(200),
      receiver_name: z.string().min(1).max(100),
      receiver_phone: z.string().min(6).max(20),
    })
    .optional(),
  restaurant_id: z.string().uuid().optional(),
  // Redemptions applied at checkout. Both optional.
  promo_code: z.string().min(2).max(30).optional(),
  wallet_apply: z.boolean().default(false),   // if true, use up to (post-discount total) of wallet balance
  food: z
    .object({
      items: z.array(z.object({
        menu_item_id: z.string().uuid(),
        name: z.string(),
        qty: z.number().int().positive().max(20),
        price: z.number().nonnegative(),
      })).min(1).max(50),
      instructions: z.string().max(300).optional(),
      subtotal: z.number().nonnegative(),      // client-computed, we re-verify server-side
    })
    .optional(),
});

// PATCH /orders/:id/schedule — reschedule a scheduled order
export const rescheduleBody = z.object({
  scheduled_at: z.string().datetime(),
});

// POST /orders/:id/messages — customer or captain sends a chat line
export const sendMessageBody = z.object({
  body: z.string().min(1).max(1000),
});

// POST /rides/location (rider heartbeat)
export const locationPingBody = z.object({
  lat: z.number(),
  lng: z.number(),
  heading: z.number().optional(),
  speed_kmh: z.number().optional(),
  order_id: z.string().uuid().optional(),
});

// POST /rides/:id/start
export const startTripBody = z.object({
  otp: z.string().length(4),
});

// POST /orders/:id/cancel
export const cancelBody = z.object({
  reason: z.string().min(2).max(200),
});

// POST /orders/:id/rate
export const rateBody = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

// POST /riders/onboard
export const onboardRiderBody = z.object({
  vehicle_type: serviceType,
  vehicle_number: z.string().min(4).max(20),
  vehicle_model: z.string().optional(),
  license_number: z.string().min(3).max(30),
  city: z.string().min(2),
});

// POST /partner/v1/orders — mirror of createOrderBody minus payment_method,
// plus reference_id for idempotency.
export const partnerCreateOrderBody = z.object({
  service: serviceType,
  city: z.string().default('Hyderabad'),
  pickup: latLng.extend({
    address: z.string(),
    contact_name: z.string().optional(),
    contact_phone: z.string().optional(),
  }),
  drop: latLng.extend({
    address: z.string(),
    contact_name: z.string(),
    contact_phone: z.string(),
  }),
  parcel: z
    .object({
      weight_kg: z.number().positive(),
      contents: z.string(),
    })
    .optional(),
  reference_id: z.string().min(1).max(80),
});

// Admin: rate card upsert
export const rateCardBody = z.object({
  id: z.number().int().optional(),
  city: z.string(),
  service: serviceType,
  base_fare: z.number().nonnegative(),
  base_km: z.number().nonnegative(),
  per_km: z.number().nonnegative(),
  per_min: z.number().nonnegative().default(0),
  min_fare: z.number().nonnegative(),
  surge_multiplier: z.number().min(0.5).max(5).default(1),
  parcel_weight_limit_kg: z.number().int().positive().nullable().optional(),
  commission_pct: z.number().min(0).max(50).default(15),
  active: z.boolean().default(true),
});

// Admin: refund/adjustment on completed order
export const refundBody = z.object({
  amount: z.number().positive(),
  type: z.enum(['refund', 'adjustment']),
  note: z.string().min(3).max(300),
});

// Admin: create/update a promo code
export const promoUpsertBody = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(2).max(30),
  description: z.string().max(200).optional(),
  discount_type: z.enum(['percent', 'flat']),
  discount_value: z.number().positive(),
  max_discount: z.number().positive().nullable().optional(),
  min_order: z.number().nonnegative().default(0),
  applies_to: z.enum(['all', 'ride', 'parcel', 'food']).default('all'),
  valid_from: z.string().datetime().optional(),
  valid_until: z.string().datetime().nullable().optional(),
  usage_limit_per_user: z.number().int().nonnegative().default(1),
  total_usage_limit: z.number().int().positive().nullable().optional(),
  active: z.boolean().default(true),
});

// Admin: credit/debit a user's wallet (customer support use case)
export const walletCreditBody = z.object({
  delta: z.number().refine((v) => v !== 0, { message: 'delta must be non-zero' }),
  reason: z.enum(['adjustment', 'refund', 'top_up', 'promo_credit']).default('adjustment'),
  note: z.string().min(3).max(300),
});
