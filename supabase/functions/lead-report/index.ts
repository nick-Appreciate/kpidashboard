import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

// Lead engine status reports → Nick's Slack DM (from the Lead Alerts app).
//
//   Daily for the first three mornings after go-live, then weekly on Mondays.
//   pg_cron calls this every morning at 8am Central; the function decides
//   whether today gets a report. ?force=daily|weekly sends one regardless.
//
//   Numbers are computed here (deterministic). The weekly report also has
//   Claude review this week vs. last week vs. the pre-launch baseline and
//   write personalized feedback for Nick.

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const SLACK_TOKEN = Deno.env.get('SLACK_BOT_TOKEN') || '';
const DASH = 'https://www.appreciate.io/leasing/automations';
const DAY = 86_400_000;

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

function phone10(v: unknown): string | null {
  if (!v) return null;
  const d = String(v).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  return d.length === 10 ? d : null;
}
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : null);
const round = (x: number | null, p = 1) => (x == null ? null : Math.round(x * 10 ** p) / 10 ** p);
const fmtMin = (m: number | null) => m == null ? '—' : m < 1 ? '<1 min' : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`;
const fmtSec = (s: number | null) => s == null ? '—' : s < 90 ? `${Math.round(s)}s` : fmtMin(s / 60);
function centralDate(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d);
}
function centralDow(d: Date) {
  return new Date(d.toLocaleString('en-US', { timeZone: 'America/Chicago' })).getDay();
}

async function all<T = any>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Everything the report needs for [start, end). */
async function metrics(start: Date, end: Date) {
  const s = start.toISOString(), e = end.toISOString();
  const touchEnd = new Date(end.getTime() + 2 * DAY).toISOString(); // first touches can land after the window

  const [leads, web, outbox, texts, calls, showings, confirms, links, apps, alerts, optouts] = await Promise.all([
    all(() => supabase.from('leasing_reports').select('id, phone, email, source, property, inquiry_received, status').gte('inquiry_received', s).lt('inquiry_received', e)),
    all(() => supabase.from('web_inquiries').select('id, phone_norm, wants_tour, showing_status, created_at, appfolio_status').gte('created_at', s).lt('created_at', e)),
    all(() => supabase.from('lead_outbox').select('kind, channel, status, skip_reason, leasing_report_id, created_at, sent_at').gte('created_at', s).lt('created_at', e)),
    all(() => supabase.from('justcall_texts').select('id, contact_number_norm, direction, agent_name, sms_at').gte('sms_at', s).lt('sms_at', touchEnd)),
    all(() => supabase.from('justcall_calls').select('contact_number_norm, direction, call_type, call_at').gte('call_at', s).lt('call_at', touchEnd)),
    all(() => supabase.from('showings').select('showing_id, status, showing_time').gte('showing_time', s).lt('showing_time', e)),
    all(() => supabase.from('showing_confirmations').select('showing_id, confirmed_at').gte('confirmed_at', s).lt('confirmed_at', e)),
    all(() => supabase.from('tour_links').select('token, opened_at, booked_at, created_at').gte('created_at', s).lt('created_at', e)),
    all(() => supabase.from('rental_applications').select('rental_application_id, received').gte('received', s.slice(0, 10)).lt('received', e.slice(0, 10))),
    all(() => supabase.from('lead_alerts').select('kind, status').gte('created_at', s).lt('created_at', e)),
    all(() => supabase.from('sms_opt_outs').select('phone_norm').gte('opted_out_at', s).lt('opted_out_at', e)),
  ]);

  // Our own API texts appear in JustCall too (under the API key owner) — not "human".
  const ourIds = new Set((await all(() => supabase.from('lead_outbox').select('external_id').not('external_id', 'is', null).gte('created_at', new Date(start.getTime() - DAY).toISOString()))).map((r: any) => String(r.external_id)));

  // Speed: per lead with a phone, first human call/text and first instant text.
  const leadById = new Map(leads.map((l: any) => [l.id, l]));
  const instantSecs: number[] = [];
  for (const o of outbox as any[]) {
    if (o.kind !== 'instant' || o.status !== 'sent' || !o.leasing_report_id || !o.sent_at) continue;
    const l = leadById.get(o.leasing_report_id);
    if (l) instantSecs.push((new Date(o.sent_at).getTime() - new Date(l.inquiry_received).getTime()) / 1000);
  }
  const firstHumanMin: number[] = [];
  let noHuman = 0, replied = 0;
  const seen = new Set<string>();
  for (const l of leads as any[]) {
    const p = phone10(l.phone);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const t0 = new Date(l.inquiry_received).getTime();
    const human = [
      ...(calls as any[]).filter((c) => c.contact_number_norm === p && !/^incoming$/i.test(c.direction || '')).map((c) => new Date(c.call_at).getTime()),
      ...(texts as any[]).filter((t) => t.contact_number_norm === p && !/^incoming$/i.test(t.direction || '') && t.agent_name && !ourIds.has(String(t.id))).map((t) => new Date(t.sms_at).getTime()),
    ].filter((ts) => ts >= t0).sort((a, b) => a - b);
    if (human.length) firstHumanMin.push((human[0] - t0) / 60_000); else noHuman++;
    const reply = (texts as any[]).some((t) => t.contact_number_norm === p && /^incoming$/i.test(t.direction || '') && new Date(t.sms_at).getTime() >= t0)
      || (calls as any[]).some((c) => c.contact_number_norm === p && /^incoming$/i.test(c.direction || '') && new Date(c.call_at).getTime() >= t0);
    if (reply) replied++;
  }
  const uniquePhones = seen.size;

  const count = (xs: any[], f: (x: any) => boolean) => xs.filter(f).length;
  const bySource: Record<string, number> = {};
  for (const l of leads as any[]) bySource[l.source || 'Unknown'] = (bySource[l.source || 'Unknown'] || 0) + 1;
  const byProperty: Record<string, number> = {};
  for (const l of leads as any[]) byProperty[l.property || 'Unknown'] = (byProperty[l.property || 'Unknown'] || 0) + 1;
  const outboxBy: Record<string, Record<string, number>> = {};
  for (const o of outbox as any[]) {
    const k = o.kind; outboxBy[k] ||= {};
    const st = o.status === 'skipped' ? `skipped: ${o.skip_reason}` : o.status;
    outboxBy[k][st] = (outboxBy[k][st] || 0) + 1;
  }
  const alertsBy: Record<string, number> = {};
  for (const a of alerts as any[]) alertsBy[a.kind] = (alertsBy[a.kind] || 0) + 1;

  return {
    period: { start: s, end: e, days: round((end.getTime() - start.getTime()) / DAY, 1) },
    leads: {
      guest_cards: leads.length, unique_phones: uniquePhones,
      no_phone: count(leads, (l) => !phone10(l.phone)),
      website_inquiries: web.length,
      by_source: bySource, by_property: byProperty,
    },
    speed: {
      instant_texts_sent: instantSecs.length,
      median_instant_seconds: round(median(instantSecs), 0),
      instant_within_2min_pct: pct(instantSecs.filter((x) => x <= 120).length, instantSecs.length),
      median_first_person_minutes: round(median(firstHumanMin), 1),
      person_within_5min_pct: pct(firstHumanMin.filter((x) => x <= 5).length, uniquePhones),
      person_within_1h_pct: pct(firstHumanMin.filter((x) => x <= 60).length, uniquePhones),
      never_reached_by_person: noHuman,
    },
    engagement: {
      prospects_replied: replied, reply_rate_pct: pct(replied, uniquePhones),
      tour_links_sent: links.length, tour_links_opened: count(links, (l) => !!l.opened_at), tours_booked_by_link: count(links, (l) => !!l.booked_at),
      tours_booked_on_website: count(web, (w) => w.showing_status === 'booked'),
      opt_outs: optouts.length,
    },
    tours: {
      tours_in_period: showings.length,
      completed: count(showings, (x) => /^completed/i.test(x.status || '')),
      no_shows: count(showings, (x) => /no show/i.test(x.status || '')),
      canceled: count(showings, (x) => /cancel/i.test(x.status || '')),
      confirmed_by_text: confirms.length,
    },
    applications: apps.length,
    messages: outboxBy,
    alerts: alertsBy,
    problems: {
      failed_messages: count(outbox, (o) => o.status === 'failed'),
      appfolio_guest_card_failures: count(web, (w) => w.appfolio_status === 'failed'),
      alerts_failed: count(alerts, (a) => a.status === 'failed'),
    },
  };
}

function slackBlocksText(kind: 'daily' | 'weekly', m: any, base: any | null, feedback: string | null) {
  const lines: string[] = [];
  const title = kind === 'daily' ? `*Lead engine — daily report* (${centralDate(new Date(m.period.end))})` : `*Lead engine — weekly report* (week ending ${centralDate(new Date(m.period.end))})`;
  lines.push(title);
  const vs = (cur: number | null, b: number | null, fmt: (x: number | null) => string, lowerBetter = true) => {
    if (b == null || cur == null) return fmt(cur);
    const better = lowerBetter ? cur < b : cur > b;
    return `${fmt(cur)} (was ${fmt(b)} ${better ? '✅' : cur === b ? '' : '⚠️'})`;
  };
  lines.push(`• *Leads:* ${m.leads.guest_cards} guest cards (${m.leads.unique_phones} people with a phone, ${m.leads.no_phone} without), ${m.leads.website_inquiries} from our website`);
  lines.push(`• *Instant text:* ${m.speed.instant_texts_sent} sent · median ${fmtSec(m.speed.median_instant_seconds)} after inquiry`);
  lines.push(`• *First person contact:* median ${vs(m.speed.median_first_person_minutes, base?.speed?.median_first_person_minutes ?? null, fmtMin)} · within 5 min ${m.speed.person_within_5min_pct ?? '—'}% · never reached ${m.speed.never_reached_by_person}`);
  lines.push(`• *Prospect replies:* ${m.engagement.prospects_replied} (${m.engagement.reply_rate_pct ?? '—'}%) · opt-outs ${m.engagement.opt_outs}`);
  lines.push(`• *Tour links:* ${m.engagement.tour_links_sent} sent → ${m.engagement.tour_links_opened} opened → ${m.engagement.tours_booked_by_link} booked · ${m.engagement.tours_booked_on_website} booked from the website`);
  lines.push(`• *Tours:* ${m.tours.tours_in_period} on the calendar · ${m.tours.completed} completed · ${m.tours.no_shows} no-shows · ${m.tours.confirmed_by_text} confirmed by text`);
  lines.push(`• *Applications:* ${m.applications}`);
  const nurture = ['nurture_1', 'nurture_2', 'nurture_3', 'nurture_4'].map((k) => `#${k.slice(-1)} ${m.messages[k]?.sent || 0}`).join(' · ');
  lines.push(`• *Follow-ups sent:* ${nurture}`);
  const al = Object.entries(m.alerts).map(([k, v]) => `${k.replace('_', ' ')} ${v}`).join(' · ');
  if (al) lines.push(`• *#leasing alerts:* ${al}`);
  const p = m.problems;
  if (p.failed_messages || p.appfolio_guest_card_failures || p.alerts_failed) {
    lines.push(`• :warning: *Problems:* ${p.failed_messages} failed messages · ${p.appfolio_guest_card_failures} website leads not in AppFolio · ${p.alerts_failed} failed alerts`);
  }
  if (feedback) lines.push('', '*Claude’s take*', feedback);
  lines.push('', `<${DASH}|Open Leasing Automations>`);
  return lines.join('\n');
}

