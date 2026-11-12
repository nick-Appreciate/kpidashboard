import { Suspense } from 'react';
import LeadTimelineDashboard from '../../../components/LeadTimelineDashboard';

export const metadata = {
  title: 'Leasing Automations — Appreciate Dashboard',
  description: 'Every lead and every touch point, human or automated',
};

export default function LeasingAutomationsPage() {
  return (
    <Suspense fallback={null}>
      <LeadTimelineDashboard />
    </Suspense>
  );
}
