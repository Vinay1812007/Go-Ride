// Two-party trip chat.
//
// Same component powers both sides:
//   • On the customer's TrackingPage — myRole='customer', otherLabel='Captain'
//   • On the captain's TripPage      — myRole='rider',    otherLabel='Customer'
//
// Realtime: subscribes to broadcast event='message' on the order channel
// so the counterparty's sends appear instantly. GET on open reconciles any
// messages we may have missed while offline and marks incoming ones read.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import BottomSheet from '@/components/ui/BottomSheet';

export interface ChatMessage {
  id: string;
  sender_role: 'customer' | 'rider';
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

interface Props {
  orderId: string;
  open: boolean;
  onClose: () => void;
  myRole: 'customer' | 'rider';
  otherLabel: string;              // "Captain" | "Customer"
  chatEnabled: boolean;            // false → send box hidden, only history shown
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Quick-reply chips speed up the common cases when driving.
const QUICK_REPLIES_RIDER = [
  'On my way',
  'Reached',
  'Please share exact location',
  'Stuck in traffic',
];
const QUICK_REPLIES_CUSTOMER = [
  "I'm coming down",
  'Please wait 2 min',
  "I'm at the gate",
  'Cancel please',
];

export default function ChatDrawer({ orderId, open, onClose, myRole, otherLabel, chatEnabled }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const quickReplies = myRole === 'rider' ? QUICK_REPLIES_RIDER : QUICK_REPLIES_CUSTOMER;

  // Load history on open
  useEffect(() => {
    if (!open) return;
    api.get<{ messages: ChatMessage[] }>(`/orders/${orderId}/messages`)
      .then((r) => setMessages(r.messages))
      .catch(() => { /* toast handled by outer badge */ });
  }, [open, orderId]);

  // Realtime subscription — active any time the drawer is mounted, so the
  // parent's unread badge stays fresh even when the drawer is closed.
  useEffect(() => {
    const ch = supabase.channel(`order:${orderId}:chat`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'message' }, (msg) => {
        const m = msg.payload as ChatMessage;
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [orderId]);

  // Scroll to bottom on new message / open
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    // rAF so DOM has painted the new bubble before we scroll.
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages.length, open]);

  async function send(body: string) {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true); setError(null);
    // Optimistic bubble — replaced by the server row when it arrives.
    const tempId = `tmp-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: tempId,
      sender_role: myRole,
      sender_id: 'me',
      body: trimmed,
      created_at: new Date().toISOString(),
      read_at: null,
    };
    setMessages((prev) => [...prev, optimistic]);
    setText('');
    try {
      const res = await api.post<{ message: ChatMessage }>(`/orders/${orderId}/messages`, { body: trimmed });
      setMessages((prev) => prev.map((m) => (m.id === tempId ? res.message : m)));
    } catch (e) {
      // Roll back the optimistic bubble on failure.
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setText(trimmed);
      setError(e instanceof ApiError ? e.message : 'Could not send');
    } finally {
      setSending(false);
    }
  }

  const grouped = useMemo(() => groupByDay(messages), [messages]);

  return (
    <BottomSheet open={open} onClose={onClose} title={`Chat with ${otherLabel}`} className="!max-h-[85vh]">
      <div className="flex flex-col" style={{ height: 'min(70vh, 520px)' }}>
        <div ref={listRef} className="flex-1 overflow-y-auto -mx-5 px-5">
          {grouped.length === 0 && (
            <div className="text-center text-sm text-slate-400 py-10">
              {chatEnabled
                ? 'Say hi — messages appear here for both of you.'
                : 'No messages yet.'}
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.day} className="space-y-1.5 mb-3">
              <div className="text-center text-[10px] uppercase tracking-wider text-slate-400 my-2">
                {group.day}
              </div>
              {group.messages.map((m) => {
                const mine = m.sender_role === myRole;
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                        mine
                          ? 'bg-brand-500 text-surface-strong rounded-br-md'
                          : 'bg-surface-muted text-surface-strong rounded-bl-md'
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div
                        className={`text-[10px] mt-0.5 opacity-70 ${mine ? 'text-right' : ''}`}
                      >
                        {fmtTime(m.created_at)}{mine && m.read_at ? ' · Read' : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {chatEnabled ? (
          <div className="border-t border-surface-border pt-3 -mx-5 px-5">
            <div className="flex gap-1 mb-2 overflow-x-auto pb-1">
              {quickReplies.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => void send(r)}
                  disabled={sending}
                  className="whitespace-nowrap text-xs px-3 py-1.5 rounded-full bg-surface-muted border border-surface-border text-slate-700 hover:bg-surface-border"
                >
                  {r}
                </button>
              ))}
            </div>
            {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
            <form
              onSubmit={(e) => { e.preventDefault(); void send(text); }}
              className="flex gap-2"
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type a message…"
                maxLength={1000}
                className="input flex-1"
              />
              <button
                type="submit"
                disabled={!text.trim() || sending}
                className="btn-primary px-4"
              >
                {sending ? '…' : 'Send'}
              </button>
            </form>
          </div>
        ) : (
          <div className="border-t border-surface-border pt-3 -mx-5 px-5 text-xs text-slate-500 text-center">
            Chat is closed for this trip.
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

// Group messages by "Today" / "Yesterday" / date for the divider.
function groupByDay(messages: ChatMessage[]): Array<{ day: string; messages: ChatMessage[] }> {
  const out: Array<{ day: string; messages: ChatMessage[] }> = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  for (const m of messages) {
    const d = new Date(m.created_at); d.setHours(0, 0, 0, 0);
    let label: string;
    if (d.getTime() === today.getTime()) label = 'Today';
    else if (d.getTime() === yesterday.getTime()) label = 'Yesterday';
    else label = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const bucket = out[out.length - 1];
    if (bucket && bucket.day === label) bucket.messages.push(m);
    else out.push({ day: label, messages: [m] });
  }
  return out;
}
