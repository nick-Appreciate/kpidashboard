import { Suspense } from 'react';
import LeasingDashboard from '../../components/LeasingDashboard';

export const metadata = {
  title: 'Leasing — Appreciate Dashboard',
  description: 'Unified leasing hub: funnel, speed-to-lead, occupancy, renewals, listing ops',
};

/**
 * /leasing — the unified Leasing hub. One tab bar for every leasing view
 * (Overview, Speed to Lead, Occupancy, Renewals, Coverage, Publishing, Sources).
 */
export default function LeasingPage() {
  return (
    <Suspense fallback={null}>
      <LeasingDashboard />
    </Suspense>
  );
}
