// Public developer docs — API reference for the D2C Partner API.
// No auth needed. Rendered at /developers on every URL.
import CodeBlock from '@/components/ui/CodeBlock';

const API_BASE = import.meta.env.VITE_API_URL || 'https://goride-api.YOUR-SUBDOMAIN.workers.dev';
const PARTNER_BASE = `${API_BASE}/partner/v1`;

const NAV = [
  { id: 'quickstart',   label: 'Quick start' },
  { id: 'authentication', label: 'Authentication' },
  { id: 'endpoints',    label: 'Endpoints' },
  { id: 'webhooks',     label: 'Webhooks' },
  { id: 'lifecycle',    label: 'Order lifecycle' },
  { id: 'errors',       label: 'Errors & limits' },
  { id: 'support',      label: 'Support' },
];

export default function DevelopersPage() {
  return (
    <div className="min-h-full bg-white">
      {/* Header */}
      <header className="border-b border-surface-border sticky top-0 bg-white/95 backdrop-blur z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2 font-bold">
            <span className="h-8 w-8 rounded-lg bg-brand-500 grid place-items-center text-surface-strong">Go</span>
            <span>GoRide<span className="text-slate-400 font-normal ml-2">Developers</span></span>
          </a>
          <div className="hidden md:flex items-center gap-4 text-xs text-slate-500">
            <a href="#quickstart" className="hover:text-surface-strong">Docs</a>
            <a href="#endpoints" className="hover:text-surface-strong">API reference</a>
            <a href="mailto:api@goride.local" className="btn-primary py-1.5 text-xs">Get API key</a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 py-16 border-b border-surface-border">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-surface-strong">
              Deliveries in <span className="text-brand-500">every corner</span> of your city
            </h1>
            <p className="mt-4 text-lg text-slate-600 max-w-md">
              REST API for e-commerce, cloud kitchens, and D2C brands. Create parcel deliveries in one call,
              track live, get status webhooks. Ready in 15 minutes.
            </p>
            <div className="mt-6 flex gap-3">
              <a href="#quickstart" className="btn-primary">Read the quick start</a>
              <a href="mailto:api@goride.local" className="btn-ghost border border-surface-border">Talk to sales</a>
            </div>
          </div>
          <div className="hidden md:block">
            <CodeBlock
              language="curl"
              code={`curl -X POST ${PARTNER_BASE}/orders \\
  -H "X-API-Key: pk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d @order.json`}
            />
          </div>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-6 py-10 grid md:grid-cols-[200px_1fr] gap-8">
        {/* Sticky side-nav */}
        <nav className="hidden md:block">
          <ul className="sticky top-24 space-y-1 text-sm">
            {NAV.map((n) => (
              <li key={n.id}>
                <a href={`#${n.id}`} className="block px-3 py-1.5 rounded hover:bg-surface-muted text-slate-600 hover:text-surface-strong">
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 space-y-16">
          {/* Quick start */}
          <section id="quickstart" className="scroll-mt-24">
            <h2 className="text-2xl font-bold mb-2">Quick start</h2>
            <p className="text-slate-600 text-sm mb-6">Three steps to your first successful delivery.</p>

            <div className="space-y-6">
              <Step n={1} title="Get an API key">
                Email <a className="underline" href="mailto:api@goride.local">api@goride.local</a> with your business name.
                We'll create a partner and send you two values: an <code className="text-xs bg-surface-muted px-1.5 py-0.5 rounded">API key</code> and a
                <code className="text-xs bg-surface-muted px-1.5 py-0.5 rounded">webhook signing secret</code>.
                Both are shown once — save them in your secrets manager.
              </Step>

              <Step n={2} title="Confirm the location is serviceable">
                <CodeBlock language="curl" code={`curl "${PARTNER_BASE}/serviceability?lat=17.3850&lng=78.4867" \\
  -H "X-API-Key: pk_live_xxx"

# → {"serviceable": true, "city": "Hyderabad"}`} />
              </Step>

              <Step n={3} title="Create a parcel order">
                <CodeBlock language="bash" code={`curl -X POST ${PARTNER_BASE}/orders \\
  -H "X-API-Key: pk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "service": "parcel_bike",
    "city": "Hyderabad",
    "pickup": {
      "lat": 17.4065, "lng": 78.5691,
      "address": "Warehouse 12, Uppal",
      "contact_name": "Store", "contact_phone": "9xxxxxxxxx"
    },
    "drop": {
      "lat": 17.4483, "lng": 78.3915,
      "address": "Flat 301, Madhapur",
      "contact_name": "Ravi", "contact_phone": "9xxxxxxxxx"
    },
    "parcel": { "weight_kg": 2, "contents": "Documents" },
    "reference_id": "ORDER-10234"
  }'`} />
                <p className="text-sm text-slate-600 mt-3">
                  Response includes <code>order_no</code>, <code>tracking_url</code> (public share link — no login required),
                  and the plaintext <code>otp</code> which your rider will ask for at pickup.
                </p>
              </Step>
            </div>
          </section>

          {/* Authentication */}
          <section id="authentication" className="scroll-mt-24">
            <h2 className="text-2xl font-bold mb-2">Authentication</h2>
            <p className="text-slate-600 text-sm mb-4">
              Every request needs an <code>X-API-Key</code> header. Keys start with{' '}
              <code>pk_live_</code> followed by 32 hex characters.
            </p>
            <CodeBlock language="http" code={`GET /partner/v1/orders HTTP/1.1
Host: goride-api.example.workers.dev
X-API-Key: pk_live_a4d8c2b3f1e0...
Accept: application/json`} />
            <p className="text-xs text-slate-500">
              Only SHA-256 hashes are stored in our database. If you lose your key, ask your GoRide contact
              to rotate it — no way to recover the original.
            </p>
          </section>

          {/* Endpoints */}
          <section id="endpoints" className="scroll-mt-24">
            <h2 className="text-2xl font-bold mb-2">API reference</h2>
            <p className="text-slate-600 text-sm mb-6">Base URL: <code className="bg-surface-muted px-1.5 py-0.5 rounded">{PARTNER_BASE}</code></p>

            <Endpoint method="POST" path="/quotes" summary="Price a delivery route without creating an order.">
              <CodeBlock language="curl" code={`curl -X POST ${PARTNER_BASE}/quotes \\
  -H "X-API-Key: pk_live_xxx" -H "Content-Type: application/json" \\
  -d '{
    "service": "parcel_bike",
    "city": "Hyderabad",
    "pickup": {"lat": 17.4065, "lng": 78.5691},
    "drop":   {"lat": 17.4483, "lng": 78.3915}
  }'`} />
              <p className="text-xs text-slate-500 mb-2">Response</p>
              <CodeBlock language="json" code={`{
  "distance_km": 14.2,
  "eta_min": 34,
  "fare": 172,
  "fare_breakup": {
    "base": 30, "distance": 122, "time": 0,
    "surge_multiplier": 1, "total": 172,
    "commission": 25.8, "rider_earning": 146.2
  },
  "polyline": "u{~vFvyys@..."
}`} />
            </Endpoint>

            <Endpoint method="POST" path="/orders" summary="Create a real delivery. Idempotent on (partner_id, reference_id) — retrying with the same reference_id returns the original order.">
              <p className="text-xs text-slate-500 mb-2">Request body — same as /quotes plus contact info, parcel details, and a partner-side reference_id.</p>
              <CodeBlock language="json" code={`{
  "service": "parcel_bike",
  "city": "Hyderabad",
  "pickup": {
    "lat": 17.4065, "lng": 78.5691,
    "address": "Warehouse 12, Uppal",
    "contact_name": "Store", "contact_phone": "9xxxxxxxxx"
  },
  "drop": {
    "lat": 17.4483, "lng": 78.3915,
    "address": "Flat 301, Madhapur",
    "contact_name": "Ravi", "contact_phone": "9xxxxxxxxx"
  },
  "parcel": { "weight_kg": 2, "contents": "Documents" },
  "reference_id": "ORDER-10234"
}`} />
              <p className="text-xs text-slate-500 mb-2">Response</p>
              <CodeBlock language="json" code={`{
  "id": "8f3a...",
  "order_no": "GR-260722-8F3K",
  "tracking_url": "/t/GR-260722-8F3K?k=...",
  "otp": "4210",
  "fare": 172
}`} />
            </Endpoint>

            <Endpoint method="GET" path="/orders/{id}" summary="Get an order's full status, assigned rider, and last known location.">
              <CodeBlock language="curl" code={`curl "${PARTNER_BASE}/orders/8f3a..." \\
  -H "X-API-Key: pk_live_xxx"`} />
            </Endpoint>

            <Endpoint method="GET" path="/orders" summary="List your recent orders. Optional ?status= filter.">
              <CodeBlock language="curl" code={`curl "${PARTNER_BASE}/orders?status=in_transit" \\
  -H "X-API-Key: pk_live_xxx"`} />
            </Endpoint>

            <Endpoint method="POST" path="/orders/{id}/cancel" summary="Cancel before pickup. Returns 409 if the order is already in transit.">
              <CodeBlock language="curl" code={`curl -X POST ${PARTNER_BASE}/orders/8f3a.../cancel \\
  -H "X-API-Key: pk_live_xxx" -H "Content-Type: application/json" \\
  -d '{"reason": "Customer requested"}'`} />
            </Endpoint>

            <Endpoint method="GET" path="/serviceability?lat=&lng=" summary="Check whether a location is inside an active service area before offering delivery at checkout.">
              <CodeBlock language="curl" code={`curl "${PARTNER_BASE}/serviceability?lat=17.3850&lng=78.4867" \\
  -H "X-API-Key: pk_live_xxx"

# → {"serviceable": true, "city": "Hyderabad"}`} />
            </Endpoint>
          </section>

          {/* Webhooks */}
          <section id="webhooks" className="scroll-mt-24">
            <h2 className="text-2xl font-bold mb-2">Webhooks</h2>
            <p className="text-slate-600 text-sm mb-4">
              Set a webhook URL when we create your partner. Every order status change (accepted → arrived →
              picked_up → delivered) fires a POST to that URL, signed with HMAC-SHA256 so you can trust it.
            </p>

            <p className="text-xs text-slate-500 mb-2">Incoming request</p>
            <CodeBlock language="http" code={`POST /your-webhook HTTP/1.1
Host: your-store.com
Content-Type: application/json
X-GoRide-Signature: v1=6f2e...a7c3

{
  "event": "status",
  "order_id": "8f3a...",
  "at": "2026-07-22T09:14:22Z",
  "status": "arrived",
  "rider": { "name": "Amit", "vehicle_number": "TS 09 AB 1001" },
  "location": { "lat": 17.42, "lng": 78.48 }
}`} />

            <p className="text-sm font-medium mt-6 mb-2">Verify the signature</p>

            <p className="text-xs text-slate-500 mb-2">Node.js</p>
            <CodeBlock language="javascript" code={`import crypto from 'node:crypto';

function verifyGoRide(body, header, secret) {
  const [version, sig] = header.split('=');
  if (version !== 'v1') return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(sig, 'utf8'),
  );
}

// Express example:
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const ok = verifyGoRide(req.body, req.get('X-GoRide-Signature'), process.env.GORIDE_SECRET);
  if (!ok) return res.status(401).end();
  const event = JSON.parse(req.body);
  // ... handle event
  res.sendStatus(200);
});`} />

            <p className="text-xs text-slate-500 mb-2">Python</p>
            <CodeBlock language="python" code={`import hmac, hashlib

def verify_goride(body: bytes, header: str, secret: str) -> bool:
    version, _, sig = header.partition('=')
    if version != 'v1':
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)

# Flask example:
@app.route('/webhook', methods=['POST'])
def webhook():
    ok = verify_goride(request.data, request.headers.get('X-GoRide-Signature',''), os.environ['GORIDE_SECRET'])
    if not ok:
        return '', 401
    event = request.get_json()
    # ... handle event
    return '', 200`} />

            <p className="text-xs text-slate-500 mb-2">PHP</p>
            <CodeBlock language="php" code={`<?php
function verify_goride(string $body, string $header, string $secret): bool {
    [$version, $sig] = explode('=', $header, 2) + [null, null];
    if ($version !== 'v1') return false;
    $expected = hash_hmac('sha256', $body, $secret);
    return hash_equals($expected, $sig);
}

$body = file_get_contents('php://input');
$header = $_SERVER['HTTP_X_GORIDE_SIGNATURE'] ?? '';
if (!verify_goride($body, $header, getenv('GORIDE_SECRET'))) {
    http_response_code(401); exit;
}
$event = json_decode($body, true);
// ... handle event`} />

            <p className="text-xs text-slate-500 mt-4">
              On non-2xx responses we retry up to 5 times with exponential backoff (10s, 30s, 2m, 10m, 1h).
              After that the delivery is marked failed in our internal log — you can always poll{' '}
              <code>GET /orders/{'{id}'}</code> to get the current status.
            </p>
          </section>

          {/* Order lifecycle */}
          <section id="lifecycle" className="scroll-mt-24">
            <h2 className="text-2xl font-bold mb-2">Order lifecycle</h2>
            <p className="text-slate-600 text-sm mb-4">
              Every order flows through these states. Ride orders end at <code>completed</code>;
              parcel orders end at <code>delivered</code>.
            </p>

            <div className="rounded-2xl bg-surface-muted p-6 my-4 overflow-x-auto">
              <div className="min-w-[520px] flex items-center gap-3 text-xs text-center">
                {[
                  { s: 'searching',  c: 'bg-amber-100 text-amber-800 border-amber-400' },
                  { s: 'accepted',   c: 'bg-blue-100 text-blue-800 border-blue-400' },
                  { s: 'arrived',    c: 'bg-blue-100 text-blue-800 border-blue-400' },
                  { s: 'picked_up',  c: 'bg-indigo-100 text-indigo-800 border-indigo-400' },
                  { s: 'in_transit', c: 'bg-indigo-100 text-indigo-800 border-indigo-400' },
                  { s: 'delivered',  c: 'bg-emerald-100 text-emerald-800 border-emerald-400' },
                ].map((step, i) => (
                  <div key={step.s} className="flex items-center gap-2 flex-1">
                    <div className={`flex-1 rounded-lg border px-3 py-2 font-mono ${step.c}`}>
                      {step.s}
                    </div>
                    {i < 5 && <span className="text-slate-400">→</span>}
                  </div>
                ))}
              </div>
              <div className="mt-4 text-xs text-slate-500 text-center">
                Terminal states also include: <code>cancelled_customer</code>, <code>cancelled_rider</code>, <code>no_rider_found</code>
              </div>
            </div>
          </section>

          {/* Errors */}
          <section id="errors" className="scroll-mt-24">
            <h2 className="text-2xl font-bold mb-2">Errors &amp; rate limits</h2>
            <p className="text-slate-600 text-sm mb-4">All error responses are JSON in this shape:</p>
            <CodeBlock language="json" code={`{ "error": { "code": "overweight", "message": "Max weight 8 kg for this service" } }`} />

            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-surface-muted text-xs uppercase text-slate-500">
                  <tr>
                    <th className="text-left p-3">HTTP</th>
                    <th className="text-left p-3">error.code</th>
                    <th className="text-left p-3">Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['400', 'bad_request',       'Request body did not match schema'],
                    ['400', 'overweight',        'Parcel weight exceeds vehicle limit'],
                    ['401', 'invalid_key',       'X-API-Key missing or unknown'],
                    ['404', 'not_found',         'Order does not belong to your partner'],
                    ['404', 'no_rate_card',     'No active rate card for that city + service'],
                    ['409', 'already_final',    'Order already completed or cancelled'],
                    ['409', 'in_progress',      'Order already picked up — cannot cancel'],
                    ['429', 'rate_limited',     'More than 60 requests/minute per key'],
                    ['500', 'insert_failed',    'Server-side database error'],
                  ].map(([code, name, meaning]) => (
                    <tr key={name} className="border-t border-surface-border">
                      <td className="p-3 font-mono text-xs">{code}</td>
                      <td className="p-3 font-mono text-xs">{name}</td>
                      <td className="p-3 text-xs text-slate-600">{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-500 mt-4">
              Default rate limit: <b>60 requests/minute per key</b>. Ask your GoRide contact to raise it if
              you're doing bulk imports.
            </p>
          </section>

          {/* Support */}
          <section id="support" className="scroll-mt-24">
            <h2 className="text-2xl font-bold mb-2">Support</h2>
            <p className="text-sm text-slate-600 mb-4">
              Questions, key rotation, or partnership requests — reach us at{' '}
              <a href="mailto:api@goride.local" className="underline font-medium">api@goride.local</a>.
            </p>
            <p className="text-xs text-slate-500">
              Source of truth for these docs:{' '}
              <a href="https://github.com/Vinay1812007/Go-Ride/blob/main/docs/PARTNER-API.md" className="underline">docs/PARTNER-API.md</a>.
            </p>
          </section>
        </main>
      </div>

      <footer className="border-t border-surface-border mt-16">
        <div className="max-w-5xl mx-auto px-6 py-6 text-xs text-slate-500 flex justify-between">
          <span>© {new Date().getFullYear()} GoRide</span>
          <span>© OpenStreetMap contributors</span>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------- Bits ----------------------------

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="h-8 w-8 rounded-full bg-brand-500 grid place-items-center font-bold text-sm text-surface-strong shrink-0">
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold mb-1">{title}</h3>
        <div className="text-sm text-slate-600">{children}</div>
      </div>
    </div>
  );
}

function Endpoint({ method, path, summary, children }: {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  summary: string;
  children: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    GET:    'bg-blue-100 text-blue-800',
    POST:   'bg-emerald-100 text-emerald-800',
    PUT:    'bg-amber-100 text-amber-800',
    DELETE: 'bg-red-100 text-red-800',
  };
  return (
    <div className="border-t border-surface-border pt-5 pb-2 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-2 mb-1">
        <span className={`text-[10px] font-bold px-2 py-1 rounded ${colors[method]}`}>{method}</span>
        <code className="font-semibold text-sm">{path}</code>
      </div>
      <p className="text-sm text-slate-600 mb-3">{summary}</p>
      {children}
    </div>
  );
}
