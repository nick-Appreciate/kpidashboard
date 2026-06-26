'use client';

/**
 * LeasingDashboard — /admin/leasing
 *
 * Single tabbed page that hosts the three leasing-operations
 * dashboards we built off the Phase 2/4 audit findings:
 *
 *   coverage   — are the rehab-ready units actually listed?
 *   publishing — pre-formatted post copy + photos for FB / CL
 *   sources    — lead source scorecard + trim-spend recommendations
 *
 * Tab is stored in the URL (?tab=...) so deep links from the old
 * standalone routes survive (and so the browser back button works).
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, Megaphone, BarChart3 } from 'lucide-react';
import ListingCoverageDashboard from './ListingCoverageDashboard';
import PublishingDashboard from './PublishingDashboard';
import SourcePerformanceDashboard from './SourcePerformanceDashboard';

type Tab = 'coverage' | 'publishing' | 'sources';

const TABS: { id: Tab; label: string; Icon: any; description: string }[] = [
  { id: 'coverage',   label: 'Coverage',   Icon: Eye,       description: 'Rehab-ready units vs active public listings' },
  { id: 'publishing', label: 'Publishing', Icon: Megaphone, description: 'Copy-paste posts for FB Marketplace + Craigslist' },
  { id: 'sources',    label: 'Sources',    Icon: BarChart3, description: 'Per-source funnel + trim/invest recommendations' },
];

function isTab(s: string | null | undefined): s is Tab {
  return s === 'coverage' || s === 'publishing' || s === 'sources';
}

export default function LeasingDashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const initial: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'coverage';
  const [tab, setTab] = useState<Tab>(initial);

  // Keep URL ?tab= in sync when user clicks a tab
  useEffect(() => {
    const current = params.get('tab');
    if (current === tab) return;
    const next = new URLSearchParams(params.toString());
    next.set('tab', tab);
    router.replace(`/admin/leasing?${next.toString()}`, { scroll: false });
  }, [tab, params, router]);

  // If the URL changes (back/forward, external link) reflect it
  useEffect(() => {
    const fromUrl = params.get('tab');
    if (isTab(fromUrl) && fromUrl !== tab) setTab(fromUrl);
  }, [params, tab]);

  const description = useMemo(
    () => TABS.find(t => t.id === tab)?.description ?? '',
    [tab],
  );

  return (
    <div className="min-h-screen">
      <div className="sticky-header">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-4 h-10 px-6 border-b border-[var(--glass-border)]">
            <h1 className="text-sm font-semibold text-slate-100 whitespace-nowrap">Leasing</h1>
            <nav className="flex items-center gap-0.5 bg-surface-overlay rounded-lg p-0.5">
              {TABS.map(t => {
                const active = t.id === tab;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      active
                        ? 'bg-accent/20 text-accent-light'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <t.Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </nav>
            <span className="text-xs text-slate-500 truncate">{description}</span>
          </div>
        </div>
      </div>

      <div className="px-6 md:px-8 pb-6 md:pb-8">
        <div className="max-w-7xl mx-auto">
          {tab === 'coverage'   && <ListingCoverageDashboard embedded />}
          {tab === 'publishing' && <PublishingDashboard embedded />}
          {tab === 'sources'    && <SourcePerformanceDashboard embedded />}
        </div>
      </div>
    </div>
  );
}
