// Thin API client — attaches Supabase JWT and unwraps { error } envelope.
import { supabase } from './supabase';

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
  get:  <T,>(p: string)                  => request<T>(p),
  post: <T,>(p: string, body?: unknown)  => request<T>(p, { method: 'POST',   body: body ? JSON.stringify(body) : undefined }),
  put:  <T,>(p: string, body?: unknown)  => request<T>(p, { method: 'PUT',    body: body ? JSON.stringify(body) : undefined }),
  del:  <T,>(p: string)                  => request<T>(p, { method: 'DELETE' }),
};
