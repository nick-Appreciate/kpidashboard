import Link from 'next/link';
import Image from 'next/image';
import PublicNav from '../../../components/public/PublicNav';
import PublicFooter from '../../../components/public/PublicFooter';
import ListingCard from '../../../components/public/ListingCard';
import { SAMPLE_LISTINGS, TENANT_PORTAL_URL } from '../../../components/public/sampleListings';

export const metadata = {
  title: 'Appreciate — Rental Homes in Kansas City & Columbia',
  description:
    'Quality rental homes from a family-owned property manager in Kansas City, KS and Columbia, MO.',
};

export default function LandingPage() {
  const featured = SAMPLE_LISTINGS.slice(0, 3);
  const heroPhoto = SAMPLE_LISTINGS[1]?.photos[0];

  return (
    <main className="min-h-screen bg-[#FAFAF7] text-[#0A0A0A]">
      <PublicNav />

      {/* HERO */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-20 pb-24 md:pt-28 md:pb-32">
        <div className="grid md:grid-cols-12 gap-10 items-center">
          <div className="md:col-span-6">
            <p className="text-[12px] uppercase tracking-[0.15em] text-[#0A0A0A]/50 mb-5">
              Kansas City · Columbia · Independence
            </p>
            <h1 className="font-[var(--font-fraunces)] text-[48px] md:text-[68px] leading-[0.95] tracking-[-0.02em] text-[#0A0A0A] mb-7">
              A home you'll
              <br />
              <em className="italic text-[#06b6d4]">appreciate</em>.
            </h1>
            <p className="text-[17px] leading-[1.55] text-[#0A0A0A]/70 max-w-[480px] mb-9">
              Thoughtfully managed rentals from a family-owned team. Browse our current
              availability, apply online, and move in with confidence.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/preview/listings"
                className="inline-flex items-center justify-center px-6 py-3.5 rounded-full bg-[#0A0A0A] text-white text-[14px] font-medium hover:bg-[#06b6d4] transition-colors"
              >
                View Available Rentals
              </Link>
              <a
                href={TENANT_PORTAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-6 py-3.5 rounded-full border border-[#0A0A0A]/15 text-[#0A0A0A] text-[14px] font-medium hover:bg-[#0A0A0A] hover:text-white transition-colors"
              >
                Tenant Portal ↗
              </a>
            </div>
          </div>
          <div className="md:col-span-6 md:pl-8">
            <div className="relative aspect-[4/5] rounded-3xl overflow-hidden bg-[#F1F0EC]">
              {heroPhoto && (
                <Image
                  src={heroPhoto}
                  alt="Featured Appreciate property"
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-cover"
                  unoptimized
                  priority
                />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* FEATURED LISTINGS STRIP */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 pb-20">
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="text-[12px] uppercase tracking-[0.15em] text-[#0A0A0A]/50 mb-2">
              Available Now
            </p>
            <h2 className="font-[var(--font-fraunces)] text-[32px] md:text-[40px] leading-[1.05] tracking-[-0.01em] text-[#0A0A0A]">
              Featured rentals
            </h2>
          </div>
          <Link
            href="/preview/listings"
            className="hidden md:inline-flex items-center text-[14px] text-[#0A0A0A]/75 hover:text-[#0A0A0A]"
          >
            View all {SAMPLE_LISTINGS.length} listings →
          </Link>
        </div>
        <div className="grid md:grid-cols-3 gap-5 md:gap-6">
          {featured.map(l => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      </section>

      {/* VALUE PROPS */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 py-20 border-t border-black/5">
        <div className="grid md:grid-cols-3 gap-10 md:gap-12">
          {[
            {
              eyebrow: 'Local',
              title: 'Family-owned, locally operated',
              body:
                'We live and work in the same neighborhoods as our rentals. Decisions are made quickly by people you can actually talk to.',
            },
            {
              eyebrow: 'Responsive',
              title: 'Maintenance that moves',
              body:
                'Submit a request through your tenant portal and we route it straight to our vetted trades. Most tickets are resolved within 48 hours.',
            },
            {
              eyebrow: 'Transparent',
              title: 'Straightforward leases',
              body:
                'No surprise fees, no junk charges. Security deposits, application fees, and rent are disclosed on every listing.',
            },
          ].map(card => (
            <div key={card.title}>
              <p className="text-[11px] uppercase tracking-[0.15em] text-[#06b6d4] mb-4">
                {card.eyebrow}
              </p>
              <h3 className="font-[var(--font-fraunces)] text-[24px] leading-[1.15] text-[#0A0A0A] mb-3">
                {card.title}
              </h3>
              <p className="text-[15px] leading-[1.6] text-[#0A0A0A]/70">{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA STRIP */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 py-20">
        <div className="bg-[#0A0A0A] rounded-3xl px-8 md:px-16 py-16 md:py-20 text-center">
          <h2 className="font-[var(--font-fraunces)] text-[36px] md:text-[52px] leading-[1.05] tracking-[-0.01em] text-white mb-5">
            Found a place you like?
          </h2>
          <p className="text-[16px] text-white/70 max-w-[460px] mx-auto mb-8">
            Browse every available rental, filter by neighborhood and budget, then apply in
            minutes.
          </p>
          <Link
            href="/preview/listings"
            className="inline-flex items-center justify-center px-7 py-4 rounded-full bg-[#06b6d4] text-[#0A0A0A] text-[14px] font-semibold hover:bg-white transition-colors"
          >
            See all listings
          </Link>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
