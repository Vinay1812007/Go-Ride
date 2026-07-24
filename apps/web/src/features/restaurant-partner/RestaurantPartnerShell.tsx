// Restaurant partner portal shell.
// Three tabs: Orders (live queue), Menu (their items), Info (their
// restaurant metadata — narrow field set, no lat/lng or city).
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { inr } from '@/lib/format';
import { useSession } from '@/lib/session';
import LoadingScreen from '@/components/ui/LoadingScreen';
import Skeleton from '@/components/ui/Skeleton';
import PartnerOrdersPage from './PartnerOrdersPage';
import PartnerMenuPage from './PartnerMenuPage';
import PartnerInfoPage from './PartnerInfoPage';

interface Me {
  profile: { id: string; full_name: string; email?: string | null; phone?: string | null };
  restaurant: {
    id: string; name: string; cuisine: string; address: string; city: string;
    lat: number; lng: number; phone?: string | null; image_url?: string | null;
    avg_prep_min: number; min_order: number; rating?: number | null; active: boolean;
    description?: string | null;
  };
  today: { orders: number; revenue: number };
  menu_item_count: number;
}

export default function RestaurantPartnerShell() {
  const { signOut } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.get<Me>('/partner-restaurant/me');
      setMe(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, []);

  if (loading && !me) return <LoadingScreen label="Loading your restaurant…" />;
  if (error || !me) {
    return (
      <div className="h-full grid place-items-center bg-surface-muted p-4">
        <div className="card max-w-md text-center">
          <div className="text-4xl mb-2">🍽️</div>
          <div className="font-semibold mb-1">No restaurant linked</div>
          <p className="text-sm text-slate-500 mb-4">
            Your account isn't linked to a restaurant yet. Ask an admin to link you from the Restaurants panel.
          </p>
          <button onClick={signOut} className="btn-ghost w-full">Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-surface-muted">
      <header className="bg-surface-strong text-white px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-xs opacity-80">Partner portal</div>
            <div className="font-bold truncate">{me.restaurant.name}</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs opacity-80">Today</div>
              <div className="text-sm font-bold">{me.today.orders} · {inr(me.today.revenue)}</div>
            </div>
            <button onClick={signOut} className="text-xs opacity-80 underline">Sign out</button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="bg-white border-b border-surface-border sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex">
          {[
            { to: '/partner',      label: 'Orders' },
            { to: '/partner/menu', label: 'Menu' },
            { to: '/partner/info', label: 'Info' },
          ].map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/partner'}
              className={({ isActive }) =>
                `flex-1 text-center py-3 text-sm font-medium border-b-2 ${
                  isActive ? 'border-brand-500 text-surface-strong' : 'border-transparent text-slate-500'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="max-w-3xl mx-auto">
        <Routes>
          <Route index element={<PartnerOrdersPage />} />
          <Route path="menu" element={<PartnerMenuPage restaurantId={me.restaurant.id} onChange={refresh} />} />
          <Route path="info" element={<PartnerInfoPage restaurant={me.restaurant} onChange={refresh} />} />
          <Route path="*" element={<Navigate to="/partner" replace />} />
        </Routes>
      </div>

      {loading && (
        <div className="fixed bottom-3 right-3 bg-white shadow-card rounded-full px-3 py-1 text-xs">
          <Skeleton className="h-3 w-16" />
        </div>
      )}
    </div>
  );
}
