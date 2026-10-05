const fs = require('fs');
process.chdir(require('path').join(__dirname, '../data')); // reads units_raw.json, writes units.json
const R = JSON.parse(fs.readFileSync('units_raw.json', 'utf8'));
const today = new Date(R.latest + 'T00:00:00');
const days = (d) => Math.round((new Date(d + 'T00:00:00') - today) / 86400000);
const OPEN = (s) => !/complet|cancel|closed/i.test(s || '');
const phone = (s) => { if (!s) return ''; const m = s.match(/\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}|\+1\d{10}/); if (!m) return ''; const d = m[0].replace(/\D/g, '').slice(-10); return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; };
const out = {};
const U = (p, u) => ((out[p] = out[p] || {})[u] = out[p][u] || {});
for (const r of R.rr) {
  const x = U(r.property, r.unit);
  x.s = r.status; x.t = r.tenant_name || ''; x.le = r.lease_to || '';
}
// directory: prefer current tenants for the phone
for (const d of R.dir) {
  if (!out[d.property_name] || !out[d.property_name][d.unit]) continue;
  if (!/current|notice|evict/i.test(d.status || '')) continue;
  const x = out[d.property_name][d.unit];
  if (!x.ph) x.ph = phone(d.phone_numbers);
  if (!x.em && d.email) x.em = d.email;
  if (d.move_in && (!x.mi || d.move_in < x.mi)) x.mi = d.move_in;
}
let woCount = 0, woNoUnit = 0;
for (const w of R.wo) {
  if (!OPEN(w.status)) continue;
  if (!out[w.property_name]) continue;
  if (!w.unit_name) { woNoUnit++; (out[w.property_name].__common = out[w.property_name].__common || { wo: [] }).wo.push(w); continue; }
  const x = out[w.property_name][w.unit_name]; if (!x) continue;
  (x.wo = x.wo || []).push([w.work_order_number, w.work_order_issue || w.work_order_type || 'General', w.status, w.priority || '', -days(w.created_at.slice(0, 10)), (w.vendor || '').slice(0, 40), (w.job_description || '').replace(/\s+/g, ' ').trim().slice(0, 160), w.assigned_user || '']);
  woCount++;
}
for (const d of R.dq) { const x = out[d.property_name] && out[d.property_name][d.unit]; if (x && +d.amount_receivable > 0) x.due = Math.round((x.due || 0) + +d.amount_receivable); }
for (const r of R.ren) {
  const x = out[r.property_name] && out[r.property_name][r.unit_name]; if (!x || !r.lease_end) continue;
  if (!x.rnEnd || r.lease_end > x.rnEnd) { x.rnEnd = r.lease_end; x.rn = r.status; }
}
// compact: drop helper fields, keep lease end only when it matters (<= 90 days or lapsed)
const final = {};
for (const p of Object.keys(out)) {
  final[p] = {};
  for (const u of Object.keys(out[p])) {
    const x = out[p][u];
    if (u === '__common') { final[p].__common = x.wo.map((w) => [w.work_order_number, w.work_order_issue || 'General', w.status, w.priority || '', -days(w.created_at.slice(0, 10)), (w.vendor || '').slice(0, 40), (w.job_description || '').replace(/\s+/g, ' ').trim().slice(0, 160), w.assigned_user || '']); continue; }
    const o = { t: x.t, ph: x.ph || '', s: x.s };
    if (x.mi) o.mi = x.mi;
    if (x.le && x.s === 'Current') { const dl = days(x.le); if (dl <= 90) { o.le = x.le; o.dl = dl; o.rn = x.rn || ''; } }
    if (x.due) o.due = x.due;
    if (x.wo) o.wo = x.wo;
    final[p][u] = o;
  }
}
fs.writeFileSync('units.json', JSON.stringify(final));
const flat = Object.values(final).flatMap((p) => Object.entries(p).filter(([k]) => k !== '__common').map(([, v]) => v));
console.log('units', flat.length, '| with tenant name', flat.filter((v) => v.t).length, '| with phone', flat.filter((v) => v.ph).length,
  '| open WOs on units', woCount, '| WOs with no unit', woNoUnit, '| units past due', flat.filter((v) => v.due).length,
  '| leases ending <=90d', flat.filter((v) => v.le).length, '| bytes', fs.statSync('units.json').size);
