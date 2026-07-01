'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';

/**
 * Gate a page to admins only. Mirrors the inline guard used by the admin
 * dashboards (e.g. MercuryDashboard): non-admins are redirected home and the
 * children never mount, so their data fetches don't run either.
 */
export default function AdminOnly({ children }) {
  const { appUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && appUser?.role !== 'admin') router.replace('/');
  }, [loading, appUser, router]);

  if (loading || appUser?.role !== 'admin') return null;
  return children;
}
