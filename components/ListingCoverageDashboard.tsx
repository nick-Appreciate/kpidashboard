'use client';

/**
 * ListingCoverageDashboard — /admin/listing-coverage
 *
 * Shows the gap between vacant rent_roll units and active public
 * listings in af_listings. Built after Phase 4 of the leasing audit
 * surfaced that ~half of KC vacant units had no public listing.
 *
 * Per-unit match strategy mirrors the API route:
 *   address-substring match (best, e.g. unit 2625F → "2625 Farrow"),
 *   else bed/bath match at the same property,
 *   else "not listed."
 */

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '../lib/swr';
import { AlertTriangle, CheckCircle2, ExternalLink, ImageOff } from 'lucide-react';

interface VacantUnit {
  unit: string;
  status: string;
  bed_bath: string | null;
  sqft: number | null;
  days_vacant: number | null;
  last_occupied: string | null;
  listed: boolean;
  listing_match_kind: 'address' | 'bed_bath' | null;
  listed_rent: number | null;
  listing_url: string | null;
  listing_photo: string | null;
  listing_first_seen: string | null;
}

interface PropertyRow {
  property: string;
  occupied: number;
  vacant_count: number;
  listed_count: number;
  gap: number;
  active_listings_count: number;
  vacant_units: VacantUnit[];
}

interface ApiResponse {
  summary: {
    snapshot_date: string | null;
    total_vacant: number;
    total_listed: number;
    total_gap: number;
    total_active_listings: number;
  };
  properties: PropertyRow[];
}

function tenureColor(days: number | null): string {
  if (days == null) return 'text-slate-400';
  if (days >= 180) return 'text-rose-400';
  if (days >= 90)  return 'text-amber-400';
  if (days >= 30)  return 'text-amber-300';
  return 'text-slate-300';
}

function tenureLabel(days: number | null): string {
  if (days == null) return 'no history';
  return `${days}d vacant`;
}

