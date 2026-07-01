import { redirect } from 'next/navigation';

// Leasing views are now individual pages under the Leasing section. Old
// bookmarks land on the Leasing overview.
export default function AdminLeasingPage() {
  redirect('/leasing');
}
