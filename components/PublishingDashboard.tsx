'use client';

/**
 * PublishingDashboard — /admin/publishing
 *
 * Assisted-publishing workflow for rehab-ready units. For each unit
 * we generate ready-to-paste post copy for Facebook Marketplace,
 * Craigslist, and NextDoor, plus deep links to each platform's new-
 * post page. The manager copies, switches tabs, pastes, posts; clicks
 * "Mark posted" here so we can track per-channel freshness.
 *
 * Built as part of C1 from the leasing audit — FB Marketplace and
 * Craigslist don't accept AppFolio's syndication feed at all, and
 * ~13 of AppFolio's syndication targets are dead-weight. This
 * dashboard is the workaround.
 */

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '../lib/swr';
import { Clipboard, Check, ExternalLink, Clock, AlertCircle, Download, Image as ImageIcon } from 'lucide-react';

type Channel = 'fb_marketplace' | 'craigslist';

interface ChannelPayload {
  channel: Channel;
  last_posted: string | null;
  days_since: number | null;
  due_for_repost: boolean;
  threshold_days: number;
  title: string;
  body: string;
  price: number;
  open_url: string;
}

interface UnitRow {
  property: string;
  unit: string;
  rehab_status: string;
  address: string;
  city: string;
  state: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  rent: number;
  available_on: string | null;
  photo: string | null;
  photos: string[];
  application_url: string | null;
  has_listing: boolean;
  channels: ChannelPayload[];
}

interface ApiResponse {
  snapshot_date: string | null;
  total_units: number;
  units: UnitRow[];
}

const CHANNEL_LABELS: Record<Channel, string> = {
  fb_marketplace: 'Facebook Marketplace',
  craigslist:     'Craigslist',
};

const CHANNEL_ACCENT: Record<Channel, string> = {
  fb_marketplace: 'text-blue-300 border-blue-500/20',
  craigslist:     'text-violet-300 border-violet-500/20',
};

