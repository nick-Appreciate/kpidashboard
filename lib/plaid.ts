import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

/**
 * Server-side Plaid client, configured from env vars:
 *   PLAID_CLIENT_ID  — from dashboard.plaid.com Team Settings → Keys
 *   PLAID_SECRET     — matching secret for the current environment
 *   PLAID_ENV        — 'sandbox' | 'development' | 'production' (default 'sandbox')
 *
 * NEVER expose this on the client. Public tokens are exchanged for access
 * tokens here; access tokens live only in Supabase (`plaid_items.access_token`)
 * and never leave the server.
 */
export function plaidClient(): PlaidApi {
  const env = (process.env.PLAID_ENV || 'sandbox') as keyof typeof PlaidEnvironments;
  const config = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID!,
        'PLAID-SECRET':    process.env.PLAID_SECRET!,
        'Plaid-Version':   '2020-09-14',
      },
    },
  });
  return new PlaidApi(config);
}
