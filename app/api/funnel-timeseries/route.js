import { requireAuth } from '../../../lib/auth';
import { NextResponse } from 'next/server';

// Per-bucket counts for the five Leasing Lifecycle stages, given the same
// filters as /api/funnel and /api/stage-stats. Client computes rates.
//
// Returns:
//   { granularity, buckets: [
//       { key, label,
//         inquiries, showings_scheduled, showings_completed,
//         applications, leases } ] }
//
// Counts match the aggregates in /api/funnel:
//   inquiries         — leasing_reports rows in window
//   showings_scheduled — ALL showings rows in window (tile shows totalShowings)
//   showings_completed — showings.status = 'Completed'
//   applications      — rental_applications rows in window
//   leases            — Converted/Approved applications, deduped by unit
//                       (one per unit; each unit lands in its most-recent
//                       application's bucket)

import { filterRecordsByRegion as filterByRegion } from '../../../lib/propertyGroups';

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function bucketDate(dateStr, granularity) {
  const [y, m, d] = dateStr.split('-').map(Number);
  switch (granularity) {
    case 'daily':
      return { key: dateStr, label: `${m}/${d}` };
    case 'weekly': {
      const date = new Date(y, m - 1, d);
      const day = date.getDay();
      const sun = new Date(date); sun.setDate(date.getDate() - day);
      const sk = `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')}`;
      return { key: sk, label: `${sun.getMonth() + 1}/${sun.getDate()}` };
    }
    case 'monthly':
      return { key: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTH_ABBR[m - 1]} '${String(y).slice(2)}` };
    case 'quarterly': {
      const q = Math.ceil(m / 3);
      return { key: `${y}-Q${q}`, label: `Q${q} '${String(y).slice(2)}` };
    }
    default:
      return { key: dateStr, label: `${m}/${d}` };
  }
}

function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function generateAllBuckets(startDateStr, endDateStr, granularity) {
  if (!startDateStr || !endDateStr) return [];
  const seen = new Set();
  const buckets = [];
  const start = parseDateStr(startDateStr);
  const end   = parseDateStr(endDateStr);
  const cur = new Date(start);
  while (cur <= end) {
    const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    const b = bucketDate(ds, granularity);
    if (!seen.has(b.key)) { seen.add(b.key); buckets.push(b); }
    cur.setDate(cur.getDate() + 1);
  }
  return buckets;
}

function toDateStr(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { searchParams } = new URL(request.url);
    const property    = searchParams.get('property');
    const region      = searchParams.get('region');
    const startDate   = searchParams.get('startDate');
    const endDate     = searchParams.get('endDate');
    const granularity = searchParams.get('granularity') || 'weekly';

    const addDate = (q, f) => {
      if (startDate) q = q.gte(f, startDate);
      if (endDate)   q = q.lte(f, endDate + 'T23:59:59');
      return q;
    };

    // Inquiries
    let inqQ = supabase.from('leasing_reports').select('inquiry_received, property');
    if (property && property !== 'all') inqQ = inqQ.eq('property', property);
    inqQ = addDate(inqQ, 'inquiry_received');
    let { data: inqData, error: inqErr } = await inqQ;
    if (inqErr) throw inqErr;
    if (region) inqData = filterByRegion(inqData || [], region);

    // Showings (all + completed)
    let shQ = supabase.from('showings').select('showing_time, status, property');
    if (property && property !== 'all') shQ = shQ.eq('property', property);
    shQ = addDate(shQ, 'showing_time');
    let { data: shData, error: shErr } = await shQ;
    if (shErr) throw shErr;
    if (region) shData = filterByRegion(shData || [], region);

    // Applications (+ derive leases)
    let appQ = supabase.from('rental_applications')
      .select('received, unit, status, application_status');
    if (property && property !== 'all') appQ = appQ.like('unit', `${property} - %`);
    appQ = addDate(appQ, 'received');
    let { data: appData, error: appErr } = await appQ;
    if (appErr) throw appErr;
    if (region) appData = filterByRegion(appData || [], region);

    // Lease dedup: match /api/funnel — for each unit, keep the most-recent
    // Converted/Approved application. Each unit contributes ONE lease, into
    // that most-recent application's bucket.
    const leaseByUnit = new Map();
    (appData || []).forEach(row => {
      const st = row.application_status || row.status;
      if (st !== 'Converted' && st !== 'Approved') return;
      const unit = row.unit || '__no_unit__';
      const received = row.received ? new Date(row.received) : null;
      if (!received) return;
      const existing = leaseByUnit.get(unit);
      if (!existing || received > existing.received) {
        leaseByUnit.set(unit, { received, unit });
      }
    });

    // Bucket range: default to actual data span if not passed
    let s = startDate;
    let e = endDate || toDateStr(new Date());
    if (!s) {
      let minDate = null;
      const consider = d => {
        if (!d) return;
        const dd = new Date(d);
        if (isNaN(dd.getTime())) return;
        if (!minDate || dd < minDate) minDate = dd;
      };
      (inqData || []).forEach(r => consider(r.inquiry_received));
      (shData  || []).forEach(r => consider(r.showing_time));
      (appData || []).forEach(r => consider(r.received));
      s = minDate ? toDateStr(minDate) : toDateStr(new Date(Date.now() - 30 * 86400_000));
    }

    const buckets = generateAllBuckets(s, e, granularity);
    const bucketMap = new Map();
    buckets.forEach(b => bucketMap.set(b.key, {
      key: b.key, label: b.label,
      inquiries: 0, showings_scheduled: 0, showings_completed: 0,
      applications: 0, leases: 0,
    }));

    const bump = (dateVal, field) => {
      const ds = toDateStr(dateVal);
      if (!ds) return;
      const b = bucketDate(ds, granularity);
      const row = bucketMap.get(b.key);
      if (row) row[field] += 1;
    };

    (inqData || []).forEach(r => bump(r.inquiry_received, 'inquiries'));
    (shData  || []).forEach(r => {
      bump(r.showing_time, 'showings_scheduled');
      if (r.status === 'Completed') bump(r.showing_time, 'showings_completed');
    });
    (appData || []).forEach(r => bump(r.received, 'applications'));
    leaseByUnit.forEach(({ received }) => bump(received, 'leases'));

    // Trim future-only buckets (past + current period only)
    const todayStr = toDateStr(new Date());
    const trimmed = buckets
      .filter(b => b.key <= todayStr || granularity === 'monthly' || granularity === 'quarterly')
      .map(b => bucketMap.get(b.key));

    return NextResponse.json({
      granularity,
      buckets: trimmed,
    }, { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } });
  } catch (err) {
    console.error('funnel-timeseries error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
