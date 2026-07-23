// Simple session hook — subscribes to Supabase auth state and pulls profile.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { api } from './api';
import { initPush, revokePush } from './push';
import type { Profile } from './types';

interface Session {
  loading: boolean;
  userId: string | null;
  authEmail: string | null;   // from Supabase session (always available when signed in)
  profile: Profile | null;    // from Worker /auth/me (may be null if API fails)
  profileError: boolean;      // true if userId exists but /auth/me failed
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useSession(): Session {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    setUserId(uid);
    setAuthEmail(session?.user?.email ?? null);
    if (uid) {
      try {
        const me = await api.get<{ profile: Profile }>('/auth/me');
        setProfile(me.profile);
        setProfileError(false);
        // Kick off push registration once profile is confirmed. Runs at most
        // once per browser thanks to the localStorage token-diff check inside.
        void initPush();
      } catch {
        setProfile(null);
        setProfileError(true);
      }
    } else {
      setProfile(null);
      setProfileError(false);
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
    authEmail,
    profile,
    profileError,
    refresh: load,
    async signOut() {
      // Unregister push before the session dies — token is user-scoped and
      // shouldn't send notifications to a signed-out browser.
      await revokePush().catch(() => {});
      await supabase.auth.signOut();
      setProfile(null);
      setUserId(null);
      setAuthEmail(null);
      setProfileError(false);
    },
  };
}
