// LocalStorage-backed cart for the food vertical.
//
// One cart at a time — switching restaurants shows a "Clear cart?" prompt so
// the customer can't accidentally mix items from two restaurants (they'd
// have to be delivered by two captains). This matches Swiggy/Zomato UX.
//
// Persistence is per-browser, not per-user, which is fine: a customer who
// signs out mid-checkout would want their cart back on sign-in.
import type { CartLine, Restaurant } from './types';

const KEY = 'goride:food-cart';

export interface CartSnapshot {
  restaurant_id: string;
  restaurant_name: string;
  restaurant_lat: number;
  restaurant_lng: number;
  restaurant_address: string;
  min_order: number;
  lines: CartLine[];
}

export function loadCart(): CartSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CartSnapshot;
    if (!parsed?.restaurant_id || !Array.isArray(parsed.lines)) return null;
    return parsed;
  } catch { return null; }
}

export function saveCart(c: CartSnapshot | null) {
  try {
    if (!c || c.lines.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(c));
  } catch { /* private mode etc. */ }
}

export function cartSubtotal(c: CartSnapshot | null): number {
  if (!c) return 0;
  return c.lines.reduce((s, l) => s + l.price * l.qty, 0);
}

export function cartCount(c: CartSnapshot | null): number {
  if (!c) return 0;
  return c.lines.reduce((s, l) => s + l.qty, 0);
}

// Ensure we don't mix items across restaurants. Returns null if the caller
// should abort (user declined the switch prompt).
export function ensureRestaurant(existing: CartSnapshot | null, r: Restaurant): CartSnapshot | null {
  if (existing && existing.restaurant_id !== r.id) {
    if (!confirm(`Clear your cart from ${existing.restaurant_name}?`)) return null;
    return newCart(r);
  }
  return existing ?? newCart(r);
}

function newCart(r: Restaurant): CartSnapshot {
  return {
    restaurant_id: r.id,
    restaurant_name: r.name,
    restaurant_lat: r.lat,
    restaurant_lng: r.lng,
    restaurant_address: r.address,
    min_order: r.min_order,
    lines: [],
  };
}

export function addOne(cart: CartSnapshot, item: { id: string; name: string; price: number; is_veg: boolean }): CartSnapshot {
  const existing = cart.lines.find((l) => l.menu_item_id === item.id);
  if (existing) {
    return { ...cart, lines: cart.lines.map((l) => l.menu_item_id === item.id ? { ...l, qty: l.qty + 1 } : l) };
  }
  return {
    ...cart,
    lines: [...cart.lines, { menu_item_id: item.id, name: item.name, price: item.price, qty: 1, is_veg: item.is_veg }],
  };
}

export function removeOne(cart: CartSnapshot, menu_item_id: string): CartSnapshot {
  const next = cart.lines
    .map((l) => l.menu_item_id === menu_item_id ? { ...l, qty: l.qty - 1 } : l)
    .filter((l) => l.qty > 0);
  return { ...cart, lines: next };
}
