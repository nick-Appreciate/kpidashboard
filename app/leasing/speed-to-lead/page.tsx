import { Suspense } from 'react';
import LeadTimelineDashboard from '../../../components/LeadTimelineDashboard';

export const metadata = {
  title: 'Speed to Lead — Appreciate Dashboard',
  description: 'Every lead and every touch point, human or automated',
};

export default function SpeedToLeadPage() {
  return (
    <Suspense fallback={null}>
      <LeadTimelineDashboard />
    </Suspense>
  );
}
