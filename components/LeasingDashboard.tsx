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
 * Implementation notes:
 *   - Active tab lives in the URL (?tab=…) and is the single source
 *     of truth; no local state to drift out of sync.
 *   - All three children mount on first render and stay mounted —
 *     switching tabs just toggles `display`. That preserves each
 *     tab's scroll position + SWR data and stops the page from
 *     jumping when content heights differ across tabs.
 */

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, Megaphone, BarChart3, Timer } from 'lucide-react';
import ListingCoverageDashboard from './ListingCoverageDashboard';
import PublishingDashboard from './PublishingDashboard';
import SourcePerformanceDashboard from './SourcePerformanceDashboard';
import SpeedToLeadDashboard from './SpeedToLeadDashboard';

type Tab = 'coverage' | 'publishing' | 'sources' | 'speed';

const TABS: { id: Tab; label: string; Icon: any }[] = [
  { id: 'coverage',   label: 'Coverage',   Icon: Eye       },
  { id: 'publishing', label: 'Publishing', Icon: Megaphone },
  { id: 'sources',    label: 'Sources',    Icon: BarChart3 },
  { id: 'speed',      label: 'Speed to Lead', Icon: Timer   },
];

function isTab(s: string | null | undefined): s is Tab {
  return s === 'coverage' || s === 'publishing' || s === 'sources' || s === 'speed';
}

export default function LeasingDashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const fromUrl = params.get('tab');
  const tab: Tab = isTab(fromUrl) ? fromUrl : 'coverage';

  const select = useCallback((next: Tab) => {
    if (next === tab) return;
    const search = new URLSearchParams(params.toString());
    search.set('tab', next);
    router.replace(`/admin/leasing?${search.toString()}`, { scroll: false });
  }, [tab, params, router]);

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
                    onClick={() => select(t.id)}
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
          </div>
        </div>
      </div>

      <div className="px-6 md:px-8 pb-6 md:pb-8">
        <div className="max-w-7xl mx-auto">
          {/* All three stay mounted; only one is visible. Preserves SWR
              cache + scroll position and avoids layout jumps when the
              user switches between very-different-height tabs. */}
          <div style={{ display: tab === 'coverage'   ? 'block' : 'none' }}>
            <ListingCoverageDashboard embedded />
          </div>
          <div style={{ display: tab === 'publishing' ? 'block' : 'none' }}>
            <PublishingDashboard embedded />
          </div>
          <div style={{ display: tab === 'sources'    ? 'block' : 'none' }}>
            <SourcePerformanceDashboard embedded />
          </div>
          <div style={{ display: tab === 'speed'      ? 'block' : 'none' }}>
            <SpeedToLeadDashboard embedded />
          </div>
        </div>
      </div>
    </div>
  );
}
