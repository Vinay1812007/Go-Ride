import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useSession } from './lib/session';
import AuthPage from './features/auth/AuthPage';
import HomePage from './features/customer/HomePage';
import LoadingScreen from './components/ui/LoadingScreen';

// ── Lazy chunks ──────────────────────────────────────────────────────────
// Every page below is only reachable from a specific route, so we split
// them out of the main bundle. First-paint routes (HomePage, AuthPage)
// stay eager so the login / home experience never shows a spinner-on-load.
//
// Grouping notes:
//   • Admin: one big chunk (all admin pages share so much layout that
//     splitting them further just adds spinner-on-tab-switch pain).
//   • Rider: CaptainShell owns its own children (OfferCard, TripPage,
//     OnboardPage) as internal imports, so lazily loading the shell
//     splits the whole rider experience.
//   • Food: three routes, split as one chunk since a customer entering
//     the food flow is likely to open several restaurants.
//   • DevelopersPage: content-heavy public doc, not needed for anyone
//     signed in.
const OrderPage        = lazy(() => import('./features/customer/OrderPage'));
const TrackingPage     = lazy(() => import('./features/customer/TrackingPage'));
const HistoryPage      = lazy(() => import('./features/customer/HistoryPage'));
const PublicTrackPage  = lazy(() => import('./features/customer/PublicTrackPage'));
const FoodBrowsePage   = lazy(() => import('./features/customer/FoodBrowsePage'));
const RestaurantPage   = lazy(() => import('./features/customer/RestaurantPage'));
const FoodCheckoutPage = lazy(() => import('./features/customer/FoodCheckoutPage'));
const WalletPage       = lazy(() => import('./features/customer/WalletPage'));
const SupportPage      = lazy(() => import('./features/customer/SupportPage'));
const PlacesPage       = lazy(() => import('./features/customer/PlacesPage'));
const CustomerSettingsPage = lazy(() => import('./features/customer/SettingsPage'));
const CaptainShell     = lazy(() => import('./features/rider/CaptainShell'));
const AdminShell       = lazy(() => import('./features/admin/AdminShell'));
const RestaurantPartnerShell = lazy(() => import('./features/restaurant-partner/RestaurantPartnerShell'));
const DevelopersPage   = lazy(() => import('./features/developers/DevelopersPage'));

type Target = 'customer' | 'rider' | 'admin' | undefined;

