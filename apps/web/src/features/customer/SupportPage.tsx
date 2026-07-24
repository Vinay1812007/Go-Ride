// Customer support inbox. Two views inside:
//   • List of tickets (open + closed) — default
//   • Selected ticket detail with threaded messages + reply box
// Realtime subscribed on ticket:{id} while a ticket is open.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import BottomSheet from '@/components/ui/BottomSheet';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

type Status   = 'open' | 'assigned' | 'awaiting_customer' | 'resolved';
type Priority = 'low' | 'normal' | 'high';

interface Ticket {
  id: string;
  subject: string;
  status: Status;
  priority: Priority;
  order_id?: string | null;
  assigned_to?: string | null;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
}

interface Message {
  id: string;
  sender_role: 'customer' | 'admin' | 'rider' | 'restaurant_partner';
  sender_id: string;
  body: string;
  read_by_customer_at?: string | null;
  read_by_agent_at?: string | null;
  created_at: string;
}

export default function SupportPage() {
  const [params, setParams] = useSearchParams();
  const openId = params.get('ticket');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ tickets: Ticket[] }>('/support/tickets');
      setTickets(res.tickets);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  const openTicket = tickets.find((t) => t.id === openId);

  function selectTicket(id: string | null) {
    const p = new URLSearchParams(params);
    if (id) p.set('ticket', id); else p.delete('ticket');
    setParams(p, { replace: true });
  }

  return (
    <div className="min-h-full bg-surface-muted">
      <header className="bg-white border-b border-surface-border sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <Link to={openTicket ? '#' : '/'} onClick={(e) => { if (openTicket) { e.preventDefault(); selectTicket(null); }}}
                className="text-slate-500 text-lg leading-none">←</Link>
          <div className="flex-1">
            <div className="font-bold">{openTicket ? 'Ticket' : 'Support'}</div>
            {openTicket && <div className="text-xs text-slate-500 truncate">{openTicket.subject}</div>}
          </div>
          {!openTicket && (
            <button onClick={() => setNewTicketOpen(true)} className="btn-primary py-1.5 px-3 text-sm">+ New</button>
          )}
        </div>
      </header>

      <div className="max-w-md mx-auto p-4">
        {!openTicket && (
          <>
            {loading && Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card mb-2 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            ))}

            {!loading && tickets.length === 0 && (
              <EmptyState
                icon="💬"
                title="No support tickets"
                description="Have a problem with a trip, payment, or wallet? Open a ticket and our support team will get back to you."
                cta={{ label: 'Open a ticket', onClick: () => setNewTicketOpen(true) }}
              />
            )}

            <div className="space-y-2">
              {tickets.map((t) => (
                <button
                  key={t.id}
                  onClick={() => selectTicket(t.id)}
                  className="w-full text-left card hover:shadow-lg transition"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-semibold truncate">{t.subject}</div>
                    <StatusChip status={t.status} />
                  </div>
                  <div className="text-xs text-slate-500 mt-1 flex items-center justify-between">
                    <span>{new Date(t.updated_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                    {t.priority === 'high' && <span className="text-red-600 font-semibold">HIGH</span>}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {openTicket && <TicketDetail ticket={openTicket} onReplied={() => { void load(); }} onResolved={() => { selectTicket(null); void load(); }} />}
      </div>

      {newTicketOpen && (
        <NewTicketSheet
          onClose={() => setNewTicketOpen(false)}
          onCreated={(id) => { setNewTicketOpen(false); void load(); selectTicket(id); }}
        />
      )}
    </div>
  );
}

function StatusChip({ status }: { status: Status }) {
  const map: Record<Status, string> = {
    open:              'bg-amber-50 text-amber-800 border border-amber-400',
    assigned:          'bg-blue-50 text-blue-800 border border-blue-400',
    awaiting_customer: 'bg-brand-50 text-brand-800 border border-brand-400',
    resolved:          'bg-emerald-50 text-emerald-800 border border-emerald-400',
  };
  const label: Record<Status, string> = {
    open:              'Open',
    assigned:          'With support',
    awaiting_customer: 'Awaiting you',
    resolved:          'Resolved',
  };
  return <span className={`chip py-0.5 text-[10px] ${map[status]}`}>{label[status]}</span>;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

// -------------------------------------------------------------------------
// Ticket detail — thread + reply box + resolve action
// -------------------------------------------------------------------------
function TicketDetail({ ticket, onReplied, onResolved }: { ticket: Ticket; onReplied: () => void; onResolved: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ messages: Message[] }>(`/support/tickets/${ticket.id}`);
      setMessages(res.messages);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [ticket.id]);

  // Realtime updates on this ticket
  useEffect(() => {
    const ch = supabase.channel(`ticket:${ticket.id}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'message' }, (msg) => {
        const m = msg.payload as Message;
        setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
      })
      .on('broadcast', { event: 'status' }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setError(null);
    // Optimistic
    const tempId = `tmp-${Date.now()}`;
    const optimistic: Message = {
      id: tempId, sender_role: 'customer', sender_id: 'me', body,
      read_by_customer_at: null, read_by_agent_at: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setText('');
    try {
      const res = await api.post<{ message: Message }>(`/support/tickets/${ticket.id}/messages`, { body });
      setMessages((prev) => prev.map((m) => m.id === tempId ? res.message : m));
      onReplied();
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setText(body);
      setError(e instanceof ApiError ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  const grouped = useMemo(() => groupByDay(messages), [messages]);
  const resolved = ticket.status === 'resolved';

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 130px)' }}>
      <div className="mb-2 flex items-baseline justify-between">
        <StatusChip status={ticket.status} />
        <div className="text-xs text-slate-500">Opened {fmtTime(ticket.created_at)}</div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto card p-3">
        {loading && Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="mb-2"><Skeleton className="h-4 w-full" /></div>
        ))}
        {grouped.map((group) => (
          <div key={group.day} className="mb-3">
            <div className="text-center text-[10px] uppercase tracking-wider text-slate-400 my-2">{group.day}</div>
            <div className="space-y-1.5">
              {group.messages.map((m) => {
                const mine = m.sender_role === 'customer';
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      mine ? 'bg-brand-500 text-surface-strong rounded-br-md' : 'bg-surface-muted text-surface-strong rounded-bl-md'
                    }`}>
                      {!mine && <div className="text-[10px] font-semibold text-slate-500 mb-0.5">Support</div>}
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div className={`text-[10px] mt-0.5 opacity-70 ${mine ? 'text-right' : ''}`}>
                        {new Date(m.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        {mine && m.read_by_agent_at ? ' · Read' : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {resolved ? (
        <div className="mt-3 rounded-xl bg-emerald-50 border border-emerald-300 p-3 text-sm text-emerald-800 text-center">
          This ticket is resolved. <button onClick={onResolved} className="underline font-semibold">Back to inbox</button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {error && <p className="text-xs text-red-600">{error}</p>}
          <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type your reply…"
              maxLength={4000}
              className="input flex-1"
            />
            <button type="submit" disabled={!text.trim() || sending} className="btn-primary px-4">
              {sending ? '…' : 'Send'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------
// New ticket sheet
// -------------------------------------------------------------------------
function NewTicketSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (subject.trim().length < 3 || body.trim().length < 1) return;
    setSaving(true); setError(null);
    try {
      const res = await api.post<{ ticket: { id: string } }>('/support/tickets', {
        subject: subject.trim(),
        body: body.trim(),
        priority,
      });
      onCreated(res.ticket.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open ticket');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open onClose={onClose} title="Open a support ticket">
      <div className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium">Subject</span>
          <input
            autoFocus
            className="input mt-1"
            placeholder="e.g. Wallet credit missing after trip"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Describe the problem</span>
          <textarea
            className="input mt-1"
            rows={5}
            placeholder="Order number, what happened, when…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Priority</span>
          <div className="mt-1 flex gap-2">
            {(['low', 'normal', 'high'] as Priority[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={cn(
                  'flex-1 py-2 rounded-lg text-sm font-medium border capitalize',
                  priority === p ? 'bg-brand-500 border-brand-500 text-surface-strong' : 'bg-white border-surface-border text-slate-700',
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          onClick={submit}
          disabled={saving || subject.trim().length < 3 || body.trim().length < 1}
          className="btn-primary w-full"
        >
          {saving ? '…' : 'Open ticket'}
        </button>
      </div>
    </BottomSheet>
  );
}

function groupByDay(messages: Message[]): Array<{ day: string; messages: Message[] }> {
  const out: Array<{ day: string; messages: Message[] }> = [];
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
