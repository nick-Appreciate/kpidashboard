'use client';

/**
 * SpeedToLeadDashboard — /admin/leasing?tab=speed
 *
 * Time-to-first-response visibility, built on leasing_reports.first_response_at
 * (observation-time capture via the 5-min guest_cards poll). Answers the
 * question we started with zero visibility on: are inquiries actually being
 * contacted fast, and where does the 5-minute target break?
 *
 * Honesty is front-loaded: latency is bounded by the ~5-min poll cadence (so
 * it slightly over-states, never under-states), only AppFolio-logged responses
 * are seen, and rates cover only inquiries received after tracking began.
 */

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '../lib/swr';

interface SourceStat {
  source: string;
  tracked: number;
  responded: number;
  response_rate_pct: number | null;
  median_latency_min: number | null;
  within_sla_pct: number | null;
}
interface RecentLead {
  name: string | null;
  source: string;
  property: string | null;
  inquiry_received: string;
  first_response_at: string | null;
  first_response_type: string | null;
  latency_min: number | null;
  tracked: boolean;
}
interface ApiResponse {
  days: number;
  region: string;
  tracking_since: string | null;
  sla_min: number;
  warn_min: number;
  totals: {
    tracked: number;
    responded: number;
    unanswered: number;
    response_rate_pct: number | null;
    median_latency_min: number | null;
    within_sla_pct: number | null;
    within_warn_pct: number | null;
  };
  sources: SourceStat[];
  recent: RecentLead[];
}

const DAY_OPTIONS = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
];
const REGION_OPTIONS = [
  { value: 'all', label: 'All regions' },
  { value: 'region_kansas_city', label: 'Kansas City' },
  { value: 'region_columbia', label: 'Columbia' },
];

