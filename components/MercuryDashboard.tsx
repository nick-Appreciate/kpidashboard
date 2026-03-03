'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import MercuryBalanceChart from './MercuryBalanceChart';

export default function MercuryDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<any>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Admin guard
  useEffect(() => {
    if (!authLoading && appUser?.role !== 'admin') {
      router.push('/');
    }
  }, [authLoading, appUser, router]);

  const triggerSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const response = await fetch('/api/admin/mercury/sync', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Sync failed');
      setLastSync(data);
    } catch (error) {
      console.error('Mercury sync error:', error);
      setSyncError(error instanceof Error ? error.message : 'Unknown error');
    }
    setSyncing(false);
  };

  if (authLoading || appUser?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="max-w-full mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">Mercury Banking</h1>
              <p className="text-sm text-slate-500">Daily account balance tracking</p>
            </div>
            <button
              onClick={triggerSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              <svg
                className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
          {lastSync && (
            <p className="text-xs text-green-600 mt-2">
              Synced {lastSync.accountsLogged} account{lastSync.accountsLogged !== 1 ? 's' : ''} for {lastSync.snapshotDate}
              {lastSync.accounts && lastSync.accounts.length > 0 && (
                <span className="text-slate-400 ml-2">
                  ({lastSync.accounts.map((a: any) =>
                    `${a.name}: $${Number(a.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                  ).join(', ')})
                </span>
              )}
            </p>
          )}
          {syncError && (
            <p className="text-xs text-red-600 mt-2">Sync error: {syncError}</p>
          )}
        </div>

        {/* Balance Chart */}
        <MercuryBalanceChart />
      </div>
    </div>
  );
}
