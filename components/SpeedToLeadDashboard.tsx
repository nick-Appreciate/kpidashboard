'use client';

/**
 * SpeedToLeadDashboard — /leasing/speed-to-lead
 *
 *   Warm Contact (headline) — first answered outbound JustCall call, minute-precise.
 *   Daily success rate — % of each day's leads reached within the 5-min goal.
 *   Lead tracker — one row per lead: dial status, warm-contact time, and the
 *     furthest leasing stage (+ date). Awaiting-a-warm-call leads sit on top so
 *     follow-ups are forced. Each row has a JustCall click-to-dial button.
 */

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';
import { fetcher } from '../lib/swr';
import { RECHARTS_THEME } from '../lib/chartTheme';
import JustCallDialerBase, { useJustCall } from './JustCallDialer';

// JS component whose callback props are all optional; alias as any so it renders prop-less.
const JustCallDialer: any = JustCallDialerBase;

function formatPhoneForJustCall(phone: string | null): string | null {
  if (!phone) return null;
  let c = phone.replace(/[^\d+]/g, '');
  if (!c.startsWith('+')) c = (c.startsWith('1') && c.length === 11) ? '+' + c : '+1' + c;
  return c;
}
const CAP_MIN = 60; // scatter Y-axis cap: 1 hour (business minutes)
// Fractional hour-of-day (0–24) in the market's timezone (Central).
function hourOfDayCentral(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour')?.value || 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return h + m / 60;
}
function fmtHour(h: number): string {
  const hr = ((h % 24) + 24) % 24; const ap = hr < 12 ? 'a' : 'p'; let d = Math.floor(hr) % 12; if (d === 0) d = 12; return `${d}${ap}`;
}
function fmtToCall(v: number): string {
  if (v >= CAP_MIN) return '>1h';
  if (v <= 0) return '0';
  return `${v}m`;
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtDateOnly(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return new Date(Number(y), Number(m) - 1, Number(day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtLatency(min: number | null): string {
  if (min == null) return '—';
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h ${min % 60}m`;
  return `${Math.round(min / 1440)}d`;
}
function latColor(min: number | null, sla: number, warn: number): string {
  if (min == null) return 'text-slate-500';
  if (min <= sla) return 'text-emerald-400';
  if (min <= warn) return 'text-amber-400';
  return 'text-rose-400';
}
// AppFolio prospect (guest card) link — the web URL keys on the guest-card
// UUID, e.g. https://appreciateinc.appfolio.com/crm/leasing/prospects/<uuid>
const APPFOLIO_BASE = 'https://appreciateinc.appfolio.com';
const guestCardUrl = (uuid: string | null) => (uuid ? `${APPFOLIO_BASE}/crm/leasing/prospects/${uuid}` : null);

interface Agent {
  name: string; outbound: number; connected: number; inbound_answered: number;
  contacts: number; warm_leads: number; median_warm_min: number | null;
}
interface TimelineEvent {
  at: string;
  kind: string;
  label: string;
  detail: string | null;
  missed?: boolean;
  call_sid?: string | null;
  has_recording?: boolean;
}
interface Lead {
  name: string | null; source: string; phone: string | null; inquiry_received: string;
  property: string | null; unit: string | null; guest_card_uuid: string | null;
  dial: 'connected' | 'left_vm' | 'attempt' | 'none';
  attempts: number;
  warm_min: number | null;
  stage: string; stage_label: string; stage_date: string | null; column_since: string; stage_business_min: number;
  min_since_touch: number | null;
  last_touch_kind: 'call' | 'stage' | null;
  awaiting: boolean; flag_reason: string | null; column: string; sort_at: string;
  disq_reason: string | null; disq_detail: string | null;
  lease_unit: string | null; lease_start: string | null; lease_start_confirmed: boolean;
  timeline: TimelineEvent[];
}

const COLUMNS: { id: string; label: string; head: string; ring: string }[] = [
  { id: 'first_touch',       label: 'First Touch',          head: 'text-rose-300',    ring: 'border-rose-500/30' },
  { id: 'follow_up',         label: 'Follow Up',            head: 'text-orange-300',  ring: 'border-orange-500/25' },
  { id: 'showing_scheduled', label: 'Showing Scheduled',    head: 'text-cyan-300',    ring: 'border-cyan-500/25' },
  { id: 'showing_completed', label: 'Showing Completed',    head: 'text-amber-300',   ring: 'border-amber-500/25' },
  { id: 'app_sent',          label: 'Application Sent',     head: 'text-violet-300',  ring: 'border-violet-500/25' },
  { id: 'app_approved',      label: 'Application Approved', head: 'text-sky-300',     ring: 'border-sky-500/25' },
  { id: 'signed_lease',      label: 'Signed Lease',         head: 'text-emerald-300', ring: 'border-emerald-500/25' },
  { id: 'disqualified',      label: 'Disqualified',         head: 'text-slate-400',   ring: 'border-white/10' },
];

const KIND_TEXT: Record<string, string> = {
  inquiry: 'text-cyan-300', auto: 'text-sky-300', call: 'text-violet-300', showing: 'text-amber-300', application: 'text-emerald-300', disqualified: 'text-rose-300',
};
const KIND_DOT: Record<string, string> = {
  inquiry: 'bg-cyan-400', auto: 'bg-sky-400', call: 'bg-violet-400', showing: 'bg-amber-400', application: 'bg-emerald-400', disqualified: 'bg-rose-400',
};
interface ApiResponse {
  days: number; region: string; sla_min: number; warn_min: number;
  warm: {
    leads_with_phone: number; dialed: number; connected: number; connect_rate_pct: number | null;
    median_dial_min: number | null; median_warm_min: number | null;
    within_sla_pct: number | null; within_warn_pct: number | null; agents: Agent[];
  };
  daily: { date: string; leads: number; within_sla_pct: number | null; within_warn_pct: number | null }[];
  leads: Lead[];
  leads_awaiting: number;
  leads_total: number;
}

const DAY_OPTIONS = [{ value: 14, label: '14d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }];
const REGION_OPTIONS = [
  { value: 'all', label: 'All regions' },
  { value: 'region_kansas_city', label: 'Kansas City' },
  { value: 'region_columbia', label: 'Columbia' },
];

const DIAL_STYLE: Record<Lead['dial'], string> = {
  connected: 'bg-emerald-500/15 text-emerald-300',
  left_vm:   'bg-sky-500/15 text-sky-300',
  attempt:   'bg-amber-500/15 text-amber-300',
  none:      'bg-rose-500/15 text-rose-300',
};
function dialLabel(l: Lead): string {
  if (l.dial === 'connected') return 'connected';
  if (l.dial === 'left_vm')   return 'left VM';
  if (l.dial === 'attempt')   return `attempt ×${l.attempts || 1}`;
  return 'never dialed';
}

// Single "how long since our team last did something" badge. Team
// touches = outbound call OR stage advance (whichever more recent).
// Replaces the prior pair of time-in-stage + warm-latency badges.
function TouchBadge({ min, kind }: { min: number | null; kind: 'call' | 'stage' | null }) {
  if (min == null) {
    return (
      <span className="text-[9px] px-1 py-0.5 rounded bg-white/5 text-slate-500" title="No team touch yet">
        no team touch
      </span>
    );
  }
  // Freshness thresholds (business minutes): ≤ 60m green, ≤ 360m (6h)
  // amber, > 360m rose. A team who's on top of things stays green.
  const cls = min <= 60 ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
            : min <= 360 ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
            : 'bg-rose-500/10 text-rose-300 border-rose-500/20';
  const kindLabel = kind === 'call' ? 'called' : 'moved';
  return (
    <span
      className={`text-[9px] px-1.5 py-0.5 rounded border ${cls} tabular-nums`}
      title={`Last team touch: ${kind === 'call' ? 'outbound call' : 'stage change'} ${fmtLatency(min)} ago (work hours only)`}
    >
      {kindLabel} {fmtLatency(min)} ago
    </span>
  );
}
function stageBadge(stage: string): string {
  switch (stage) {
    case 'application':       return 'bg-violet-500/15 text-violet-300';
    case 'showing_completed': return 'bg-emerald-500/15 text-emerald-300';
    case 'showing_scheduled': return 'bg-cyan-500/15 text-cyan-300';
    case 'showing_other':     return 'bg-slate-500/20 text-slate-300';
    case 'contacted':         return 'bg-sky-500/15 text-sky-300';
    default:                  return 'bg-white/5 text-slate-400'; // inquiry
  }
}

export default function SpeedToLeadDashboard({ embedded = false }: { embedded?: boolean }) {
  const [days, setDays] = useState(30);
  const [region, setRegion] = useState('all');
  // Live-ops dashboard — poll every 30s + revalidate on focus so a call
  // placed 5 seconds ago shows up without the user needing to reload.
  const { data, error, isLoading, mutate, isValidating } = useSWR<ApiResponse>(
    `/api/admin/speed-to-lead?days=${days}&region=${region}`,
    fetcher,
    {
      revalidateOnMount: true,
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5_000,
    },
  );
  const [lastFetched, setLastFetched] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isValidating && data) setLastFetched(Date.now());
  }, [isValidating, data]);
  const [secAgo, setSecAgo] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecAgo(Math.floor((Date.now() - lastFetched) / 1000)), 1_000);
    return () => clearInterval(t);
  }, [lastFetched]);

  const { makeCall } = useJustCall();
  const dial = (phone: string | null, name: string | null) => {
    const p = formatPhoneForJustCall(phone);
    if (p) makeCall(p, name || 'Lead');
  };

  // Only one lead expanded at a time.
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const toggleRow = (i: number) => setExpandedIdx((cur) => (cur === i ? null : i));
  // Clicking a scatter point expands that lead's row and scrolls to it.
  const focusLead = (idx?: number) => {
    if (idx == null) return;
    setExpandedIdx(idx);
    setTimeout(() => document.getElementById(`lead-card-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };

  const wrap = embedded ? 'px-2 pb-6' : 'px-6 md:px-8 pb-6 md:pb-8';
  if (isLoading && !data) return <div className={`${wrap} text-sm text-slate-500 py-10 text-center`}>Loading speed-to-lead…</div>;
  if (error) return <div className={`${wrap} text-sm text-rose-400 py-10 text-center`}>Failed to load speed-to-lead data.</div>;
  if (!data) return null;

  const { warm, sla_min, warn_min } = data;

  // 48-hour scatter: each lead by inquiry time-of-day (x) vs time-to-warm (y, capped 3h).
  const cutoff = Date.now() - 48 * 3600 * 1000;
  const scatterPts = data.leads
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => new Date(l.inquiry_received).getTime() >= cutoff)
    .map(({ l, idx }) => {
      const contacted = l.warm_min != null;
      return {
        x: hourOfDayCentral(l.inquiry_received),
        // Connected leads sit at their business-minutes-to-contact; not-connected
        // leads pin at the cap (no contact time to plot).
        y: Math.min(contacted ? (l.warm_min as number) : CAP_MIN, CAP_MIN),
        dial: l.dial, attempts: l.attempts, idx, // idx = row index in data.leads (for click-to-expand)
        name: l.name, stage: l.stage_label, warm_min: l.warm_min, inquiry_received: l.inquiry_received,
      };
    });
  const byDial = (d: string) => scatterPts.filter((p) => p.dial === d);

  return (
    <div className={`${wrap} space-y-6`}>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented options={DAY_OPTIONS} value={days} onChange={setDays} />
        <Segmented options={REGION_OPTIONS} value={region} onChange={setRegion} />
        <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
          <span className="tabular-nums">
            {isValidating
              ? 'refreshing…'
              : secAgo < 5
                ? 'just now'
                : `updated ${secAgo}s ago`}
          </span>
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-2 py-0.5 rounded border border-white/10 hover:bg-white/5 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
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
          <Stat label="Median to first dial" value={fmtLatency(warm.median_dial_min)} sub="of connected leads" tone="neutral" big />
          <Stat label="Connect rate" value={warm.connect_rate_pct != null ? `${warm.connect_rate_pct}%` : '—'} sub={`${warm.connected}/${warm.leads_with_phone} leads`}
            tone={warm.connect_rate_pct != null && warm.connect_rate_pct >= 70 ? 'good' : 'warn'} big />
          <Stat label="Dialed / Connected" value={`${warm.dialed} / ${warm.connected}`} sub="attempts vs answered" tone="neutral" big />
        </div>

        {warm.agents.length > 0 && (
          <div className="overflow-x-auto">
            <div className="px-1 pb-1 text-[11px] text-slate-500">Per agent · all calls in window</div>
            <table className="w-full text-sm min-w-[600px]">
              <thead className="bg-surface-raised/80 text-xs text-slate-400">
                <tr>
                  <th className="text-left font-medium px-3 py-1.5">Agent</th>
                  <th className="text-right font-medium px-3 py-1.5">Outbound</th>
                  <th className="text-right font-medium px-3 py-1.5">Connected</th>
                  <th className="text-right font-medium px-3 py-1.5">Inbound</th>
                  <th className="text-right font-medium px-3 py-1.5">Contacts</th>
                  <th className="text-right font-medium px-3 py-1.5">Median to warm</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {warm.agents.map(a => (
                  <tr key={a.name} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-1.5 text-slate-200 whitespace-nowrap">{a.name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{a.outbound}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-300">{a.connected}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{a.inbound_answered}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{a.contacts}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${latColor(a.median_warm_min, sla_min, warn_min)}`}>{fmtLatency(a.median_warm_min)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── TIME-TO-CONTACT SCATTER (last 48h) ──────────────────────── */}
      <section className="glass-card p-4 [&_*:focus]:outline-none [&_svg]:outline-none">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-100">Time to contact <span className="text-slate-500 font-normal">· last 48 hours</span></h3>
          <span className="text-[11px] text-slate-500">{scatterPts.length} leads · business-hours clock (9:15–5 M–F) · goal {sla_min}m · capped &gt;1h</span>
        </div>
        {scatterPts.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">No inquiries in the last 48 hours.</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={RECHARTS_THEME.grid.stroke} />
              <XAxis type="number" dataKey="x" domain={[0, 24]} ticks={[0, 3, 6, 9, 12, 15, 18, 21, 24]} tickFormatter={fmtHour}
                stroke={RECHARTS_THEME.axis.stroke} fontSize={RECHARTS_THEME.axis.fontSize} fontFamily={RECHARTS_THEME.axis.fontFamily}
                label={{ value: 'Inquiry time of day (CT)', position: 'insideBottom', offset: -10, fontSize: 11, fill: '#64748b' }} />
              <YAxis type="number" dataKey="y" domain={[0, CAP_MIN]} ticks={[0, 15, 30, 45, 60]} tickFormatter={fmtToCall}
                stroke={RECHARTS_THEME.axis.stroke} fontSize={RECHARTS_THEME.axis.fontSize} fontFamily={RECHARTS_THEME.axis.fontFamily} width={40} />
              <ReferenceLine y={sla_min} stroke="#10b981" strokeDasharray="4 3" strokeOpacity={0.6}
                label={{ value: `${sla_min}m goal`, position: 'insideTopLeft', fontSize: 10, fill: '#10b981' }} />
              <Tooltip cursor={false} content={<ScatterTip slaMin={sla_min} />} />
              <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
              <Scatter name="Connected"  data={byDial('connected')} fill="#10b981" fillOpacity={0.85} cursor="pointer" onClick={(d: any) => focusLead(d?.payload?.idx ?? d?.idx)} />
              <Scatter name="Left VM"    data={byDial('left_vm')}   fill="#38bdf8" fillOpacity={0.85} cursor="pointer" onClick={(d: any) => focusLead(d?.payload?.idx ?? d?.idx)} />
              <Scatter name="Attempted"  data={byDial('attempt')}   fill="#eab308" fillOpacity={0.85} cursor="pointer" onClick={(d: any) => focusLead(d?.payload?.idx ?? d?.idx)} />
              <Scatter name="Not called" data={byDial('none')}      fill="#f43f5e" fillOpacity={0.85} cursor="pointer" onClick={(d: any) => focusLead(d?.payload?.idx ?? d?.idx)} />
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* ── LEAD BOARD (pipeline) ───────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between px-1 pb-2">
          <h3 className="text-sm font-semibold text-slate-100">Lead board</h3>
          <span className="text-[11px] text-slate-500">
            <span className="text-rose-300 font-medium">{data.leads_awaiting}</span> need follow-up · {data.leads_total} leads
          </span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((col) => {
            const items = data.leads.map((l, idx) => ({ l, idx }))
              .filter(({ l }) => l.column === col.id)
              // Follow-up column: oldest first so the most-overdue lead surfaces
              // at the top. All other columns keep newest-first.
              .sort((a, b) => col.id === 'follow_up'
                ? a.l.sort_at.localeCompare(b.l.sort_at)
                : b.l.sort_at.localeCompare(a.l.sort_at));
            return (
              <div key={col.id} className="flex-shrink-0 w-[240px]">
                <div className={`flex items-center justify-between px-2 py-1.5 border-b ${col.ring}`}>
                  <span className={`text-xs font-semibold ${col.head}`}>{col.label}</span>
                  <span className="text-[10px] text-slate-500 tabular-nums">{items.length}</span>
                </div>
                <div className="mt-2 space-y-2 max-h-[72vh] overflow-y-auto pr-0.5">
                  {items.length === 0
                    ? <div className="text-[11px] text-slate-600 px-2 py-4 text-center">—</div>
                    : items.map(({ l, idx }) => (
                      <LeadCard key={idx} lead={l} idx={idx} open={expandedIdx === idx}
                        onToggle={() => toggleRow(idx)} onCall={() => dial(l.phone, l.name)}
                        slaMin={sla_min} warnMin={warn_min} />
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Embedded dialer so the Call buttons place calls via JustCall */}
      <JustCallDialer />
    </div>
  );
}

function LeadCard({ lead, idx, open, onToggle, onCall, slaMin, warnMin }: {
  lead: Lead; idx: number; open: boolean; onToggle: () => void; onCall: () => void; slaMin: number; warnMin: number;
}) {
  // The "needs action" red treatment (outline + never-dialed badge) only makes
  // sense in First Touch — once a lead has moved on, it's just noise.
  const isFirstTouch = lead.column === 'first_touch';
  const showAwaiting = lead.awaiting && isFirstTouch;
  const showDialBadge = !(lead.dial === 'none' && !isFirstTouch);
  return (
    <div id={`lead-card-${idx}`} onClick={onToggle}
      className={`glass-card cursor-pointer p-2.5 border ${showAwaiting ? 'border-rose-500/30' : 'border-white/5'} hover:border-white/15 transition-colors`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-slate-200 truncate">{lead.name || '—'}</span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {lead.guest_card_uuid && (
            <a href={guestCardUrl(lead.guest_card_uuid)!} target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()} title="Open guest card in AppFolio"
              className="text-[10px] text-accent-light hover:text-accent hover:underline">
              Card
            </a>
          )}
          {lead.phone && (
            <button onClick={(e) => { e.stopPropagation(); onCall(); }} title="Call via JustCall"
              className="text-accent-light hover:text-accent">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
            </button>
          )}
        </div>
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5 truncate">{lead.source} · {fmtDateTime(lead.sort_at)}</div>
      {(lead.property || lead.unit) && (
        <div className="text-[10px] text-slate-400 mt-0.5 truncate">
          {[lead.property, lead.unit].filter(Boolean).join(' · ')}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1 mt-1.5">
        {showDialBadge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${DIAL_STYLE[lead.dial]}`}>{dialLabel(lead)}</span>}
        <TouchBadge min={lead.min_since_touch} kind={lead.last_touch_kind} />
        {lead.flag_reason === 'missed callback' && <span className="text-[9px] px-1 py-0.5 rounded bg-rose-500/15 text-rose-300">missed callback</span>}
      </div>
      {lead.column === 'signed_lease' && (lead.lease_unit || lead.lease_start) && (
        <div className="mt-1.5 pt-1.5 border-t border-white/5 text-[10px] text-emerald-300/90">
          <div className="truncate">{lead.lease_unit || 'Unit —'}</div>
          {lead.lease_start && <div className="text-slate-400">{lead.lease_start_confirmed ? 'Lease starts' : 'Target move-in'} {fmtDateOnly(lead.lease_start)}</div>}
        </div>
      )}
      {lead.column === 'disqualified' && lead.disq_reason && (
        <div className="mt-1.5 pt-1.5 border-t border-white/5 text-[10px] text-rose-300/90">
          <div className="truncate font-medium">{lead.disq_reason}</div>
          {lead.disq_detail && <div className="text-slate-400 line-clamp-2">{lead.disq_detail}</div>}
        </div>
      )}
      {open && <div className="mt-2 pt-2 border-t border-white/5"><LeadTimeline events={lead.timeline} /></div>}
    </div>
  );
}

function LeadTimeline({ events }: { events: TimelineEvent[] }) {
  const [playingSid, setPlayingSid] = useState<string | null>(null);
  if (!events?.length) return <div className="text-xs text-slate-500">No events recorded.</div>;
  // Stop bubbling on every interactive control inside the timeline —
  // otherwise clicking Play (or the audio scrubber) bubbles up to the
  // card's onClick and collapses the row before playback starts.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <ol className="relative ml-1 border-l border-white/10 space-y-2 pl-4 py-0.5" onClick={stop}>
      {events.map((e, i) => {
        const canPlay = e.kind === 'call' && e.has_recording && e.call_sid;
        const isPlaying = canPlay && playingSid === e.call_sid;
        return (
          <li key={i} className="relative">
            <span className={`absolute -left-[21px] top-1 w-2 h-2 rounded-full ${KIND_DOT[e.kind] || 'bg-slate-400'}`} />
            <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="text-slate-500 tabular-nums w-28 flex-shrink-0">{fmtDateTime(e.at)}</span>
              <span className={`font-medium ${KIND_TEXT[e.kind] || 'text-slate-300'}`}>{e.label}</span>
              {e.detail && <span className="text-slate-400">· {e.detail}</span>}
              {canPlay && !isPlaying && (
                <button
                  onClick={(ev) => { ev.stopPropagation(); setPlayingSid(e.call_sid!); }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent-light hover:bg-accent/25 inline-flex items-center gap-1"
                  title="Play recording"
                >
                  ▶ Play
                </button>
              )}
              {isPlaying && (
                <button
                  onClick={(ev) => { ev.stopPropagation(); setPlayingSid(null); }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 hover:bg-white/10"
                  title="Stop"
                >
                  ✕ Close
                </button>
              )}
            </div>
            {isPlaying && (
              <div className="mt-2 -ml-4" onClick={stop}>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio
                  autoPlay
                  controls
                  preload="none"
                  src={`/api/justcall/recording?call_sid=${encodeURIComponent(e.call_sid!)}`}
                  // Default h-8 squished the native scrubber — Chrome collapses
                  // the seek bar when the control area is < ~40px tall. h-12 gives
                  // it a proper rail so short calls can still be scrubbed.
                  className="w-full h-12"
                  onClick={stop}
                  onError={() => setPlayingSid(null)}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ScatterTip({ active, payload, slaMin }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const status = p.dial === 'connected'
    ? { text: `Connected in ${fmtToCall(Math.min(p.warm_min, CAP_MIN))} (business hrs)`, cls: p.warm_min <= slaMin ? 'text-emerald-400' : 'text-emerald-300' }
    : p.dial === 'left_vm'
      ? { text: 'Left voicemail', cls: 'text-sky-400' }
      : p.dial === 'attempt'
        ? { text: `Attempted × ${p.attempts || 1}`, cls: 'text-amber-400' }
        : { text: 'Not called', cls: 'text-rose-400' };
  return (
    <div className="bg-[var(--surface-overlay)] border border-white/10 rounded-lg px-3 py-2 text-xs shadow-lg">
      <div className="font-medium text-slate-200 mb-0.5">{p.name || '—'}</div>
      <div className="text-slate-400">Inquiry: {fmtDateTime(p.inquiry_received)}</div>
      <div className={status.cls}>{status.text}</div>
      {p.stage && <div className="text-slate-500 mt-0.5">{p.stage}</div>}
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
