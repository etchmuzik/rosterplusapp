// Transactional email surface. One entrypoint, seven template types.
// Shares visual shell with send-booking-reminders so every email the user
// gets from ROSTR+ looks like it came from the same system.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = 'ROSTER+ <book@rosterplus.io>';
const SITE_URL = 'https://rosterplus.io';

interface EmailPayload {
  to: string;
  type:
    | 'booking_confirmation'
    | 'booking_request'
    | 'contract_signed'
    | 'payment_received'
    | 'booking_accepted'
    | 'booking_rejected'
    | 'invitation'
    // Artist onboarding drip — fired by send-artist-onboarding-drip cron
    | 'artist_welcome'
    | 'artist_profile_nudge_24h'
    | 'artist_epk_share_72h'
    // Post-event review prompt — fired by send-review-prompts cron
    | 'review_prompt';
  data: Record<string, string>;
}

// ── Shared shell ────────────────────────────────────────────────
// Mirror of the shell in send-booking-reminders. When this changes,
// update that one too. Dark background, white primary CTAs, microcopy
// footer with context so one-off recipients know why they got the mail.
const SHELL = (content: string, footerContext?: string) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#08090b;color:#fff;padding:40px;border-radius:12px">
  ${content}
  ${footerContext ? `<p style="color:rgba(255,255,255,0.38);font-size:12px;margin-top:32px;line-height:1.6">${footerContext}</p>` : ''}
  <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:28px 0 16px">
  <p style="color:rgba(255,255,255,0.22);font-size:11px;margin:0;line-height:1.6">
    ROSTER+ &mdash; The GCC Booking Platform<br>
    <a href="${SITE_URL}" style="color:rgba(255,255,255,0.28);text-decoration:none">rosterplus.io</a>
    &nbsp;&middot;&nbsp;
    <a href="${SITE_URL}/settings.html" style="color:rgba(255,255,255,0.28);text-decoration:none">Manage notifications</a>
  </p>
</div>`;

// Primary CTA — light pill on dark bg, brand-parity with booking reminders.
const btn = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:#f3f5f8;color:#08090b;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:20px;font-size:15px">${label}</a>`;

// Secondary CTA — outline style for "Browse Other Artists" etc.
const btnGhost = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:transparent;color:#f3f5f8;padding:13px 27px;border:1px solid rgba(255,255,255,0.16);border-radius:10px;text-decoration:none;font-weight:500;margin-top:20px;font-size:15px">${label}</a>`;

const h1 = (text: string) =>
  `<h1 style="color:#f3f5f8;font-size:24px;margin:0 0 8px;letter-spacing:-0.02em;font-weight:600">${text}</h1>`;

const lede = (text: string) =>
  `<p style="color:rgba(255,255,255,0.62);line-height:1.6;margin:0 0 20px;font-size:15px">${text}</p>`;

const factCard = (rows: Array<[string, string]>) =>
  `<div style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:20px 24px;margin:24px 0">
    ${rows
      .map(
        ([k, v]) =>
          `<p style="margin:6px 0;color:rgba(255,255,255,0.86);font-size:14px"><span style="color:rgba(255,255,255,0.48);display:inline-block;min-width:96px">${k}</span>${v}</p>`,
      )
      .join('')}
  </div>`;

