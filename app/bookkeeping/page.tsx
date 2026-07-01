import { Suspense } from 'react';
import AdminOnly from '../../components/AdminOnly';
import BookkeepingDashboard from '../../components/BookkeepingDashboard';

export const metadata = {
  title: 'Bookkeeping - Appreciate Dashboard',
  description: 'Unified bookkeeping: Brex expenses, billing invoices, and duplicate detection',
};

export default function BookkeepingPage() {
  return (
    <AdminOnly>
      <Suspense>
        <BookkeepingDashboard />
      </Suspense>
    </AdminOnly>
  );
}
