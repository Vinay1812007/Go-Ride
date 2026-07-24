// Thin API client — attaches Supabase JWT and unwraps { error } envelope.
import { supabase } from './supabase';
export { supabase };  // convenient re-export

const BASE = import.meta.env.VITE_API_URL.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(err?.code ?? 'error', err?.message ?? res.statusText, res.status);
  }
  return body as T;
}

export const api = {
  get:   <T,>(p: string)                  => request<T>(p),
  post:  <T,>(p: string, body?: unknown)  => request<T>(p, { method: 'POST',   body: body ? JSON.stringify(body) : undefined }),
  put:   <T,>(p: string, body?: unknown)  => request<T>(p, { method: 'PUT',    body: body ? JSON.stringify(body) : undefined }),
  patch: <T,>(p: string, body?: unknown)  => request<T>(p, { method: 'PATCH',  body: body ? JSON.stringify(body) : undefined }),
  del:   <T,>(p: string)                  => request<T>(p, { method: 'DELETE' }),
};

// Trigger a browser download of an authenticated Worker endpoint (e.g. CSV).
export async function downloadFile(path: string, fallbackName = 'download'): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${BASE}${path}`, {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let body: { error?: { code?: string; message?: string } } | null = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* not json */ }
    throw new ApiError(body?.error?.code ?? 'download_failed', body?.error?.message ?? res.statusText, res.status);
  }
  // Try to read filename from Content-Disposition
  const cd = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(cd);
  const filename = match?.[1] ?? fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
