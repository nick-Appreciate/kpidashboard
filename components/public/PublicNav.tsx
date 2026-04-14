'use client';

import Link from 'next/link';
import { useState } from 'react';
import { TENANT_PORTAL_URL } from './sampleListings';

export default function PublicNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-[#FAFAF7]/85 backdrop-blur-md border-b border-black/5">
      <nav className="max-w-[1280px] mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
        <Link
          href="/preview/landing"
          className="font-[var(--font-fraunces)] text-[20px] font-medium tracking-tight text-[#0A0A0A] leading-none"
        >
          Appreciate Property Management
        </Link>

        <div className="hidden md:flex items-center gap-8 text-[14px] text-[#0A0A0A]/75">
          <Link href="/preview/landing" className="hover:text-[#0A0A0A] transition-colors">
            Home
          </Link>
          <Link href="/preview/listings" className="hover:text-[#0A0A0A] transition-colors">
            Listings
          </Link>
        </div>

        <a
          href={TENANT_PORTAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden md:inline-flex items-center justify-center px-4 py-2 text-[13px] font-medium rounded-full bg-[#0A0A0A] text-white hover:bg-[#06b6d4] transition-colors"
        >
          Tenant Portal
        </a>

        <button
          className="md:hidden w-10 h-10 flex flex-col items-center justify-center gap-1.5"
          onClick={() => setOpen(v => !v)}
          aria-label="Toggle menu"
        >
          <span className={`block w-5 h-[1.5px] bg-[#0A0A0A] transition-transform ${open ? 'translate-y-[6px] rotate-45' : ''}`} />
          <span className={`block w-5 h-[1.5px] bg-[#0A0A0A] transition-opacity ${open ? 'opacity-0' : ''}`} />
          <span className={`block w-5 h-[1.5px] bg-[#0A0A0A] transition-transform ${open ? '-translate-y-[6px] -rotate-45' : ''}`} />
        </button>
      </nav>

      {open && (
        <div className="md:hidden border-t border-black/5 px-6 py-5 flex flex-col gap-4 bg-[#FAFAF7]">
          <Link href="/preview/landing" className="text-[15px] text-[#0A0A0A]" onClick={() => setOpen(false)}>
            Home
          </Link>
          <Link href="/preview/listings" className="text-[15px] text-[#0A0A0A]" onClick={() => setOpen(false)}>
            Listings
          </Link>
          <a
            href={TENANT_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-medium rounded-full bg-[#0A0A0A] text-white mt-2 w-fit"
          >
            Tenant Portal ↗
          </a>
        </div>
      )}
    </header>
  );
}
