'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from './Logo';

export default function Sidebar({ user, onLogout }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const pathname = usePathname();
  const hoverTimeoutRef = useRef(null);
  const [openSections, setOpenSections] = useState(new Set());

  const isAdmin = user?.role === 'admin';

  const navSections = [
    {
      label: 'Operations',
      items: [
        {
          name: 'Leasing',
          href: '/',
          icon: (
            <svg className="w-6 h-6" style={{ width: '1.5rem', height: '1.5rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          )
        },
        {
          name: 'Occupancy',
          href: '/occupancy',
          icon: (
            <svg className="w-6 h-6" style={{ width: '1.5rem', height: '1.5rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          )
        },
        {
          name: 'Collections',
          href: '/collections',
          icon: (
            <svg className="w-6 h-6" style={{ width: '1.5rem', height: '1.5rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )
        },
        {
          name: 'Billing',
          href: '/billing',
          icon: (
            <svg className="w-6 h-6" style={{ width: '1.5rem', height: '1.5rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
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
            <svg className="w-6 h-6" style={{ width: '1.5rem', height: '1.5rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          )
        },
        {
          name: 'Inspections',
          href: '/inspections',
          icon: (
            <svg className="w-6 h-6" style={{ width: '1.5rem', height: '1.5rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          )
        }
      ]
    },
    ...(isAdmin ? [{
      label: 'Admin',
      items: [
        {
          name: 'User Management',
          href: '/admin/users',
          icon: (
            <svg className="w-6 h-6" style={{ width: '1.5rem', height: '1.5rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          )
        },
        {
          name: 'Brex Expenses',
          href: '/admin/brex',
          icon: (
            <svg className="w-6 h-6" style={{ width: '1.5rem', height: '1.5rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          )
        }
      ]
    }] : [])
  ];

  const toggleSection = (label) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  return (
    <aside
      className="fixed left-0 top-0 h-full bg-slate-900 text-white z-50 overflow-hidden"
      style={{ width: isExpanded ? '16rem' : '4rem', transition: 'width 300ms ease-in-out' }}
      onMouseEnter={() => {
        hoverTimeoutRef.current = setTimeout(() => setIsExpanded(true), 300);
      }}
      onMouseLeave={() => {
        clearTimeout(hoverTimeoutRef.current);
        setIsExpanded(false);
        setOpenSections(new Set());
      }}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-center border-b border-slate-700 p-2">
        <Logo variant="white" className="h-12 w-auto" />
      </div>

      {/* Navigation */}
      <nav className="mt-4 px-2">
        {navSections.map((section) => {
          const open = openSections.has(section.label);
          return (
            <div key={section.label} className="mb-2">
              {/* Section header — clickable when expanded */}
              <button
                onClick={() => isExpanded && toggleSection(section.label)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 ${
                  isExpanded
                    ? 'text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer'
                    : 'cursor-default'
                }`}
              >
                {/* Section icon (first item's icon) when collapsed */}
                {!isExpanded && (
                  <div className="flex-shrink-0 text-slate-500">
                    {section.items[0].icon}
                  </div>
                )}
                {isExpanded && (
                  <>
                    <svg
                      className={`w-4 h-4 flex-shrink-0 text-slate-500 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
                      {section.label}
                    </span>
                  </>
                )}
              </button>

              {/* Section items — only visible when sidebar expanded AND section open */}
              <div className={`overflow-hidden transition-all duration-200 ${
                isExpanded && open ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
              }`}>
                {section.items.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition-all duration-200 group ${
                        isExpanded ? 'pl-7' : ''
                      } ${
                        isActive
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <div className="flex-shrink-0">
                        {item.icon}
                      </div>
                      <span className={`font-medium whitespace-nowrap transition-opacity duration-200 ${
                        isExpanded ? 'opacity-100' : 'opacity-0'
                      }`}>
                        {item.name}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Bottom section - User info and logout */}
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-700">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center flex-shrink-0" style={{ width: '2rem', height: '2rem', minWidth: '2rem' }}>
            <span className="text-white text-sm font-medium">
              {user?.name?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || '?'}
            </span>
          </div>
          <div className={`transition-opacity duration-200 ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>
            <p className="text-sm text-white font-medium whitespace-nowrap">{user?.name || 'User'}</p>
            <p className="text-xs text-slate-400 whitespace-nowrap">{user?.email}</p>
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
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span className="whitespace-nowrap">Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
