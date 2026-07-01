'use client';

/**
 * LeasingDashboard — the unified Leasing hub (/leasing).
 *
 * One tab bar for every leasing view, reached from the single "Leasing" link
 * in the sidebar:
 *
 *   overview   — inquiry-funnel charts (formerly the standalone /dashboard)
 *   speed      — Speed to Lead response tracking
 *   occupancy  — rent-roll / churn
 *   renewals   — renewal pipeline
 *   coverage   — are rehab-ready units actually listed?
 *   publishing — pre-formatted post copy + photos for FB / CL
 *   sources    — lead-source scorecard
 *
 * Implementation notes:
 *   - Active tab lives in the URL (?tab=…), the single source of truth.
 *   - All tabs mount once and stay mounted; switching toggles `display` so
 *     scroll position + SWR cache survive and the page doesn't jump.
 *   - Overview / Occupancy / Renewals are full-page dashboards that bring
 *     their own chrome, so they render outside the narrow content wrapper the
 *     embedded tabs share.
 */

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LayoutDashboard, Timer, Building2, RefreshCw, Eye, Megaphone, BarChart3 } from 'lucide-react';
import Dashboard from './Dashboard';
import SpeedToLeadDashboard from './SpeedToLeadDashboard';
import OccupancyDashboard from './OccupancyDashboard';
import RenewalsDashboard from './RenewalsDashboard';
import ListingCoverageDashboard from './ListingCoverageDashboard';
import PublishingDashboard from './PublishingDashboard';
import SourcePerformanceDashboard from './SourcePerformanceDashboard';

type Tab = 'overview' | 'speed' | 'occupancy' | 'renewals' | 'coverage' | 'publishing' | 'sources';

const TABS: { id: Tab; label: string; Icon: any }[] = [
  { id: 'overview',   label: 'Overview',      Icon: LayoutDashboard },
  { id: 'speed',      label: 'Speed to Lead', Icon: Timer           },
  { id: 'occupancy',  label: 'Occupancy',     Icon: Building2       },
  { id: 'renewals',   label: 'Renewals',      Icon: RefreshCw       },
  { id: 'coverage',   label: 'Coverage',      Icon: Eye             },
  { id: 'publishing', label: 'Publishing',    Icon: Megaphone       },
  { id: 'sources',    label: 'Sources',       Icon: BarChart3       },
];

const TAB_IDS = TABS.map(t => t.id);
function isTab(s: string | null | undefined): s is Tab {
  return !!s && (TAB_IDS as string[]).includes(s);
}

export default function LeasingDashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const fromUrl = params.get('tab');
  const tab: Tab = isTab(fromUrl) ? fromUrl : 'overview';

  const select = useCallback((next: Tab) => {
    if (next === tab) return;
    const search = new URLSearchParams(params.toString());
    search.set('tab', next);
    router.replace(`/leasing?${search.toString()}`, { scroll: false });
  }, [tab, params, router]);

  const show = (id: Tab) => ({ display: tab === id ? 'block' : 'none' } as const);

  return (
    <div className="min-h-screen">
      <div className="sticky-header">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-4 h-10 px-6 border-b border-[var(--glass-border)]">
            <h1 className="text-sm font-semibold text-slate-100 whitespace-nowrap">Leasing</h1>
            <nav className="flex items-center gap-0.5 bg-surface-overlay rounded-lg p-0.5 overflow-x-auto">
              {TABS.map(t => {
                const active = t.id === tab;
                return (
                  <button
                    key={t.id}
                    onClick={() => select(t.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                      active ? 'bg-accent/20 text-accent-light' : 'text-slate-400 hover:text-slate-200'
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

      {/* Full-page tabs — render their own layout/chrome. */}
      <div style={show('overview')}><Dashboard /></div>
      <div style={show('occupancy')}><OccupancyDashboard /></div>
      <div style={show('renewals')}><RenewalsDashboard /></div>

      {/* Embedded tabs — share the narrow content wrapper. */}
      <div className="px-6 md:px-8 pb-6 md:pb-8">
        <div className="max-w-7xl mx-auto">
          <div style={show('speed')}><SpeedToLeadDashboard embedded /></div>
          <div style={show('coverage')}><ListingCoverageDashboard embedded /></div>
          <div style={show('publishing')}><PublishingDashboard embedded /></div>
          <div style={show('sources')}><SourcePerformanceDashboard embedded /></div>
        </div>
      </div>
    </div>
  );
}
