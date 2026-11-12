/**
 * /t/<token> — personal tour link from our lead texts.
 *
 * Opens straight to live tour times for the listing (the property manager's
 * AppFolio calendar). The prospect's guest card and contact info ride on the
 * token, so booking is two taps: pick a time → Confirm.
 */

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import TourLinkClient from './TourLinkClient';
import { getListingPath, type Locale } from '../../../lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Schedule a tour · Appreciate', robots: { index: false } };

const LINK_TTL_DAYS = 60;

export default async function TourLinkPage({ params }: { params: { token: string } }) {
  const token = String(params.token || '').slice(0, 32);
  if (!/^[A-Za-z0-9]{4,32}$/.test(token)) notFound();

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: link } = await sb.from('tour_links')
    .select('token, listing_id, property_name, first_name, last_name, phone_norm, email, locale, created_at, opened_at')
    .eq('token', token).maybeSingle();
  if (!link) redirect(getListingPath('en'));
  const locale: Locale = link.locale === 'es' ? 'es' : 'en';
  if (Date.now() - new Date(link.created_at).getTime() > LINK_TTL_DAYS * 86_400_000) redirect(getListingPath(locale));

  const { data: listing } = await sb.from('af_listings')
    .select('id, address, city, state, default_photo_url, inactive_since').eq('id', link.listing_id).maybeSingle();
  // Unit got leased since the text went out — send them to everything available.
  if (!listing || listing.inactive_since) redirect(getListingPath(locale));

  if (!link.opened_at) await sb.from('tour_links').update({ opened_at: new Date().toISOString() }).eq('token', token);

  return (
    <TourLinkClient
      token={token}
      locale={locale}
      listingId={listing.id}
      title={link.property_name || listing.address}
      address={[listing.address, listing.city, listing.state].filter(Boolean).join(', ')}
      photo={listing.default_photo_url}
      prefill={{ first: link.first_name, last: link.last_name, phone: link.phone_norm, email: link.email }}
    />
  );
}
