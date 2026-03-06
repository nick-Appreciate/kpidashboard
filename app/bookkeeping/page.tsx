import { Suspense } from 'react';
import BookkeepingDashboard from '../../components/BookkeepingDashboard';

export const metadata = {
  title: 'Bookkeeping - Appreciate Dashboard',
  description: 'Unified bookkeeping: Brex expenses, billing invoices, and duplicate detection',
};

export default function BookkeepingPage() {
  return (
    <Suspense>
      <BookkeepingDashboard />
    </Suspense>
  );
}
