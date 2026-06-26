'use client';

/**
 * SourcePerformanceDashboard — /admin/source-performance
 *
 * Per-source funnel + recommendation. Surfaces the Phase 2b finding
 * (KC's 49% denial rate is concentrated in a couple of "high volume,
 * unqualifiable" sources) continuously so managers can see whether
 * to keep pushing leads from each source to their team.
 *
 * Recommendation rules (computed server-side):
 *   trim     — ≥5 apps AND denial rate ≥60%
 *   invest   — ≥5 apps AND denial <30% AND close rate ≥20%
 *   hold     — enough volume to judge, in between
 *   unknown  — too little volume to call
 */

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '../lib/swr';
import { AlertTriangle, TrendingUp, Minus, HelpCircle } from 'lucide-react';

type Region = 'all' | 'region_kansas_city' | 'region_columbia';
type Days = 30 | 60 | 90 | 180 | 365;
type Recommendation = 'trim' | 'invest' | 'hold' | 'unknown';

interface SourceRow {
  source: string;
  inquiries: number;
  showings_scheduled: number;
  showings_completed: number;
  applications: number;
  denied: number;
  converted: number;
  show_up_pct: number | null;
  apply_pct: number | null;
  denial_pct: number | null;
  close_pct: number | null;
  inquiry_to_lease_pct: number | null;
  recommendation: Recommendation;
}

interface ApiResponse {
  days: number;
  region: Region;
  since: string;
  rows: SourceRow[];
  totals: {
    inquiries: number;
    showings_scheduled: number;
    showings_completed: number;
    applications: number;
    denied: number;
    converted: number;
  };
}

function pctCell(v: number | null, accent?: (v: number) => string) {
  if (v == null) return <span className="text-slate-600">—</span>;
  const cls = accent ? accent(v) : 'text-slate-200';
  return <span className={`tabular-nums ${cls}`}>{v}%</span>;
}

function denialAccent(v: number): string {
  if (v >= 60) return 'text-rose-300';
  if (v >= 40) return 'text-amber-300';
  if (v >= 20) return 'text-slate-200';
  return 'text-emerald-300';
}

function closeAccent(v: number): string {
  if (v >= 30) return 'text-emerald-300';
  if (v >= 15) return 'text-slate-200';
  if (v >= 5)  return 'text-amber-300';
  return 'text-rose-300';
}

