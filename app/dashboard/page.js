import { redirect } from 'next/navigation';

// The leasing funnel now lives on the unified Leasing landing page (/leasing),
// alongside Speed to Lead. Keep this route as a redirect so old links and
// bookmarks keep working.
export default function DashboardPage() {
  redirect('/leasing');
}
