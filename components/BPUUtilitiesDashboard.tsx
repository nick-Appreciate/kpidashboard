'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import BPUUsageChart, { TIME_RANGES } from './BPUUsageChart';
import BPUBaselineChart from './BPUBaselineChart';
import BPUWasteChart from './BPUWasteChart';
import BPULeakAlerts from './BPULeakAlerts';
import BPUMeterDetail from './BPUMeterDetail';
import BPUOccupiedUnits from './BPUOccupiedUnits';

interface Stats {
  totalMeters: number;
  activeMeters: number;
  totalCcf: number;
  alertCount: number;
}

interface MeterSummary {
  meter: string;
  label: string;
  address: string;
  name: string;
  accountNumber: string;
  totalCcf: number;
  avgHourly: number;
  maxHourly: number;
  overnightAvg: number;
  pctActive: number;
  dayCount: number;
  readingCount: number;
}

interface Alert {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  meter: string;
  label: string;
  address: string;
  name: string;
  date: string;
  actual: number;
  expected: number;
  zScore?: number;
  message: string;
}

type Tab = 'overview' | 'alerts' | 'detail';

export default function BPUUtilitiesDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const router = useRouter();

  const [stats, setStats] = useState<Stats | null>(null);
  const [dailyUsage, setDailyUsage] = useState<any[]>([]);
  const [dailyCost, setDailyCost] = useState<any[]>([]);
  const [dailyWaste, setDailyWaste] = useState<any[]>([]);
  const [baselineDeviation, setBaselineDeviation] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [meters, setMeters] = useState<MeterSummary[]>([]);
  const [occupiedMetered, setOccupiedMetered] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('30');
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [selectedMeter, setSelectedMeter] = useState<MeterSummary | null>(null);

  useEffect(() => {
    if (!authLoading && appUser?.role !== 'admin') {
      router.push('/');
    }
  }, [authLoading, appUser, router]);

  useEffect(() => {
    if (appUser?.role !== 'admin') return;

    const controller = new AbortController();

    // Clear stale data immediately so charts show loading state
    setLoading(true);
    setDailyUsage([]);
    setDailyCost([]);
    setDailyWaste([]);
    setBaselineDeviation([]);
    setAlerts([]);
    setMeters([]);
    setOccupiedMetered([]);
    setStats(null);

    fetch(`/api/admin/utilities?days=${timeRange}`, { signal: controller.signal })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data) return;
        setStats(data.stats || null);
        setDailyUsage(data.dailyUsage || []);
        setDailyCost(data.dailyCost || []);
        setDailyWaste(data.dailyWaste || []);
        setBaselineDeviation(data.baselineDeviation || []);
        setAlerts(data.alerts || []);
        setMeters(data.meters || []);
        setOccupiedMetered(data.occupiedMetered || []);
      })
      .catch(err => {
        if (err.name !== 'AbortError') console.error('Error fetching utilities data:', err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [appUser, timeRange]);

  const handleMeterClick = (meterStr: string) => {
    const m = meters.find(m => m.meter === meterStr);
    if (m) {
      setSelectedMeter(m);
      setActiveTab('detail');
    }
  };

  const handleBack = () => {
    setSelectedMeter(null);
    setActiveTab('overview');
  };

  if (authLoading || appUser?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Utilities</h1>
          <p className="text-sm text-slate-400 mt-1">BPU water meter usage tracking &amp; leak detection</p>
        </div>
        <div className="flex items-center gap-1.5">
          {TIME_RANGES.map(t => (
            <button
              key={t.value}
              onClick={() => setTimeRange(t.value)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                timeRange === t.value
                  ? 'bg-accent/15 text-accent'
                  : 'text-slate-500 hover:bg-white/10 hover:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="glass-stat group">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                <circle cx="12" cy="12" r="10" strokeWidth={1.5} />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats?.totalMeters ?? '—'}</p>
              <p className="text-xs text-slate-400">Total Meters</p>
            </div>
          </div>
        </div>
        <div className="glass-stat group">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats?.activeMeters ?? '—'}</p>
              <p className="text-xs text-slate-400">Active Meters</p>
            </div>
          </div>
        </div>
        <div className="glass-stat group">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a8 8 0 008-8c0-3.5-2.5-6.5-4-8l-4 5-4-5c-1.5 1.5-4 4.5-4 8a8 8 0 008 8z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats?.totalCcf?.toFixed(1) ?? '—'}</p>
              <p className="text-xs text-slate-400">Total CCF</p>
            </div>
          </div>
        </div>
        <div className="glass-stat group">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${(stats?.alertCount ?? 0) > 0 ? 'bg-rose-500/10' : 'bg-emerald-500/10'}`}>
              {(stats?.alertCount ?? 0) > 0 ? (
                <svg className="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>
            <div>
              <p className={`text-2xl font-bold ${(stats?.alertCount ?? 0) > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {stats?.alertCount ?? '—'}
              </p>
              <p className="text-xs text-slate-400">Leak Alerts</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      {activeTab !== 'detail' && (
        <div className="flex items-center gap-1 border-b border-white/10 pb-0">
          {(['overview', 'alerts'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${
                activeTab === tab
                  ? 'border-accent text-accent'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab === 'overview' ? 'Overview' : `Alerts${(stats?.alertCount ?? 0) > 0 ? ` (${stats?.alertCount})` : ''}`}
            </button>
          ))}
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <BPUUsageChart
            dailyUsage={dailyCost}
            timeRange={timeRange}
            loading={loading}
          />

          <BPUWasteChart
            dailyWaste={dailyWaste}
            timeRange={timeRange}
            loading={loading}
          />

          <BPUBaselineChart
            baselineDeviation={baselineDeviation}
            timeRange={timeRange}
            loading={loading}
          />

          <BPUOccupiedUnits
            data={occupiedMetered}
            loading={loading}
            timeRange={timeRange}
          />

          {/* Meter summary table */}
          <div className="glass-card">
            <div className="p-4 border-b border-white/10">
              <h3 className="text-lg font-semibold text-white">Meters</h3>
            </div>
            <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-800/95 backdrop-blur">
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Location</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Property</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">% Active</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Total CCF</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Avg/Hr</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Max/Hr</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Night Avg</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {meters.map((m, i) => (
                    <tr
                      key={m.meter}
                      className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                      onClick={() => handleMeterClick(m.meter)}
                    >
                      <td className="px-4 py-3 text-slate-200 text-xs font-medium">{m.label}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs truncate max-w-[160px]">{m.name}</td>
                      <td className={`px-4 py-3 text-right tabular-nums text-xs ${m.pctActive > 50 ? 'text-cyan-400' : m.pctActive > 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                        {m.pctActive.toFixed(0)}%
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums text-xs ${m.totalCcf > 0 ? 'text-slate-200' : 'text-slate-600'}`}>
                        {m.totalCcf.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-400 text-xs">{m.avgHourly.toFixed(4)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-400 text-xs">{m.maxHourly.toFixed(4)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums text-xs ${m.overnightAvg > 0.01 ? 'text-rose-400' : m.overnightAvg > 0 ? 'text-amber-400' : 'text-slate-600'}`}>
                        {m.overnightAvg.toFixed(4)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-400 text-xs">{m.dayCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'alerts' && (
        <BPULeakAlerts alerts={alerts} onMeterClick={handleMeterClick} timeRange={timeRange} />
      )}

      {activeTab === 'detail' && selectedMeter && (
        <BPUMeterDetail
          meter={selectedMeter}
          alerts={alerts}
          onBack={handleBack}
        />
      )}
    </div>
  );
}
