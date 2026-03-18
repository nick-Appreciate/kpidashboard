import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/auth';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('mode') || 'deposits';
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const depositId = searchParams.get('deposit_id');
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const limit = 100;
  const offset = (page - 1) * limit;

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
        const { data } = await supabase.storage.from('simmons-checks').createSignedUrl(img.front_image_path, 3600);
        front_url = data?.signedUrl || null;
      }
      if (img.back_image_path) {
        const { data } = await supabase.storage.from('simmons-checks').createSignedUrl(img.back_image_path, 3600);
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

    return NextResponse.json({ rows: raw || [], summary: buildSummary(raw || []) });
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildSummary(rows: any[]) {
  return {
    matched:      rows.filter(r => r.status === 'matched').length,
    simmons_only: rows.filter(r => r.status === 'simmons_only').length,
    af_only:      rows.filter(r => r.status === 'af_only').length,
    amount_diffs: rows.filter(r => r.status === 'matched' && r.amounts_match === false).length,
  };
}

async function attachSignedUrls(supabase: any, rows: any[]) {
  return Promise.all(rows.map(async (row) => {
    if (!row.front_image_path && !row.back_image_path) return row;
    let front_url = null, back_url = null;
    if (row.front_image_path) {
      const { data } = await supabase.storage.from('simmons-checks').createSignedUrl(row.front_image_path, 3600);
      front_url = data?.signedUrl || null;
    }
    if (row.back_image_path) {
      const { data } = await supabase.storage.from('simmons-checks').createSignedUrl(row.back_image_path, 3600);
      back_url = data?.signedUrl || null;
    }
    return { ...row, front_url, back_url };
  }));
}
