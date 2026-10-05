const fs = require('fs');
const path = require('path');
// Usage: node arcade/scripts/fetch-units.js [envFile]  (default: the repo's .env.local)
const ENV_FILE = process.argv[2] || path.join(__dirname, '../../.env.local');
const OUT = path.join(__dirname, '../data/units_raw.json');
const env = Object.fromEntries(fs.readFileSync(ENV_FILE, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
async function all(path) {
  const rows = []; let from = 0;
  for (;;) {
    const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
    if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const b = await r.json(); rows.push(...b); if (b.length < 1000) break; from += 1000;
  }
  return rows;
}
(async () => {
  const latest = (await all('rent_roll_snapshots?select=snapshot_date&order=snapshot_date.desc&limit=1'))[0].snapshot_date;
  const rr = await all(`rent_roll_snapshots?select=property,unit,status,tenant_name,lease_to&snapshot_date=eq.${latest}`);
  const dir = await all('af_tenant_directory?select=property_name,unit,phone_numbers,email,move_in,status');
  const wo = await all('af_work_orders?select=property_name,unit_name,work_order_number,work_order_issue,work_order_type,status,priority,created_at,vendor,job_description,assigned_user');
  const dqDate = (await all('af_delinquency?select=snapshot_date&order=snapshot_date.desc&limit=1'))[0].snapshot_date;
  const dq = await all(`af_delinquency?select=property_name,unit,amount_receivable&snapshot_date=eq.${dqDate}`);
  const ren = await all('renewal_summary?select=property_name,unit_name,status,lease_end');
  fs.writeFileSync(OUT, JSON.stringify({ latest, rr, dir, wo, dq, ren }));
  console.log('snapshot', latest, '| rent roll', rr.length, '| directory', dir.length, '| work orders', wo.length, '| delinquency', dq.length, '| renewals', ren.length);
  console.log('rent-roll rows with a tenant name:', rr.filter((r) => r.tenant_name).length);
})().catch((e) => { console.error(e.message); process.exit(1); });
