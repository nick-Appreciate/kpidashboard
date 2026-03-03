'use client';

import { useAuth } from '../../../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function UserManagementPage() {
  const { appUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && appUser?.role !== 'admin') {
      router.push('/');
    }
  }, [loading, appUser, router]);

  if (loading || appUser?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">User Management</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-slate-500">User management coming soon.</p>
      </div>
    </div>
  );
}