export default function ListingCoverageDashboard() {
  const { data, error, isLoading, mutate } = useSWR<ApiResponse>(
    '/api/admin/listing-coverage',
    fetcher,
    { revalidateOnMount: true }
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Auto-expand any property with a gap on first load
  useEffect(() => {
    if (!data) return;
    setExpanded(prev => {
      if (prev.size > 0) return prev;
      const next = new Set<string>();
      for (const p of data.properties) if (p.gap > 0) next.add(p.property);
      return next;
    });
  }, [data]);

  const toggle = (prop: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(prop)) next.delete(prop); else next.add(prop);
      return next;
    });
  };

  const coveragePct = useMemo(() => {
    if (!data || data.summary.total_vacant === 0) return 100;
    return Math.round(100 * data.summary.total_listed / data.summary.total_vacant);
  }, [data]);

  if (isLoading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Loading listing coverage…</p>
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
            <h1 className="text-sm font-semibold text-slate-100 whitespace-nowrap">Listing coverage</h1>
            <span className="text-xs text-slate-500">
              snapshot {data.summary.snapshot_date}
            </span>
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
          {/* Summary strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 mb-6">
            <StatCard label="Vacant units"   value={data.summary.total_vacant} />
            <StatCard label="Listed"          value={data.summary.total_listed}
                      sub={`${coveragePct}% coverage`} />
            <StatCard label="Coverage gap"    value={data.summary.total_gap}
                      tone={data.summary.total_gap > 0 ? 'warn' : 'good'} />
            <StatCard label="Active listings" value={data.summary.total_active_listings} />
          </div>

          {data.summary.total_gap > 0 && (
            <div className="glass-card border border-amber-500/30 bg-amber-500/5 p-4 mb-4 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-sm text-slate-200">
                <strong className="text-amber-300">{data.summary.total_gap} vacant units have no active public listing.</strong>
                {' '}These units are invisible to renters searching Apartments.com, Zillow, etc. Open
                AppFolio for each and confirm the "Post" toggle is on and all required fields (photos,
                bed/bath, description) are populated.
              </div>
            </div>
          )}

          {/* Per-property cards */}
          <div className="space-y-3">
            {data.properties.map(p => (
              <div key={p.property} className="glass-card overflow-hidden">
                <button
                  onClick={() => toggle(p.property)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors"
                >
                  <div className="flex-1 flex items-center gap-3 text-left">
                    <span className="font-semibold text-slate-100">{p.property}</span>
                    <span className="text-xs text-slate-500 tabular-nums">
                      {p.occupied} occupied · {p.vacant_count} vacant
                    </span>
                  </div>
                  <CoveragePill
                    listed={p.listed_count}
                    total={p.vacant_count}
                    gap={p.gap}
                  />
                  <span className="text-xs text-slate-500 tabular-nums">
                    {p.active_listings_count} active listings
                  </span>
                  <span className="text-slate-500 text-xs">
                    {expanded.has(p.property) ? '▼' : '▶'}
                  </span>
                </button>
                {expanded.has(p.property) && p.vacant_units.length > 0 && (
                  <div className="border-t border-[var(--glass-border)]">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-raised/80 text-xs text-slate-400">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Unit</th>
                          <th className="px-3 py-2 text-left font-medium">Bed/Bath</th>
                          <th className="px-3 py-2 text-left font-medium">Sqft</th>
                          <th className="px-3 py-2 text-left font-medium">Tenure</th>
                          <th className="px-3 py-2 text-left font-medium">Listing</th>
                          <th className="px-3 py-2 text-right font-medium">Listed rent</th>
                          <th className="px-3 py-2 text-center font-medium w-[80px]">Open</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {p.vacant_units.map((u, i) => (
                          <tr key={u.unit + i} className="hover:bg-white/5">
                            <td className="px-3 py-2 font-medium text-slate-100">{u.unit}</td>
                            <td className="px-3 py-2 text-slate-300 tabular-nums">{u.bed_bath || '—'}</td>
                            <td className="px-3 py-2 text-slate-300 tabular-nums">{u.sqft || '—'}</td>
                            <td className={`px-3 py-2 tabular-nums ${tenureColor(u.days_vacant)}`}>
                              {tenureLabel(u.days_vacant)}
                            </td>
                            <td className="px-3 py-2">
                              {u.listed ? (
                                <span className="inline-flex items-center gap-1.5 text-xs">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                  <span className="text-emerald-300">
                                    Listed
                                    <span className="opacity-70 ml-1">
                                      ({u.listing_match_kind === 'address' ? 'address match' : 'bed/bath match'})
                                    </span>
                                  </span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-xs text-rose-300">
                                  <ImageOff className="w-3.5 h-3.5" />
                                  Not listed
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-300 tabular-nums">
                              {u.listed_rent ? `$${Number(u.listed_rent).toLocaleString()}` : '—'}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {u.listing_url ? (
                                <a href={u.listing_url} target="_blank" rel="noopener noreferrer"
                                   className="inline-flex items-center text-accent hover:text-accent-light"
                                   title="Open public listing">
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              ) : (
                                <span className="text-slate-600 text-xs">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
            {data.properties.length === 0 && (
              <div className="text-center py-12 text-slate-500 text-sm">
                No vacant units in the latest snapshot.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, tone }: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: 'good' | 'warn';
}) {
  const valueColor = tone === 'warn' ? 'text-amber-300' :
                     tone === 'good' ? 'text-emerald-300' : 'text-slate-100';
  return (
    <div className="glass-card p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-3xl font-bold tabular-nums mt-1 ${valueColor}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

function CoveragePill({ listed, total, gap }: { listed: number; total: number; gap: number }) {
  if (total === 0) {
    return <span className="text-xs text-slate-500 px-2 py-0.5 rounded bg-slate-500/10">no vacancies</span>;
  }
  const pct = Math.round(100 * listed / total);
  const tone = gap === 0 ? 'emerald' : gap <= 2 ? 'amber' : 'rose';
  const bg = tone === 'emerald' ? 'bg-emerald-500/15 text-emerald-300' :
             tone === 'amber'   ? 'bg-amber-500/15 text-amber-300' :
                                  'bg-rose-500/15 text-rose-300';
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded tabular-nums ${bg}`}>
      {listed}/{total} listed · {pct}%
    </span>
  );
}
