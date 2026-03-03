'use client';

import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import MercuryBalanceChart from './MercuryBalanceChart';
import MercuryMonthOverMonthChart from './MercuryMonthOverMonthChart';

export default function MercuryDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const router = useRouter();

  // Admin guard
  useEffect(() => {
    if (!authLoading && appUser?.role !== 'admin') {
      router.push('/');
    }
  }, [authLoading, appUser, router]);

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
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Mercury Banking</h1>
            <p className="text-sm text-slate-500">Daily account balance tracking</p>
          </div>
        </div>

        {/* Balance Chart */}
        <MercuryBalanceChart />

        {/* Month-over-Month Chart */}
        <div className="mt-4">
          <MercuryMonthOverMonthChart />
        </div>
      </div>
    </div>
  );
}
