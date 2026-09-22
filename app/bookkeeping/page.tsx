import { Suspense } from 'react';
import AdminOnly from '../../components/AdminOnly';
import BookkeepingDashboard from '../../components/BookkeepingDashboard';

export const metadata = {
  title: 'Bookkeeping - Appreciate Dashboard',
  description: 'Reconcile Brex + Mercury outflows against AppFolio bills',
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
