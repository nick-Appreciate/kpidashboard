'use client';

import Link from 'next/link';
import { TENANT_PORTAL_URL } from './sampleListings';

export default function PublicFooter() {
  return (
    <footer className="border-t border-black/5 mt-24 bg-[#FAFAF7]">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
        <div className="col-span-2">
          <p className="font-[var(--font-fraunces)] text-xl text-[#0A0A0A] mb-2">
            Appreciate Property Management
          </p>
          <p className="text-[13px] text-[#0A0A0A]/60 max-w-sm leading-relaxed">
            Property management serving the Kansas City and mid-Missouri rental markets.
            Thoughtful homes, straightforward leases.
          </p>
        </div>
        <div>
          <p className="text-[12px] uppercase tracking-wider text-[#0A0A0A]/50 mb-3">Prospective Tenants</p>
          <ul className="space-y-2 text-[13px] text-[#0A0A0A]/75">
            <li><Link href="/listings" className="hover:text-[#0A0A0A]">Available Rentals</Link></li>
            <li><a href={TENANT_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="hover:text-[#0A0A0A]">Apply Online ↗</a></li>
          </ul>
        </div>
        <div>
          <p className="text-[12px] uppercase tracking-wider text-[#0A0A0A]/50 mb-3">Current Tenants</p>
          <ul className="space-y-2 text-[13px] text-[#0A0A0A]/75">
            <li><a href={TENANT_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="hover:text-[#0A0A0A]">Tenant Portal ↗</a></li>
            <li><a href={TENANT_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="hover:text-[#0A0A0A]">Pay Rent ↗</a></li>
            <li><a href={TENANT_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="hover:text-[#0A0A0A]">Maintenance Request ↗</a></li>
          </ul>
        </div>
      </div>
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10 py-5 border-t border-black/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-[12px] text-[#0A0A0A]/50">
        <p>© {new Date().getFullYear()} Appreciate, Inc. All rights reserved.</p>
        <p>Kansas City · Columbia · Independence</p>
      </div>
    </footer>
  );
}
