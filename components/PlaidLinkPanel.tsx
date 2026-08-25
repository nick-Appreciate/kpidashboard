'use client';

/**
 * /admin/plaid-link — one-time UI to link an external bank (Simmons, etc.)
 * via Plaid Link. Flow:
 *   1. POST /api/admin/plaid/link-token → get short-lived link_token
 *   2. usePlaidLink() opens the Plaid Link modal with that token; user
 *      picks their bank and enters credentials (or OAuth-redirects for
 *      banks that require it)
 *   3. On success, Plaid hands us a public_token; we POST to
 *      /api/admin/plaid/exchange-token, which trades it for a permanent
 *      access_token + does an immediate balance pull.
 *   4. Successful items appear in the list below and show up in /admin/cash.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import useSWR from 'swr';
import { fetcher } from '../lib/swr';
import { Loader2, CheckCircle2, AlertCircle, Building2, History, Trash2 } from 'lucide-react';

interface LinkedItem {
  id: string;
  institution_name: string | null;
  institution_id: string | null;
  linked_at: string;
  last_synced_at: string | null;
  status: string;
  status_message: string | null;
  linked_by: string | null;
}

export default function PlaidLinkPanel() {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<Record<string, 'backfill' | 'unlink' | null>>({});
  const [rowMessage, setRowMessage] = useState<Record<string, { kind: 'ok' | 'err'; text: string } | null>>({});

  const { data: items, mutate: refetchItems } = useSWR<{ items: LinkedItem[] }>(
    '/api/admin/plaid/items', fetcher,
  );

  // 1. Fetch a link_token on mount
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/admin/plaid/link-token', { method: 'POST' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Failed to create link token');
        setLinkToken(j.link_token);
      } catch (err: any) {
        setTokenError(err.message);
      }
    })();
  }, []);

  // 2. Wire up Plaid Link with that token
  const onSuccess = useCallback(async (public_token: string, metadata: any) => {
    setBusy(true);
    setExchangeError(null);
    try {
      const r = await fetch('/api/admin/plaid/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          public_token,
          institution: metadata.institution,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Exchange failed');
      setResult(j);
      refetchItems();
    } catch (err: any) {
      setExchangeError(err.message);
    } finally {
      setBusy(false);
    }
  }, [refetchItems]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

  const backfill = useCallback(async (itemId: string) => {
    setRowBusy(s => ({ ...s, [itemId]: 'backfill' }));
    setRowMessage(s => ({ ...s, [itemId]: null }));
    try {
      const r = await fetch('/api/admin/plaid/backfill-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId }),
      });
      const j = await r.json();
      if (!r.ok && r.status !== 202) throw new Error(j.error || j.items?.[0]?.error || 'Backfill failed');
      const itemResult = j.items?.[0];
      if (itemResult?.error) {
        setRowMessage(s => ({ ...s, [itemId]: { kind: 'err', text: itemResult.error } }));
      } else {
        const days = itemResult?.accounts?.reduce((a: number, x: any) => Math.max(a, x.days_backfilled || 0), 0) || 0;
        setRowMessage(s => ({ ...s, [itemId]: {
          kind: 'ok',
          text: `Backfilled ${days.toLocaleString()} days across ${itemResult?.accounts?.length || 0} account(s). Total Cash rebuilt for ${j.total_cash_rows_updated?.toLocaleString() || 0} historical dates.`,
        } }));
      }
      refetchItems();
    } catch (err: any) {
      setRowMessage(s => ({ ...s, [itemId]: { kind: 'err', text: err.message } }));
    } finally {
      setRowBusy(s => ({ ...s, [itemId]: null }));
    }
  }, [refetchItems]);

  const unlink = useCallback(async (itemId: string, name: string | null) => {
    if (!confirm(`Unlink ${name || 'this bank'}? Historical balances stay in the database; only the live connection is revoked.`)) return;
    setRowBusy(s => ({ ...s, [itemId]: 'unlink' }));
    setRowMessage(s => ({ ...s, [itemId]: null }));
    try {
      const r = await fetch(`/api/admin/plaid/items/${itemId}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Unlink failed');
      refetchItems();
    } catch (err: any) {
      setRowMessage(s => ({ ...s, [itemId]: { kind: 'err', text: err.message } }));
    } finally {
      setRowBusy(s => ({ ...s, [itemId]: null }));
    }
  }, [refetchItems]);

  return (
    <div className="max-w-3xl mx-auto p-6 text-slate-100">
      <h1 className="text-2xl font-bold text-white mb-1">Link a bank via Plaid</h1>
      <p className="text-sm text-slate-400 mb-6">
        Use this to connect external bank accounts (Simmons, etc.) that Mercury&apos;s API
        doesn&apos;t expose. Once linked, the account&apos;s daily balance flows into{' '}
        <a href="/admin/cash" className="text-cyan-400 hover:underline">/admin/cash</a>{' '}
        as part of Total Cash. This authentication is a one-time step per bank.
      </p>

      {/* Link CTA */}
      <div className="glass-card p-5 mb-6">
        {tokenError ? (
          <div className="flex items-center gap-2 text-red-300">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{tokenError}</span>
          </div>
        ) : !linkToken ? (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Requesting Plaid session…</span>
          </div>
        ) : (
          <button
            onClick={() => open()}
            disabled={!ready || busy}
            className="inline-flex items-center gap-2 rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Linking…</>
              : <><Building2 className="h-4 w-4" /> Link a bank</>}
          </button>
        )}

        {result?.ok && (
          <div className="mt-4 p-3 rounded bg-emerald-500/15 border border-emerald-500/30 text-sm">
            <div className="flex items-center gap-2 text-emerald-300 font-semibold">
              <CheckCircle2 className="h-4 w-4" />
              Linked {result.institution?.name || 'bank'}
            </div>
            {result.accounts?.length > 0 && (
              <ul className="mt-2 space-y-1 text-slate-200">
                {result.accounts.map((a: any) => (
                  <li key={a.mask} className="text-xs">
                    {a.name} ••{a.mask} — ${(a.balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {exchangeError && (
          <div className="mt-4 p-3 rounded bg-red-500/15 border border-red-500/30 text-sm text-red-300">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="h-4 w-4" /> Link failed
            </div>
            <div className="mt-1 text-xs">{exchangeError}</div>
          </div>
        )}
      </div>

      {/* Existing linked items */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">
        Currently linked
      </h2>
      {!items ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : items.items.length === 0 ? (
        <div className="text-slate-500 text-sm">No banks linked yet.</div>
      ) : (
        <ul className="space-y-2">
          {items.items.map((it) => {
            const rb  = rowBusy[it.id] ?? null;
            const msg = rowMessage[it.id] ?? null;
            return (
              <li key={it.id} className="glass-card p-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-white font-medium">
                      {it.institution_name || it.institution_id || 'Unknown institution'}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Linked {new Date(it.linked_at).toLocaleDateString()}
                      {it.linked_by ? ` by ${it.linked_by}` : ''}
                      {it.last_synced_at ? ` · last synced ${new Date(it.last_synced_at).toLocaleString()}` : ''}
                    </div>
                    {it.status !== 'active' && (
                      <div className="text-xs text-amber-300 mt-1">
                        Status: {it.status}{it.status_message ? ` — ${it.status_message}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => backfill(it.id)}
                      disabled={!!rb}
                      title="Reconstruct up to 24 months of daily balances from transaction history"
                      className="inline-flex items-center gap-1.5 rounded bg-slate-700/60 hover:bg-slate-700 text-slate-100 text-xs px-2.5 py-1 disabled:opacity-50"
                    >
                      {rb === 'backfill'
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <History className="h-3.5 w-3.5" />}
                      Backfill history
                    </button>
                    <button
                      onClick={() => unlink(it.id, it.institution_name)}
                      disabled={!!rb}
                      title="Revoke Plaid access token; historical balances preserved"
                      className="inline-flex items-center gap-1.5 rounded bg-red-500/15 hover:bg-red-500/25 text-red-200 text-xs px-2.5 py-1 disabled:opacity-50"
                    >
                      {rb === 'unlink'
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />}
                      Unlink
                    </button>
                    <div className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${
                      it.status === 'active'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}>
                      {it.status}
                    </div>
                  </div>
                </div>
                {msg && (
                  <div className={`mt-2 text-xs px-2 py-1.5 rounded ${
                    msg.kind === 'ok'
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-200'
                      : 'bg-red-500/15 border border-red-500/30 text-red-200'
                  }`}>
                    {msg.text}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
