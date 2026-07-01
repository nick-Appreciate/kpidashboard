import { redirect } from 'next/navigation';

// Renewals is now a tab in the unified Leasing hub. Keep this route as a
// redirect so old links/bookmarks work.
export default function RenewalsPage() {
  redirect('/leasing?tab=renewals');
}
