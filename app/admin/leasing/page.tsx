import { redirect } from 'next/navigation';

// Merged into the unified Leasing hub at /leasing. Old bookmarks keep working.
export default function AdminLeasingPage() {
  redirect('/leasing?tab=coverage');
}
