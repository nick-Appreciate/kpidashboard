import { redirect } from 'next/navigation';

// Permanent redirect: /admin/mercury was renamed to /admin/cash.
// Keeps any old bookmarks / external links working.
export default function MercuryRedirect() {
  redirect('/admin/cash');
}
