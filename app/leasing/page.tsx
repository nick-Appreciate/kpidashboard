import Dashboard from '../../components/Dashboard';

export const metadata = {
  title: 'Leasing Overview — Appreciate Dashboard',
  description: 'Leasing inquiry-funnel analytics',
};

// Leasing → Overview: the inquiry-funnel charts. Sibling views (Speed to Lead,
// Renewals, Coverage, Publishing, Sources) are their own pages under the
// Leasing section in the sidebar.
export default function LeasingOverviewPage() {
  return <Dashboard />;
}