async function claudeFeedback(cur: any, prev: any | null, base: any | null): Promise<string> {
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
  const system = `You review the weekly numbers for Appreciate Property Management's automated leasing follow-up system and write feedback for Nick, the owner.

Context: Appreciate manages ~260 rental units in Kansas City and Columbia, MO. On 2026-11-12 they replaced AppFolio's lead automations with their own: an instant text with a two-tap tour-booking link for every new lead, follow-up texts on days 1/2/4/7, tour reminders (day before + 2h), no-show and post-tour texts, and Slack alerts to #leasing that @mention Jader (the leasing VA) when a prospect replies, calls and is missed, or goes 15 minutes without a person reaching them. Leads with an email get the instant message and day-2/day-7 follow-ups by email too (leads with no phone get email at every step). Upcoming tour reminders sitting in the outbox as 'pending' are normal — they're scheduled for later. Before launch, the median time to a first human call was ~15 hours and ~45% of booked tours were lost to no-shows/cancellations; tours booked 2+ days out were lost ~80% of the time.

Write for Slack (mrkdwn: *bold*, bullets with •). 150–250 words. Lead with the single most important takeaway. Then 2–4 specific, actionable recommendations tied to numbers in the data (e.g. a property or lead source underperforming, a follow-up step nobody responds to, a person-response gap, a broken step). Compare against last week and the pre-launch baseline when they're provided. If the sample is too small to conclude something, say so plainly rather than over-reading it. Don't restate the whole metrics list — Nick sees it above your note.`;
  const user = `This week:\n${JSON.stringify(cur)}\n\nLast week:\n${prev ? JSON.stringify(prev) : 'none (first week)'}\n\nPre-launch baseline (30 days before go-live):\n${base ? JSON.stringify(base) : 'unavailable'}`;
  const resp: any = await (client.beta.messages as any).create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'high' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (resp.stop_reason === 'refusal') return '_Claude declined to review this week’s data._';
  return (resp.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
}

async function postDm(user: string, text: string) {
  if (!SLACK_TOKEN) throw new Error('SLACK_BOT_TOKEN not set');
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SLACK_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: user, text, unfurl_links: false, mrkdwn: true }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`Slack: ${body.error}`);
}

