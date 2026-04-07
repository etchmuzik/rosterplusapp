import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = 'ROSTER+ <book@rosterplus.io>';

interface EmailPayload {
  to: string;
  type: 'booking_confirmation' | 'booking_request' | 'contract_signed' | 'payment_received' | 'booking_accepted' | 'booking_rejected';
  data: Record<string, string>;
}

const templates: Record<string, (d: Record<string, string>) => { subject: string; html: string }> = {
  booking_confirmation: (d) => ({
    subject: `Booking Confirmed — ${d.artist_name} at ${d.venue_name}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#fff;padding:40px;border-radius:12px">
        <h1 style="color:#c9a84c;font-size:24px;margin-bottom:8px">Booking Confirmed</h1>
        <p style="color:rgba(255,255,255,0.7)">Your booking has been confirmed. Here are the details:</p>
        <div style="background:#1a1a22;border-radius:8px;padding:24px;margin:24px 0">
          <p><strong>Artist:</strong> ${d.artist_name}</p>
          <p><strong>Venue:</strong> ${d.venue_name}</p>
          <p><strong>Date:</strong> ${d.event_date}</p>
          <p><strong>Fee:</strong> ${d.fee}</p>
        </div>
        <a href="${d.booking_url}" style="display:inline-block;background:#c9a84c;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">View Booking</a>
        <p style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:32px">ROSTER+ — The GCC Booking Platform</p>
      </div>
    `,
  }),

  booking_request: (d) => ({
    subject: `New Booking Request from ${d.promoter_name}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#fff;padding:40px;border-radius:12px">
        <h1 style="color:#c9a84c;font-size:24px;margin-bottom:8px">New Booking Request</h1>
        <p style="color:rgba(255,255,255,0.7)"><strong>${d.promoter_name}</strong> wants to book you for an event.</p>
        <div style="background:#1a1a22;border-radius:8px;padding:24px;margin:24px 0">
          <p><strong>Event:</strong> ${d.event_name}</p>
          <p><strong>Venue:</strong> ${d.venue_name}</p>
          <p><strong>Date:</strong> ${d.event_date}</p>
          <p><strong>Offered Fee:</strong> ${d.fee}</p>
        </div>
        <a href="${d.booking_url}" style="display:inline-block;background:#c9a84c;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Review Request</a>
        <p style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:32px">ROSTER+ — The GCC Booking Platform</p>
      </div>
    `,
  }),

  contract_signed: (d) => ({
    subject: `Contract Signed — ${d.event_name}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#fff;padding:40px;border-radius:12px">
        <h1 style="color:#c9a84c;font-size:24px;margin-bottom:8px">Contract Signed</h1>
        <p style="color:rgba(255,255,255,0.7)">The contract for <strong>${d.event_name}</strong> has been signed by all parties.</p>
        <a href="${d.contract_url}" style="display:inline-block;background:#c9a84c;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:16px">View Contract</a>
        <p style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:32px">ROSTER+ — The GCC Booking Platform</p>
      </div>
    `,
  }),

  payment_received: (d) => ({
    subject: `Payment Received — ${d.amount} ${d.currency}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#fff;padding:40px;border-radius:12px">
        <h1 style="color:#c9a84c;font-size:24px;margin-bottom:8px">Payment Received</h1>
        <p style="color:rgba(255,255,255,0.7)">A payment of <strong>${d.amount} ${d.currency}</strong> has been received for ${d.event_name}.</p>
        <div style="background:#1a1a22;border-radius:8px;padding:24px;margin:24px 0">
          <p><strong>Amount:</strong> ${d.amount} ${d.currency}</p>
          <p><strong>Event:</strong> ${d.event_name}</p>
          <p><strong>Status:</strong> Confirmed</p>
        </div>
        <p style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:32px">ROSTER+ — The GCC Booking Platform</p>
      </div>
    `,
  }),

  booking_accepted: (d) => ({
    subject: `Booking Accepted — ${d.artist_name} confirmed for ${d.event_name}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#fff;padding:40px;border-radius:12px">
        <h1 style="color:#c9a84c;font-size:24px;margin-bottom:8px">Booking Accepted</h1>
        <p style="color:rgba(255,255,255,0.7)"><strong>${d.artist_name}</strong> has accepted your booking request.</p>
        <a href="${d.booking_url}" style="display:inline-block;background:#c9a84c;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:16px">Proceed to Contract</a>
        <p style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:32px">ROSTER+ — The GCC Booking Platform</p>
      </div>
    `,
  }),

  booking_rejected: (d) => ({
    subject: `Booking Declined — ${d.artist_name}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#fff;padding:40px;border-radius:12px">
        <h1 style="color:#c9a84c;font-size:24px;margin-bottom:8px">Booking Declined</h1>
        <p style="color:rgba(255,255,255,0.7)"><strong>${d.artist_name}</strong> is unable to accept your booking request at this time.</p>
        <a href="${d.browse_url}" style="display:inline-block;background:#c9a84c;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:16px">Browse Other Artists</a>
        <p style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:32px">ROSTER+ — The GCC Booking Platform</p>
      </div>
    `,
  }),
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload: EmailPayload = await req.json();
    const { to, type, data } = payload;

    if (!to || !type || !templates[type]) {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { subject, html } = templates[type](data);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });

    const result = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({ error: result }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, id: result.id }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
