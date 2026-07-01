import { redirect } from 'next/navigation';

// Occupancy is now a tab in the unified Leasing hub. Keep this route as a
// redirect so old links/bookmarks work.
export default function OccupancyPage() {
  redirect('/leasing?tab=occupancy');
}
