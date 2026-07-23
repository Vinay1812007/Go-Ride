import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import Spinner from '@/components/ui/Spinner';

export default function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email, password, options: { data: { full_name: name || email.split('@')[0] } },
        });
        if (error) throw error;
        toast.success('Account created — check your inbox to confirm your email.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('Welcome back!');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full grid place-items-center bg-surface-muted p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto mb-3 h-14 w-14 rounded-2xl bg-brand-500 grid place-items-center">
            <span className="font-bold text-2xl text-surface-strong">Go</span>
          </div>
          <h1 className="text-2xl font-bold">GoRide</h1>
          <p className="text-sm text-slate-500 mt-1">
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </p>
        </div>

        <form onSubmit={submit} className="card space-y-3">
          {mode === 'signup' && (
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Full name</span>
              <input
                className="input mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Priya Kumar"
              />
            </label>
          )}
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input
              className="input mt-1"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Password</span>
            <input
              className="input mt-1"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </label>
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? <><Spinner /> Please wait</> : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <button
            type="button"
            className="w-full text-sm text-slate-500 pt-2"
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          >
            {mode === 'signin' ? "New to GoRide? Create account" : 'Already have an account? Sign in'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-400 mt-4">
          By continuing you agree to the Terms &amp; Privacy Policy
        </p>
      </div>
    </div>
  );
}