async function authorized(req: Request): Promise<boolean> {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (bearer) {
    const probe = createClient(Deno.env.get('SUPABASE_URL')!, bearer, { auth: { persistSession: false } });
    const { error } = await probe.rpc('lead_engine_secret_ok', { p: '' });
    if (!error) return true;
  }
  const secret = req.headers.get('x-lead-engine-secret');
  if (!secret) return false;
  const { data } = await supabase.rpc('lead_engine_secret_ok', { p: secret });
  return data === true;
}

Deno.serve(async (req: Request) => {
  if (!(await authorized(req))) return json({ error: 'unauthorized' }, 401);
  const url = new URL(req.url);
  const force = url.searchParams.get('force') as 'daily' | 'weekly' | null;
  const dry = url.searchParams.get('dry') === '1';
  try {
    const { data: s } = await supabase.from('lead_engine_settings').select('live_since, report_slack_user').eq('id', 1).single();
    const live = new Date(s!.live_since);
    const now = new Date();
    const daysLive = Math.floor((now.getTime() - live.getTime()) / DAY);

    // Daily for the first three mornings after go-live, then Mondays.
    let kind: 'daily' | 'weekly' | null = force;
    if (!kind) {
      if (daysLive <= 3 && now.getTime() - live.getTime() > 12 * 3600e3) kind = 'daily';
      else if (centralDow(now) === 1) kind = 'weekly';
    }
    if (!kind) return json({ ok: true, skipped: 'not a report day' });

    const end = now;
    const start = kind === 'daily'
      ? new Date(Math.max(end.getTime() - DAY, live.getTime()))
      : new Date(Math.max(end.getTime() - 7 * DAY, live.getTime()));
    const cur = await metrics(start, end);

    // Baseline: the 30 days before go-live (AppFolio's automations), scaled to this period's length.
    const base = await metrics(new Date(live.getTime() - 30 * DAY), live);
    let prev: any = null;
    if (kind === 'weekly') {
      const { data: p } = await supabase.from('lead_reports').select('metrics').eq('kind', 'weekly').order('period_end', { ascending: false }).limit(1).maybeSingle();
      prev = p?.metrics || null;
    }
    const feedback = kind === 'weekly' ? await claudeFeedback(cur, prev, base) : null;
    const text = slackBlocksText(kind, cur, base, feedback);

    if (dry) return json({ kind, text, metrics: cur });

    const { data: row } = await supabase.from('lead_reports').insert({
      kind, period_start: start.toISOString(), period_end: end.toISOString(), metrics: cur, feedback, slack_text: text,
    }).select('id').single();
    try {
      await postDm(s!.report_slack_user || 'U039CBF4PJ9', text);
      await supabase.from('lead_reports').update({ status: 'sent' }).eq('id', row!.id);
    } catch (e: any) {
      await supabase.from('lead_reports').update({ status: 'failed', error: String(e?.message || e) }).eq('id', row!.id);
      throw e;
    }
    return json({ ok: true, kind, sent: true });
  } catch (e: any) {
    console.error('lead-report', e?.message || e);
    return json({ error: e?.message || String(e) }, 500);
  }
});