function freshnessLabel(c: ChannelPayload): { text: string; tone: 'good' | 'warn' | 'rose' } {
  if (c.last_posted == null) return { text: 'Never posted', tone: 'rose' };
  if (c.due_for_repost)      return { text: `Posted ${c.days_since}d ago — due`, tone: 'warn' };
  return { text: `Posted ${c.days_since}d ago`, tone: 'good' };
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function photoBaseName(property: string, unit: string): string {
  return `${property}-${unit}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function photoExtFromUrl(url: string): string {
  const m = url.split('?')[0].match(/\.([a-zA-Z0-9]{2,4})$/);
  return m ? m[1].toLowerCase() : 'jpg';
}

function buildProxyHref(url: string, filename: string): string {
  const qs = new URLSearchParams({ url, filename });
  return `/api/admin/publishing/photo?${qs.toString()}`;
}

/**
 * Triggers sequential downloads via temporary <a download> clicks
 * routed through our same-origin proxy. Spaced ~250ms apart so the
 * browser doesn't bundle them into a single "this site is downloading
 * multiple files" prompt.
 */
async function downloadAllPhotos(property: string, unit: string, photos: string[]) {
  const base = photoBaseName(property, unit);
  for (let i = 0; i < photos.length; i++) {
    const ext = photoExtFromUrl(photos[i]);
    const filename = `${base}-${String(i + 1).padStart(2, '0')}.${ext}`;
    const href = buildProxyHref(photos[i], filename);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (i < photos.length - 1) await new Promise(r => setTimeout(r, 250));
  }
}

export default function PublishingDashboard() {
  const { data, error, isLoading, mutate } = useSWR<ApiResponse>(
    '/api/admin/publishing',
    fetcher,
    { revalidateOnMount: true }
  );
  const [expanded, setExpanded]         = useState<Set<string>>(new Set());
  const [copied, setCopied]             = useState<string | null>(null);
  const [marking, setMarking]           = useState<string | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState<string | null>(null);

  // Auto-expand any unit with a due-for-repost channel on first load
  useEffect(() => {
    if (!data) return;
    setExpanded(prev => {
      if (prev.size > 0) return prev;
      const next = new Set<string>();
      for (const u of data.units) {
        if (u.channels.some(c => c.due_for_repost)) next.add(`${u.property}||${u.unit}`);
      }
      return next;
    });
  }, [data]);

  const summary = useMemo(() => {
    if (!data) return { total: 0, overdue: 0 };
    let overdue = 0;
    for (const u of data.units) {
      if (u.channels.some(c => c.due_for_repost)) overdue++;
    }
    return { total: data.units.length, overdue };
  }, [data]);

  const handleCopy = async (key: string, text: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(key);
      setTimeout(() => setCopied(prev => (prev === key ? null : prev)), 2000);
    }
  };

  const markPosted = async (property: string, unit: string, channel: Channel) => {
    const key = `${property}||${unit}||${channel}`;
    setMarking(key);
    try {
      const res = await fetch('/api/admin/publishing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property, unit, channel }),
      });
      if (res.ok) await mutate();
    } finally {
      setMarking(null);
    }
  };

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  if (isLoading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Loading publishing dashboard…</p>
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
            <h1 className="text-sm font-semibold text-slate-100 whitespace-nowrap">Publishing</h1>
            <span className="text-xs text-slate-500">
              {summary.total} rehab-ready units · {summary.overdue} have a channel due for repost
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
          {summary.overdue > 0 && (
            <div className="glass-card border border-amber-500/30 bg-amber-500/5 p-4 mt-6 mb-4 flex gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-sm text-slate-200">
                <strong className="text-amber-300">
                  {summary.overdue} units have at least one channel due for repost.
                </strong>
                {' '}Expand a unit to see what's overdue, copy the prefilled post, and click "Mark
                posted" after publishing.
              </div>
            </div>
          )}

          <div className="space-y-3 mt-4">
            {data.units.map(u => {
              const key = `${u.property}||${u.unit}`;
              const isOpen = expanded.has(key);
              const overdueCount = u.channels.filter(c => c.due_for_repost).length;
              return (
                <div key={key} className="glass-card overflow-hidden">
                  <button
                    onClick={() => toggle(key)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className="font-semibold text-slate-100">{u.property}</span>
                        <span className="text-slate-500 text-xs">·</span>
                        <span className="text-slate-200 text-sm">Unit {u.unit}</span>
                        <RehabBadge status={u.rehab_status} />
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                        {[
                          u.bedrooms != null ? `${u.bedrooms} BR` : null,
                          u.bathrooms != null ? `${u.bathrooms} BA` : null,
                          u.sqft != null ? `${u.sqft.toLocaleString()} sqft` : null,
                          `$${u.rent.toLocaleString()}/mo`,
                          u.address,
                        ].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {u.channels.map(c => (
                        <ChannelDot key={c.channel} channel={c.channel} due={c.due_for_repost} />
                      ))}
                    </div>
                    {overdueCount > 0 && (
                      <span className="text-xs font-medium text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded tabular-nums">
                        {overdueCount} due
                      </span>
                    )}
                    <span className="text-slate-500 text-xs">{isOpen ? '▼' : '▶'}</span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-[var(--glass-border)] p-4 space-y-3 bg-black/10">
                      {!u.has_listing && (
                        <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
                          No active af_listing for this unit — descriptions below use a generic
                          fallback. Check /admin/listing-coverage and post the listing in AppFolio
                          first for best copy quality.
                        </div>
                      )}

                      {/* Photo strip */}
                      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 text-xs">
                            <ImageIcon className="w-3.5 h-3.5 text-slate-400" />
                            <span className="font-semibold uppercase tracking-wide text-slate-300">
                              Photos
                            </span>
                            <span className="text-slate-500">·</span>
                            <span className="text-slate-400 tabular-nums">
                              {u.photos.length} available
                            </span>
                          </div>
                          {u.photos.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={async () => {
                                  const ok = await copyToClipboard(u.photos.join('\n'));
                                  if (ok) {
                                    const k = `urls:${key}`;
                                    setCopied(k);
                                    setTimeout(() => setCopied(prev => prev === k ? null : prev), 2000);
                                  }
                                }}
                                className="text-xs px-2 py-1 rounded text-slate-300 hover:text-white hover:bg-white/10 flex items-center gap-1"
                                title="Copy all photo URLs to clipboard"
                              >
                                {copied === `urls:${key}` ? (
                                  <><Check className="w-3 h-3 text-emerald-400" /> URLs copied</>
                                ) : (
                                  <><Clipboard className="w-3 h-3" /> Copy URLs</>
                                )}
                              </button>
                              <button
                                onClick={async () => {
                                  setBulkDownloading(key);
                                  try { await downloadAllPhotos(u.property, u.unit, u.photos); }
                                  finally { setBulkDownloading(null); }
                                }}
                                disabled={bulkDownloading === key}
                                className="text-xs px-2 py-1 rounded bg-accent/15 text-accent-light hover:bg-accent/25 disabled:opacity-60 flex items-center gap-1"
                                title={`Download all ${u.photos.length} photos to your computer`}
                              >
                                <Download className="w-3 h-3" />
                                {bulkDownloading === key ? `Downloading ${u.photos.length}…` : `Download all (${u.photos.length})`}
                              </button>
                            </div>
                          )}
                        </div>
                        {u.photos.length === 0 ? (
                          <div className="text-xs text-slate-500 py-4 text-center">
                            No photos uploaded yet. Add photos to this unit in AppFolio so
                            Marketplace and Craigslist posts have visuals.
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                            {u.photos.map((src, i) => {
                              const filename = `${photoBaseName(u.property, u.unit)}-${String(i+1).padStart(2,'0')}.${photoExtFromUrl(src)}`;
                              const proxyHref = buildProxyHref(src, filename);
                              return (
                                <a
                                  key={i}
                                  href={proxyHref}
                                  download={filename}
                                  className="relative group block aspect-square rounded overflow-hidden border border-white/10 bg-black/40 hover:border-accent/50 transition-colors"
                                  title={`Photo ${i+1} — click to download`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={src}
                                    alt={`Photo ${i+1}`}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                  />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <Download className="w-4 h-4 text-white" />
                                  </div>
                                  <span className="absolute top-1 left-1 text-[10px] font-semibold text-white bg-black/60 px-1.5 py-0.5 rounded">
                                    {i + 1}
                                  </span>
                                </a>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {u.channels.map(c => {
                        const channelKey = `${u.property}||${u.unit}||${c.channel}`;
                        const f = freshnessLabel(c);
                        const titleKey = `title:${channelKey}`;
                        const bodyKey  = `body:${channelKey}`;
                        return (
                          <div key={c.channel} className={`rounded-lg border ${CHANNEL_ACCENT[c.channel]} bg-white/[0.02] p-3`}>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-semibold uppercase tracking-wide">
                                {CHANNEL_LABELS[c.channel]}
                              </span>
                              <span className="text-[11px] text-slate-500">·</span>
                              <FreshnessBadge tone={f.tone}>
                                <Clock className="w-3 h-3" />
                                {f.text}
                              </FreshnessBadge>
                              <div className="ml-auto flex items-center gap-1.5">
                                <a
                                  href={c.open_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs px-2 py-1 rounded bg-accent/15 text-accent-light hover:bg-accent/25 flex items-center gap-1"
                                  title={`Open ${CHANNEL_LABELS[c.channel]} new-post page`}
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  Open form
                                </a>
                                <button
                                  onClick={() => markPosted(u.property, u.unit, c.channel)}
                                  disabled={marking === channelKey}
                                  className="text-xs px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                                >
                                  {marking === channelKey ? 'Marking…' : 'Mark posted'}
                                </button>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <CopyableField
                                label="Title"
                                value={c.title}
                                copyKey={titleKey}
                                copied={copied === titleKey}
                                onCopy={() => handleCopy(titleKey, c.title)}
                              />
                              <CopyableField
                                label="Body"
                                value={c.body}
                                copyKey={bodyKey}
                                copied={copied === bodyKey}
                                onCopy={() => handleCopy(bodyKey, c.body)}
                                multiline
                              />
                              <div className="flex items-center gap-3 text-xs text-slate-400">
                                <span>Price: <span className="text-slate-200 tabular-nums">${c.price.toLocaleString()}/mo</span></span>
                                <span>·</span>
                                <span>Re-post window: {c.threshold_days}d</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {data.units.length === 0 && (
              <div className="text-center py-12 text-slate-500 text-sm">
                No rehab-ready units. Set a rehab to "In Progress" or "Complete" on /rehabs to populate this dashboard.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CopyableField({ label, value, copyKey, copied, onCopy, multiline }: {
  label: string;
  value: string;
  copyKey: string;
  copied: boolean;
  onCopy: () => void;
  multiline?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
        <button
          onClick={onCopy}
          className="text-xs px-1.5 py-0.5 rounded text-slate-300 hover:text-white hover:bg-white/10 flex items-center gap-1"
        >
          {copied ? <><Check className="w-3 h-3 text-emerald-400" /> Copied</> : <><Clipboard className="w-3 h-3" /> Copy</>}
        </button>
      </div>
      {multiline ? (
        <pre className="text-xs text-slate-200 bg-black/30 border border-white/5 rounded p-2 whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-sans">
          {value}
        </pre>
      ) : (
        <div className="text-sm text-slate-100 bg-black/30 border border-white/5 rounded px-2 py-1.5 break-words">
          {value}
        </div>
      )}
    </div>
  );
}

function ChannelDot({ channel, due }: { channel: Channel; due: boolean }) {
  const color = due
    ? 'bg-amber-400'
    : channel === 'fb_marketplace' ? 'bg-blue-400'
    : 'bg-violet-400';
  return (
    <span
      title={`${CHANNEL_LABELS[channel]}${due ? ' — due for repost' : ' — fresh'}`}
      className={`w-2 h-2 rounded-full ${color}`}
    />
  );
}

function FreshnessBadge({ tone, children }: { tone: 'good' | 'warn' | 'rose'; children: React.ReactNode }) {
  const cls =
    tone === 'good' ? 'bg-emerald-500/10 text-emerald-300' :
    tone === 'warn' ? 'bg-amber-500/15  text-amber-300'   :
                       'bg-rose-500/15   text-rose-300';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] ${cls}`}>
      {children}
    </span>
  );
}

function RehabBadge({ status }: { status: string }) {
  const cls = status === 'Complete'
    ? 'bg-emerald-500/15 text-emerald-300'
    : status === 'In Progress'
    ? 'bg-blue-500/15 text-blue-300'
    : 'bg-slate-500/15 text-slate-300';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${cls}`}>
      {status}
    </span>
  );
}
