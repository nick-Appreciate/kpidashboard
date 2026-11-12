'use client';

import { useRouter } from 'next/navigation';
import InquiryModal from '../../../components/public/InquiryModal';
import { getListingPath, type Locale } from '../../../lib/i18n';

interface Props {
  token: string;
  locale: Locale;
  listingId: string;
  title: string;
  address: string;
  photo: string | null;
  prefill: { first: string | null; last: string | null; phone: string | null; email: string | null };
}

/** Full-screen tour picker over the listing photo; closing goes to the listing. */
export default function TourLinkClient({ token, locale, listingId, title, address, photo, prefill }: Props) {
  const router = useRouter();
  return (
    <main className="min-h-screen bg-[#FAFAF7]">
      <div
        className="fixed inset-0 bg-cover bg-center"
        style={photo ? { backgroundImage: `url(${photo})` } : undefined}
        aria-hidden
      />
      <div className="fixed top-0 inset-x-0 z-[60] px-5 pt-5 text-white drop-shadow">
        <p className="font-[var(--font-fraunces)] text-[20px] leading-tight">{title}</p>
        <p className="text-[12px] opacity-90">{address}</p>
      </div>
      <InquiryModal
        open
        mode="tour"
        locale={locale}
        listingId={listingId}
        tourToken={token}
        prefill={prefill}
        onClose={() => router.push(getListingPath(locale, listingId))}
      />
    </main>
  );
}
