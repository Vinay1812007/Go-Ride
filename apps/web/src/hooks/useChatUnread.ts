// Tracks unread-message count for an order's chat.
//
// Strategy:
//   • On mount, GET messages once to seed the count (unread = messages from the
//     other role with read_at=null).
//   • Subscribe to broadcast event='message' on the order channel — bump count
//     whenever an incoming (other-role) message arrives while the drawer is
//     closed.
//   • Exposes reset() which the parent calls when the drawer opens (the API's
//     GET messages endpoint flips read_at server-side).
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';

interface ChatMessage {
  id: string;
  sender_role: 'customer' | 'rider';
  read_at: string | null;
}

export function useChatUnread(orderId: string | undefined, myRole: 'customer' | 'rider') {
  const [unread, setUnread] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Seed from the server on mount / orderId change.
  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    api.get<{ messages: ChatMessage[] }>(`/orders/${orderId}/messages`)
      .then((r) => {
        if (cancelled) return;
        // Note: GET marks incoming as read server-side. So the seed count is
        // effectively 0 whenever this fires. We still call it so the API
        // sees the recipient viewing the thread.
        const n = r.messages.filter((m) => m.sender_role !== myRole && !m.read_at).length;
        setUnread(n);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [orderId, myRole]);

  // Live increments — only while the drawer is closed.
  useEffect(() => {
    if (!orderId) return;
    const ch = supabase.channel(`order:${orderId}:badge`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'message' }, (msg) => {
        const m = msg.payload as { sender_role?: string };
        if (m?.sender_role && m.sender_role !== myRole && !drawerOpen) {
          setUnread((n) => n + 1);
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [orderId, myRole, drawerOpen]);

  const openDrawer = useCallback(() => { setDrawerOpen(true); setUnread(0); }, []);
  const closeDrawer = useCallback(() => { setDrawerOpen(false); }, []);

  return { unread, drawerOpen, openDrawer, closeDrawer };
}
