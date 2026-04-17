import { redirect } from 'next/navigation';

// `/es` sends visitors to the Spanish listings grid, parallel to the way
// `/` redirects to `/listings` via middleware. Kept as a page-level redirect
// rather than a middleware rule so it works even if someone bookmarks the
// bare /es URL from a flyer.
export default function EsRootPage() {
  redirect('/es/listings');
}
