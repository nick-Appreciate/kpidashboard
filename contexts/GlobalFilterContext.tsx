'use client';

/**
 * GlobalFilterContext
 *
 * App-wide filter that scopes most dashboards down to a subset of
 * properties. The user can pick any combination of:
 *   - ownership groups (defined on /admin/owners)
 *   - individual owners
 *   - individual property names
 *
 * The context resolves all three into a single canonical
 * `effectiveProperties: string[]`. When the filter is inactive (nothing
 * selected) the array is empty AND `isActive` is false, which dashboards
 * treat as "show everything".
 *
 * State is persisted to localStorage so navigating between pages keeps
 * the filter active.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

interface GroupShape {
  id: string;
  name: string;
  color: string;
  // Property names this group currently filters to (resolved from
  // active property_periods assigned to it).
  properties: string[];
}

interface OwnerShape {
  // Kept for backward compatibility with older UIs that displayed
  // owners as a filter option. The new property-period model treats
  // "holding company" as a label on each period rather than a
  // first-class entity. Empty for now — populated only if we add
  // owner-level filtering back later.
  owner_id: number;
  name: string;
  current_properties: string[];
}

interface GlobalFilterValue {
  // Loaded data
  groups: GroupShape[];
  owners: OwnerShape[];
  allProperties: string[];
  loaded: boolean;

  // Selections
  selectedGroupIds: string[];
  selectedOwnerIds: number[];
  selectedProperties: string[];

  // Resolved
  effectiveProperties: string[];
  isActive: boolean;

  // Mutators
  setSelectedGroupIds: (ids: string[]) => void;
  setSelectedOwnerIds: (ids: number[]) => void;
  setSelectedProperties: (props: string[]) => void;
  toggleGroup: (id: string) => void;
  toggleOwner: (id: number) => void;
  toggleProperty: (name: string) => void;
  clearAll: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<GlobalFilterValue | null>(null);

const LS_KEY = 'globalFilter.v1';

interface StoredState {
  groups: string[];
  owners: number[];
  properties: string[];
}

function loadStored(): StoredState {
  if (typeof window === 'undefined') return { groups: [], owners: [], properties: [] };
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { groups: [], owners: [], properties: [] };
    const parsed = JSON.parse(raw);
    return {
      groups: Array.isArray(parsed.groups) ? parsed.groups.map(String) : [],
      owners: Array.isArray(parsed.owners) ? parsed.owners.map((n: any) => Number(n)).filter(Number.isFinite) : [],
      properties: Array.isArray(parsed.properties) ? parsed.properties.map(String) : [],
    };
  } catch {
    return { groups: [], owners: [], properties: [] };
  }
}

function persistStored(s: StoredState) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

export function GlobalFilterProvider({ children }: { children: React.ReactNode }) {
  const [groups, setGroups] = useState<GroupShape[]>([]);
  const [owners, setOwners] = useState<OwnerShape[]>([]);
  const [allProperties, setAllProperties] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const stored = useMemo(loadStored, []);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(stored.groups);
  const [selectedOwnerIds, setSelectedOwnerIds] = useState<number[]>(stored.owners);
  const [selectedProperties, setSelectedProperties] = useState<string[]>(stored.properties);

  useEffect(() => {
    persistStored({ groups: selectedGroupIds, owners: selectedOwnerIds, properties: selectedProperties });
  }, [selectedGroupIds, selectedOwnerIds, selectedProperties]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/property-periods');
      if (!res.ok) { setLoaded(true); return; }
      const j = await res.json();

      // Resolve each group → property names of its currently-active periods
      const groupProps = new Map<string, Set<string>>();
      const allProps = new Set<string>();
      for (const p of j.periods || []) {
        if (!p.is_active) continue;
        allProps.add(p.property_name);
        for (const g of p.groups || []) {
          const s = groupProps.get(g.id) || new Set<string>();
          s.add(p.property_name);
          groupProps.set(g.id, s);
        }
      }
      const groupRows: GroupShape[] = (j.groups || []).map((g: any) => ({
        id: g.id, name: g.name, color: g.color,
        properties: Array.from(groupProps.get(g.id) || []).sort(),
      }));

      setOwners([]); // owner-level filtering is retired; keep empty for shape compat
      setGroups(groupRows);
      setAllProperties(Array.from(allProps).sort());
    } catch (e) {
      console.warn('GlobalFilter refresh failed', e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Resolve selections → effective property set
  const effectiveProperties = useMemo(() => {
    const set = new Set<string>();
    for (const gid of selectedGroupIds) {
      const g = groups.find(x => x.id === gid);
      if (g) for (const p of g.properties) set.add(p);
    }
    for (const oid of selectedOwnerIds) {
      const o = owners.find(x => x.owner_id === oid);
      if (o) for (const p of o.current_properties) set.add(p);
    }
    for (const p of selectedProperties) set.add(p);
    return Array.from(set).sort();
  }, [selectedGroupIds, selectedOwnerIds, selectedProperties, groups, owners]);

  const isActive = selectedGroupIds.length + selectedOwnerIds.length + selectedProperties.length > 0;

  const toggleGroup = useCallback((id: string) => {
    setSelectedGroupIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);
  const toggleOwner = useCallback((id: number) => {
    setSelectedOwnerIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);
  const toggleProperty = useCallback((name: string) => {
    setSelectedProperties(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]);
  }, []);
  const clearAll = useCallback(() => {
    setSelectedGroupIds([]); setSelectedOwnerIds([]); setSelectedProperties([]);
  }, []);

  const value: GlobalFilterValue = {
    groups, owners, allProperties, loaded,
    selectedGroupIds, selectedOwnerIds, selectedProperties,
    effectiveProperties, isActive,
    setSelectedGroupIds, setSelectedOwnerIds, setSelectedProperties,
    toggleGroup, toggleOwner, toggleProperty, clearAll, refresh,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGlobalFilter(): GlobalFilterValue {
  const v = useContext(Ctx);
  if (!v) {
    // Render-safe fallback for pages outside the provider tree (e.g.
    // public listings). Filter is permanently inactive.
    return {
      groups: [], owners: [], allProperties: [], loaded: true,
      selectedGroupIds: [], selectedOwnerIds: [], selectedProperties: [],
      effectiveProperties: [], isActive: false,
      setSelectedGroupIds: () => {}, setSelectedOwnerIds: () => {}, setSelectedProperties: () => {},
      toggleGroup: () => {}, toggleOwner: () => {}, toggleProperty: () => {},
      clearAll: () => {}, refresh: async () => {},
    };
  }
  return v;
}

/**
 * Returns a helper that filters a list of rows (or really, anything
 * with a property_name field) according to the active global filter.
 * If the filter is inactive, returns the input unchanged.
 */
export function useGlobalFilterFn<T extends { property_name?: string | null; property?: string | null }>(): (rows: T[]) => T[] {
  const { effectiveProperties, isActive } = useGlobalFilter();
  return useCallback((rows: T[]) => {
    if (!isActive || effectiveProperties.length === 0) return rows;
    const set = new Set(effectiveProperties);
    return rows.filter(r => {
      const p = (r as any).property_name ?? (r as any).property;
      return p && set.has(p);
    });
  }, [effectiveProperties, isActive]);
}
