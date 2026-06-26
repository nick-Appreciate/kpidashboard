import { redirect } from 'next/navigation';

// Consolidated into /admin/leasing. Old bookmarks keep working.
export default function ListingCoveragePage() {
  redirect('/admin/leasing?tab=coverage');
}
