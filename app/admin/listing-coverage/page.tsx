import { redirect } from 'next/navigation';

// Consolidated into the unified Leasing hub. Old bookmarks keep working.
export default function ListingCoveragePage() {
  redirect('/leasing?tab=coverage');
}
