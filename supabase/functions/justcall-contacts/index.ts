import { createClient } from 'jsr:@supabase/supabase-js@2';

// Keeps JustCall contact names in sync with who the number belongs to:
//
//   tenant (current / notice / future / eviction)  "Jane Doe - 2637F"
//   former tenant                                    "Jane Doe - 2637F (former)"
//   vendor                                           "ABC Plumbing - Vendor"
//   prospect                                         "Jane Doe - Prospect"
//
// Unit labels that repeat across properties ("17") get the property's first
// word ("Oakwood 17"); the full property name goes in JustCall's Company field.
// A number that matches several records takes the first of: tenant, vendor,
// former tenant, prospect. Each phone number is its own contact.
//
// Contacts are created/updated team-wide (across_team) so every agent sees the
// same name. The name JustCall showed before we first changed it is kept in
// justcall_contact_sync.prev_name.
//
// JustCall's limit is 30 requests/min and 1,800/hour for the whole account,
// shared with sync-justcall and the lead engine — each run handles a small
// batch, paces requests and stops early when the burst budget runs low.
//
// ?dry=1        plan only (no JustCall calls), returns counts + samples
// ?only=<phone> process a single number
// ?limit=N      contacts per run (default 25)

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const JC = `${Deno.env.get('JUSTCALL_API_KEY')}:${Deno.env.get('JUSTCALL_API_SECRET')}`;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b, null, 1), { status, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function phones(raw: unknown): string[] {
  const out: string[] = [];
  for (const m of String(raw || '').matchAll(/\+?1?[\s.-]*\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})/g)) {
    const p = `${m[1]}${m[2]}${m[3]}`;
    if (!out.includes(p) && !/^(555|000)/.test(p.slice(3)) && !p.startsWith('0')) out.push(p);
  }
  return out;
}
function tidy(name: string): string {
  let n = String(name || '').trim().replace(/\s+/g, ' ');
  if (n.includes(',')) { const [last, ...rest] = n.split(','); n = `${rest.join(' ').trim()} ${last.trim()}`.trim(); }
  // Fix ALL-lower / ALL-UPPER names; leave mixed case alone.
  if (n === n.toLowerCase() || n === n.toUpperCase()) n = n.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
  return n;
}
async function sha(s: string) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
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

interface Want { phone_norm: string; source: string; source_id: string; first_name: string; last_name: string | null; company: string | null }

/** Who each phone number belongs to, by precedence. */
async function plan(): Promise<Map<string, Want>> {
  const [tenants, vendors, prospects] = await Promise.all([
    all(() => supabase.from('af_tenant_directory').select('tenant_id, tenant_name, property_name, unit, phone_numbers, status, move_out')),
    all(() => supabase.from('af_vendor_directory').select('vendor_id, company_name, name, phone_numbers, do_not_use_for_work_order')),
    all(() => supabase.from('leasing_reports').select('id, name, phone, property, inquiry_received').not('phone', 'is', null).order('inquiry_received', { ascending: false })),
  ]);

  // Unit labels shared by more than one property need the property name too.
  const unitProps = new Map<string, Set<string>>();
  for (const t of tenants as any[]) {
    if (!t.unit) continue;
    if (!unitProps.has(t.unit)) unitProps.set(t.unit, new Set());
    unitProps.get(t.unit)!.add(t.property_name || '');
  }
  const unitLabel = (unit: string | null, prop: string | null) => {
    if (!unit) return prop ? prop.split(' ')[0] : '';
    return (unitProps.get(unit)?.size || 0) > 1 && prop ? `${prop.split(' ')[0]} ${unit}` : unit;
  };

  const want = new Map<string, Want>();
  const claim = (p: string, w: Omit<Want, 'phone_norm'>) => { if (!want.has(p)) want.set(p, { phone_norm: p, ...w }); };

  const current = (tenants as any[]).filter((t) => ['Current', 'Notice', 'Future', 'Evict'].includes(t.status));
  for (const t of current) {
    const label = unitLabel(t.unit, t.property_name);
    for (const p of phones(t.phone_numbers)) {
      claim(p, { source: 'tenant', source_id: String(t.tenant_id), first_name: `${tidy(t.tenant_name)} - ${label}`.trim(), last_name: null, company: t.property_name || null });
    }
  }
  for (const v of vendors as any[]) {
    const name = tidy(v.company_name || v.name || '');
    if (!name) continue;
    for (const p of phones(v.phone_numbers)) {
      claim(p, { source: 'vendor', source_id: String(v.vendor_id), first_name: `${name} - Vendor`, last_name: null, company: 'Vendor' });
    }
  }
  const past = (tenants as any[]).filter((t) => t.status === 'Past').sort((a, b) => String(b.move_out || '').localeCompare(String(a.move_out || '')));
  for (const t of past) {
    const label = unitLabel(t.unit, t.property_name);
    for (const p of phones(t.phone_numbers)) {
      claim(p, { source: 'former_tenant', source_id: String(t.tenant_id), first_name: `${tidy(t.tenant_name)} - ${label} (former)`.trim(), last_name: null, company: t.property_name || null });
    }
  }
  for (const l of prospects as any[]) {   // newest inquiry first, so the latest property wins
    const name = tidy(l.name || '');
    if (!name) continue;
    for (const p of phones(l.phone)) {
      claim(p, { source: 'prospect', source_id: String(l.id), first_name: `${name} - Prospect`, last_name: null, company: l.property || null });
    }
  }
  return want;
}

