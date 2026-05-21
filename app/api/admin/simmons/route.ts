import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabase';

// Use service-role client for storage signed URLs. Admin auth is already
// verified at the API layer; the service-role bypass avoids any RLS edge
// cases with the user-scoped JWT against the storage bucket.
function storageClient() {
  return supabaseAdmin ?? null;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;
  const storage = storageClient() ?? supabase; // fallback to user client

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('mode') || 'deposits';
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const depositId = searchParams.get('deposit_id');
  const checkImageId = searchParams.get('check_image_id');
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const limit = 100;
  const offset = (page - 1) * limit;

  // ── Return a single check image by ID ───────────────────────────────────────
  if (checkImageId) {
    const { data: images, error } = await supabase
      .from('simmons_check_images')
      .select('id, image_index, image_type, amount, check_type, payer_name, payer_address, issuer, money_order_number, check_number, check_date, memo, routing_number, front_image_path, back_image_path, extracted_at')
      .eq('id', checkImageId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const imagesWithUrls = await Promise.all((images || []).map(async (img) => {
      let front_url = null, back_url = null;
      if (img.front_image_path) {
        const { data } = await storage.storage.from('simmons-checks').createSignedUrl(img.front_image_path, 3600);
        front_url = data?.signedUrl || null;
      }
      if (img.back_image_path) {
        const { data } = await storage.storage.from('simmons-checks').createSignedUrl(img.back_image_path, 3600);
        back_url = data?.signedUrl || null;
      }
      return { ...img, front_url, back_url };
    }));

    return NextResponse.json({ images: imagesWithUrls });
  }

  // ── Return check images + signed URLs for a specific deposit ──────────────
  if (depositId) {
    const { data: images, error } = await supabase
      .from('simmons_check_images')
      .select('id, image_index, image_type, amount, check_type, payer_name, payer_address, issuer, money_order_number, check_number, check_date, memo, routing_number, front_image_path, back_image_path, extracted_at')
      .eq('deposit_id', depositId)
      .not('image_type', 'in', '("deposit_slip","low_quality","endorsement_back")')
      .order('image_index');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const imagesWithUrls = await Promise.all((images || []).map(async (img) => {
      let front_url = null, back_url = null;
      if (img.front_image_path) {
        const { data } = await storage.storage.from('simmons-checks').createSignedUrl(img.front_image_path, 3600);
        front_url = data?.signedUrl || null;
      }
      if (img.back_image_path) {
        const { data } = await storage.storage.from('simmons-checks').createSignedUrl(img.back_image_path, 3600);
        back_url = data?.signedUrl || null;
      }
      return { ...img, front_url, back_url };
    }));

    return NextResponse.json({ images: imagesWithUrls });
  }

  // ── Reconciliation mode ───────────────────────────────────────────────────
  if (mode === 'reconcile') {
    // Fetch all rows from view — client handles date filtering so nulls on either
    // side (simmons_only / af_only) are included correctly
    const { data: raw, error } = await supabase
      .from('v_simmons_reconcile')
      .select('*')
      .order('deposit_date', { ascending: false, nullsFirst: false })
      .limit(2000);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Fetch all manual resolutions and merge into rows
    const { data: resolutions } = await supabase
      .from('simmons_reconcile_resolutions')
      .select('id, check_image_id, af_id, resolved_by, resolved_at, notes')
      .order('resolved_at', { ascending: false });

    const byCheck = new Map<string, any>();
    const byAf = new Map<string, any>();
    for (const r of resolutions || []) {
      if (r.check_image_id) byCheck.set(r.check_image_id, r);
      if (r.af_id) byAf.set(r.af_id, r);
    }

    const rowsWithResolution = (raw || []).map((row: any) => {
      const res =
        (row.check_image_id && byCheck.get(row.check_image_id)) ||
        (row.af_id && byAf.get(row.af_id)) ||
        null;
      return {
        ...row,
        resolution: res
          ? {
              id: res.id,
              resolved_by: res.resolved_by,
              resolved_at: res.resolved_at,
              notes: res.notes,
            }
          : null,
      };
    });

    return NextResponse.json({
      rows: rowsWithResolution,
      summary: buildSummary(rowsWithResolution),
    });
  }

  // ── Deposits list mode (original) ─────────────────────────────────────────
  let matchingDepositIds: string[] | null = null;
  if (search && search.length >= 2) {
    const { data: matches } = await supabase
      .from('simmons_check_images')
      .select('deposit_id')
      .or(`payer_name.ilike.%${search}%,money_order_number.ilike.%${search}%,check_number.ilike.%${search}%,memo.ilike.%${search}%`)
      .limit(200);
    if (matches) matchingDepositIds = Array.from(new Set(matches.map(m => m.deposit_id)));
  }

  let query = supabase
    .from('simmons_deposits')
    .select(`
      id, account_suffix, deposit_date, amount, image_count, transaction_id,
      simmons_check_images!inner(id, image_type, amount, check_type, payer_name, money_order_number, extracted_at)
    `, { count: 'exact' })
    .order('deposit_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (matchingDepositIds !== null) {
    if (matchingDepositIds.length === 0) return NextResponse.json({ deposits: [], total: 0 });
    query = query.in('id', matchingDepositIds);
  } else if (search) {
    const asAmount = parseFloat(search);
    if (!isNaN(asAmount)) query = query.eq('amount', asAmount);
    else query = query.ilike('deposit_date', `${search}%`);
  }

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const deposits = (data || []).map((dep: any) => {
    const checks = dep.simmons_check_images || [];
    const extracted = checks.filter((c: any) => c.extracted_at && c.check_type);
    const payers = Array.from(new Set(extracted.map((c: any) => c.payer_name).filter(Boolean)));
    const types  = Array.from(new Set(extracted.map((c: any) => c.check_type).filter(Boolean)));
    return {
      id: dep.id,
      account_suffix: dep.account_suffix,
      deposit_date: dep.deposit_date,
      amount: dep.amount,
      image_count: dep.image_count,
      transaction_id: dep.transaction_id,
      extracted_count: extracted.length,
      total_checks: checks.filter((c: any) => !['deposit_slip','low_quality','endorsement_back'].includes(c.image_type)).length,
      payers,
      types,
    };
  });

  return NextResponse.json({ deposits, total: count || 0 });
}

// ── POST: resolve / unresolve a reconciliation exception ─────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action, check_image_id, af_id, notes } = body || {};

  if (action !== 'resolve' && action !== 'unresolve') {
    return NextResponse.json({ error: 'action must be "resolve" or "unresolve"' }, { status: 400 });
  }
  if (!check_image_id && !af_id) {
    return NextResponse.json({ error: 'either check_image_id or af_id is required' }, { status: 400 });
  }
  if (check_image_id && af_id) {
    return NextResponse.json({ error: 'only one of check_image_id / af_id may be set' }, { status: 400 });
  }

  if (action === 'resolve') {
    const { data, error } = await supabase
      .from('simmons_reconcile_resolutions')
      .upsert(
        {
          check_image_id: check_image_id || null,
          af_id: af_id || null,
          resolved_by: auth.appUser.email,
          notes: (notes || '').toString().trim() || null,
          resolved_at: new Date().toISOString(),
        },
        { onConflict: check_image_id ? 'check_image_id' : 'af_id' }
      )
      .select('id, check_image_id, af_id, resolved_by, resolved_at, notes')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ resolution: data });
  }

  // action === 'unresolve'
  let q = supabase.from('simmons_reconcile_resolutions').delete();
  q = check_image_id ? q.eq('check_image_id', check_image_id) : q.eq('af_id', af_id);
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildSummary(rows: any[]) {
  return {
    matched:        rows.filter(r => r.status === 'matched').length,
    simmons_only:   rows.filter(r => r.status === 'simmons_only' && !r.resolution).length,
    af_only:        rows.filter(r => r.status === 'af_only' && !r.resolution).length,
    resolved:       rows.filter(r => r.resolution).length,
    amount_diffs:   rows.filter(r => r.status === 'matched' && r.amounts_match === false).length,
    duplicate_refs: rows.filter(r => r.duplicate_ref === true).length,
  };
}

// (helper not currently called; takes any Supabase-like client with .storage)
async function attachSignedUrls(client: any, rows: any[]) {
  return Promise.all(rows.map(async (row) => {
    if (!row.front_image_path && !row.back_image_path) return row;
    let front_url = null, back_url = null;
    if (row.front_image_path) {
      const { data } = await client.storage.from('simmons-checks').createSignedUrl(row.front_image_path, 3600);
      front_url = data?.signedUrl || null;
    }
    if (row.back_image_path) {
      const { data } = await client.storage.from('simmons-checks').createSignedUrl(row.back_image_path, 3600);
      back_url = data?.signedUrl || null;
    }
    return { ...row, front_url, back_url };
  }));
}
