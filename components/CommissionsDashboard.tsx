'use client';

/**
 * CommissionsDashboard — leasing & renewal commissions per month.
 *
 * Gross pool = AppFolio Lease/Renewal Fee bills paid in the month; net =
 * gross × the month-end-occupancy accelerator; split maintenance / PM and
 * evenly within each role (lib/commissions.ts). An admin approves a finished
 * month, which freezes it, then downloads the Rippling import file.
 */

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import DarkSelect from './DarkSelect';

interface Line { name: string; role: 'pm' | 'maintenance'; rippling_worker_id: string | null; share: number; amount: number }
interface Item { bill_id: string; property_name: string; unit: string | null; type: string; memo: string | null; amount: number; bill_date: string; paid_date: string }
interface Month {
  month: string; status: 'open' | 'ready' | 'approved' | 'exported' | 'paid';
  gross: number; lease_gross: number; renewal_gross: number; lease_count: number; renewal_count: number;
  occupancy_pct: number | null; occupancy_as_of: string | null; multiplier: number; net: number;
  lines: Line[]; items: Item[]; approved_by?: string | null; approved_at?: string | null;
}
interface Resp { months: Month[]; isAdmin: boolean }

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const monthLabel = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const STATUS: Record<Month['status'], { label: string; cls: string }> = {
  open: { label: 'In progress', cls: 'bg-slate-500/15 text-slate-300' },
  ready: { label: 'Ready to approve', cls: 'bg-amber-500/15 text-amber-300' },
  approved: { label: 'Approved', cls: 'bg-emerald-500/15 text-emerald-300' },
  exported: { label: 'Exported', cls: 'bg-cyan-500/15 text-cyan-300' },
  paid: { label: 'Paid', cls: 'bg-emerald-500/15 text-emerald-300' },
};

