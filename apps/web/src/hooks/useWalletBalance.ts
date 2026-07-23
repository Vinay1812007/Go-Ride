// Lightweight wallet-balance fetch — used at checkout to decide whether to
// show the "Use wallet balance" toggle at all. Fails-open (returns 0) so a
// wallet fetch error doesn't block the customer from placing an order.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export function useWalletBalance() {
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    api.get<{ balance: number }>('/wallet')
      .then((r) => { if (!cancelled) setBalance(Number(r.balance ?? 0)); })
      .catch(() => { /* keep 0 */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return { balance, loading };
}
