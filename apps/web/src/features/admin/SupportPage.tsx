// Admin — support ticket queue.
// Two-pane layout: left is a filterable ticket list; right is the selected
// ticket's thread with reply box + status controls.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/ui/Toast';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/cn';

type Status   = 'open' | 'assigned' | 'awaiting_customer' | 'resolved';
type Priority = 'low' | 'normal' | 'high';
type Filter   = Status | 'all';

interface CustomerProfile { full_name: string; email?: string | null; phone?: string | null }
interface Ticket {
  id: string;
  subject: string;
  status: Status;
  priority: Priority;
  order_id?: string | null;
  assigned_to?: string | null;
  customer_id: string;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  profiles?: CustomerProfile;
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
  const [filter, setFilter] = useState<Filter>('open');
  const [mine, setMine] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const toast = useToast();

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const q = new URLSearchParams({ status: filter });
      if (mine) q.set('mine', '1');
      const res = await api.get<{ tickets: Ticket[] }>(`/admin/support/tickets?${q}`);
      setTickets(res.tickets);
      // If nothing selected, pick the first one so admin lands with context.
      if (!silent && !selectedId && res.tickets.length > 0) {
        setSelectedId(res.tickets[0]!.id);
      }
    } catch (e) {
      if (!silent) toast.error(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      if (!silent) setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [filter, mine]);
  useEffect(() => {
    const t = setInterval(() => void load(true), 15_000);
    return () => clearInterval(t);
  }, [filter, mine]);

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Support</h1>
          <p className="text-xs text-slate-500">Customer-support ticket queue. Auto-refreshes every 15s.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-4 w-4 accent-brand-500" />
            <span>Mine only</span>
          </label>
          <div className="flex gap-1 bg-white rounded-full p-1 border border-surface-border">
            {(['open', 'assigned', 'awaiting_customer', 'resolved', 'all'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium ${filter === f ? 'bg-surface-strong text-white' : 'text-slate-600'}`}
              >
                {label(f)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ticket list */}
        <div className="card p-0 overflow-hidden max-h-[75vh] overflow-y-auto">
          {loading && Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-3 border-b border-surface-border last:border-none space-y-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          ))}
          {!loading && tickets.length === 0 && (
            <EmptyState icon="🧾" title="No tickets in this view" description="Try 'all' or turn off 'Mine only'." />
          )}
          {tickets.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={`w-full text-left p-3 border-b border-surface-border last:border-none hover:bg-surface-muted transition ${selectedId === t.id ? 'bg-brand-50 border-l-4 border-l-brand-500' : ''}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-medium truncate flex-1">{t.subject}</div>
                <StatusChip status={t.status} />
              </div>
              <div className="text-xs text-slate-500 mt-1 flex items-center justify-between gap-2">
                <span className="truncate">{t.profiles?.full_name ?? '(unknown)'} · {t.profiles?.email ?? t.profiles?.phone ?? '—'}</span>
                {t.priority === 'high' && <span className="text-red-600 font-semibold flex-shrink-0">HIGH</span>}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Updated {new Date(t.updated_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
              </div>
            </button>
          ))}
        </div>

        {/* Detail pane */}
        <div className="card p-0 overflow-hidden">
          {!selected ? (
            <EmptyState icon="💬" title="Select a ticket" description="Pick one from the list to see the thread and reply." />
          ) : (
            <TicketPane key={selected.id} ticket={selected} onChanged={() => void load()} />
          )}
        </div>
      </div>
    </div>
  );
}

function label(f: Filter): string {
  switch (f) {
    case 'open':              return 'Open';
    case 'assigned':          return 'Assigned';
    case 'awaiting_customer': return 'Awaiting cust.';
    case 'resolved':          return 'Resolved';
    case 'all':               return 'All';
  }
}

function StatusChip({ status }: { status: Status }) {
  const map: Record<Status, string> = {
    open:              'bg-amber-50 text-amber-800 border border-amber-400',
    assigned:          'bg-blue-50 text-blue-800 border border-blue-400',
    awaiting_customer: 'bg-brand-50 text-brand-800 border border-brand-400',
    resolved:          'bg-emerald-50 text-emerald-800 border border-emerald-400',
  };
  const l: Record<Status, string> = { open: 'Open', assigned: 'Assigned', awaiting_customer: 'Awaiting cust.', resolved: 'Resolved' };
  return <span className={`chip py-0.5 text-[10px] ${map[status]}`}>{l[status]}</span>;
}

// -------------------------------------------------------------------------
// Ticket detail pane (admin side)
// -------------------------------------------------------------------------
function TicketPane({ ticket, onChanged }: { ticket: Ticket; onChanged: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const { userId } = useSession();

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ messages: Message[] }>(`/admin/support/tickets/${ticket.id}`);
      setMessages(res.messages);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [ticket.id]);

  useEffect(() => {
    const ch = supabase.channel(`ticket:${ticket.id}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'message' }, (msg) => {
        const m = msg.payload as Message;
        setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages.length]);

  async function assignToMe() {
    if (!userId) return;
    setBusy(true);
    try {
      // Server auto-flips status from 'open' → 'assigned' when assigned_to is set.
      await api.patch(`/admin/support/tickets/${ticket.id}`, { assigned_to: userId });
      toast.success('Assigned to you');
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Assign failed');
    } finally {
      setBusy(false);
    }
  }

  async function resolve() {
    if (!confirm('Mark this ticket resolved? The customer sees a green banner and can\'t reply further (they can open a new ticket).')) return;
    setBusy(true);
    try {
      await api.patch(`/admin/support/tickets/${ticket.id}`, { status: 'resolved' });
      toast.success('Resolved');
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function setPriority(p: Priority) {
    setBusy(true);
    try {
      await api.patch(`/admin/support/tickets/${ticket.id}`, { priority: p });
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const tempId = `tmp-${Date.now()}`;
    const optimistic: Message = {
      id: tempId, sender_role: 'admin', sender_id: 'me', body,
      read_by_customer_at: null, read_by_agent_at: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setText('');
    try {
      const res = await api.post<{ message: Message }>(`/admin/support/tickets/${ticket.id}/messages`, { body });
      setMessages((prev) => prev.map((m) => m.id === tempId ? res.message : m));
      onChanged();
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setText(body);
      toast.error(e instanceof ApiError ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  const grouped = useMemo(() => groupByDay(messages), [messages]);
  const resolved = ticket.status === 'resolved';

  return (
    <div className="flex flex-col" style={{ height: '75vh' }}>
      {/* Header */}
      <div className="p-3 border-b border-surface-border bg-surface-muted">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <div className="font-semibold">{ticket.subject}</div>
            <div className="text-xs text-slate-500">
              {ticket.profiles?.full_name ?? '(unknown)'} · {ticket.profiles?.email ?? ticket.profiles?.phone ?? '—'}
              {ticket.order_id && <> · Order <span className="font-mono">{ticket.order_id.slice(0, 8)}…</span></>}
            </div>
          </div>
          <StatusChip status={ticket.status} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 items-center text-xs">
          <span className="text-slate-500 mr-1">Priority:</span>
          {(['low', 'normal', 'high'] as Priority[]).map((p) => (
            <button
              key={p}
              onClick={() => setPriority(p)}
              disabled={busy || ticket.priority === p}
              className={cn(
                'chip capitalize',
                ticket.priority === p && (p === 'high' ? 'bg-red-100 text-red-800 border border-red-400' : 'bg-slate-200'),
              )}
            >
              {p}
            </button>
          ))}
          <span className="mx-2 text-slate-300">|</span>
          {!resolved && ticket.status === 'open' && (
            <button onClick={assignToMe} disabled={busy} className="chip">Assign to me</button>
          )}
          {!resolved && (
            <button onClick={resolve} disabled={busy} className="chip text-emerald-800 border-emerald-400">✓ Resolve</button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-3">
        {loading && Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="mb-2"><Skeleton className="h-4 w-full" /></div>
        ))}
        {grouped.map((group) => (
          <div key={group.day} className="mb-3">
            <div className="text-center text-[10px] uppercase tracking-wider text-slate-400 my-2">{group.day}</div>
            <div className="space-y-1.5">
              {group.messages.map((m) => {
                const admin = m.sender_role === 'admin';
                return (
                  <div key={m.id} className={`flex ${admin ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      admin ? 'bg-brand-500 text-surface-strong rounded-br-md' : 'bg-surface-muted text-surface-strong rounded-bl-md'
                    }`}>
                      {!admin && <div className="text-[10px] font-semibold text-slate-500 mb-0.5">Customer</div>}
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div className={`text-[10px] mt-0.5 opacity-70 ${admin ? 'text-right' : ''}`}>
                        {new Date(m.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        {admin && m.read_by_customer_at ? ' · Read' : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Reply box */}
      {resolved ? (
        <div className="p-3 border-t border-surface-border text-xs text-slate-500 text-center">
          This ticket is resolved. Customer can no longer reply.
        </div>
      ) : (
        <div className="p-3 border-t border-surface-border">
          <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Reply to customer…"
              rows={2}
              maxLength={4000}
              className="input flex-1 resize-none"
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

function groupByDay(messages: Message[]): Array<{ day: string; messages: Message[] }> {
  const out: Array<{ day: string; messages: Message[] }> = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  for (const m of messages) {
    const d = new Date(m.created_at); d.setHours(0, 0, 0, 0);
    let l: string;
    if (d.getTime() === today.getTime()) l = 'Today';
    else if (d.getTime() === yesterday.getTime()) l = 'Yesterday';
    else l = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const bucket = out[out.length - 1];
    if (bucket && bucket.day === l) bucket.messages.push(m);
    else out.push({ day: l, messages: [m] });
  }
  return out;
}
