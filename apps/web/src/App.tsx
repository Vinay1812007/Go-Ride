import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useSession } from './lib/session';
import AuthPage from './features/auth/AuthPage';
import HomePage from './features/customer/HomePage';
import OrderPage from './features/customer/OrderPage';
import TrackingPage from './features/customer/TrackingPage';
import HistoryPage from './features/customer/HistoryPage';
import PublicTrackPage from './features/customer/PublicTrackPage';
import CaptainShell from './features/rider/CaptainShell';
import AdminShell from './features/admin/AdminShell';
import DevelopersPage from './features/developers/DevelopersPage';

function LoadingScreen() {
  return (
    <div className="h-full grid place-items-center bg-white">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 rounded-xl bg-brand-500 animate-pulse" />
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      </div>
    </div>
  );
}

export default function App() {
  const { loading, userId, profile } = useSession();
  const location = useLocation();

  // Public routes that don't require login.
  const publicPath = location.pathname.startsWith('/t/') || location.pathname === '/developers';

  if (loading) return <LoadingScreen />;
  if (!userId && !publicPath) {
    return <AuthPage />;
  }

  const target = import.meta.env.VITE_APP_TARGET;

  // In production the APK has VITE_APP_TARGET locked; on web we route by role.
  const role = profile?.role ?? 'customer';

  return (
    <Routes>
      {/* Public */}
      <Route path="/t/:orderNo" element={<PublicTrackPage />} />
      <Route path="/developers" element={<DevelopersPage />} />

      {/* Customer */}
      {(target === 'customer' || target == null) && role === 'customer' && (
        <>
          <Route path="/" element={<HomePage />} />
          <Route path="/order/:id" element={<OrderPage />} />
          <Route path="/track/:id" element={<TrackingPage />} />
          <Route path="/history" element={<HistoryPage />} />
        </>
      )}

      {/* Rider — /captain/* is available to any signed-in user so a customer can onboard */}
      <Route path="/captain/*" element={<CaptainShell />} />
      {role === 'rider' && target !== 'admin' && (
        <Route path="/" element={<Navigate to="/captain" replace />} />
      )}

      {/* Admin */}
      {(target === 'admin' || role === 'admin') && (
        <Route path="/admin/*" element={<AdminShell />} />
      )}
      {role === 'admin' && target !== 'rider' && (
        <Route path="/" element={<Navigate to="/admin" replace />} />
      )}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
