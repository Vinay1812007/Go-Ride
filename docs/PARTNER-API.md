# GoRide D2C Partner API — v1

Programmatic parcel (and later, food) delivery on the GoRide fleet — comparable to Porter Enterprise / Shadowfax D2C.

## Base URL

```
https://api.<your-domain>/partner/v1
```

## Authentication

Every request must include your API key:

```
X-API-Key: pk_live_xxxxxxxxxxxxxxxxxx
```

Keys are issued by a GoRide admin (Admin panel → Partners → New partner). The plaintext key is displayed **once at creation**; only a SHA-256 hash is stored. If you lose it, the admin must rotate it.

## Rate limit

`60 requests/minute` per key by default. Limit responses come back as HTTP `429` with an `error.code` of `rate_limited`. Contact us to raise your limit.

## Error format

```json
{ "error": { "code": "overweight", "message": "Max weight 8 kg for this service" } }
```

Common codes: `unauthenticated`, `invalid_key`, `rate_limited`, `bad_request`, `not_found`, `already_final`, `in_progress`, `overweight`, `no_rate_card`, `setup_incomplete`.

---

## Endpoints

### `POST /quotes` — price a delivery

**Request**

```json
{
  "service": "parcel_bike",
  "city": "Hyderabad",
  "pickup": { "lat": 17.4065, "lng": 78.5691 },
  "drop":   { "lat": 17.4483, "lng": 78.3915 }
}
```

**Response**

```json
{
  "distance_km": 14.2,
  "eta_min": 34,
  "fare": 172,
  "fare_breakup": {
    "base": 30, "distance": 122, "time": 0,
    "surge_multiplier": 1, "subtotal": 152, "total": 172, "min_fare": 40,
    "km": 14.2, "minutes": 34, "commission": 25.8, "rider_earning": 146.2
  },
  "polyline": "u{~vFvyys@..."
}
```

---

### `POST /orders` — create a delivery

**Idempotent** on `(partner_id, reference_id)`. Retrying with the same `reference_id` returns the original order.

**Request**

```json
{
  "service": "parcel_bike",
  "city": "Hyderabad",
  "pickup": {
    "lat": 17.4065, "lng": 78.5691,
    "address": "Warehouse 12, Uppal",
    "contact_name": "Store",
    "contact_phone": "9xxxxxxxxx"
  },
  "drop": {
    "lat": 17.4483, "lng": 78.3915,
    "address": "Flat 301, Madhapur",
    "contact_name": "Ravi",
    "contact_phone": "9xxxxxxxxx"
  },
  "parcel": { "weight_kg": 2, "contents": "Apparel" },
  "reference_id": "SHOPIFY-10234"
}
```

**Response**

```json
{
  "id": "8f3a...",
  "order_no": "GR-260722-8F3K",
  "tracking_url": "/t/GR-260722-8F3K?k=...",
  "otp": "4210",
  "fare": 172,
  "fare_breakup": { ... }
}
```

---

### `GET /orders/{id}` — full status

```json
{
  "order": { "id": "...", "status": "in_transit", "riders": { "vehicle_number": "TS 09 AB 1234", ... }, ... },
  "location": { "lat": 17.42, "lng": 78.48, "heading": 91, "recorded_at": "2026-07-22T09:14:22Z" }
}
```

### `GET /orders?status=in_transit` — list

Returns up to 100 most recent orders you created. Filter with `?status=<order_status>`.

### `POST /orders/{id}/cancel` — cancel before pickup

```json
{ "reason": "customer requested" }
```

Returns `409` if the order has already been picked up or completed.

### `GET /serviceability?lat=&lng=` — is this address covered

```json
{ "serviceable": true, "city": "Hyderabad" }
```

---

## Webhook

Set `webhook_url` on your partner record (Admin panel). Every status change fires:

```
POST <webhook_url>
Content-Type: application/json
X-GoRide-Signature: v1=<hmac_sha256_hex>

{
  "event": "status",
  "order_id": "...",
  "at": "2026-07-22T09:14:22Z",
  "status": "arrived",
  "rider": { "name": "...", "vehicle_number": "..." },
  "location": { "lat": 17.42, "lng": 78.48 }
}
```

### Verify signature

```js
import crypto from 'node:crypto';

function verify(bodyString, header, secret) {
  const [version, sig] = header.split('=');
  if (version !== 'v1') return false;
  const expected = crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
```

Retries: on non-2xx, we retry up to 5 times with exponential backoff (10s, 30s, 2m, 10m, 1h). After that the delivery is marked failed in our webhook log — you can pull latest status via `GET /orders/{id}`.

---

## Order status lifecycle

```
searching → accepted → arrived → picked_up → in_transit → delivered
                          ↓                                    ↑
                          → completed (rides only)
                     cancelled_customer / cancelled_rider / no_rider_found
```

For parcel services the final state is `delivered`. For rides it is `completed`.

## Service codes

| Code | Vehicle |
|---|---|
| `parcel_bike` | Bike (≤ 8 kg) |
| `parcel_scooter` | Scooter (≤ 8 kg) |
| `parcel_auto` | Auto (≤ 40 kg) |
| `parcel_truck` | Mini truck (≤ 500 kg) |

---

## Full curl example

```bash
curl -sS -X POST https://api.<your-domain>/partner/v1/orders \
  -H "X-API-Key: pk_live_xxx" \
  -H "Content-Type: application/json" \
  -d @order.json | jq
```
