// Reusable promo-code + wallet checkbox row.
// Parent owns the applied code + wallet toggle. Child does the API dance,
// shows inline errors, and displays the currently-applied discount with a
// "Remove" affordance.
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { inr } from '@/lib/format';
import type { LatLng, ServiceType } from '@/lib/types';

interface Props {
  service: ServiceType;
  pickup: LatLng;
  drop: LatLng;
  city: string;
  foodSubtotal?: number;         // required when service='food'
  // Applied state (parent-owned so it persists into the create-order call).
  appliedCode: string | null;
  appliedDiscount: number;
  onApply: (code: string, discount: number) => void;
  onClear: () => void;
  // Wallet
  walletBalance: number;
  walletApply: boolean;
  onWalletToggle: (v: boolean) => void;
}

export default function PromoInput({
  service, pickup, drop, city, foodSubtotal,
  appliedCode, appliedDiscount, onApply, onClear,
  walletBalance, walletApply, onWalletToggle,
}: Props) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setError(null); }, [appliedCode]);

  async function apply() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<{ code: string; discount: number; description?: string }>(
        '/promo/validate',
        {
          code: trimmed,
          service,
          city,
          pickup, drop,
          food_subtotal: foodSubtotal,
        },
      );
      onApply(res.code, res.discount);
      setCode('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Code check failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {appliedCode ? (
        <div className="flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-300 px-3 py-2">
          <div>
            <div className="text-xs uppercase tracking-wider text-emerald-700">
              Promo applied
            </div>
            <div className="font-mono font-semibold text-emerald-900">{appliedCode}</div>
          </div>
          <div className="text-right">
            <div className="font-bold text-emerald-900">−{inr(appliedDiscount)}</div>
            <button onClick={onClear} className="text-xs text-emerald-700 underline">Remove</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Promo code (e.g. WELCOME50)"
              maxLength={30}
              className="input flex-1 font-mono uppercase"
            />
            <button
              onClick={apply}
              disabled={busy || code.trim().length < 2}
              className="btn-ghost border border-brand-500 text-brand-800 px-4 font-semibold"
            >
              {busy ? '…' : 'Apply'}
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </>
      )}

      {walletBalance > 0 && (
        <label className="flex items-center gap-3 rounded-xl bg-surface-muted px-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={walletApply}
            onChange={(e) => onWalletToggle(e.target.checked)}
            className="h-4 w-4 accent-brand-500"
          />
          <div className="flex-1">
            <div className="text-sm font-medium">Use wallet balance</div>
            <div className="text-xs text-slate-500">You have {inr(walletBalance)} available</div>
          </div>
        </label>
      )}
    </div>
  );
}