function fmtLatency(min: number | null): string {
  if (min == null) return '—';
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h ${min % 60}m`;
  return `${Math.round(min / 1440)}d`;
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function latencyColor(min: number | null, sla: number, warn: number): string {
  if (min == null) return 'text-slate-500';
  if (min <= sla) return 'text-emerald-400';
  if (min <= warn) return 'text-amber-400';
  return 'text-rose-400';
}

export default function SpeedToLeadDashboard({ embedded = false }: { embedded?: boolean }) {
  const [days, setDays] = useState(14);
  const [region, setRegion] = useState('all');

  const { data, error, isLoading } = useSWR<ApiResponse>(
    `/api/admin/speed-to-lead?days=${days}&region=${region}`,
    fetcher,
    { revalidateOnMount: true },
  );

  const wrap = embedded ? 'px-2 pb-6' : 'px-6 md:px-8 pb-6 md:pb-8';

  if (isLoading && !data) {
    return <div className={`${wrap} text-sm text-slate-500 py-10 text-center`}>Loading speed-to-lead…</div>;
  }
  if (error) {
    return <div className={`${wrap} text-sm text-rose-400 py-10 text-center`}>Failed to load speed-to-lead data.</div>;
  }
  if (!data) return null;

  const t = data.totals;

  return (
    <div className={`${wrap} space-y-5`}>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--glass-border)] bg-surface-overlay p-0.5">
          {DAY_OPTIONS.map(o => (
            <button key={o.value} onClick={() => setDays(o.value)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${days === o.value ? 'bg-accent/20 text-accent-light' : 'text-slate-400 hover:text-slate-200'}`}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-[var(--glass-border)] bg-surface-overlay p-0.5">
          {REGION_OPTIONS.map(o => (
            <button key={o.value} onClick={() => setRegion(o.value)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${region === o.value ? 'bg-accent/20 text-accent-light' : 'text-slate-400 hover:text-slate-200'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Method caveat — this data has real limits; say so up front. */}
      <div className="glass-card border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-slate-300 leading-relaxed">
        <span className="font-semibold text-amber-300">How this is measured.</span>{' '}
        Response time is captured when our 5-minute sync first sees an AppFolio guest-card response,
        so it&apos;s accurate to ~5 min and never makes responses look faster than they were.
        Only AppFolio-logged touches (auto-text, email, logged calls) count — a phone call the VA
        never logs won&apos;t appear. Rates cover inquiries received since tracking began
        {data.tracking_since ? ` (${fmtDateTime(data.tracking_since)})` : ' (not yet — no responses observed)'}.
      </div>

      {/* Hero stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label={`Within ${data.sla_min} min`} value={t.within_sla_pct != null ? `${t.within_sla_pct}%` : '—'}
          sub="the target" tone={t.within_sla_pct != null && t.within_sla_pct >= 70 ? 'good' : t.within_sla_pct != null && t.within_sla_pct >= 40 ? 'warn' : 'bad'} />
        <Stat label="Within 1 hour" value={t.within_warn_pct != null ? `${t.within_warn_pct}%` : '—'} sub="secondary" tone="neutral" />
        <Stat label="Median response" value={fmtLatency(t.median_latency_min)} sub="tracked leads" tone="neutral" />
        <Stat label="Response rate" value={t.response_rate_pct != null ? `${t.response_rate_pct}%` : '—'} sub={`${t.responded}/${t.tracked} tracked`} tone={t.response_rate_pct != null && t.response_rate_pct >= 80 ? 'good' : 'warn'} />
        <Stat label="Unanswered" value={String(t.unanswered)} sub="no response seen" tone={t.unanswered > 0 ? 'bad' : 'good'} />
      </div>

      {/* By source */}
      <div className="glass-card overflow-x-auto">
        <div className="px-4 pt-3 pb-1 text-xs font-semibold text-slate-300">Response speed by source</div>
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-surface-raised/80 text-xs text-slate-400 sticky top-0 z-10">
            <tr>
              <th className="text-left font-medium px-4 py-2">Source</th>
              <th className="text-right font-medium px-4 py-2">Tracked</th>
              <th className="text-right font-medium px-4 py-2">Responded</th>
              <th className="text-right font-medium px-4 py-2">Median</th>
              <th className="text-right font-medium px-4 py-2">Within {data.sla_min}m</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {data.sources.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500 text-xs">No tracked inquiries yet in this window — data accrues as new leads arrive.</td></tr>
            ) : data.sources.map(s => (
              <tr key={s.source} className="hover:bg-white/[0.02]">
                <td className="px-4 py-2 text-slate-200">{s.source}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-300">{s.tracked}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-300">{s.responded}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${latencyColor(s.median_latency_min, data.sla_min, data.warn_min)}`}>{fmtLatency(s.median_latency_min)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-300">{s.within_sla_pct != null ? `${s.within_sla_pct}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent leads */}
      <div className="glass-card overflow-x-auto">
        <div className="px-4 pt-3 pb-1 text-xs font-semibold text-slate-300">Recent inquiries</div>
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-surface-raised/80 text-xs text-slate-400 sticky top-0 z-10">
            <tr>
              <th className="text-left font-medium px-4 py-2">Lead</th>
              <th className="text-left font-medium px-4 py-2">Source</th>
              <th className="text-left font-medium px-4 py-2">Inquiry</th>
              <th className="text-right font-medium px-4 py-2">Response</th>
              <th className="text-left font-medium px-4 py-2 pl-6">Via</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {data.recent.map((l, i) => (
              <tr key={i} className={`hover:bg-white/[0.02] ${!l.tracked ? 'opacity-40' : ''}`}>
                <td className="px-4 py-2 text-slate-200 truncate max-w-[160px]">{l.name || '—'}</td>
                <td className="px-4 py-2 text-slate-400">{l.source}</td>
                <td className="px-4 py-2 text-slate-400 whitespace-nowrap">{fmtDateTime(l.inquiry_received)}</td>
                <td className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${latencyColor(l.latency_min, data.sla_min, data.warn_min)}`}>
                  {l.tracked ? fmtLatency(l.latency_min) : 'pre-tracking'}
                </td>
                <td className="px-4 py-2 pl-6 text-slate-500 text-xs">{l.first_response_type || (l.tracked ? 'no response yet' : '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const color = tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : tone === 'bad' ? 'text-rose-400' : 'text-slate-100';
  return (
    <div className="glass-stat p-3">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
