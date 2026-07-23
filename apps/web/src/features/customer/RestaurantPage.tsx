import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import type { MenuGroup, MenuItem, Restaurant } from '@/lib/types';
import { inr } from '@/lib/format';
import Skeleton from '@/components/ui/Skeleton';
import LoadingScreen from '@/components/ui/LoadingScreen';
import {
  addOne,
  cartCount,
  cartSubtotal,
  ensureRestaurant,
  loadCart,
  removeOne,
  saveCart,
  type CartSnapshot,
} from '@/lib/foodCart';

interface Payload { restaurant: Restaurant; menu: MenuGroup[] }

export default function RestaurantPage() {
  const nav = useNavigate();
  const { restaurantId } = useParams();
  const [data, setData] = useState<Payload | null>(null);
  const [cart, setCart] = useState<CartSnapshot | null>(loadCart());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!restaurantId) return;
    setLoading(true);
    api.get<Payload>(`/food/restaurants/${restaurantId}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [restaurantId]);

  // Whenever the cart changes, mirror it to localStorage.
  useEffect(() => { saveCart(cart); }, [cart]);

  const qtyByItem = useMemo(() => {
    if (!cart || cart.restaurant_id !== restaurantId) return new Map<string, number>();
    return new Map(cart.lines.map((l) => [l.menu_item_id, l.qty]));
  }, [cart, restaurantId]);

  function inc(item: MenuItem) {
    if (!data) return;
    const base = ensureRestaurant(cart, data.restaurant);
    if (!base) return; // user declined the clear-cart prompt
    setCart(addOne(base, { id: item.id, name: item.name, price: Number(item.price), is_veg: item.is_veg }));
  }
  function dec(item: MenuItem) {
    if (!cart) return;
    setCart(removeOne(cart, item.id));
  }

  if (loading || !data) {
    return (
      <div className="h-full bg-surface-muted">
        <Skeleton className="h-40 w-full" rounded="sm" />
        <div className="p-4 space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-56" />
        </div>
        {!data && loading && <LoadingScreen label="Loading menu…" />}
      </div>
    );
  }

  const { restaurant, menu } = data;
  const activeCart = cart && cart.restaurant_id === restaurant.id ? cart : null;
  const n = cartCount(activeCart);
  const subtotal = cartSubtotal(activeCart);
  const belowMin = subtotal > 0 && subtotal < restaurant.min_order;

  return (
    <div className="h-full bg-surface-muted">
      {/* Hero */}
      <div className="relative">
        {restaurant.image_url && (
          <div className="h-40 bg-slate-200 overflow-hidden">
            <img
              src={restaurant.image_url}
              alt={restaurant.name}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
        )}
        <Link
          to="/food"
          className="absolute top-3 left-3 rounded-xl bg-white/95 shadow-card px-3 py-2 text-sm"
        >
          ←
        </Link>
      </div>

      <div className="max-w-md mx-auto p-4 -mt-8 relative z-10">
        <div className="card">
          <div className="flex items-baseline justify-between">
            <h1 className="text-xl font-bold">{restaurant.name}</h1>
            <div className="text-xs bg-emerald-50 text-emerald-800 rounded-md px-1.5 py-0.5 border border-emerald-200">
              ★ {(restaurant.rating ?? 0).toFixed(1)}
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-1">{restaurant.cuisine} · {restaurant.address}</div>
          <div className="mt-2 flex items-center gap-3 text-xs text-slate-600">
            <span>⏱ {restaurant.avg_prep_min} min</span>
            <span>·</span>
            <span>Min order {inr(restaurant.min_order)}</span>
          </div>
        </div>
      </div>

      {/* Menu grouped by category */}
      <div className="max-w-md mx-auto px-4 pb-28 space-y-6">
        {menu.map((group) => (
          <section key={group.category}>
            <h2 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2 mt-2">
              {group.category}
            </h2>
            <div className="space-y-2">
              {group.items.map((it) => {
                const qty = qtyByItem.get(it.id) ?? 0;
                return (
                  <div key={it.id} className="card flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block h-3 w-3 border ${it.is_veg ? 'border-emerald-600' : 'border-red-600'}`}
                          aria-label={it.is_veg ? 'Veg' : 'Non-veg'}
                        >
                          <span className={`block h-1.5 w-1.5 m-[1px] rounded-full ${it.is_veg ? 'bg-emerald-600' : 'bg-red-600'}`} />
                        </span>
                        <span className="font-medium truncate">{it.name}</span>
                      </div>
                      {it.description && (
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{it.description}</p>
                      )}
                      <div className="mt-1 text-sm font-bold">{inr(it.price)}</div>
                    </div>
                    {qty === 0 ? (
                      <button
                        onClick={() => inc(it)}
                        className="btn-ghost border border-brand-500 text-brand-800 py-1.5 px-3 text-sm font-semibold flex-shrink-0"
                      >
                        Add
                      </button>
                    ) : (
                      <div className="flex items-center gap-1 border border-brand-500 rounded-lg overflow-hidden flex-shrink-0">
                        <button onClick={() => dec(it)} className="px-3 py-1 text-brand-800 font-bold">−</button>
                        <span className="px-1 min-w-[20px] text-center font-semibold">{qty}</span>
                        <button onClick={() => inc(it)} className="px-3 py-1 text-brand-800 font-bold">+</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Sticky cart bar */}
      {activeCart && n > 0 && (
        <div className="fixed inset-x-0 bottom-3 z-30 pointer-events-none">
          <div className="max-w-md mx-auto px-3">
            <button
              onClick={() => nav('/food/checkout')}
              disabled={belowMin}
              className="pointer-events-auto flex items-center justify-between w-full bg-emerald-600 disabled:bg-slate-400 text-white rounded-2xl shadow-xl px-4 py-3 animate-slide-up"
            >
              <div className="text-left">
                <div className="text-xs opacity-80">{n} item{n > 1 ? 's' : ''}</div>
                <div className="font-bold">{inr(subtotal)}</div>
              </div>
              <span className="text-sm font-semibold">
                {belowMin ? `Add ${inr(restaurant.min_order - subtotal)} more` : 'Checkout →'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
