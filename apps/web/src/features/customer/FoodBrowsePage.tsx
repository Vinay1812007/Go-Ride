import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import type { Restaurant } from '@/lib/types';
import { inr } from '@/lib/format';
import { cartCount, cartSubtotal, loadCart } from '@/lib/foodCart';
import { useCity } from '@/hooks/useCity';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/cn';

interface Payload { restaurants: Restaurant[]; cuisines: string[] }

export default function FoodBrowsePage() {
  const nav = useNavigate();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [cuisine, setCuisine] = useState<string | null>(null);

  const { city } = useCity();

  useEffect(() => {
    setLoading(true);
    api.get<Payload>(`/food/restaurants?city=${encodeURIComponent(city)}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [city]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.restaurants.filter((r) => {
      if (cuisine && r.cuisine !== cuisine) return false;
      if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [data, cuisine, q]);

  const cart = loadCart();
  const cartN = cartCount(cart);
  const cartAmt = cartSubtotal(cart);

  return (
    <div className="h-full bg-surface-muted">
      <header className="bg-white border-b border-surface-border sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/" className="text-slate-500 text-lg leading-none">←</Link>
          <div className="flex-1">
            <div className="font-bold">Food delivery</div>
            <div className="text-xs text-slate-500">{city}</div>
          </div>
        </div>
        <div className="max-w-md mx-auto px-4 pb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search restaurants…"
            className="input"
          />
        </div>
        {data && data.cuisines.length > 0 && (
          <div className="max-w-md mx-auto px-4 pb-3 flex gap-2 overflow-x-auto">
            <button
              onClick={() => setCuisine(null)}
              className={cn(
                'whitespace-nowrap text-xs px-3 py-1.5 rounded-full border',
                !cuisine ? 'bg-brand-500 border-brand-500 text-surface-strong font-semibold' : 'bg-white border-surface-border text-slate-700',
              )}
            >
              All
            </button>
            {data.cuisines.map((c) => (
              <button
                key={c}
                onClick={() => setCuisine(c)}
                className={cn(
                  'whitespace-nowrap text-xs px-3 py-1.5 rounded-full border',
                  cuisine === c ? 'bg-brand-500 border-brand-500 text-surface-strong font-semibold' : 'bg-white border-surface-border text-slate-700',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="max-w-md mx-auto p-4 space-y-3 pb-24">
        {loading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-0 overflow-hidden">
            <Skeleton className="h-32 w-full" rounded="sm" />
            <div className="p-3 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        ))}

        {!loading && filtered.length === 0 && (
          <EmptyState
            icon="🍽️"
            title="No restaurants match"
            description={q || cuisine ? 'Try clearing your search or picking a different cuisine.' : 'None open in your area right now.'}
            cta={q || cuisine ? { label: 'Clear filters', onClick: () => { setQ(''); setCuisine(null); } } : undefined}
          />
        )}

        {filtered.map((r) => (
          <button
            key={r.id}
            onClick={() => nav(`/food/${r.id}`)}
            className="block card p-0 overflow-hidden w-full text-left animate-fade-in hover:shadow-lg transition"
          >
            {r.image_url && (
              <div className="h-32 bg-slate-100 overflow-hidden">
                <img
                  src={r.image_url}
                  alt={r.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              </div>
            )}
            <div className="p-3">
              <div className="flex items-baseline justify-between">
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs bg-emerald-50 text-emerald-800 rounded-md px-1.5 py-0.5 border border-emerald-200">
                  ★ {(r.rating ?? 0).toFixed(1)}
                </div>
              </div>
              <div className="text-xs text-slate-500 mt-1">{r.cuisine}</div>
              {r.description && (
                <div className="text-xs text-slate-500 mt-1 line-clamp-2">{r.description}</div>
              )}
              <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                <span>⏱ {r.avg_prep_min} min</span>
                <span>Min {inr(r.min_order)}</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Sticky cart summary bar if there's something in it */}
      {cart && cartN > 0 && (
        <div className="fixed inset-x-0 bottom-3 z-30 pointer-events-none">
          <div className="max-w-md mx-auto px-3">
            <button
              onClick={() => nav(`/food/${cart.restaurant_id}`)}
              className="pointer-events-auto flex items-center justify-between w-full bg-emerald-600 text-white rounded-2xl shadow-xl px-4 py-3 animate-slide-up"
            >
              <div className="text-left">
                <div className="text-xs opacity-80">{cartN} item{cartN > 1 ? 's' : ''} · {cart.restaurant_name}</div>
                <div className="font-bold">{inr(cartAmt)}</div>
              </div>
              <span className="text-sm font-semibold">Open cart →</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
