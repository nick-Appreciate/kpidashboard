/**
 * POST /api/listings/prequal
 *
 * Captures a pre-qualification attempt from the public listings detail
 * page. The page POSTs whenever a renter clicks "Apply Now" — we run
 * the qualification rules server-side and either let them through to
 * AppFolio's application URL or send them to a soft "we'll save your
 * info" path.
 *
 * Public endpoint (no auth) — uses the service role internally to
 * insert into prequal_attempts. RLS on the table doesn't allow anon
 * INSERT, so the service-role client is the entry point.
 *
 * Request body:
 *   {
 *     listing_id, listing_address?, listing_rent,
 *     email, monthly_income, credit_band,
 *     desired_move_in?,
 *     locale?
 *   }
 *
 * Response:
 *   {
 *     passed: boolean,
 *     fail_reasons: string[],        // empty when passed
 *     requirements: { min_income, min_credit_band }
 *   }
 *
 * Qualification rules (kept intentionally permissive in v1):
 *   - monthly_income >= 3 × listing_rent
 *   - credit_band in {'620_679','680_plus'}
 * Borderline credit bands ('580_619') fall to "fail" — but the page
 * still shows a polite "you may not qualify, here's what we look for"
 * rather than blocking application entirely.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const adminSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const CREDIT_BANDS = new Set(['below_580', '580_619', '620_679', '680_plus', 'unsure']);
const PASSING_CREDIT_BANDS = new Set(['620_679', '680_plus']);
const INCOME_MULTIPLIER = 3;

interface Body {
  listing_id?: string;
  listing_address?: string;
  listing_rent?: number;
  email?: string;
  monthly_income?: number;
  credit_band?: string;
  desired_move_in?: string | null;
  locale?: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const listing_id    = String(body.listing_id || '').trim();
  const email         = String(body.email || '').trim().toLowerCase();
  const credit_band   = String(body.credit_band || '').trim();
  const monthlyIncome = Number(body.monthly_income);
  const listingRent   = Number(body.listing_rent);

  if (!listing_id)                          return bad('listing_id is required');
  if (!email || !email.includes('@'))       return bad('valid email is required');
  if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0)
    return bad('monthly_income must be a positive number');
  if (!CREDIT_BANDS.has(credit_band))       return bad('credit_band must be one of the allowed values');
  if (!Number.isFinite(listingRent) || listingRent <= 0)
    return bad('listing_rent is required and must be positive');

  // Optional move-in date — accept blank
  let desired_move_in: string | null = null;
  if (body.desired_move_in) {
    const d = new Date(body.desired_move_in);
    if (!isNaN(d.getTime())) desired_move_in = d.toISOString().slice(0, 10);
  }

  const fail_reasons: string[] = [];
  if (monthlyIncome < listingRent * INCOME_MULTIPLIER) fail_reasons.push('income_below_3x_rent');
  if (!PASSING_CREDIT_BANDS.has(credit_band))          fail_reasons.push('credit_below_620');
  const passed = fail_reasons.length === 0;

  const userAgent = req.headers.get('user-agent') || null;
  const locale = (body.locale === 'es' || body.locale === 'en') ? body.locale : 'en';

  const { error } = await adminSupabase().from('prequal_attempts').insert({
    listing_id,
    listing_address: body.listing_address || null,
    listing_rent: listingRent,
    email,
    monthly_income: monthlyIncome,
    credit_band,
    desired_move_in,
    passed,
    fail_reasons: fail_reasons.length ? fail_reasons : null,
    locale,
    user_agent: userAgent,
  });
  if (error) {
    console.error('prequal insert failed:', error.message);
    return NextResponse.json({ error: 'Could not record attempt' }, { status: 500 });
  }

  return NextResponse.json({
    passed,
    fail_reasons,
    requirements: {
      min_income_monthly: listingRent * INCOME_MULTIPLIER,
      min_credit_band: '620_679',
    },
  });
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
