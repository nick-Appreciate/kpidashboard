// Per-unit data for the Appreciate Arcade (arcade/src/Main.dc.html), built
// from the latest rent roll, tenant directory, work orders, delinquency and
// renewals. Shared by the /api/arcade route (live, with the signed-in user's
// client) and arcade/scripts/refresh-data.mjs (for publishing the artifact).
//
// Shape, per property and unit:
//   t tenant · ph phone · s rent-roll status · mi move-in
//   le/dl/rn lease end, days left, renewal status (only when ≤ 90 days or lapsed)
//   due past due today · pd past due on the same day last month
//   wo open work orders [number, issue, status, priority, age, vendor, description, assignee]
// plus per property __common (work orders with no unit) and __other (balances
// on units the map doesn't draw), and a top-level __dq with the two dates.

const PAGE = 1000; // PostgREST caps responses at 1000 rows

async function all(query) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function latestDate(supabase, table) {
  const { data, error } = await supabase.from(table).select('snapshot_date').order('snapshot_date', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return data[0].snapshot_date;
}

// Same day of the month, one month back (clamped to that month's last day).
export function priorMonthDate(latest) {
  const [y, m, d] = latest.split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  const last = new Date(py, pm, 0).getDate();
  return `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export async function fetchArcadeRaw(supabase) {
  const latest = await latestDate(supabase, 'rent_roll_snapshots');
  const dqLatest = await latestDate(supabase, 'af_delinquency');
  const dqPrior = priorMonthDate(dqLatest);
  const dqRows = (date) => all(() => supabase.from('af_delinquency').select('property_name,unit,amount_receivable').eq('snapshot_date', date));
  const [rr, dir, wo, ren, dqCur, dqPri] = await Promise.all([
    all(() => supabase.from('rent_roll_snapshots').select('property,unit,status,tenant_name,lease_to').eq('snapshot_date', latest)),
    all(() => supabase.from('af_tenant_directory').select('property_name,unit,phone_numbers,email,move_in,status')),
    all(() => supabase.from('af_work_orders').select('property_name,unit_name,work_order_number,work_order_issue,work_order_type,status,priority,created_at,vendor,job_description,assigned_user')),
    all(() => supabase.from('renewal_summary').select('property_name,unit_name,status,lease_end')),
    dqRows(dqLatest),
    dqRows(dqPrior),
  ]);
  return { latest, rr, dir, wo, ren, dq: { latest: dqLatest, prior: dqPrior, cur: dqCur, pri: dqPri } };
}

const OPEN = (s) => !/complet|cancel|closed/i.test(s || '');
const phone = (s) => {
  if (!s) return '';
  const m = s.match(/\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}|\+1\d{10}/);
  if (!m) return '';
  const d = m[0].replace(/\D/g, '').slice(-10);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

export function buildArcadeUnits(raw) {
  const today = new Date(raw.latest + 'T00:00:00');
  const days = (d) => Math.round((new Date(d + 'T00:00:00') - today) / 86400000);
  const woRow = (w) => [w.work_order_number, w.work_order_issue || w.work_order_type || 'General', w.status, w.priority || '', -days(w.created_at.slice(0, 10)),
    (w.vendor || '').slice(0, 40), (w.job_description || '').replace(/\s+/g, ' ').trim().slice(0, 160), w.assigned_user || ''];

  const out = {};
  const U = (p, u) => ((out[p] = out[p] || {})[u] = out[p][u] || {});
  for (const r of raw.rr) {
    const x = U(r.property, r.unit);
    x.s = r.status; x.t = r.tenant_name || ''; x.le = r.lease_to || '';
  }
  // Directory: phone and move-in from current, notice or eviction tenants.
  for (const d of raw.dir) {
    if (!out[d.property_name] || !out[d.property_name][d.unit]) continue;
    if (!/current|notice|evict/i.test(d.status || '')) continue;
    const x = out[d.property_name][d.unit];
    if (!x.ph) x.ph = phone(d.phone_numbers);
    if (d.move_in && (!x.mi || d.move_in < x.mi)) x.mi = d.move_in;
  }
  const common = {};
  for (const w of raw.wo) {
    if (!OPEN(w.status) || !out[w.property_name]) continue;
    if (!w.unit_name) { (common[w.property_name] = common[w.property_name] || []).push(woRow(w)); continue; }
    const x = out[w.property_name][w.unit_name];
    if (x) (x.wo = x.wo || []).push(woRow(w));
  }
  for (const r of raw.ren) {
    const x = out[r.property_name] && out[r.property_name][r.unit_name];
    if (!x || !r.lease_end) continue;
    if (!x.rnEnd || r.lease_end > x.rnEnd) { x.rnEnd = r.lease_end; x.rn = r.status; }
  }

  // Delinquency, positive balances only, per unit ('—' when no unit).
  const agg = (list) => {
    const o = {};
    list.forEach((r) => { const p = r.property_name, u = r.unit || '—'; (o[p] = o[p] || {}); o[p][u] = Math.round((o[p][u] || 0) + Math.max(0, +r.amount_receivable)); });
    return o;
  };
  const cur = agg(raw.dq.cur), pri = agg(raw.dq.pri);

  const final = {};
  for (const p of Object.keys(out)) {
    final[p] = {};
    const units = Object.keys(out[p]);
    const c = cur[p] || {}, q = pri[p] || {};
    for (const u of units) {
      const x = out[p][u];
      const o = { t: x.t, ph: x.ph || '', s: x.s };
      if (x.mi) o.mi = x.mi;
      if (x.le && x.s === 'Current') { const dl = days(x.le); if (dl <= 90) { o.le = x.le; o.dl = dl; o.rn = x.rn || ''; } }
      if (u in c) o.due = c[u];
      if (q[u]) o.pd = q[u];
      if (x.wo) o.wo = x.wo;
      final[p][u] = o;
    }
    if (common[p]) final[p].__common = common[p];
    const rest = (o) => Object.entries(o).filter(([u]) => !units.includes(u)).reduce((t, [, v]) => t + v, 0);
    const oc = rest(c), op = rest(q);
    if (oc || op) final[p].__other = { due: oc, pd: op };
  }
  final.__dq = { latest: raw.dq.latest, prior: raw.dq.prior };
  return final;
}

export async function arcadeUnits(supabase) {
  return buildArcadeUnits(await fetchArcadeRaw(supabase));
}
