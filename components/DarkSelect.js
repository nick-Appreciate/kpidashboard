'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';

/**
 * Custom dark-themed dropdown to replace native <select> elements.
 * Uses a portal so the menu is never clipped by parent overflow.
 * Supports type-ahead search filtering when the dropdown is open.
 *
 * @param {string}   value       - Currently selected value
 * @param {function} onChange    - Called with the new value (not an event)
 * @param {Array}    options     - Flat or grouped: [{ value, label }, { group, options: [{ value, label }] }]
 * @param {boolean}  disabled    - Disable interaction
 * @param {string}   className   - Additional wrapper classes
 * @param {string}   placeholder - Shown when no value matches
 * @param {boolean}  compact     - Compact sizing
 * @param {boolean}  searchable  - Show search input (auto-enabled when ≥6 options)
 */
export default function DarkSelect({
  value,
  onChange,
  options = [],
  disabled = false,
  className = '',
  placeholder = 'Select...',
  compact = false,
  searchable,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);

  // Count total options to auto-enable search
  const totalOptions = useMemo(() => {
    let count = 0;
    for (const item of options) {
      if (item.group) {
        count += item.options?.length || 0;
      } else {
        count += 1;
      }
    }
    return count;
  }, [options]);

  const showSearch = searchable !== undefined ? searchable : totalOptions >= 6;

  // Filter options by search term
  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase().trim();
    return options
      .map((item) => {
        if (item.group) {
          const filtered = item.options?.filter((o) =>
            o.label.toLowerCase().includes(q)
          );
          if (!filtered || filtered.length === 0) return null;
          return { ...item, options: filtered };
        }
        return item.label.toLowerCase().includes(q) ? item : null;
      })
      .filter(Boolean);
  }, [options, search]);

  // Calculate menu position from trigger button
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 180),
    });
  }, []);

  // Position on open, reposition on resize/scroll.
  // Only close if the trigger element moves significantly (real user scroll),
  // not on minor layout shifts from React re-renders.
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const initialRect = triggerRef.current?.getBoundingClientRect();
    const closeOnScroll = (e) => {
      // Don't close if scrolling inside the dropdown menu itself
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      // Only close if the trigger has actually moved (real scroll, not React re-render)
      if (triggerRef.current && initialRect) {
        const currentRect = triggerRef.current.getBoundingClientRect();
        const drift = Math.abs(currentRect.top - initialRect.top) + Math.abs(currentRect.left - initialRect.left);
        if (drift < 2) {
          // Trigger didn't move — just reposition the menu in case of minor layout shift
          updatePosition();
          return;
        }
      }
      setIsOpen(false);
    };
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, updatePosition]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Focus search input and scroll selected into view when opening
  useEffect(() => {
    if (isOpen) {
      // Focus search input after portal renders
      if (showSearch) {
        requestAnimationFrame(() => {
          searchRef.current?.focus();
        });
      }
      // Scroll active item into view
      if (menuRef.current) {
        requestAnimationFrame(() => {
          const active = menuRef.current?.querySelector('[data-active="true"]');
          if (active) active.scrollIntoView({ block: 'nearest' });
        });
      }
    } else {
      setSearch('');
    }
  }, [isOpen, showSearch]);

  // Find the label for the currently selected value
  const getSelectedLabel = () => {
    for (const item of options) {
      if (item.group) {
        const found = item.options?.find((o) => o.value === value);
        if (found) return found.label;
      } else if (item.value === value) {
        return item.label;
      }
    }
    return placeholder;
  };

  const handleSelect = (val) => {
    onChange(val);
    setIsOpen(false);
  };

  const menu = isOpen
    ? createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] rounded-lg border border-[var(--glass-border-hover)] shadow-xl overflow-hidden"
          style={{
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            background: '#1a2332',
          }}
        >
          {/* Search input */}
          {showSearch && (
            <div className="px-2 pt-2 pb-1">
              <div className="relative">
                <svg
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-7 pr-2 py-1.5 text-xs bg-white/5 border border-white/10 rounded-md text-slate-200 placeholder-slate-500 focus:outline-none focus:border-accent/40 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          )}

          <div className="max-h-56 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-500 text-center">
                No matches
              </div>
            ) : (
              filteredOptions.map((item, i) => {
                if (item.group) {
                  return (
                    <div key={item.group}>
                      {i > 0 && <div className="mx-2 my-1 border-t border-white/5" />}
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 select-none">
                        {item.group}
                      </div>
                      {item.options?.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          data-active={opt.value === value || undefined}
                          onClick={() => handleSelect(opt.value)}
                          className={[
                            'w-full text-left px-3 py-1.5 pl-5 text-sm transition-colors',
                            opt.value === value
                              ? 'bg-accent/10 text-accent-light'
                              : 'text-slate-300 hover:bg-white/5 hover:text-slate-100',
                          ].join(' ')}
                        >
                          <span className="truncate block">{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  );
                }
                return (
                  <button
                    key={item.value}
                    type="button"
                    data-active={item.value === value || undefined}
                    onClick={() => handleSelect(item.value)}
                    className={[
                      'w-full text-left px-3 py-1.5 text-sm transition-colors',
                      item.value === value
                        ? 'bg-accent/10 text-accent-light'
                        : 'text-slate-300 hover:bg-white/5 hover:text-slate-100',
                    ].join(' ')}
                  >
                    <span className="truncate block">{item.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className={className}>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={[
          `w-full flex items-center justify-between gap-2 ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} rounded-lg transition-all duration-150`,
          'bg-surface-overlay/80 border text-slate-200',
          disabled
            ? 'opacity-50 cursor-not-allowed border-[var(--glass-border)]'
            : 'cursor-pointer border-[var(--glass-border)] hover:border-[var(--glass-border-hover)]',
          isOpen ? 'border-accent/50 ring-1 ring-accent/20' : '',
        ].join(' ')}
      >
        <span className="truncate">{getSelectedLabel()}</span>
        <svg
          className={`w-3.5 h-3.5 flex-shrink-0 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {menu}
    </div>
  );
}
