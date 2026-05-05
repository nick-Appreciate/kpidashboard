'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Loader2, DollarSign, Landmark, RefreshCw } from 'lucide-react';
import MercuryBalanceChart from './MercuryBalanceChart';
import MercuryDailyByMonthChart from './MercuryDailyByMonthChart';
import MercuryMonthOverMonthChart from './MercuryMonthOverMonthChart';
import MercuryCashFlowChart from './MercuryCashFlowChart';
import MercuryBankFlowChart from './MercuryBankFlowChart';

export default function MercuryDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const [lastSync, setLastSync] = useState<string | null>(null);

  // Period granularity for charts that aggregate over time. Inherently-daily
  // charts (Balance, Daily-by-Month) ignore this; charts that bucket into
  // months/quarters (Month-over-Month, Cash Flow) use it.
  const [period, setPeriod] = useState<'month' | 'quarter'>('month');

  // Stats from balance chart
  const [totalCash, setTotalCash] = useState<number | null>(null);
  const [accountCount, setAccountCount] = useState<number>(0);

  useEffect(() => {
    if (!authLoading && appUser && appUser.role !== 'admin') {
      router.push('/');
    }
  }, [authLoading, appUser, router]);

  // Fetch latest balance for stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/mercury/balances?days=7');
      if (res.ok) {
        const data = await res.json();
        const balances = data.balances || [];
        if (balances.length > 0) {
          // Get latest date
          const latestDate = balances.reduce((max: string, b: any) =>
            b.snapshot_date > max ? b.snapshot_date : max, '');
          const latestEntries = balances.filter((b: any) => b.snapshot_date === latestDate);
          const totalRow = latestEntries.find((b: any) => b.account_name === 'Total Cash');
          const accounts = latestEntries.filter((b: any) =>
            b.account_name !== 'Total Cash' && Number(b.current_balance) !== 0
          );
          setTotalCash(totalRow ? Number(totalRow.current_balance) : accounts.reduce((s: number, a: any) => s + Number(a.current_balance), 0));
          setAccountCount(accounts.length);
          setLastSync(latestDate);
        }
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  }, []);

  useEffect(() => {
    if (appUser?.role === 'admin') fetchStats();
  }, [appUser, fetchStats]);

  if (authLoading || appUser?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  const formatCurrency = (value: number) =>
    `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Cash</h1>
          <p className="text-sm text-slate-400 mt-1">Mercury bank account balance tracking</p>
        </div>
        <div className="inline-flex rounded-lg border border-[var(--glass-border)] bg-surface-overlay/60 p-0.5 text-xs">
          {[
            { value: 'month',   label: 'Monthly' },
            { value: 'quarter', label: 'Quarterly' },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setPeriod(value as 'month' | 'quarter')}
              className={`px-3 py-1 rounded-md transition-colors ${
                period === value
                  ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="glass-stat group">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">
                {totalCash !== null ? formatCurrency(totalCash) : '—'}
              </p>
              <p className="text-xs text-slate-400">Total Cash</p>
            </div>
          </div>
        </div>
        <div className="glass-stat group">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <Landmark className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{accountCount}</p>
              <p className="text-xs text-slate-400">Active Accounts</p>
            </div>
          </div>
        </div>
        <div className="glass-stat group">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <RefreshCw className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">
                {lastSync ? new Date(lastSync + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
              </p>
              <p className="text-xs text-slate-400">Last Snapshot</p>
            </div>
          </div>
        </div>
      </div>

      {/* Balance Chart */}
      <MercuryBalanceChart />

      {/* Daily Cash by Month */}
      <MercuryDailyByMonthChart />

      {/* Month-over-Month Chart (respects period toggle) */}
      <MercuryMonthOverMonthChart period={period} />

      {/* Cash In / Out / Net — from AppFolio property cash flow */}
      <MercuryCashFlowChart period={period} />

      {/* Banking Cash In / Out / Net — from Mercury transactions + Simmons deposits */}
      <MercuryBankFlowChart period={period} />
    </div>
  );
}
