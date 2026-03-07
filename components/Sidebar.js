'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Sidebar({ user, onLogout }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const pathname = usePathname();
  const hoverTimeoutRef = useRef(null);

  const isAdmin = user?.role === 'admin';

  const navSections = [
    {
      label: 'Operations',
      items: [
        {
          name: 'Leasing',
          href: '/',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          )
        },
        {
          name: 'Occupancy',
          href: '/occupancy',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          )
        },
        {
          name: 'Collections',
          href: '/collections',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )
        },
        {
          name: 'Renewals',
          href: '/renewals',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )
        }
      ]
    },
    {
      label: 'Maintenance',
      items: [
        {
          name: 'Rehabs',
          href: '/rehabs',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          )
        },
        {
          name: 'Inspections',
          href: '/inspections',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          )
        }
      ]
    },
    {
      label: 'Administrative',
      items: [
        {
          name: 'Bookkeeping',
          href: '/bookkeeping',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )
        },
      ]
    },
    ...(isAdmin ? [{
      label: 'Private',
      items: [
        {
          name: 'User Management',
          href: '/admin/users',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          )
        },
        {
          name: 'Mercury Cash',
          href: '/admin/mercury',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )
        },
      ]
    }] : [])
  ];

  return (
    <aside
      className={`fixed left-0 top-0 h-full bg-surface-raised/80 backdrop-blur-[16px] border-r border-[var(--glass-border)] text-white z-50 transition-all duration-300 ease-in-out ${
        isExpanded ? 'w-36' : 'w-10 overflow-hidden'
      }`}
      style={{ width: isExpanded ? '9rem' : '2.5rem' }}
      onMouseEnter={() => {
        hoverTimeoutRef.current = setTimeout(() => setIsExpanded(true), 300);
      }}
      onMouseLeave={() => {
        clearTimeout(hoverTimeoutRef.current);
        setIsExpanded(false);
      }}
    >
      {/* Logo — icon stays fixed, "Appreciate" text fades in beside it */}
      <div className="h-10 flex items-center border-b border-[var(--glass-border)] pl-2.5 pr-1.5 gap-1 overflow-hidden">
        <div className="flex-shrink-0 flex items-center justify-center w-5" style={{ minWidth: '1.25rem' }}>
          <svg className="w-4 h-5" viewBox="0 0 163 200" fill="none">
            <path fillRule="evenodd" clipRule="evenodd" d="M81.4 0L0 38.8V161.2L81.4 200l81.4-38.8V38.8L81.4 0zm-.008 25.3L25.99 51.1v96l27.6-13v-71l27.8-12.1 27.8 12.1v71l27.6 13v-96L81.392 25.3z" fill="currentColor" />
          </svg>
        </div>
        <span className={`text-sm font-semibold text-slate-200 whitespace-nowrap transition-opacity duration-150 ${
          isExpanded ? 'opacity-100 delay-200' : 'opacity-0 delay-0'
        }`}>
          Appreciate
        </span>
      </div>

      {/* Navigation */}
      <nav className="mt-2 px-1">
        {navSections.map((section) => (
          <div key={section.label} className="mb-1">
            {/* Section label — bright teal, visible when expanded */}
            <div className="w-full flex items-center gap-1.5 px-1.5 py-1 relative">
              {/* Section icon when collapsed */}
              <div className={`absolute flex-shrink-0 flex items-center justify-center w-5 transition-opacity duration-150 ${
                isExpanded ? 'opacity-0 pointer-events-none' : 'opacity-100 delay-200'
              }`}>
                <span className="text-slate-500">{section.items[0].icon}</span>
              </div>
              <div className={`transition-opacity duration-150 ${
                isExpanded ? 'opacity-100 delay-200' : 'opacity-0 pointer-events-none'
              }`}>
                <span className="text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap text-accent">
                  {section.label}
                </span>
              </div>
            </div>

            {/* Section items — visible when sidebar is expanded */}
            <div className={`overflow-hidden transition-all duration-200 ${
              isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
            }`}>
              {section.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 px-1.5 py-1.5 rounded-md mb-0.5 transition-all duration-200 group ${
                      isExpanded ? 'pl-5' : ''
                    } ${
                      isActive
                        ? 'bg-accent/15 text-accent-light border-l-2 border-accent'
                        : 'text-slate-500 hover:bg-white/5 hover:text-slate-200 hover:translate-x-0.5'
                    }`}
                  >
                    <div className="flex-shrink-0">
                      {item.icon}
                    </div>
                    <span className={`text-xs font-medium whitespace-nowrap transition-opacity duration-150 ${
                      isExpanded ? 'opacity-100 delay-200' : 'opacity-0 delay-0'
                    }`}>
                      {item.name}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom section - User info and logout */}
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
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onLogout) {
              onLogout();
            }
          }}
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
