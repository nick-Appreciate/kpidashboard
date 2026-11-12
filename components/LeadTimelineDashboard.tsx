'use client';

/**
 * LeadTimelineDashboard — /leasing/speed-to-lead
 *
 * Every lead (any source: Zillow, Apartments.com, our website, walk-ins…),
 * filterable by property, with every touch point on one timeline — our
 * automated texts, AppFolio's own automation, JustCall texts and calls by
 * people, prospect replies, tours and applications. Data: /api/admin/lead-timeline.
 */

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '../lib/swr';
import JustCallDialerBase, { useJustCall } from './JustCallDialer';

const JustCallDialer: any = JustCallDialerBase;

type Actor = 'auto' | 'human' | 'prospect' | 'appfolio' | 'system';
interface Touch {
  at: string; actor: Actor; channel: string; label: string;
  detail?: string | null; agent?: string | null; status?: string | null;
}
interface Lead {
  key: string; name: string; phone: string | null; email: string | null;
  property: string | null; unit: string | null; sources: string[]; received: string;
  appfolio_status: string | null; guest_card_uuid: string | null;
  stage: 'new' | 'contacted' | 'tour_scheduled' | 'toured' | 'applied' | 'inactive';
  first_auto_sec: number | null; first_human_min: number | null;
  human_touches: number; auto_touches: number; prospect_replies: number;
  needs_human: boolean; opted_out: boolean; last_touch_at: string; timeline: Touch[];
}
interface Api {
  days: number; property: string;
  engine: { enabled: boolean; dry_run: boolean; live_since: string } | null;
  properties: { name: string; count: number }[];
  kpis: {
    leads: number; auto_within_1m_pct: number; median_auto_sec: number | null;
    human_within_5m_pct: number; human_within_1h_pct: number; median_human_min: number | null;
    never_human: number; needs_human: number; tour_scheduled: number; toured: number; applied: number;
  };
  leads: Lead[];
}

