const fs = require('fs');
const path = require('path');
// Usage: node arcade/scripts/fetch-dq.js [envFile]  (default: the repo's .env.local)
const ENV_FILE = process.argv[2] || path.join(__dirname, '../../.env.local');
const OUT = path.join(__dirname, '../data/dq.json');
const env = Object.fromEntries(fs.readFileSync(ENV_FILE, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const get = async (path) => { const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }); if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); };
(async () => {
  const latest = (await get('af_delinquency?select=snapshot_date&order=snapshot_date.desc&limit=1'))[0].snapshot_date;
  // Same day of the month, one month back (clamped to that month's last day).
  const [y, m, d] = latest.split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  const last = new Date(py, pm, 0).getDate();
  const prior = `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  const rows = async (date) => get(`af_delinquency?select=property_name,unit,amount_receivable&snapshot_date=eq.${date}`);
  const [cur, pri] = await Promise.all([rows(latest), rows(prior)]);
  const agg = (list) => { const o = {}; list.forEach((r) => { const p = r.property_name, u = r.unit || '—'; (o[p] = o[p] || {}); o[p][u] = Math.round((o[p][u] || 0) + Math.max(0, +r.amount_receivable)); }); return o; };
  const out = { latest, prior, cur: agg(cur), pri: agg(pri) };
  fs.writeFileSync(OUT, JSON.stringify(out));
  const tot = (o) => Object.values(o).reduce((t, p) => t + Object.values(p).reduce((a, b) => a + b, 0), 0);
  console.log('latest', latest, '$' + tot(out.cur), '| prior', prior, '$' + tot(out.pri), '| delta', ((tot(out.cur) / tot(out.pri) - 1) * 100).toFixed(1) + '%');
  for (const p of Object.keys(out.cur).sort()) { const c = Object.values(out.cur[p]).reduce((a, b) => a + b, 0), q = Object.values(out.pri[p] || {}).reduce((a, b) => a + b, 0); console.log('  ', p.padEnd(32), ('$' + q).padStart(8), '→', ('$' + c).padStart(8), q ? (((c / q) - 1) * 100).toFixed(1).padStart(7) + '%' : '   new'); }
})().catch((e) => { console.error(e.message); process.exit(1); });
