// Customer-facing support endpoints. Admin support endpoints live in
// admin.ts under /admin/support/*.
import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth, requireRole } from '../lib/auth';
import { admin, broadcast } from '../lib/supabase';
import { createSupportTicketBody, supportMessageBody } from '../lib/schemas';
import type { z } from 'zod';

const support = new Hono<AppEnv>();

async function parse<T extends z.ZodTypeAny>(c: any, s: T) {
  try { return s.parse(await c.req.json()); } catch { return null; }
}

// Customers only. Restaurant partners / captains have their own channels
// (captain: the trip chat; partner: n/a — they contact admin out-of-band).
support.use('*', requireAuth, requireRole('customer'));

// GET /support/tickets — my tickets, most recent first.
support.get('/tickets', async (c) => {
  const uid = c.get('userId')!;
  const { data } = await admin(c.env)
    .from('support_tickets')
    .select('id, subject, status, priority, order_id, assigned_to, created_at, updated_at, closed_at')
    .eq('customer_id', uid)
    .order('updated_at', { ascending: false })
    .limit(100);
  return c.json({ tickets: data ?? [] });
});

// POST /support/tickets — open a new ticket with a seed message
support.post('/tickets', async (c) => {
  const body = await parse(c, createSupportTicketBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;
  const db = admin(c.env);

  // If an order_id was passed, guard that the customer owns it.
  if (body.order_id) {
    const { data: order } = await db.from('orders').select('customer_id').eq('id', body.order_id).maybeSingle();
    if (!order || order.customer_id !== uid) {
      return c.json({ error: { code: 'forbidden_order' } }, 403);
    }
  }

  const { data: ticket, error } = await db
    .from('support_tickets')
    .insert({
      customer_id: uid,
      order_id: body.order_id ?? null,
      subject: body.subject.trim(),
      priority: body.priority,
    })
    .select('id, subject, status, priority, order_id, created_at, updated_at')
    .single();
  if (error || !ticket) return c.json({ error: { code: 'insert_failed', message: error?.message } }, 500);

  // Seed the first message.
  await db.from('support_messages').insert({
    ticket_id: ticket.id,
    sender_role: 'customer',
    sender_id: uid,
    body: body.body.trim(),
  });

  return c.json({ ticket });
});

// GET /support/tickets/:id — ticket + all messages. Marks admin-sent
// messages read by customer as a side effect.
support.get('/tickets/:id', async (c) => {
  const uid = c.get('userId')!;
  const db = admin(c.env);

  const { data: ticket } = await db
    .from('support_tickets')
    .select('id, subject, status, priority, order_id, assigned_to, created_at, updated_at, closed_at')
    .eq('id', c.req.param('id'))
    .eq('customer_id', uid)
    .maybeSingle();
  if (!ticket) return c.json({ error: { code: 'not_found' } }, 404);

  const { data: messages } = await db
    .from('support_messages')
    .select('id, sender_role, sender_id, body, read_by_customer_at, read_by_agent_at, created_at')
    .eq('ticket_id', ticket.id)
    .order('created_at', { ascending: true })
    .limit(500);

  // Mark admin-sent messages read.
  await db
    .from('support_messages')
    .update({ read_by_customer_at: new Date().toISOString() })
    .eq('ticket_id', ticket.id)
    .eq('sender_role', 'admin')
    .is('read_by_customer_at', null);

  return c.json({ ticket, messages: messages ?? [] });
});

// POST /support/tickets/:id/messages — customer sends a reply
support.post('/tickets/:id/messages', async (c) => {
  const body = await parse(c, supportMessageBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;
  const db = admin(c.env);
  const ticketId = c.req.param('id');

  // Guard membership + not resolved.
  const { data: ticket } = await db
    .from('support_tickets')
    .select('id, status, assigned_to')
    .eq('id', ticketId)
    .eq('customer_id', uid)
    .maybeSingle();
  if (!ticket) return c.json({ error: { code: 'not_found' } }, 404);
  if (ticket.status === 'resolved') {
    return c.json({ error: { code: 'ticket_resolved', message: 'This ticket is closed. Open a new one if you need more help.' } }, 409);
  }

  const { data: msg, error } = await db
    .from('support_messages')
    .insert({
      ticket_id: ticketId,
      sender_role: 'customer',
      sender_id: uid,
      body: body.body.trim(),
    })
    .select('id, sender_role, sender_id, body, read_by_customer_at, read_by_agent_at, created_at')
    .single();
  if (error || !msg) return c.json({ error: { code: 'insert_failed', message: error?.message } }, 500);

  // Broadcast to any live listener on ticket:{id} and to the assigned agent's
  // per-user channel (if there is one) so admin inboxes update instantly.
  c.executionCtx.waitUntil(broadcast(c.env, `ticket:${ticketId}`, 'message', msg).catch(() => {}));
  if (ticket.assigned_to) {
    c.executionCtx.waitUntil(broadcast(c.env, `admin:${ticket.assigned_to}`, 'ticket_message', { ticket_id: ticketId }).catch(() => {}));
  }

  return c.json({ message: msg });
});

export default support;
