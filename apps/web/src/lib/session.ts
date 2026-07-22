// Simple session hook — subscribes to Supabase auth state and pulls profile.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { api } from './api';
import type { Profile } from './types';

interface Session {
  loading: boolean;
  userId: string | null;
  profile: Profile | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useSession(): Session {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    setUserId(uid);
    if (uid) {
      try {
        const me = await api.get<{ profile: Profile }>('/auth/me');
        setProfile(me.profile);
      } catch {
        setProfile(null);
      }
    } else {
      setProfile(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { void load(); });
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    loading,
    userId,
    profile,
    refresh: load,
    async signOut() {
      await supabase.auth.signOut();
      setProfile(null);
      setUserId(null);
    },
  };
}
