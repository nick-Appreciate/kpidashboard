import { Suspense } from 'react';
import PublishingDashboard from '../../../components/PublishingDashboard';

export const metadata = { title: 'Publishing — Appreciate Dashboard' };

export default function PublishingPage() {
  return (
    <Suspense fallback={null}>
      <PublishingDashboard />
    </Suspense>
  );
}
