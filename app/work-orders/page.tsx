import { Suspense } from 'react';
import WorkOrdersDashboard from '../../components/WorkOrdersDashboard';

export const metadata = {
  title: 'Work Orders - Appreciate Dashboard',
  description: 'Appfolio work orders with semantic search',
};

export default function WorkOrdersPage() {
  return (
    <Suspense>
      <WorkOrdersDashboard />
    </Suspense>
  );
}