const APPFOLIO_BASE = 'https://appreciateinc.appfolio.com';
const DAY_OPTIONS = [7, 14, 30, 90];
const STAGE: Record<Lead['stage'], { label: string; cls: string }> = {
  new:            { label: 'New',            cls: 'bg-rose-500/15 text-rose-300' },
  contacted:      { label: 'Contacted',      cls: 'bg-sky-500/15 text-sky-300' },
  tour_scheduled: { label: 'Tour scheduled', cls: 'bg-cyan-500/15 text-cyan-300' },
  toured:         { label: 'Toured',         cls: 'bg-amber-500/15 text-amber-300' },
  applied:        { label: 'Applied',        cls: 'bg-emerald-500/15 text-emerald-300' },
  inactive:       { label: 'Inactive',       cls: 'bg-white/5 text-slate-400' },
};
const ACTOR: Record<Actor, { label: string; dot: string; text: string }> = {
  auto:     { label: 'Automated (ours)', dot: 'bg-sky-400',     text: 'text-sky-300' },
  human:    { label: 'Team',             dot: 'bg-violet-400',  text: 'text-violet-300' },
  prospect: { label: 'Prospect',         dot: 'bg-emerald-400', text: 'text-emerald-300' },
  appfolio: { label: 'AppFolio auto',    dot: 'bg-slate-400',   text: 'text-slate-300' },
  system:   { label: 'Tour / system',    dot: 'bg-amber-400',   text: 'text-amber-300' },
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtMin(min: number | null) {
  if (min == null) return '—';
  if (min < 1) return '<1m';
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
  return `${Math.round(min / 1440)}d`;
}
function fmtSec(sec: number | null) {
  if (sec == null) return '—';
  return sec < 60 ? `${sec}s` : fmtMin(sec / 60);
}
const latCls = (min: number | null, good: number, ok: number) =>
  min == null ? 'text-slate-500' : min <= good ? 'text-emerald-400' : min <= ok ? 'text-amber-400' : 'text-rose-400';
function toE164(p: string) { return `+1${p}`; }

export default function LeadTimelineDashboard() {
  const [days, setDays] = useState(30);
  const [property, setProperty] = useState('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'all' | 'needs_human' | 'new' | 'active'>('all');
  const [actorFilter, setActorFilter] = useState<Actor | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const { makeCall } = useJustCall();

  // ?q=<phone> (links from #leasing Slack alerts) pre-fills the search and opens that lead.
  const [deepLink, setDeepLink] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) { setQuery(q); setDeepLink(q.replace(/\D/g, '')); }
  }, []);

  const { data, error, isLoading } = useSWR<Api>(
    `/api/admin/lead-timeline?days=${days}&property=${encodeURIComponent(property)}`,
    fetcher, { refreshInterval: 30_000 },
  );

  const leads = useMemo(() => {
    let xs = data?.leads || [];
    if (view === 'needs_human') xs = xs.filter((l) => l.needs_human);
    if (view === 'new') xs = xs.filter((l) => l.stage === 'new');
    if (view === 'active') xs = xs.filter((l) => l.stage !== 'inactive');
    const q = query.trim().toLowerCase();
    if (q) {
      const digits = q.replace(/\D/g, '');
      xs = xs.filter((l) => l.name.toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q)
        || (digits.length >= 3 && (l.phone || '').includes(digits)) || (l.unit || '').toLowerCase().includes(q));
    }
    return xs;
  }, [data, view, query]);

  useEffect(() => {
    if (!deepLink || !leads.length) return;
    const hit = leads.find((l) => l.phone && deepLink.length >= 10 && l.phone === deepLink.slice(-10));
    if (hit) { setOpen(hit.key); setDeepLink(null); }
  }, [deepLink, leads]);

  if (error) return <div className="p-6 text-rose-300 text-sm">Failed to load leads.</div>;

  const k = data?.kpis;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <JustCallDialer />

      {/* ── Header + filters ───────────────────────────────────────── */}
      <div className="sticky-header -mx-4 md:-mx-6 px-4 md:px-6 py-3 flex flex-wrap items-center gap-3 border-b border-[var(--glass-border)]">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold text-slate-100">Speed to Lead</h1>
          <p className="text-[11px] text-slate-500">
            Every lead and every touch — ours, AppFolio&apos;s and the team&apos;s. Refreshes every 30s.
            {data?.engine && (
              <span className={`ml-2 px-1.5 py-0.5 rounded ${!data.engine.enabled ? 'bg-rose-500/15 text-rose-300' : data.engine.dry_run ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                Lead engine: {!data.engine.enabled ? 'off' : data.engine.dry_run ? 'dry run (not texting yet)' : 'live'}
              </span>
            )}
          </p>
        </div>
        <select value={property} onChange={(e) => setProperty(e.target.value)} className="dark-select px-2.5 py-1.5 text-xs" aria-label="Property">
          <option value="all">All properties</option>
          {(data?.properties || []).map((p) => <option key={p.name} value={p.name}>{p.name} ({p.count})</option>)}
        </select>
        <div className="inline-flex rounded-lg border border-[var(--glass-border)] bg-surface-overlay p-0.5">
          {DAY_OPTIONS.map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded text-xs font-medium ${days === d ? 'bg-accent/20 text-accent-light' : 'text-slate-400 hover:text-slate-200'}`}>
              {d}d
            </button>
          ))}
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone, unit…"
          className="dark-input px-2.5 py-1.5 text-xs w-48" />
      </div>

      {/* ── KPIs ───────────────────────────────────────────────────── */}
      {k && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi label="Leads" value={String(k.leads)} sub={`${k.needs_human} need a person now`} subCls={k.needs_human ? 'text-rose-300' : 'text-slate-500'} />
          <Kpi label="Auto reply within 1 min" value={`${k.auto_within_1m_pct}%`} sub={`median ${fmtSec(k.median_auto_sec)} (ours or AppFolio's)`} />
          <Kpi label="Person within 5 min" value={`${k.human_within_5m_pct}%`} sub={`${k.human_within_1h_pct}% within 1h`} />
          <Kpi label="Median to a person" value={fmtMin(k.median_human_min)} sub={`${k.never_human} never reached by a person`} subCls={k.never_human ? 'text-amber-300' : 'text-slate-500'} />
          <Kpi label="Tours" value={String(k.tour_scheduled)} sub={`${k.toured} toured`} />
          <Kpi label="Applications" value={String(k.applied)} sub={k.leads ? `${Math.round(100 * k.applied / k.leads)}% of leads` : ''} />
        </div>
      )}

      {/* ── View + legend ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-[var(--glass-border)] bg-surface-overlay p-0.5">
          {([['all', 'All'], ['needs_human', 'Needs a person'], ['new', 'New'], ['active', 'Active']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2.5 py-1 rounded text-xs font-medium ${view === v ? 'bg-accent/20 text-accent-light' : 'text-slate-400 hover:text-slate-200'}`}>
              {label}{v === 'needs_human' && k?.needs_human ? ` (${k.needs_human})` : ''}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          <span className="text-slate-500 mr-1">Timeline shows:</span>
          <button onClick={() => setActorFilter('all')} className={`px-2 py-0.5 rounded ${actorFilter === 'all' ? 'bg-white/10 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>Everything</button>
          {(Object.keys(ACTOR) as Actor[]).map((a) => (
            <button key={a} onClick={() => setActorFilter(a)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${actorFilter === a ? 'bg-white/10 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${ACTOR[a].dot}`} />{ACTOR[a].label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-slate-500">{leads.length} shown</span>
      </div>

      {/* ── Lead table ─────────────────────────────────────────────── */}
      <div className="glass-card overflow-auto max-h-[75vh]">
        <table className="w-full text-xs">
          <thead className="dark-thead">
            <tr>
              <th className="text-left font-medium px-3 py-2">Lead</th>
              <th className="text-left font-medium px-3 py-2">Property</th>
              <th className="text-left font-medium px-3 py-2">Source</th>
              <th className="text-left font-medium px-3 py-2">Received</th>
              <th className="text-right font-medium px-3 py-2">First auto</th>
              <th className="text-right font-medium px-3 py-2">First person</th>
              <th className="text-right font-medium px-3 py-2" title="Team / automated / prospect replies">Touches</th>
              <th className="text-left font-medium px-3 py-2">Stage</th>
              <th className="text-left font-medium px-3 py-2">Last touch</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {isLoading && !data && (
              <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-500">Loading leads…</td></tr>
            )}
            {data && leads.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-500">No leads match.</td></tr>
            )}
            {leads.map((l) => {
              const isOpen = open === l.key;
              const tl = actorFilter === 'all' ? l.timeline : l.timeline.filter((t) => t.actor === actorFilter);
              return (
                <LeadRows key={l.key} l={l} isOpen={isOpen} timeline={tl}
                  onToggle={() => setOpen(isOpen ? null : l.key)}
                  onCall={() => l.phone && makeCall(toE164(l.phone), l.name)} />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, subCls = 'text-slate-500' }: { label: string; value: string; sub?: string; subCls?: string }) {
  return (
    <div className="glass-card p-3">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-xl font-semibold text-slate-100 tabular-nums mt-0.5">{value}</div>
      {sub && <div className={`text-[11px] mt-0.5 ${subCls}`}>{sub}</div>}
    </div>
  );
}

function LeadRows({ l, isOpen, timeline, onToggle, onCall }: {
  l: Lead; isOpen: boolean; timeline: Touch[]; onToggle: () => void; onCall: () => void;
}) {
  const st = STAGE[l.stage];
  return (
    <>
      <tr className={`cursor-pointer hover:bg-white/[0.03] ${isOpen ? 'bg-white/[0.03]' : ''}`} onClick={onToggle}>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            {l.needs_human && <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" title="No person has reached out yet" />}
            <span className="text-slate-100 font-medium">{l.name}</span>
            {l.opted_out && <span className="px-1 rounded bg-rose-500/15 text-rose-300 text-[10px]">STOP</span>}
          </div>
          <div className="text-[11px] text-slate-500">{l.phone ? `(${l.phone.slice(0, 3)}) ${l.phone.slice(3, 6)}-${l.phone.slice(6)}` : l.email || 'no contact info'}</div>
        </td>
        <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{l.property || '—'}{l.unit ? <span className="text-slate-500"> · {l.unit}</span> : null}</td>
        <td className="px-3 py-2 text-slate-400">{l.sources.join(', ')}</td>
        <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{fmtDateTime(l.received)}</td>
        <td className={`px-3 py-2 text-right tabular-nums ${latCls(l.first_auto_sec == null ? null : l.first_auto_sec / 60, 1, 5)}`}>{fmtSec(l.first_auto_sec)}</td>
        <td className={`px-3 py-2 text-right tabular-nums ${latCls(l.first_human_min, 5, 60)}`}>{fmtMin(l.first_human_min)}</td>
        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
          <span className="text-violet-300">{l.human_touches}</span>
          <span className="text-slate-600"> / </span>
          <span className="text-sky-300">{l.auto_touches}</span>
          <span className="text-slate-600"> / </span>
          <span className="text-emerald-300">{l.prospect_replies}</span>
        </td>
        <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-[11px] ${st.cls}`}>{st.label}</span></td>
        <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{fmtDateTime(l.last_touch_at)}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {l.phone && (
            <button onClick={onCall} className="px-2 py-1 rounded bg-accent/15 text-accent-light hover:bg-accent/25 text-[11px] font-medium">Call</button>
          )}
          {l.guest_card_uuid && (
            <a href={`${APPFOLIO_BASE}/crm/leasing/prospects/${l.guest_card_uuid}`} target="_blank" rel="noopener noreferrer"
              className="ml-1.5 px-2 py-1 rounded bg-white/5 text-slate-300 hover:bg-white/10 text-[11px]">AppFolio ↗</a>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={10} className="px-3 pb-4 pt-1 bg-white/[0.02]">
            {timeline.length === 0 ? (
              <div className="text-[11px] text-slate-500 py-3">No touches of this type.</div>
            ) : (
              <ol className="relative ml-2 border-l border-white/10 space-y-2.5 py-2">
                {timeline.map((t, i) => {
                  const a = ACTOR[t.actor];
                  const future = new Date(t.at).getTime() > Date.now();
                  return (
                    <li key={i} className="ml-4">
                      <span className={`absolute -left-[4px] mt-1.5 w-2 h-2 rounded-full ${a.dot} ${future ? 'opacity-40' : ''}`} />
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[11px] text-slate-500 tabular-nums w-28 shrink-0">
                          {t.status === 'date_only'
                            ? new Date(t.at).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
                            : fmtDateTime(t.at)}
                        </span>
                        <span className={`text-[11px] ${a.text}`}>{a.label}</span>
                        <span className="text-slate-200">{t.label}</span>
                        {t.agent && <span className="text-[11px] text-slate-500">· {t.agent}</span>}
                        {t.status === 'dry_run' && <span className="px-1 rounded bg-amber-500/15 text-amber-300 text-[10px]">dry run — not sent</span>}
                        {t.status === 'scheduled' && <span className="px-1 rounded bg-white/5 text-slate-400 text-[10px]">scheduled</span>}
                        {t.status === 'skipped' && <span className="px-1 rounded bg-white/5 text-slate-400 text-[10px]">skipped</span>}
                        {t.status === 'failed' && <span className="px-1 rounded bg-rose-500/15 text-rose-300 text-[10px]">failed</span>}
                        {t.channel === 'email' && <span className="px-1 rounded bg-white/5 text-slate-400 text-[10px]">email</span>}
                        {t.status === 'confirmed' && <span className="px-1 rounded bg-emerald-500/15 text-emerald-300 text-[10px]">confirmed</span>}
                      </div>
                      {t.detail && <div className="ml-[7.5rem] text-[11px] text-slate-400 whitespace-pre-wrap max-w-3xl">{t.detail}</div>}
                    </li>
                  );
                })}
              </ol>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
