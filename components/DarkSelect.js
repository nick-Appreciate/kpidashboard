'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * Custom dark-themed dropdown to replace native <select> elements.
 * Uses a portal so the menu is never clipped by parent overflow.
 *
 * @param {string}   value      - Currently selected value
 * @param {function} onChange   - Called with the new value (not an event)
 * @param {Array}    options    - Flat or grouped: [{ value, label }, { group, options: [{ value, label }] }]
 * @param {boolean}  disabled   - Disable interaction
 * @param {string}   className  - Additional wrapper classes
 * @param {string}   placeholder - Shown when no value matches
 */
export default function DarkSelect({
  value,
  onChange,
  options = [],
  disabled = false,
  className = '',
  placeholder = 'Select...',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  // Calculate menu position from trigger button
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  // Position on open, close on scroll, reposition on resize
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const closeOnScroll = (e) => {
      // Don't close if scrolling inside the dropdown menu itself
      if (menuRef.current && menuRef.current.contains(e.target)) return;
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

  // Scroll selected item into view when opening
  useEffect(() => {
    if (isOpen && menuRef.current) {
      const active = menuRef.current.querySelector('[data-active="true"]');
      if (active) active.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen]);

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
          <div className="max-h-56 overflow-y-auto py-1 dark-scrollbar">
            {options.map((item, i) => {
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
            })}
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
          'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg transition-all duration-150',
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
