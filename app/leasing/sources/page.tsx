import { Suspense } from 'react';
import SourcePerformanceDashboard from '../../../components/SourcePerformanceDashboard';

export const metadata = { title: 'Source Performance — Appreciate Dashboard' };

export default function SourcesPage() {
  return (
    <Suspense fallback={null}>
      <SourcePerformanceDashboard />
    </Suspense>
  );
}
