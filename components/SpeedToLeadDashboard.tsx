'use client';

/**
 * SpeedToLeadDashboard — /leasing?tab=speed
 *
 * Two tracks:
 *   Warm Contact (headline) — first answered outbound call, from JustCall,
 *     minute-precise with full history. The number that predicts conversion.
 *   Automated (secondary) — auto-text/email first touch (observation-time).
 */

import { useState } from 'react';
import useSWR from 'swr';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetcher } from '../lib/swr';
import { RECHARTS_THEME } from '../lib/chartTheme';
import JustCallDialerBase, { useJustCall } from './JustCallDialer';

// JS component whose callback props are all optional; alias as any so it can be
// rendered prop-less without TS inferring the props as required.
const JustCallDialer: any = JustCallDialerBase;

// Ensure a dialable +1E.164 number for the JustCall SDK.
function formatPhoneForJustCall(phone: string | null): string | null {
  if (!phone) return null;
  let c = phone.replace(/[^\d+]/g, '');
  if (!c.startsWith('+')) c = (c.startsWith('1') && c.length === 11) ? '+' + c : '+1' + c;
  return c;
}
function fmtDay(date: string): string {
  const [y, m, d] = date.split('-');
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface Agent { name: string; connects: number; median_warm_min: number | null; }
interface RecentLead {
  name: string | null; source: string; inquiry_received: string;
  auto_min: number | null; auto_type: string | null; dialed: boolean; warm_min: number | null;
}
interface ApiResponse {
  days: number; region: string; sla_min: number; warn_min: number;
  automated: {
    tracking_since: string | null; tracked: number; responded: number;
    within_sla_pct: number | null; median_latency_min: number | null;
  };
  warm: {
    leads_with_phone: number; dialed: number; connected: number; connect_rate_pct: number | null;
    median_dial_min: number | null; median_warm_min: number | null;
    within_sla_pct: number | null; within_warn_pct: number | null; agents: Agent[];
  };
  recent: RecentLead[];
  daily: { date: string; leads: number; within_sla_pct: number | null; within_warn_pct: number | null }[];
  uncontacted: { name: string | null; source: string; phone: string | null; inquiry_received: string; dialed: boolean; hours_waiting: number }[];
  uncontacted_total: number;
}

const DAY_OPTIONS = [{ value: 14, label: '14d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }];
const REGION_OPTIONS = [
  { value: 'all', label: 'All regions' },
  { value: 'region_kansas_city', label: 'Kansas City' },
  { value: 'region_columbia', label: 'Columbia' },
];

function fmtLatency(min: number | null): string {
  if (min == null) return '—';
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h ${min % 60}m`;
  return `${Math.round(min / 1440)}d`;
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function latColor(min: number | null, sla: number, warn: number): string {
  if (min == null) return 'text-slate-500';
  if (min <= sla) return 'text-emerald-400';
  if (min <= warn) return 'text-amber-400';
  return 'text-rose-400';
}

export default function SpeedToLeadDashboard({ embedded = false }: { embedded?: boolean }) {
  const [days, setDays] = useState(30);
  const [region, setRegion] = useState('all');
  const { data, error, isLoading } = useSWR<ApiResponse>(
    `/api/admin/speed-to-lead?days=${days}&region=${region}`, fetcher, { revalidateOnMount: true },
  );

  const { makeCall } = useJustCall();
  const dial = (phone: string | null, name: string | null) => {
    const p = formatPhoneForJustCall(phone);
    if (p) makeCall(p, name || 'Lead');
  };

  const wrap = embedded ? 'px-2 pb-6' : 'px-6 md:px-8 pb-6 md:pb-8';
  if (isLoading && !data) return <div className={`${wrap} text-sm text-slate-500 py-10 text-center`}>Loading speed-to-lead…</div>;
  if (error) return <div className={`${wrap} text-sm text-rose-400 py-10 text-center`}>Failed to load speed-to-lead data.</div>;
  if (!data) return null;

  const { warm, automated, sla_min, warn_min } = data;

  return (
    <div className={`${wrap} space-y-6`}>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented options={DAY_OPTIONS} value={days} onChange={setDays} />
        <Segmented options={REGION_OPTIONS} value={region} onChange={setRegion} />
      </div>

      {/* ── WARM CONTACT (headline) ─────────────────────────────────── */}
      <section className="glass-card border border-accent/25 p-4 space-y-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Warm Contact <span className="text-slate-500 font-normal">· first answered call</span></h3>
          <span className="text-[11px] text-slate-500">JustCall · minute-precise · full history</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label={`Called within ${sla_min} min`} value={warm.within_sla_pct != null ? `${warm.within_sla_pct}%` : '—'} sub="answered outbound"
            tone={warm.within_sla_pct != null && warm.within_sla_pct >= 50 ? 'good' : warm.within_sla_pct != null && warm.within_sla_pct >= 20 ? 'warn' : 'bad'} big />
          <Stat label="Median to warm contact" value={fmtLatency(warm.median_warm_min)} sub="inquiry → answered call" tone="neutral" big />
          <Stat label="Median to first dial" value={fmtLatency(warm.median_dial_min)} sub="inquiry → first attempt" tone="neutral" big />
          <Stat label="Connect rate" value={warm.connect_rate_pct != null ? `${warm.connect_rate_pct}%` : '—'} sub={`${warm.connected}/${warm.leads_with_phone} leads`}
            tone={warm.connect_rate_pct != null && warm.connect_rate_pct >= 70 ? 'good' : 'warn'} big />
          <Stat label="Dialed / Connected" value={`${warm.dialed} / ${warm.connected}`} sub="attempts vs answered" tone="neutral" big />
        </div>

        {/* Per-VA */}
        {warm.agents.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead className="bg-surface-raised/80 text-xs text-slate-400">
                <tr>
                  <th className="text-left font-medium px-3 py-1.5">Agent</th>
                  <th className="text-right font-medium px-3 py-1.5">Warm contacts</th>
                  <th className="text-right font-medium px-3 py-1.5">Median to warm</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {warm.agents.map(a => (
                  <tr key={a.name} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-1.5 text-slate-200">{a.name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{a.connects}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${latColor(a.median_warm_min, sla_min, warn_min)}`}>{fmtLatency(a.median_warm_min)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── DAILY SUCCESS RATE (accountability) ─────────────────────── */}
      {data.daily.length > 1 && (
        <section className="glass-card p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-100">
              Daily success rate <span className="text-slate-500 font-normal">· warm call within {sla_min} min</span>
            </h3>
            <span className="text-[11px] text-slate-500">goal: reach every lead within {sla_min} minutes</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.daily} margin={{ top: 5, right: 16, left: -8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={RECHARTS_THEME.grid.stroke} />
              <XAxis dataKey="date" tickFormatter={fmtDay} stroke={RECHARTS_THEME.axis.stroke}
                fontSize={RECHARTS_THEME.axis.fontSize} fontFamily={RECHARTS_THEME.axis.fontFamily} minTickGap={24} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} stroke={RECHARTS_THEME.axis.stroke}
                fontSize={RECHARTS_THEME.axis.fontSize} fontFamily={RECHARTS_THEME.axis.fontFamily} width={44} />
              <Tooltip
                contentStyle={{ background: 'var(--surface-overlay)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                labelFormatter={(d) => fmtDay(String(d))}
                formatter={(v: any, n: any) => [v == null ? '—' : `${v}%`, n]} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
              <Line type="monotone" dataKey="within_sla_pct" name={`Within ${sla_min} min`} stroke="#22d3ee" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} connectNulls />
              <Line type="monotone" dataKey="within_warn_pct" name="Within 1 hour" stroke="#64748b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* ── WORKLIST: leads still awaiting a warm call ──────────────── */}
      {data.uncontacted.length > 0 && (
        <section className="glass-card border border-rose-500/25 bg-rose-500/[0.03]">
          <div className="flex items-baseline justify-between px-4 pt-3 pb-2">
            <h3 className="text-sm font-semibold text-rose-200">Awaiting a warm call
              <span className="ml-2 text-xs font-normal text-slate-400">{data.uncontacted_total} lead{data.uncontacted_total === 1 ? '' : 's'} with no answered call yet</span>
            </h3>
            <span className="text-[11px] text-slate-500">freshest first{data.uncontacted_total > data.uncontacted.length ? ` · top ${data.uncontacted.length}` : ''}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-surface-raised/80 text-xs text-slate-400">
                <tr>
                  <th className="text-left font-medium px-4 py-1.5">Lead</th>
                  <th className="text-left font-medium px-4 py-1.5">Source</th>
                  <th className="text-left font-medium px-4 py-1.5">Inquiry</th>
                  <th className="text-right font-medium px-4 py-1.5">Waiting</th>
                  <th className="text-right font-medium px-4 py-1.5">Status</th>
                  <th className="text-right font-medium px-4 py-1.5">Call</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.uncontacted.map((l, i) => (
                  <tr key={i} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-1.5 text-slate-200 truncate max-w-[150px]">{l.name || '—'}</td>
                    <td className="px-4 py-1.5 text-slate-400">{l.source}</td>
                    <td className="px-4 py-1.5 text-slate-400 whitespace-nowrap">{fmtDateTime(l.inquiry_received)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-300 whitespace-nowrap">
                      {l.hours_waiting < 24 ? `${l.hours_waiting}h` : `${Math.round(l.hours_waiting / 24)}d`}
                    </td>
                    <td className="px-4 py-1.5 text-right whitespace-nowrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${l.dialed ? 'bg-amber-500/15 text-amber-300' : 'bg-rose-500/15 text-rose-300'}`}>
                        {l.dialed ? 'dialed, no answer' : 'never dialed'}
                      </span>
                    </td>
                    <td className="px-4 py-1.5 text-right whitespace-nowrap">
                      {l.phone ? (
                        <button onClick={() => dial(l.phone, l.name)}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-accent/20 text-accent-light hover:bg-accent/30 transition-colors"
                          title={`Call ${l.name || 'lead'} via JustCall`}>
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                          Call
                        </button>
                      ) : <span className="text-[10px] text-slate-600">no #</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── AUTOMATED (secondary) ───────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Automated first touch</h3>
          <span className="text-[11px] text-slate-500">
            auto-text / email · since {automated.tracking_since ? fmtDateTime(automated.tracking_since) : 'tracking not yet started'}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label={`Within ${sla_min} min`} value={automated.within_sla_pct != null ? `${automated.within_sla_pct}%` : '—'} sub="auto response" tone="neutral" />
          <Stat label="Median response" value={fmtLatency(automated.median_latency_min)} sub="tracked leads" tone="neutral" />
          <Stat label="Responded" value={`${automated.responded}/${automated.tracked}`} sub="tracked" tone="neutral" />
          <Stat label="—" value="" sub="" tone="neutral" />
        </div>
      </section>

      {/* Caveat */}
      <div className="text-[11px] text-slate-500 leading-relaxed">
        <span className="font-medium text-slate-400">Method.</span>{' '}
        Warm contact = the first <em>answered outbound</em> JustCall call to the lead after inquiry, matched by phone — minute-precise, full 90-day history.
        Automated = first auto-text/email, captured by our 5-min sync (≈5-min resolution, only since tracking began).
        A fast first-dial but slow warm contact means leads aren’t picking up, not that the VA is slow.
      </div>

      {/* Recent */}
      <div className="glass-card overflow-x-auto">
        <div className="px-4 pt-3 pb-1 text-xs font-semibold text-slate-300">Recent inquiries</div>
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-surface-raised/80 text-xs text-slate-400 sticky top-0 z-10">
            <tr>
              <th className="text-left font-medium px-4 py-2">Lead</th>
              <th className="text-left font-medium px-4 py-2">Source</th>
              <th className="text-left font-medium px-4 py-2">Inquiry</th>
              <th className="text-right font-medium px-4 py-2">Auto</th>
              <th className="text-right font-medium px-4 py-2">Warm call</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {data.recent.map((l, i) => (
              <tr key={i} className="hover:bg-white/[0.02]">
                <td className="px-4 py-2 text-slate-200 truncate max-w-[150px]">{l.name || '—'}</td>
                <td className="px-4 py-2 text-slate-400">{l.source}</td>
                <td className="px-4 py-2 text-slate-400 whitespace-nowrap">{fmtDateTime(l.inquiry_received)}</td>
                <td className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${latColor(l.auto_min, sla_min, warn_min)}`}>{fmtLatency(l.auto_min)}</td>
                <td className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${latColor(l.warm_min, sla_min, warn_min)}`}>
                  {l.warm_min != null ? fmtLatency(l.warm_min) : (l.dialed ? 'no answer' : '—')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Embedded dialer so the worklist Call buttons place calls via JustCall */}
      <JustCallDialer />
    </div>
  );
}

function Segmented({ options, value, onChange }: { options: { value: any; label: string }[]; value: any; onChange: (v: any) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--glass-border)] bg-surface-overlay p-0.5">
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${value === o.value ? 'bg-accent/20 text-accent-light' : 'text-slate-400 hover:text-slate-200'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, sub, tone, big }: { label: string; value: string; sub?: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; big?: boolean }) {
  const color = tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : tone === 'bad' ? 'text-rose-400' : 'text-slate-100';
  return (
    <div className="glass-stat p-3">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`${big ? 'text-2xl' : 'text-xl'} font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
