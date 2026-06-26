import { Suspense } from 'react';
import LeasingDashboard from '../../../components/LeasingDashboard';

export const metadata = {
  title: 'Leasing — Appreciate Dashboard',
};

export default function LeasingPage() {
  return (
    <Suspense fallback={null}>
      <LeasingDashboard />
    </Suspense>
  );
}
