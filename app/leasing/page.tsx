import Dashboard from '../../components/Dashboard';
import SpeedToLeadDashboard from '../../components/SpeedToLeadDashboard';

export const metadata = {
  title: 'Leasing — Appreciate Dashboard',
  description: 'Leasing funnel analytics and speed-to-lead response tracking',
};

/**
 * /leasing — the Leasing landing page (Overview).
 *
 * Combines the two things the team checks most: the inquiry-funnel charts
 * (formerly the standalone /dashboard) and the Speed to Lead response tracker.
 * Occupancy, Renewals, and the listing-ops tabs (Coverage/Publishing/Sources)
 * are reached from the Leasing group in the sidebar.
 */
export default function LeasingPage() {
  return (
    <div>
      {/* Inquiry funnel + source/property charts */}
      <Dashboard />

      {/* Speed to Lead */}
      <section className="px-6 md:px-8 pb-8">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-sm font-semibold text-slate-100 mb-3">Speed to Lead</h2>
          <SpeedToLeadDashboard embedded />
        </div>
      </section>
    </div>
  );
}
