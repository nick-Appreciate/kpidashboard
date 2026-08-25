import { NextResponse } from 'next/server';
import { CountryCode, Products } from 'plaid';
import { plaidClient } from '../../../../../lib/plaid';
import { requireAdmin } from '../../../../../lib/auth';

/**
 * POST /api/admin/plaid/link-token
 *
 * Creates a short-lived `link_token` used by Plaid Link (client-side JS) to
 * authenticate the user with their bank. The token is scoped to this app +
 * this user + the products we're requesting; it expires in ~4 hours.
 *
 * Products requested: Auth only. Balance is not a standalone product in the
 * current Plaid API — /accounts/balance/get is available on any Item that has
 * at least one other product initialized. Auth is the lightest choice.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;

  try {
    const res = await plaidClient().linkTokenCreate({
      user: { client_user_id: auth.user.id },
      client_name: 'Appreciate KPI Dashboard',
      products: [Products.Auth],
      country_codes: [CountryCode.Us],
      language: 'en',
      // Redirect URI would go here if we needed OAuth-only banks; Simmons uses
      // credential-based auth so no redirect is needed.
    });
    return NextResponse.json({ link_token: res.data.link_token, expiration: res.data.expiration });
  } catch (err: any) {
    console.error('Plaid link-token error:', err?.response?.data || err);
    return NextResponse.json(
      { error: err?.response?.data?.error_message || err?.message || 'Plaid error' },
      { status: 500 },
    );
  }
}