/** Write the plan into justcall_contact_sync (DB only). */
async function savePlan(want: Map<string, Want>): Promise<number> {
  const rows = await Promise.all([...want.values()].map(async (w) => ({
    ...w, desired_hash: await sha(`${w.first_name}|${w.last_name || ''}|${w.company || ''}`), updated_at: new Date().toISOString(),
  })));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('justcall_contact_sync').upsert(rows.slice(i, i + 500), { onConflict: 'phone_norm' });
    if (error) throw new Error(`plan upsert: ${error.message}`);
  }
  return rows.length;
}

let burstRemaining = 30;
async function jc(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`https://api.justcall.io${path}`, {
    method,
    headers: { Authorization: JC, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const br = Number(res.headers.get('x-rate-limit-burst-remaining'));
  if (Number.isFinite(br)) burstRemaining = br;
  const text = await res.text();
  let b: any = text;
  try { b = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, body: b };
}

async function pushOne(row: any): Promise<string> {
  const number = `+1${row.phone_norm}`;
  const found = await jc('GET', `/v2.1/contacts?contact_number=${encodeURIComponent(number)}&across_team=true&per_page=50`);
  if (found.status === 429) throw new Error('rate limited');
  const matches: any[] = (found.body?.data || []).filter((c: any) =>
    [c.contact_number, ...(c.other_numbers || []).map((o: any) => o.number)].some((n: any) => String(n || '').replace(/\D/g, '').slice(-10) === row.phone_norm));
  const fields = { first_name: row.first_name, last_name: row.last_name || '', company: row.company || '' };

  if (matches.length) {
    const prev = row.prev_name ?? (matches[0].name || [matches[0].first_name, matches[0].last_name].filter(Boolean).join(' ') || null);
    const same = matches.every((c: any) => c.first_name === fields.first_name && (c.last_name || '') === fields.last_name && (c.company || '') === fields.company);
    if (!same) {
      const up = await jc('PUT', '/v2.1/contacts', { contact_number: matches[0].contact_number || number, ...fields, across_team: true });
      if (up.status === 429) throw new Error('rate limited');
      if (up.status >= 300) throw new Error(`update ${up.status}: ${JSON.stringify(up.body).slice(0, 200)}`);
    }
    await supabase.from('justcall_contact_sync').update({
      synced_hash: row.desired_hash, justcall_ids: matches.map((c: any) => String(c.id)), prev_name: prev,
      action: same ? 'unchanged' : 'updated', error: null, attempts: row.attempts + 1, synced_at: new Date().toISOString(),
    }).eq('phone_norm', row.phone_norm);
    return same ? 'unchanged' : 'updated';
  }

  const cr = await jc('POST', '/v2.1/contacts', { ...fields, contact_number: number, across_team: true });
  if (cr.status === 429) throw new Error('rate limited');
  if (cr.status >= 300) throw new Error(`create ${cr.status}: ${JSON.stringify(cr.body).slice(0, 200)}`);
  const ids = (Array.isArray(cr.body?.data) ? cr.body.data : [cr.body?.data]).filter(Boolean).map((c: any) => String(c.id));
  await supabase.from('justcall_contact_sync').update({
    synced_hash: row.desired_hash, justcall_ids: ids, action: 'created', error: null, attempts: row.attempts + 1, synced_at: new Date().toISOString(),
  }).eq('phone_norm', row.phone_norm);
  return 'created';
}

const ORDER: Record<string, number> = { tenant: 0, vendor: 1, former_tenant: 2, prospect: 3 };

Deno.serve(async (req: Request) => {
  // Same caller auth as the lead engine: service-role key or the vault secret (pg_cron).
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  let ok = false;
  if (bearer) { const { error } = await createClient(Deno.env.get('SUPABASE_URL')!, bearer, { auth: { persistSession: false } }).rpc('lead_engine_secret_ok', { p: '' }); ok = !error; }
  if (!ok) { const s = req.headers.get('x-lead-engine-secret'); if (s) { const { data } = await supabase.rpc('lead_engine_secret_ok', { p: s }); ok = data === true; } }
  if (!ok) return json({ error: 'unauthorized' }, 401);

  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === '1';
  const only = (url.searchParams.get('only') || '').replace(/\D/g, '').slice(-10) || null;
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit')) || 25));
  try {
    const want = await plan();
    const planned = await savePlan(want);
    // Drop numbers that no longer match anyone (we never delete JustCall contacts).
    const bySource: Record<string, number> = {};
    for (const w of want.values()) bySource[w.source] = (bySource[w.source] || 0) + 1;

    // Pull the queue a source at a time (tenants first) so PostgREST's 1,000-row
    // cap never starves higher-priority numbers; count the true backlog separately.
    const cols = 'phone_norm, source, first_name, last_name, company, desired_hash, synced_hash, prev_name, attempts';
    const pending = () => supabase.from('justcall_contact_sync').select(cols, { count: 'exact' })
      .or('synced_hash.is.null,synced_hash.neq.desired_hash').lt('attempts', 5);
    const queue: any[] = [];
    let backlog = 0;
    if (only) {
      const { data } = await supabase.from('justcall_contact_sync').select(cols).eq('phone_norm', only);
      queue.push(...(data || []));
      backlog = queue.length;
    } else {
      for (const src of Object.keys(ORDER)) {
        const { data, count } = await pending().eq('source', src).limit(dry ? 4 : Math.max(0, limit - queue.length) || 1);
        backlog += count || 0;
        if (queue.length < limit || dry) queue.push(...(data || []));
      }
    }

    if (dry) {
      const samples: Record<string, string[]> = {};
      for (const r of queue) { (samples[r.source] ||= []).length < 4 && samples[r.source].push(`${r.first_name}${r.company ? ` [${r.company}]` : ''}`); }
      return json({ dry: true, planned, bySource, remaining: backlog, samples });
    }

    const tally: Record<string, number> = {};
    const errors: string[] = [];
    // Edge functions get ~150s; keep a margin. When JustCall's per-minute burst
    // budget runs low, wait for it to refill instead of ending the run.
    const deadline = Date.now() + 120_000;
    let done = 0;
    for (const row of queue.slice(0, limit)) {
      if (burstRemaining < 6) {
        if (Date.now() + 25_000 > deadline) { tally.stopped_at_time_budget = 1; break; }
        await sleep(20_000); burstRemaining = 30;
      }
      if (Date.now() > deadline) { tally.stopped_at_time_budget = 1; break; }
      try { const r = await pushOne(row); tally[r] = (tally[r] || 0) + 1; done++; }
      catch (e: any) {
        const msg = String(e?.message || e);
        if (msg === 'rate limited') { tally.paused_for_rate_limit = 1; break; }
        errors.push(msg.slice(0, 160));
        await supabase.from('justcall_contact_sync').update({ error: msg.slice(0, 300), attempts: row.attempts + 1 }).eq('phone_norm', row.phone_norm);
        tally.failed = (tally.failed || 0) + 1;
      }
      await sleep(2200); // ~27 requests/min worst case (2 per contact) — leaves room for other JustCall traffic
    }
    return json({ planned, bySource, remaining: Math.max(0, backlog - done), tally, errors: errors.slice(0, 5) });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
