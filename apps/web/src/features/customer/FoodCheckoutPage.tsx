import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { getCurrentPosition, reverseGeocode, DEFAULT_CENTER } from '@/lib/geo';
import { inr } from '@/lib/format';
import type { LatLng } from '@/lib/types';
import { cartSubtotal, loadCart, saveCart, addOne, removeOne, type CartSnapshot } from '@/lib/foodCart';
import Spinner from '@/components/ui/Spinner';
import PromoInput from '@/components/PromoInput';
import { useWalletBalance } from '@/hooks/useWalletBalance';
import { useToast } from '@/components/ui/Toast';

export default function FoodCheckoutPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [cart, setCart] = useState<CartSnapshot | null>(loadCart());
  const [drop, setDrop] = useState<(LatLng & { address: string }) | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState('');
  const [payment, setPayment] = useState<'cash' | 'upi'>('cash');
  const [feeQuote, setFeeQuote] = useState<{ fare: number; distance_km: number; duration_min: number } | null>(null);
  const [placing, setPlacing] = useState(false);
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState<number>(0);
  const [walletApply, setWalletApply] = useState(false);
  const { balance: walletBalance } = useWalletBalance();

  // Grab customer's location for the drop address.
  useEffect(() => {
    getCurrentPosition().then(async (p) => {
      try {
        const rev = await reverseGeocode(p.lat, p.lng);
        setDrop({ ...p, address: rev.label });
      } catch {
        setDrop({ ...p, address: `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` });
      }
    }).catch(() => {
      setLocError('Could not read your location. Please enter a delivery address.');
      setDrop({ ...DEFAULT_CENTER, address: 'Hyderabad (default)' });
    });
  }, []);

  // Whenever cart or drop location changes, requote the delivery fee.
  useEffect(() => {
    if (!cart || !drop) return;
    api.post<{ fare: number; distance_km: number; duration_min: number }>('/fare/quote', {
      pickup: { lat: cart.restaurant_lat, lng: cart.restaurant_lng },
      drop:   { lat: drop.lat, lng: drop.lng },
      service: 'food',
      city: import.meta.env.VITE_DEFAULT_CITY ?? 'Hyderabad',
    }).then(setFeeQuote).catch(() => setFeeQuote(null));
  }, [cart?.restaurant_id, cart?.lines.length, drop?.lat, drop?.lng]);
  useEffect(() => { saveCart(cart); }, [cart]);

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="h-full grid place-items-center bg-surface-muted p-6 text-center">
        <div className="card max-w-sm">
          <div className="text-4xl mb-2">🍽️</div>
          <div className="font-semibold mb-1">Your cart is empty</div>
          <p className="text-sm text-slate-500 mb-4">Add items from a restaurant to place an order.</p>
          <Link to="/food" className="btn-primary block">Browse restaurants</Link>
        </div>
      </div>
    );
  }

  const subtotal = cartSubtotal(cart);
  const fee = feeQuote?.fare ?? 0;
  const walletApplied = walletApply ? Math.min(walletBalance, Math.max(0, subtotal + fee - promoDiscount)) : 0;
  const total = Math.max(0, subtotal + fee - promoDiscount - walletApplied);
  const belowMin = subtotal < cart.min_order;

  async function placeOrder() {
    if (!cart || !drop) return;
    if (belowMin) return;
    setPlacing(true);
    try {
      const res = await api.post<{ id: string; order_no: string }>('/orders', {
        service: 'food',
        city: import.meta.env.VITE_DEFAULT_CITY ?? 'Hyderabad',
        restaurant_id: cart.restaurant_id,
        pickup: { lat: cart.restaurant_lat, lng: cart.restaurant_lng, address: `${cart.restaurant_name} · ${cart.restaurant_address}` },
        drop:   { lat: drop.lat, lng: drop.lng, address: drop.address },
        payment_method: payment,
        food: {
          items: cart.lines.map((l) => ({
            menu_item_id: l.menu_item_id,
            name: l.name,
            qty: l.qty,
            price: l.price,
          })),
          instructions: instructions.trim() || undefined,
          subtotal,
        },
        promo_code: promoCode ?? undefined,
        wallet_apply: walletApply,
      });
      // Cart is placed → clear it before tracking.
      saveCart(null); setCart(null);
      toast.success('Order placed! Finding a captain to pick it up.');
      nav(`/track/${res.id}`, { replace: true });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not place order');
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className="h-full bg-surface-muted overflow-y-auto pb-24">
      <header className="bg-white border-b border-surface-border sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <Link to={`/food/${cart.restaurant_id}`} className="text-slate-500 text-lg leading-none">←</Link>
          <div className="flex-1">
            <div className="font-bold">Checkout</div>
            <div className="text-xs text-slate-500 truncate">{cart.restaurant_name}</div>
          </div>
        </div>
      </header>

      <div className="max-w-md mx-auto p-4 space-y-3">
        {/* Items list */}
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Your order</div>
          <div className="space-y-2">
            {cart.lines.map((l) => (
              <div key={l.menu_item_id} className="flex items-center gap-2 text-sm">
                <span
                  className={`inline-block h-3 w-3 border ${l.is_veg ? 'border-emerald-600' : 'border-red-600'} flex-shrink-0`}
                >
                  <span className={`block h-1.5 w-1.5 m-[1px] rounded-full ${l.is_veg ? 'bg-emerald-600' : 'bg-red-600'}`} />
                </span>
                <span className="flex-1 truncate">{l.name}</span>
                <div className="flex items-center gap-1 border border-surface-border rounded-md overflow-hidden">
                  <button onClick={() => setCart(removeOne(cart, l.menu_item_id))} className="px-2 py-0.5 text-brand-800 font-bold">−</button>
                  <span className="px-1 min-w-[16px] text-center text-xs font-semibold">{l.qty}</span>
                  <button onClick={() => setCart(addOne(cart, { id: l.menu_item_id, name: l.name, price: l.price, is_veg: l.is_veg }))} className="px-2 py-0.5 text-brand-800 font-bold">+</button>
                </div>
                <span className="w-16 text-right font-semibold">{inr(l.qty * l.price)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Delivery address */}
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Deliver to</div>
          {locError && <p className="text-xs text-amber-700 mb-2">{locError}</p>}
          <input
            className="input"
            placeholder="Delivery address"
            value={drop?.address ?? ''}
            onChange={(e) => drop && setDrop({ ...drop, address: e.target.value })}
          />
          <p className="text-[11px] text-slate-500 mt-2">
            Pickup: {cart.restaurant_name} · {cart.restaurant_address}
          </p>
        </div>

        {/* Instructions */}
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
            Instructions (optional)
          </div>
          <textarea
            className="input"
            placeholder="Extra spice, no onion, ring the bell, etc."
            rows={2}
            maxLength={300}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </div>

        {/* Payment */}
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Payment</div>
          <div className="flex gap-2">
            <button
              onClick={() => setPayment('cash')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                payment === 'cash' ? 'bg-brand-500 text-surface-strong border-brand-500' : 'bg-white border-surface-border text-slate-700'
              }`}
            >
              Cash on delivery
            </button>
            <button
              onClick={() => setPayment('upi')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                payment === 'upi' ? 'bg-brand-500 text-surface-strong border-brand-500' : 'bg-white border-surface-border text-slate-700'
              }`}
            >
              UPI
            </button>
          </div>
        </div>

        {/* Promo + wallet */}
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Offers</div>
          <PromoInput
            service="food"
            pickup={{ lat: cart.restaurant_lat, lng: cart.restaurant_lng }}
            drop={drop ?? { lat: cart.restaurant_lat, lng: cart.restaurant_lng }}
            city={import.meta.env.VITE_DEFAULT_CITY ?? 'Hyderabad'}
            foodSubtotal={subtotal}
            appliedCode={promoCode}
            appliedDiscount={promoDiscount}
            onApply={(c, d) => { setPromoCode(c); setPromoDiscount(d); }}
            onClear={() => { setPromoCode(null); setPromoDiscount(0); }}
            walletBalance={walletBalance}
            walletApply={walletApply}
            onWalletToggle={setWalletApply}
          />
        </div>

        {/* Bill summary */}
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Bill</div>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt>Food subtotal</dt><dd>{inr(subtotal)}</dd></div>
            <div className="flex justify-between">
              <dt>Delivery fee {feeQuote && <span className="text-xs text-slate-500">({feeQuote.distance_km.toFixed(1)} km)</span>}</dt>
              <dd>{feeQuote ? inr(fee) : <Spinner className="h-3 w-3 inline-block" />}</dd>
            </div>
            {promoDiscount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <dt>Promo {promoCode && <span className="font-mono text-xs">{promoCode}</span>}</dt>
                <dd>−{inr(promoDiscount)}</dd>
              </div>
            )}
            {walletApplied > 0 && (
              <div className="flex justify-between text-emerald-700">
                <dt>Wallet applied</dt>
                <dd>−{inr(walletApplied)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-surface-border pt-2 mt-2 font-bold">
              <dt>Total</dt><dd>{inr(total)}</dd>
            </div>
          </dl>
          {belowMin && (
            <p className="text-xs text-amber-700 mt-2">
              Minimum order is {inr(cart.min_order)}. Add {inr(cart.min_order - subtotal)} more.
            </p>
          )}
        </div>
      </div>

      {/* Sticky place-order bar */}
      <div className="fixed inset-x-0 bottom-3 z-30 pointer-events-none">
        <div className="max-w-md mx-auto px-3">
          <button
            onClick={placeOrder}
            disabled={placing || belowMin || !feeQuote || !drop}
            className="pointer-events-auto flex items-center justify-between w-full bg-emerald-600 disabled:bg-slate-400 text-white rounded-2xl shadow-xl px-4 py-3 animate-slide-up"
          >
            <div className="text-left">
              <div className="text-xs opacity-80">Pay {payment === 'cash' ? 'cash on delivery' : 'via UPI'}</div>
              <div className="font-bold">{inr(total)}</div>
            </div>
            <span className="text-sm font-semibold inline-flex items-center gap-1">
              {placing && <Spinner className="h-3 w-3" />}
              {placing ? 'Placing…' : 'Place order →'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
