import { Suspense } from 'react';
import SpeedToLeadDashboard from '../../../components/SpeedToLeadDashboard';

export const metadata = {
  title: 'Speed to Lead — Appreciate Dashboard',
  description: 'Warm-contact and automated first-touch response times',
};

export default function SpeedToLeadPage() {
  return (
    <Suspense fallback={null}>
      <SpeedToLeadDashboard />
    </Suspense>
  );
}
