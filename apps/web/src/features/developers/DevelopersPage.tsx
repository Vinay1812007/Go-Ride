// Public developers page — rendered from docs/PARTNER-API.md at build time,
// but for MVP we ship a static curated view (docs page ships in full on Day 3).
export default function DevelopersPage() {
  return (
    <div className="min-h-full bg-white">
      <header className="border-b border-surface-border px-6 py-4 flex items-center justify-between">
        <a href="/" className="font-bold">GoRide · Developers</a>
        <a href="mailto:api@goride.local" className="text-sm text-slate-500">Contact</a>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-10 prose prose-slate">
        <h1>GoRide D2C Partner API</h1>
        <p>Programmatic parcel and food delivery on the GoRide fleet. All endpoints require an <code>X-API-Key</code> header. Get a key from your GoRide admin contact.</p>

        <h2>Base URL</h2>
        <pre>https://api.goride.local/partner/v1</pre>

        <h2>Endpoints</h2>
        <ul>
          <li><code>POST /quotes</code> — distance, ETA, and fare for a route</li>
          <li><code>POST /orders</code> — create a parcel order (idempotent on <code>reference_id</code>)</li>
          <li><code>GET  /orders/:id</code> — status + rider info + last location</li>
          <li><code>GET  /orders</code> — list your orders</li>
          <li><code>POST /orders/:id/cancel</code> — cancel before pickup</li>
          <li><code>GET  /serviceability?lat=&amp;lng=</code> — is this address inside a service area</li>
        </ul>

        <h2>Rate limit</h2>
        <p>60 requests/minute per key (configurable). 429 responses include a <code>Retry-After</code> header.</p>

        <h2>Webhook</h2>
        <p>Every order status change fires an HMAC-signed POST to your <code>webhook_url</code>. Header:</p>
        <pre>X-GoRide-Signature: v1=&lt;sha256_hex&gt;</pre>
        <p>Verify with the <code>webhook_secret</code> shown once at partner creation.</p>

        <h2>Example: create parcel</h2>
        <pre>{`curl -X POST https://api.goride.local/partner/v1/orders \\
  -H "X-API-Key: pk_live_xxx" -H "Content-Type: application/json" \\
  -d '{
    "service": "parcel_bike",
    "pickup": {"lat":17.4065,"lng":78.5691,"address":"Warehouse 12, Uppal"},
    "drop":   {"lat":17.4483,"lng":78.3915,"address":"Flat 301, Madhapur",
               "contact_name":"Ravi","contact_phone":"9xxxxxxxxx"},
    "parcel": {"weight_kg": 2, "contents": "Apparel"},
    "reference_id": "SHOPIFY-10234"
  }'`}</pre>

        <p className="text-xs text-slate-500">Full reference: <a href="https://github.com/Vinay1812007/Go-Ride/blob/main/docs/PARTNER-API.md">docs/PARTNER-API.md</a></p>
      </main>
    </div>
  );
}