// ── Templates ───────────────────────────────────────────────────
const templates: Record<string, (d: Record<string, string>) => { subject: string; html: string; text: string }> = {
  booking_confirmation: (d) => ({
    subject: `Booking confirmed — ${d.artist_name} at ${d.venue_name}`,
    html: SHELL(
      `${h1('Booking confirmed')}
       ${lede('Your booking is locked in. Here are the details both sides see:')}
       ${factCard([
         ['Artist', d.artist_name],
         ['Venue', d.venue_name],
         ['Date', d.event_date],
         ['Fee', d.fee],
       ])}
       ${btn(d.booking_url, 'Open booking')}`,
      `You got this because the booking between ${d.artist_name} and the promoter was confirmed on ROSTR+.`,
    ),
    text: `Booking confirmed\n\nArtist: ${d.artist_name}\nVenue: ${d.venue_name}\nDate: ${d.event_date}\nFee: ${d.fee}\n\nOpen booking: ${d.booking_url}\n\n— ROSTER+`,
  }),

  booking_request: (d) => ({
    subject: `New booking request from ${d.promoter_name}`,
    html: SHELL(
      `${h1('New booking request')}
       ${lede(`<strong>${d.promoter_name}</strong> wants to book you. Review the details and respond within 48 hours so the promoter can plan.`)}
       ${factCard([
         ['Event', d.event_name],
         ['Venue', d.venue_name],
         ['Date', d.event_date],
         ['Offered fee', d.fee],
       ])}
       ${btn(d.booking_url, 'Review request')}`,
      `You got this because ${d.promoter_name} sent you a booking request on ROSTR+.`,
    ),
    text: `New booking request from ${d.promoter_name}\n\nEvent: ${d.event_name}\nVenue: ${d.venue_name}\nDate: ${d.event_date}\nFee: ${d.fee}\n\nReview: ${d.booking_url}\n\n— ROSTER+`,
  }),

  contract_signed: (d) => ({
    subject: `Contract signed — ${d.event_name}`,
    html: SHELL(
      `${h1('Contract signed')}
       ${lede(`The contract for <strong>${d.event_name}</strong> has been signed by all parties. A copy is saved to your booking.`)}
       ${btn(d.contract_url, 'View contract')}`,
      `You got this because you\u2019re party to the contract for ${d.event_name}.`,
    ),
    text: `Contract signed — ${d.event_name}\n\nView: ${d.contract_url}\n\n— ROSTER+`,
  }),

  payment_received: (d) => ({
    subject: `Payment received — ${d.amount} ${d.currency}`,
    html: SHELL(
      `${h1('Payment received')}
       ${lede(`A payment of <strong>${d.amount} ${d.currency}</strong> has been logged for ${d.event_name}.`)}
       ${factCard([
         ['Amount', `${d.amount} ${d.currency}`],
         ['Event', d.event_name],
         ['Status', 'Confirmed'],
       ])}`,
      `You got this because a payment was logged against your booking on ROSTR+.`,
    ),
    text: `Payment received\n\nAmount: ${d.amount} ${d.currency}\nEvent: ${d.event_name}\nStatus: Confirmed\n\n— ROSTER+`,
  }),

  booking_accepted: (d) => ({
    subject: `Booking accepted — ${d.artist_name} confirmed for ${d.event_name}`,
    html: SHELL(
      `${h1('Booking accepted')}
       ${lede(`<strong>${d.artist_name}</strong> has accepted your booking request. Next step: the contract.`)}
       ${btn(d.booking_url, 'Proceed to contract')}`,
      `You got this because you sent a booking request that ${d.artist_name} accepted.`,
    ),
    text: `Booking accepted — ${d.artist_name} confirmed for ${d.event_name}\n\nProceed to contract: ${d.booking_url}\n\n— ROSTER+`,
  }),

  booking_rejected: (d) => ({
    subject: `Booking declined — ${d.artist_name}`,
    html: SHELL(
      `${h1('Booking declined')}
       ${lede(`<strong>${d.artist_name}</strong> isn\u2019t able to accept your booking request. We have more than 50 other artists ready to perform.`)}
       ${btnGhost(d.browse_url, 'Browse other artists')}`,
      `You got this because the artist you requested declined. No charge, no hard feelings.`,
    ),
    text: `Booking declined — ${d.artist_name}\n\n${d.artist_name} isn't able to accept this booking. Browse others: ${d.browse_url}\n\n— ROSTER+`,
  }),

  // ── Artist onboarding drip ────────────────────────────────
  artist_welcome: (d) => ({
    subject: `Welcome to ROSTR+, ${d.name}`,
    html: SHELL(
      `${h1(`Welcome aboard, ${d.name}.`)}
       ${lede(`Your account is live. The next step: build out your profile so promoters can find you and book with confidence.`)}
       ${factCard([
         ['Profile', d.profile_complete === 'true' ? 'Complete' : 'Missing details'],
         ['Next step', 'Add bio, rate, rider'],
         ['Time needed', '~3 minutes'],
       ])}
       ${btn(d.profile_url, 'Complete my profile')}`,
      `You got this because you just created an artist account on ROSTR+.`,
    ),
    text: `Welcome to ROSTR+, ${d.name}\n\nYour account is live. Complete your profile to start getting booked.\n\n${d.profile_url}\n\n— ROSTER+`,
  }),

  artist_profile_nudge_24h: (d) => ({
    subject: `${d.name}, your ROSTR+ profile is 24 hours old`,
    html: SHELL(
      `${h1('A quick nudge.')}
       ${lede(`Your profile has been up for a day but promoters can't discover you yet. Finish the last few fields and you\u2019ll show up in the directory today.`)}
       <p style="color:rgba(255,255,255,0.62);font-size:14px;line-height:1.6;margin:0 0 16px">Missing pieces block promoters from sending requests:</p>
       <ul style="color:rgba(255,255,255,0.78);font-size:14px;line-height:1.8;padding-left:20px;margin:0 0 24px">
         ${d.missing_bio === 'true' ? '<li>Short bio (2-3 sentences)</li>' : ''}
         ${d.missing_rate === 'true' ? '<li>Starting fee (we show \"on request\" until you set one)</li>' : ''}
         ${d.missing_rider === 'true' ? '<li>Technical rider (makes booking conflict-free)</li>' : ''}
         ${d.missing_avatar === 'true' ? '<li>Profile photo</li>' : ''}
       </ul>
       ${btn(d.profile_url, 'Finish my profile')}`,
      `You got this because your ROSTR+ artist profile has missing fields 24 hours after signup.`,
    ),
    text: `${d.name}, your ROSTR+ profile needs finishing.\n\nComplete it here: ${d.profile_url}\n\n— ROSTER+`,
  }),

  artist_epk_share_72h: (d) => ({
    subject: `Your ROSTR+ EPK is ready to share, ${d.name}`,
    html: SHELL(
      `${h1('Your EPK is live.')}
       ${lede(`Three days in and your profile is in good shape. Here\u2019s something most artists don\u2019t realise for weeks \u2014 ROSTR+ auto-generates a shareable Electronic Press Kit at a link you can drop into any WhatsApp, email, or Instagram bio.`)}
       <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:16px 20px;margin:20px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:rgba(255,255,255,0.78);word-break:break-all">${d.epk_url}</div>
       ${lede(`Promoters who click it see a clean, updated press kit — not a 6-month-old PDF. Every booking gets more likely.`)}
       ${btn(d.epk_url, 'Open my EPK')}
       <p style="color:rgba(255,255,255,0.42);font-size:13px;margin-top:20px;line-height:1.6">Pro tip: replace the link in your Instagram bio with the EPK URL. Every DM becomes a booking request.</p>`,
      `You got this because your ROSTR+ profile has been live for 72 hours. This is the last automated onboarding email — future emails will be booking-related only.`,
    ),
    text: `Your ROSTR+ EPK is ready to share.\n\nOpen: ${d.epk_url}\n\nDrop this link into any WhatsApp, email, or Instagram bio.\n\n— ROSTER+`,
  }),

  // ── Post-event review prompt ──────────────────────────────
  // Fires 3 days after a confirmed/contracted booking's event_date so
  // everyone's back from the gig but the memory is fresh. Links straight
  // to the review card on booking-detail where setRating() waits.
  review_prompt: (d) => ({
    subject: `How did ${d.event_name} go?`,
    html: SHELL(
      `${h1('How did it go?')}
       ${lede(`${d.event_name} wrapped ${d.days_ago === '1' ? 'yesterday' : d.days_ago + ' days ago'}. Both sides of ROSTR+ work better when we know who showed up, delivered, and vibed \u2014 and who didn\u2019t. Leave a rating (it takes 15 seconds) and help the next person make a better booking.`)}
       ${factCard([
         ['Event',        d.event_name],
         ['When',         d.event_date],
         [d.role === 'promoter' ? 'Artist' : 'Promoter', d.counterparty_name],
       ])}
       ${btn(d.booking_url, 'Leave a rating')}
       <p style="color:rgba(255,255,255,0.42);font-size:13px;margin-top:20px;line-height:1.6">Ratings are mutual \u2014 both of you leave one. Comments are public on profiles. Admins moderate anything that crosses a line.</p>`,
      `You got this because you were party to a booking on ROSTR+ that happened 3 days ago.`,
    ),
    text: `How did ${d.event_name} go?\n\nLeave a quick rating — takes 15 seconds: ${d.booking_url}\n\n\u2014 ROSTER+`,
  }),

  invitation: (d) => ({
    subject: `You\u2019re invited to join ROSTR+ \u2014 ${d.inviter_name} wants to connect`,
    html: SHELL(
      `${h1('You\u2019re invited to ROSTR+')}
       ${lede(`<strong>${d.inviter_name}</strong> has invited you to join ROSTR+, the GCC\u2019s booking platform for live events.`)}
       ${
         d.message
           ? `<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:16px 20px;margin:20px 0;border-left:3px solid rgba(255,255,255,0.28)">
                <p style="color:rgba(255,255,255,0.78);font-style:italic;margin:0;line-height:1.55">"${d.message}"</p>
              </div>`
           : ''
       }
       <p style="color:rgba(255,255,255,0.58);font-size:14px;margin:16px 0">Join as ${d.role === 'artist' ? 'an <strong>Artist</strong>' : 'a <strong>Promoter</strong>'} and start booking today.</p>
       ${btn(d.invite_url, 'Accept invitation')}`,
      `You got this because ${d.inviter_name} invited you to ROSTR+. If you didn\u2019t expect it, you can ignore this email.`,
    ),
    text: `You're invited to join ROSTR+ — ${d.inviter_name} wants to connect\n\n${d.message ? `"${d.message}"\n\n` : ''}Join as ${d.role === 'artist' ? 'an Artist' : 'a Promoter'}: ${d.invite_url}\n\n— ROSTER+`,
  }),
};

// ── Server ──────────────────────────────────────────────────────
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

    const { subject, html, text } = templates[type](data);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      // Include plain-text alongside html — improves deliverability
      // (Gmail/Apple Mail weight multipart/alternative higher) and renders
      // gracefully in clients with images-off.
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html, text }),
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