function RecommendationBadge({ rec }: { rec: Recommendation }) {
  const cfg: Record<Recommendation, { label: string; cls: string; Icon: any }> = {
    trim:    { label: 'Trim spend',  cls: 'bg-rose-500/15 text-rose-300 border-rose-500/20',       Icon: AlertTriangle },
    invest:  { label: 'Invest more', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20', Icon: TrendingUp },
    hold:    { label: 'Hold',        cls: 'bg-slate-500/15 text-slate-300 border-slate-500/20',    Icon: Minus },
    unknown: { label: 'Unknown',     cls: 'bg-slate-500/10 text-slate-500 border-slate-500/15',    Icon: HelpCircle },
  };
  const c = cfg[rec];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${c.cls}`}>
      <c.Icon className="w-3 h-3" />
      {c.label}
    </span>
  );
}

export default function SourcePerformanceDashboard() {
  const [days, setDays] = useState<Days>(180);
  const [region, setRegion] = useState<Region>('all');

  const { data, error, isLoading, mutate } = useSWR<ApiResponse>(
    `/api/admin/source-performance?days=${days}&region=${region}`,
    fetcher,
    { revalidateOnMount: true },
  );

  const trimCount = useMemo(
    () => (data?.rows.filter(r => r.recommendation === 'trim').length ?? 0),
    [data],
  );
  const investCount = useMemo(
    () => (data?.rows.filter(r => r.recommendation === 'invest').length ?? 0),
    [data],
  );
  const portfolioDenialPct = useMemo(() => {
    if (!data) return null;
    const apps = data.totals.applications;
    return apps > 0 ? Math.round((100 * data.totals.denied / apps) * 10) / 10 : null;
  }, [data]);

  if (isLoading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Loading source performance…</p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-rose-400 text-sm">Error: {String(error)}</p>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="min-h-screen">
      <div className="sticky-header">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-4 h-10 px-6 border-b border-[var(--glass-border)]">
            <h1 className="text-sm font-semibold text-slate-100 whitespace-nowrap">Lead source performance</h1>
            <div className="flex items-center gap-2 text-xs">
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value as Region)}
                className="bg-surface-overlay border border-white/10 rounded px-2 py-1 text-xs text-slate-200"
              >
                <option value="all">All regions</option>
                <option value="region_kansas_city">Kansas City</option>
                <option value="region_columbia">Columbia</option>
              </select>
              <select
                value={days}
                onChange={(e) => setDays(parseInt(e.target.value, 10) as Days)}
                className="bg-surface-overlay border border-white/10 rounded px-2 py-1 text-xs text-slate-200"
              >
                <option value={30}>Last 30 days</option>
                <option value={60}>Last 60 days</option>
                <option value={90}>Last 90 days</option>
                <option value={180}>Last 180 days</option>
                <option value={365}>Last 365 days</option>
              </select>
            </div>
            <button
              onClick={() => mutate()}
              className="ml-auto text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded hover:bg-white/5"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 md:px-8 pb-6 md:pb-8">
        <div className="max-w-7xl mx-auto">
          {/* Stat strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 mb-4">
            <StatCard label="Inquiries" value={data.totals.inquiries.toLocaleString()} />
            <StatCard label="Applications" value={data.totals.applications.toLocaleString()} />
            <StatCard
              label="Portfolio denial %"
              value={portfolioDenialPct != null ? `${portfolioDenialPct}%` : '—'}
              tone={portfolioDenialPct != null && portfolioDenialPct >= 40 ? 'warn' : portfolioDenialPct != null && portfolioDenialPct < 20 ? 'good' : undefined}
            />
            <StatCard
              label="Sources flagged"
              value={trimCount > 0 ? `${trimCount} trim · ${investCount} invest` : `${investCount} invest`}
              tone={trimCount > 0 ? 'warn' : undefined}
            />
          </div>

          {trimCount > 0 && (
            <div className="glass-card border border-rose-500/30 bg-rose-500/5 p-4 mb-4 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-sm text-slate-200">
                <strong className="text-rose-300">{trimCount} source{trimCount > 1 ? 's' : ''} flagged for trim:</strong>{' '}
                {data.rows.filter(r => r.recommendation === 'trim').map(r => r.source).join(', ')}.{' '}
                ≥60% of applications from these sources get denied. Either gate them upstream with the
                pre-qual flow or stop pushing them to property managers.
              </div>
            </div>
          )}

          {/* Source table */}
          <div className="glass-card overflow-x-auto">
            <table className="w-full text-sm min-w-[920px]">
              <thead className="bg-surface-raised/80 text-xs text-slate-400 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Source</th>
                  <th className="px-3 py-2 text-right font-medium">Inquiries</th>
                  <th className="px-3 py-2 text-right font-medium">Showings</th>
                  <th className="px-3 py-2 text-right font-medium">Show-up %</th>
                  <th className="px-3 py-2 text-right font-medium">Apps</th>
                  <th className="px-3 py-2 text-right font-medium">Apply %</th>
                  <th className="px-3 py-2 text-right font-medium">Denied</th>
                  <th className="px-3 py-2 text-right font-medium">Denial %</th>
                  <th className="px-3 py-2 text-right font-medium">Leases</th>
                  <th className="px-3 py-2 text-right font-medium">Close %</th>
                  <th className="px-3 py-2 text-right font-medium">Inq → Lease %</th>
                  <th className="px-3 py-2 text-center font-medium">Recommendation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.rows.map(r => (
                  <tr key={r.source} className="hover:bg-white/5">
                    <td className="px-3 py-2 font-medium text-slate-100">{r.source}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-200">{r.inquiries.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                      {r.showings_scheduled.toLocaleString()}
                      <span className="text-slate-500 text-[11px]"> / {r.showings_completed.toLocaleString()}</span>
                    </td>
                    <td className="px-3 py-2 text-right">{pctCell(r.show_up_pct)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-200">{r.applications.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{pctCell(r.apply_pct)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-300">{r.denied.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{pctCell(r.denial_pct, denialAccent)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-200">{r.converted.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{pctCell(r.close_pct, closeAccent)}</td>
                    <td className="px-3 py-2 text-right">{pctCell(r.inquiry_to_lease_pct, closeAccent)}</td>
                    <td className="px-3 py-2 text-center"><RecommendationBadge rec={r.recommendation} /></td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-3 py-12 text-center text-slate-500 text-sm">
                      No source activity in the selected window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="mt-4 text-xs text-slate-500 grid gap-1">
            <div>
              <strong className="text-slate-400">Denial %:</strong>
              <span className="text-rose-300 ml-2">≥60% rose</span>
              <span className="text-amber-300 ml-2">≥40% amber</span>
              <span className="text-emerald-300 ml-2">&lt;20% green</span>
            </div>
            <div>
              <strong className="text-slate-400">Recommendations:</strong>
              <span className="ml-2">trim = ≥5 apps + ≥60% denial</span>
              <span className="ml-2">·</span>
              <span className="ml-2">invest = ≥5 apps + &lt;30% denial + ≥20% close</span>
              <span className="ml-2">·</span>
              <span className="ml-2">unknown = too little volume to call</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  const valueColor = tone === 'warn' ? 'text-rose-300' : tone === 'good' ? 'text-emerald-300' : 'text-slate-100';
  return (
    <div className="glass-card p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold tabular-nums mt-1 ${valueColor}`}>{value}</div>
    </div>
  );
}