// Wraps a Routes block so lazy-loaded pages get a graceful loading state
// instead of a blank screen while their chunk fetches.
function Suspended({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
}

function RoleMismatch({ target, role, email, profileMissing, onSignOut }: {
  target: Exclude<Target, undefined>;
  role: string;
  email: string | null;
  profileMissing: boolean;
  onSignOut: () => void;
}) {
  const map = {
    customer: { title: 'This is the passenger app', hint: 'Use the correct URL for your role.' },
    rider:    { title: 'This is the Captain app',   hint: 'Riders only. Sign out to switch accounts.' },
    admin:    { title: 'This is the Admin console', hint: 'Admins only. Contact your team lead if you need access.' },
  };
  const info = map[target];
  const suggestUrl = role === 'admin'
    ? 'https://goride-admin.pages.dev'
    : role === 'rider'
      ? 'https://goride-captain.pages.dev'
      : 'https://goride-web.pages.dev';

  return (
    <div className="h-full grid place-items-center bg-surface-muted p-4">
      <div className="max-w-md card text-center">
        <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-brand-500 grid place-items-center font-bold text-xl text-surface-strong">
          Go
        </div>
        <h1 className="text-lg font-bold mb-1">{info.title}</h1>
        <p className="text-sm text-slate-500 mb-4">{info.hint}</p>

        {/* Diagnostic block — shows exactly which account is signed in */}
        <div className="rounded-xl bg-surface-muted border border-surface-border p-3 text-left text-xs mb-4">
          <div className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">Signed in as</div>
          <div className="font-mono break-all text-sm mb-2">{email ?? '(no email)'}</div>
          <div className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">Detected role</div>
          <div className="font-mono text-sm">
            {role}
            {profileMissing && (
              <span className="ml-2 text-amber-700">(profile not found — API returned 401)</span>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-500 mb-4">
          You probably want{' '}
          <a href={suggestUrl} className="underline">the {role} app</a>.
        </p>
        <button onClick={onSignOut} className="btn-ghost w-full">
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { loading, userId, authEmail, profile, profileError, signOut } = useSession();
  const location = useLocation();

  // Public routes that don't require login
  const publicPath = location.pathname.startsWith('/t/') || location.pathname === '/developers';

  if (loading) return <LoadingScreen />;

  // Public: /t/:orderNo and /developers accessible on every target
  if (publicPath) {
    return (
      <Suspended>
        <Routes>
          <Route path="/t/:orderNo" element={<PublicTrackPage />} />
          <Route path="/developers" element={<DevelopersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspended>
    );
  }

  if (!userId) return <AuthPage />;

  const target = import.meta.env.VITE_APP_TARGET as Target;
  const role = profile?.role ?? 'customer';

  // ------------- Target-locked builds (Pages projects per role) -------------
  if (target === 'customer') {
    // Customer-only bundle. Restaurant partners share this build (they
    // sign up as customers, then get promoted by an admin) and get sent
    // straight to /partner.
    if (role === 'restaurant_partner') {
      return (
        <Suspended>
          <Routes>
            <Route path="/partner/*" element={<RestaurantPartnerShell />} />
            <Route path="*" element={<Navigate to="/partner" replace />} />
          </Routes>
        </Suspended>
      );
    }
    if (role !== 'customer') return <RoleMismatch target="customer" role={role} email={authEmail} profileMissing={profileError} onSignOut={signOut} />;
    return (
      <Suspended>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/order/:id" element={<OrderPage />} />
          <Route path="/track/:id" element={<TrackingPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/food" element={<FoodBrowsePage />} />
          <Route path="/food/checkout" element={<FoodCheckoutPage />} />
          <Route path="/food/:restaurantId" element={<RestaurantPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/places" element={<PlacesPage />} />
          <Route path="/settings" element={<CustomerSettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspended>
    );
  }

  if (target === 'rider') {
    // Rider bundle — customers can sign in and onboard to become riders.
    // Admins are blocked (they should use the admin URL).
    if (role === 'admin') return <RoleMismatch target="rider" role={role} email={authEmail} profileMissing={profileError} onSignOut={signOut} />;
    return (
      <Suspended>
        <Routes>
          <Route path="/captain/*" element={<CaptainShell />} />
          <Route path="*" element={<Navigate to="/captain" replace />} />
        </Routes>
      </Suspended>
    );
  }

  if (target === 'admin') {
    // Admin-only bundle; strict.
    if (role !== 'admin') return <RoleMismatch target="admin" role={role} email={authEmail} profileMissing={profileError} onSignOut={signOut} />;
    return (
      <Suspended>
        <Routes>
          <Route path="/admin/*" element={<AdminShell />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Suspended>
    );
  }

  // ------------- No target set: dynamic role-based routing -------------
  if (role === 'admin') {
    return (
      <Suspended>
        <Routes>
          <Route path="/admin/*" element={<AdminShell />} />
          <Route path="/captain/*" element={<CaptainShell />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Suspended>
    );
  }
  if (role === 'rider') {
    return (
      <Suspended>
        <Routes>
          <Route path="/captain/*" element={<CaptainShell />} />
          <Route path="*" element={<Navigate to="/captain" replace />} />
        </Routes>
      </Suspended>
    );
  }
  if (role === 'restaurant_partner') {
    return (
      <Suspended>
        <Routes>
          <Route path="/partner/*" element={<RestaurantPartnerShell />} />
          <Route path="*" element={<Navigate to="/partner" replace />} />
        </Routes>
      </Suspended>
    );
  }
  // Customer default
  return (
    <Suspended>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/order/:id" element={<OrderPage />} />
        <Route path="/track/:id" element={<TrackingPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/food" element={<FoodBrowsePage />} />
        <Route path="/food/checkout" element={<FoodCheckoutPage />} />
        <Route path="/food/:restaurantId" element={<RestaurantPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/places" element={<PlacesPage />} />
        <Route path="/settings" element={<CustomerSettingsPage />} />
        <Route path="/captain/*" element={<CaptainShell />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspended>
  );
}
