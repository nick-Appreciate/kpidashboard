'use client';

/**
 * GlobalFilterBar
 *
 * The visible UI for the global filter. Renders as a compact trigger
 * button that opens a popover with three checkbox lists:
 *   - Ownership groups
 *   - Owners
 *   - Individual properties
 *
 * When the filter is active, the button shows a chip per selection +
 * a count of resolved properties. Click "Clear" to reset.
 *
 * Mounted in AppLayout so it appears in the same place on every admin
 * page — pages don't need to render this themselves.
 */

import { useEffect, useRef, useState } from 'react';
import { Filter, X, Check } from 'lucide-react';
import { useGlobalFilter } from '../contexts/GlobalFilterContext';

export default function GlobalFilterBar({ className = '' }: { className?: string }) {
  const f = useGlobalFilter();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!popoverRef.current || !btnRef.current) return;
      const t = e.target as Node;
      if (!popoverRef.current.contains(t) && !btnRef.current.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!f.loaded) return null; // wait for owners + groups to load
  if (f.allProperties.length === 0 && f.groups.length === 0) return null; // nothing useful to filter on

  const totalSelections =
    f.selectedGroupIds.length + f.selectedOwnerIds.length + f.selectedProperties.length;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
          f.isActive
            ? 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/15'
            : 'border-[var(--glass-border)] bg-surface-overlay/60 text-slate-300 hover:bg-white/5'
        }`}
        title={f.isActive ? `Filtering to ${f.effectiveProperties.length} properties` : 'Filter by owner / group / property'}
      >
        <Filter className="w-4 h-4" />
        <span>
          {f.isActive
            ? <>Filter <span className="font-bold">·</span> {f.effectiveProperties.length} prop{f.effectiveProperties.length === 1 ? '' : 's'}</>
            : 'Filter'}
        </span>
        {totalSelections > 0 && (
          <span className="text-[10px] font-semibold tabular-nums bg-accent/20 text-accent px-1.5 py-0.5 rounded">
            {totalSelections}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 mt-2 w-80 z-50 rounded-lg border border-[var(--glass-border)] bg-surface-raised/95 backdrop-blur-md shadow-xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--glass-border)]">
            <div>
              <div className="text-sm font-semibold text-slate-100">Global filter</div>
              <div className="text-[11px] text-slate-500">
                {f.isActive
                  ? `${f.effectiveProperties.length} ${f.effectiveProperties.length === 1 ? 'property' : 'properties'} after resolving`
                  : 'Pick anything to scope the dashboard'}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {f.isActive && (
                <button
                  onClick={() => f.clearAll()}
                  className="text-[11px] text-slate-400 hover:text-rose-400 px-2 py-1 rounded hover:bg-white/5"
                >Clear</button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-slate-500 hover:text-slate-200 p-1 rounded hover:bg-white/5"
              ><X className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {/* GROUPS */}
            <Section title="Groups" emptyText="No groups yet — create one on /admin/owners.">
              {f.groups.map(g => {
                const checked = f.selectedGroupIds.includes(g.id);
                return (
                  <CheckRow
                    key={g.id}
                    checked={checked}
                    onClick={() => f.toggleGroup(g.id)}
                    label={
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                        <span className="truncate">{g.name}</span>
                      </span>
                    }
                    right={<span className="text-[10px] text-slate-500 tabular-nums">{g.properties.length}p</span>}
                  />
                );
              })}
            </Section>

            {/* OWNERS */}
            <Section title="Owners" emptyText="No owners loaded.">
              {f.owners
                .filter(o => o.current_properties.length > 0)
                .map(o => {
                  const checked = f.selectedOwnerIds.includes(o.owner_id);
                  return (
                    <CheckRow
                      key={o.owner_id}
                      checked={checked}
                      onClick={() => f.toggleOwner(o.owner_id)}
                      label={<span className="truncate">{o.name}</span>}
                      right={<span className="text-[10px] text-slate-500 tabular-nums">{o.current_properties.length}p</span>}
                    />
                  );
                })}
            </Section>

            {/* PROPERTIES */}
            <Section title="Properties" emptyText="No properties.">
              {f.allProperties.map(p => {
                const checked = f.selectedProperties.includes(p);
                return (
                  <CheckRow
                    key={p}
                    checked={checked}
                    onClick={() => f.toggleProperty(p)}
                    label={<span className="truncate">{p}</span>}
                  />
                );
              })}
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children, emptyText }: {
  title: string; children: React.ReactNode; emptyText: string;
}) {
  const childArr = Array.isArray(children) ? children : [children];
  const realChildren = childArr.filter(Boolean);
  return (
    <div className="border-b border-[var(--glass-border)] last:border-b-0">
      <div className="px-4 py-1.5 text-[10px] uppercase tracking-wide font-semibold text-slate-500 bg-slate-900/50">
        {title}
      </div>
      {realChildren.length === 0 ? (
        <div className="px-4 py-2 text-[11px] text-slate-500 italic">{emptyText}</div>
      ) : (
        <div className="py-1">{children}</div>
      )}
    </div>
  );
}

function CheckRow({ checked, onClick, label, right }: {
  checked: boolean;
  onClick: () => void;
  label: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-4 py-1.5 text-sm hover:bg-white/[0.04] text-left ${
        checked ? 'text-slate-100' : 'text-slate-300'
      }`}
    >
      <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
        checked ? 'bg-accent border-accent' : 'border-slate-600'
      }`}>
        {checked && <Check className="w-3 h-3 text-white" />}
      </span>
      <span className="flex-1 min-w-0">{label}</span>
      {right}
    </button>
  );
}
