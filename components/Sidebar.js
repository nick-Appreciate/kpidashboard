'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Sidebar — primary site navigation.
 *
 * Intent-based domains (Leasing, Collections, Maintenance, Financials, Admin),
 * each expandable to its sub-views. The domain containing the current route is
 * auto-expanded; any domain can be expanded manually via its chevron to jump
 * straight to a sub-view. Admin-only items/domains are hidden for non-admins.
 *
 * Behavior preserved from the previous version: hover to expand the rail,
 * glass chrome, active-route highlight, user card + logout, Alerts pulse badge.
 */

// --- icons (kept inline to avoid a new dependency) -------------------------
const Icon = {
  leasing: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
  ),
  collections: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
  ),
  maintenance: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.42 15.17l-5.1-5.1a1.5 1.5 0 010-2.12l.71-.71a1.5 1.5 0 012.12 0l3.57 3.57 7.07-7.07a1.5 1.5 0 012.12 0l.71.71a1.5 1.5 0 010 2.12l-8.49 8.49a1.5 1.5 0 01-2.12 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 21h18" /></svg>
  ),
  financials: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V9m4 8V5m4 12v-4M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
  ),
  admin: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
  ),
};

const Chevron = ({ open }) => (
  <svg className={`w-3 h-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

// --- navigation model ------------------------------------------------------
// Each domain expands to sub-items. `admin: true` hides the item (or whole
// domain) from non-admins. Order reflects daily-use frequency.
const DOMAINS = [
  {
    // Single unified link — every leasing view (Overview, Speed to Lead,
    // Occupancy, Renewals, Coverage, Publishing, Sources) lives in the tab
    // bar on the /leasing hub, not as separate sidebar sub-items.
    key: 'leasing', label: 'Leasing', icon: Icon.leasing,
    items: [{ name: 'Leasing', href: '/leasing' }],
  },
  {
    key: 'collections', label: 'Collections', icon: Icon.collections,
    items: [{ name: 'Collections', href: '/collections' }],
  },
  {
    key: 'maintenance', label: 'Maintenance', icon: Icon.maintenance,
    items: [
      { name: 'Rehabs',      href: '/rehabs' },
      { name: 'Inspections', href: '/inspections' },
      { name: 'Work Orders', href: '/work-orders' },
      { name: 'Time Cards',  href: '/admin/time-cards' },
      { name: 'Utilities',   href: '/admin/utilities' },
    ],
  },
  {
    key: 'financials', label: 'Financials', icon: Icon.financials,
    items: [
      { name: 'Bookkeeping', href: '/bookkeeping' },
      { name: 'Overview',    href: '/financials',        admin: true },  // portfolio cash flow / net income
      { name: 'Cash',        href: '/admin/cash',        admin: true },
      { name: 'Deposits',    href: '/admin/simmons',     admin: true },
      { name: 'Duplicates',  href: '/admin/duplicates',  admin: true },
    ],
  },
  {
    key: 'admin', label: 'Admin', icon: Icon.admin, admin: true,
    items: [
      { name: 'Properties', href: '/admin/properties' },
      { name: 'Users',      href: '/admin/users' },
      { name: 'Alerts',     href: '/admin/alerts', badge: 'alerts' },
    ],
  },
];

// Path portion of an href (drop ?query) for active matching.
const pathOf = (href) => href.split('?')[0];

export default function Sidebar({ user, onLogout, alertCount = 0 }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [openKeys, setOpenKeys] = useState({});
  const pathname = usePathname();
  const hoverTimeoutRef = useRef(null);

  const isAdmin = user?.role === 'admin';

  // Resolve each domain to only the items this user may see, and drop domains
  // that end up empty (e.g. the admin-only Admin domain for a normal user).
  const domains = DOMAINS
    .filter((d) => !d.admin || isAdmin)
    .map((d) => ({ ...d, items: d.items.filter((i) => !i.admin || isAdmin) }))
    .filter((d) => d.items.length > 0);

  const domainLandingHref = (d) => d.items[0].href;
  const isItemActive = (href) => pathname === pathOf(href);
  const activeDomainKey = domains.find((d) => d.items.some((i) => isItemActive(i.href)))?.key;

  // Always keep the active domain expanded; other domains stay as the user left them.
  useEffect(() => {
    if (activeDomainKey) setOpenKeys((prev) => ({ ...prev, [activeDomainKey]: true }));
  }, [activeDomainKey]);

  const toggle = (key) => setOpenKeys((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <aside
      className={`fixed left-0 top-0 h-full bg-surface-raised/80 backdrop-blur-[16px] border-r border-[var(--glass-border)] text-white z-50 transition-all duration-300 ease-in-out ${
        isExpanded ? 'w-40' : 'w-10 overflow-hidden'
      }`}
      style={{ width: isExpanded ? '10rem' : '2.5rem' }}
      onMouseEnter={() => {
        hoverTimeoutRef.current = setTimeout(() => setIsExpanded(true), 300);
      }}
      onMouseLeave={() => {
        clearTimeout(hoverTimeoutRef.current);
        setIsExpanded(false);
      }}
    >
      {/* Logo */}
      <div className="h-10 flex items-center border-b border-[var(--glass-border)] pl-2.5 pr-1.5 gap-1 overflow-hidden">
        <div className="flex-shrink-0 flex items-center justify-center w-5" style={{ minWidth: '1.25rem' }}>
          <svg className="w-4 h-5" viewBox="0 0 163 200" fill="none">
            <path fillRule="evenodd" clipRule="evenodd" d="M81.4 0L0 38.8V161.2L81.4 200l81.4-38.8V38.8L81.4 0zm-.008 25.3L25.99 51.1v96l27.6-13v-71l27.8-12.1 27.8 12.1v71l27.6 13v-96L81.392 25.3z" fill="currentColor" />
          </svg>
        </div>
        <span className={`text-sm font-semibold text-slate-200 whitespace-nowrap transition-opacity duration-150 ${isExpanded ? 'opacity-100 delay-200' : 'opacity-0 delay-0'}`}>
          Appreciate
        </span>
      </div>

      {/* Navigation */}
      <nav className="mt-2 px-1">
        {domains.map((d) => {
          const open = isExpanded && !!openKeys[d.key];
          const single = d.items.length === 1;
          const domainActive = d.key === activeDomainKey;
          const showAlertDot = d.items.some((i) => i.badge === 'alerts') && alertCount > 0;

          return (
            <div key={d.key} className="mb-0.5">
              {/* Domain header. Single-item domains link straight to the page;
                  multi-item domains link to the landing and expose a chevron. */}
              <div className="relative flex items-center">
                <Link
                  href={domainLandingHref(d)}
                  className={`flex-1 flex items-center gap-2 px-1.5 py-1.5 rounded-md transition-all duration-200 ${
                    domainActive ? 'text-accent-light' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                >
                  <div className="flex-shrink-0 relative">
                    {d.icon}
                    {showAlertDot && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-rose-500 rounded-full animate-pulse" />
                    )}
                  </div>
                  <span className={`text-xs font-semibold whitespace-nowrap transition-opacity duration-150 ${isExpanded ? 'opacity-100 delay-200' : 'opacity-0 delay-0'}`}>
                    {d.label}
                  </span>
                </Link>
                {isExpanded && !single && (
                  <button
                    aria-label={`Toggle ${d.label}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(d.key); }}
                    className="px-1.5 py-1.5 text-slate-500 hover:text-slate-200"
                  >
                    <Chevron open={open} />
                  </button>
                )}
              </div>

              {/* Sub-items */}
              {!single && (
                <div className={`overflow-hidden transition-all duration-200 ${open ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                  {d.items.map((item) => {
                    const active = isItemActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center justify-between pl-8 pr-2 py-1 rounded-md mb-0.5 text-xs font-medium transition-all duration-150 ${
                          active
                            ? 'bg-accent/15 text-accent-light border-l-2 border-accent'
                            : 'text-slate-500 hover:bg-white/5 hover:text-slate-200'
                        }`}
                      >
                        <span className="whitespace-nowrap">{item.name}</span>
                        {item.badge === 'alerts' && alertCount > 0 && (
                          <span className="ml-1 min-w-4 h-4 px-1 flex items-center justify-center text-[9px] font-semibold bg-rose-500/90 text-white rounded-full">
                            {alertCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom section — user info and logout */}
      <div className="absolute bottom-0 left-0 right-0 p-2 border-t border-[var(--glass-border)]">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-6 h-6 bg-accent/20 rounded-full flex items-center justify-center flex-shrink-0" style={{ minWidth: '1.5rem' }}>
            <span className="text-accent text-[10px] font-medium">
              {user?.name?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || '?'}
            </span>
          </div>
          <div className={`transition-opacity duration-150 overflow-hidden ${isExpanded ? 'opacity-100 delay-200' : 'opacity-0 delay-0'}`}>
            <p className="text-[11px] text-slate-200 font-medium whitespace-nowrap truncate">{user?.name || 'User'}</p>
            <p className="text-[9px] text-slate-500 whitespace-nowrap truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (onLogout) onLogout(); }}
          className={`w-full flex items-center gap-1.5 px-1.5 py-1 text-[11px] text-slate-500 hover:text-slate-200 hover:bg-white/5 rounded-md transition-all duration-200 ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span className="whitespace-nowrap">Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
