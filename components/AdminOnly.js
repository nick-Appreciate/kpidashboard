'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';

/**
 * Gate a page. Accepts an optional `page` prop that names a page_key in
 * role_page_permissions — the current role must have that page allowed.
 * With no `page`, falls back to the original admins-only behavior.
 *
 * Admins bypass the check (hasPermission returns true for role='admin').
 * Non-authorized users are redirected home and the children never mount,
 * so their data fetches don't run either.
 */
export default function AdminOnly({ page, children }) {
  const { appUser, permissions, loading, hasPermission } = useAuth();
  const router = useRouter();

  const permsReady = appUser?.role === 'admin' || permissions !== null;
  const allowed = page ? hasPermission(page) : appUser?.role === 'admin';

  useEffect(() => {
    if (loading || !permsReady) return;
    if (!allowed) router.replace('/');
  }, [loading, permsReady, allowed, router]);

  if (loading || !permsReady || !allowed) return null;
  return children;
}