export default function CommissionsDashboard() {
  const { data, error, mutate, isLoading } = useSWR<Resp>('/api/commissions?months=12', { revalidateOnFocus: false });
  const months = useMemo(() => data?.months ?? [], [data]);
  const [picked, setPicked] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Default to the most recent finished month: that's the one to pay.
  const selected = months.find((m) => m.month === picked) ?? months.find((m) => m.status !== 'open') ?? months[0];
  const people = useMemo(() => Array.from(new Set(months.flatMap((m) => m.lines.map((l) => l.name)))).sort(), [months]);
  const ytd = useMemo(() => {
    const year = new Date().getFullYear().toString();
    const t: Record<string, number> = {};
    months.filter((m) => m.month.startsWith(year)).forEach((m) => m.lines.forEach((l) => { t[l.name] = (t[l.name] || 0) + l.amount; }));
    return t;
  }, [months]);

  async function approve() {
    if (!selected) return;
    const who = selected.lines.filter((l) => l.amount > 0).map((l) => `${l.name} ${usd(l.amount)}`).join(', ');
    if (!window.confirm(`Approve ${monthLabel(selected.month)} commissions: ${usd(selected.net)} total (${who})?\n\nThis freezes the month.`)) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/commissions/${selected.month}/approve`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setMsg(`${monthLabel(selected.month)} approved. Download the Rippling file to add it to payroll.`);
      await mutate();
    } catch (e: any) {
      setMsg(`Couldn't approve: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="p-6 text-red-400">Couldn&apos;t load commissions: {error.message}</div>;
  if (isLoading || !selected) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" /></div>;
  }

  const st = STATUS[selected.status];
  const frozen = selected.status !== 'open' && selected.status !== 'ready';

  return (
    <div className="p-4 space-y-4">
      <div className="bg-[rgba(10,14,26,0.92)] backdrop-blur-[16px] rounded-lg border border-[var(--glass-border)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-slate-100">Commissions</h1>
            <span className={`px-2 py-0.5 rounded text-xs ${st.cls}`}>{st.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <DarkSelect value={selected.month} onChange={setPicked} compact className="w-44"
              options={months.map((m) => ({ value: m.month, label: monthLabel(m.month) }))} />
            {data?.isAdmin && selected.status === 'ready' && (
              <button onClick={approve} disabled={busy}
                className="px-3 py-1.5 rounded text-sm bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50">
                {busy ? 'Approving…' : 'Approve month'}
              </button>
            )}
            {data?.isAdmin && frozen && selected.status !== 'paid' && (
              <a href={`/api/commissions/${selected.month}/export`}
                className="px-3 py-1.5 rounded text-sm bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30">
                Download Rippling file
              </a>
            )}
          </div>
        </div>
        {msg && <p className="mt-2 text-sm text-slate-300">{msg}</p>}
        {frozen && selected.approved_by && (
          <p className="mt-2 text-xs text-slate-500">Approved by {selected.approved_by}{selected.approved_at ? ` on ${new Date(selected.approved_at).toLocaleDateString()}` : ''}. Figures are frozen.</p>
        )}
        {selected.status === 'open' && <p className="mt-2 text-xs text-slate-500">This month is still running: figures update as fees are paid and occupancy changes.</p>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Gross pool" value={usd(selected.gross)}
          sub={`${selected.lease_count} lease fees ${usd(selected.lease_gross)} · ${selected.renewal_count} renewal fees ${usd(selected.renewal_gross)}`} />
        <Stat label="Month-end occupancy" value={selected.occupancy_pct == null ? '—' : `${selected.occupancy_pct.toFixed(1)}%`}
          sub={selected.occupancy_as_of ? `Rent roll ${shortDate(selected.occupancy_as_of)}` : 'From the rent roll'} />
        <Stat label="Accelerator" value={`${Math.round(selected.multiplier * 100)}%`} sub="<90% → 40% · 95%+ → 100%" />
        <Stat label="Total payout" value={usd(selected.net)} sub="Gross × accelerator" highlight />
      </div>

      <div className="glass-card overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 text-sm font-semibold text-slate-200">Breakdown by person — {monthLabel(selected.month)}</div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="sticky top-0 z-10">
            <tr className="dark-thead text-xs">
              <th className="px-4 py-2 text-left">Person</th>
              <th className="px-4 py-2 text-left">Role</th>
              <th className="px-4 py-2 text-right">Share of payout</th>
              <th className="px-4 py-2 text-right">This month</th>
              <th className="px-4 py-2 text-right">Year to date</th>
            </tr>
          </thead>
          <tbody>
            {selected.lines.map((l) => (
              <tr key={l.name} className="border-t border-white/5">
                <td className="px-4 py-2 text-slate-200">{l.name}</td>
                <td className="px-4 py-2 text-slate-400">{l.role === 'pm' ? 'Property manager' : 'Maintenance'}</td>
                <td className="px-4 py-2 text-right text-slate-400">{Math.round(l.share * 100)}%</td>
                <td className="px-4 py-2 text-right font-medium text-slate-100">{usd(l.amount)}</td>
                <td className="px-4 py-2 text-right text-slate-400">{usd(ytd[l.name] || 0)}</td>
              </tr>
            ))}
            <tr className="border-t border-white/10">
              <td className="px-4 py-2 font-semibold text-slate-200" colSpan={3}>Total</td>
              <td className="px-4 py-2 text-right font-semibold text-slate-100">{usd(selected.lines.reduce((t, l) => t + l.amount, 0))}</td>
              <td />
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 text-sm font-semibold text-slate-200">By month</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="sticky top-0 z-10">
              <tr className="dark-thead text-xs">
                <th className="px-3 py-2 text-left">Month</th>
                <th className="px-3 py-2 text-right">Gross</th>
                <th className="px-3 py-2 text-right">Occupancy</th>
                <th className="px-3 py-2 text-right">Accelerator</th>
                <th className="px-3 py-2 text-right">Payout</th>
                {people.map((p) => <th key={p} className="px-3 py-2 text-right">{p.split(' ')[0]}</th>)}
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} onClick={() => setPicked(m.month)}
                  className={`border-t border-white/5 cursor-pointer hover:bg-white/5 ${m.month === selected.month ? 'bg-white/5' : ''}`}>
                  <td className="px-3 py-2 text-slate-200">{monthLabel(m.month)}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{usd(m.gross)}</td>
                  <td className="px-3 py-2 text-right text-slate-400">{m.occupancy_pct == null ? '—' : `${m.occupancy_pct.toFixed(1)}%`}</td>
                  <td className="px-3 py-2 text-right text-slate-400">{Math.round(m.multiplier * 100)}%</td>
                  <td className="px-3 py-2 text-right font-medium text-slate-100">{usd(m.net)}</td>
                  {people.map((p) => {
                    const l = m.lines.find((x) => x.name === p);
                    return <td key={p} className="px-3 py-2 text-right text-slate-400">{l ? usd(l.amount) : '—'}</td>;
                  })}
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs ${STATUS[m.status].cls}`}>{STATUS[m.status].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 text-sm font-semibold text-slate-200">
          AppFolio fee bills paid in {monthLabel(selected.month)} ({selected.items.length})
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="sticky top-0 z-10">
              <tr className="dark-thead text-xs">
                <th className="px-4 py-2 text-left">Paid</th>
                <th className="px-4 py-2 text-left">Property</th>
                <th className="px-4 py-2 text-left">Unit</th>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-left">Memo</th>
                <th className="px-4 py-2 text-right">Fee</th>
              </tr>
            </thead>
            <tbody>
              {selected.items.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No lease or renewal fees paid this month yet.</td></tr>
              )}
              {selected.items.map((i) => (
                <tr key={`${i.bill_id}-${i.unit}-${i.amount}`} className="border-t border-white/5">
                  <td className="px-4 py-1.5 text-slate-400">{shortDate(i.paid_date)}</td>
                  <td className="px-4 py-1.5 text-slate-200">{i.property_name}</td>
                  <td className="px-4 py-1.5 text-slate-400">{i.unit || '—'}</td>
                  <td className="px-4 py-1.5 text-slate-300">{i.type}</td>
                  <td className="px-4 py-1.5 text-slate-500 truncate max-w-[280px]" title={i.memo || ''}>{i.memo || '—'}</td>
                  <td className="px-4 py-1.5 text-right text-slate-200">{usd(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`glass-card p-4 ${highlight ? 'border border-emerald-500/30' : ''}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${highlight ? 'text-emerald-300' : 'text-slate-100'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
