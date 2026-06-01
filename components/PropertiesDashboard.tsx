'use client';

/**
 * PropertiesDashboard — /admin/properties
 *
 * Property-period-centric replacement for the owner-centric admin page.
 * Each property is shown as a card containing one or more "periods" —
 * windows of management under a single ownership structure. Each period
 * has its own:
 *   - holding company / notes
 *   - start & end dates
 *   - insurance / taxes / debt overlay
 *   - group memberships (used by the global filter)
 *
 * Properties that traded hands (e.g. Hilltop Townhomes) have multiple
 * periods. A "Split this period" action lets the user close an active
 * period on a date and open a new one with fresh ownership / costs.
 *
 * Group management lives in the right pane.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Loader2, ChevronRight, Pencil, Trash2, Plus, Save, X, Check, Scissors } from 'lucide-react';

interface Group {
  id: string;
  name: string;
  color: string;
  description: string | null;
}

interface PropertyPeriod {
  id: string;
  property_name: string;
  af_property_id: number | null;
  period_start: string | null;
  period_end: string | null;
  holding_company: string | null;
  notes: string | null;
  monthly_insurance: number | null;
  monthly_taxes: number | null;
  monthly_debt_service: number | null;
  source: string | null;
  is_active: boolean;
  groups: Group[];
}

const GROUP_PALETTE = [
  '#06b6d4', '#34d399', '#8b5cf6', '#fbbf24', '#fb7185',
  '#60a5fa', '#fb923c', '#2dd4bf', '#f472b6', '#a3e635',
];

const fmtDate = (d: string | null) => d || '—';

export default function PropertiesDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const router = useRouter();

  const [periods, setPeriods] = useState<PropertyPeriod[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Owners admin page is now property-centric and Private.
  useEffect(() => {
    if (authLoading) return;
    if (!appUser || appUser.role !== 'admin') router.push('/');
  }, [authLoading, appUser, router]);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/property-periods');
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const j = await res.json();
      setPeriods(j.periods || []);
      setGroups(j.groups || []);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (appUser?.role === 'admin') reload(); }, [appUser, reload]);

  // Group properties together
  const byProperty = useMemo(() => {
    const m = new Map<string, PropertyPeriod[]>();
    for (const p of periods) {
      const arr = m.get(p.property_name) || [];
      arr.push(p);
      m.set(p.property_name, arr);
    }
    // Sort each group chronologically (oldest first)
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.period_start || '').localeCompare(b.period_start || ''));
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [periods]);

  // ── CRUD helpers ────────────────────────────────────────────────────
  const savePeriod = async (id: string, patch: Partial<PropertyPeriod> & { group_ids?: string[] }) => {
    const res = await fetch(`/api/admin/property-periods/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    await reload();
  };
  const deletePeriod = async (id: string) => {
    if (!confirm('Delete this period? Any group memberships on it will be removed too.')) return;
    const res = await fetch(`/api/admin/property-periods/${id}`, { method: 'DELETE' });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`); return; }
    await reload();
  };
  const splitPeriod = async (id: string, split_date: string, new_holding_company: string) => {
    const res = await fetch(`/api/admin/property-periods/${id}/split`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ split_date, new_holding_company }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    await reload();
  };
  const togglePeriodInGroup = async (period: PropertyPeriod, groupId: string) => {
    const current = period.groups.map(g => g.id);
    const next = current.includes(groupId) ? current.filter(x => x !== groupId) : [...current, groupId];
    try { await savePeriod(period.id, { group_ids: next }); }
    catch (e: any) { alert(e.message); }
  };

  // ── Group CRUD ──────────────────────────────────────────────────────
  const createGroup = async (name: string, color: string) => {
    const res = await fetch('/api/admin/ownership-groups', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    await reload();
  };
  const updateGroup = async (id: string, patch: any) => {
    const res = await fetch(`/api/admin/ownership-groups/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    await reload();
  };
  const deleteGroup = async (id: string) => {
    if (!confirm('Delete this group? Period memberships will be removed.')) return;
    const res = await fetch(`/api/admin/ownership-groups/${id}`, { method: 'DELETE' });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`); return; }
    await reload();
  };

  if (authLoading || !appUser) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;
  }
  if (appUser.role !== 'admin') return null;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Properties</h1>
        <p className="text-sm text-slate-400 mt-1">
          One row per ownership period. Edit insurance / taxes / debt and assign to groups
          used by the app-wide filter. Properties that traded hands have multiple periods.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-300 px-4 py-3 text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {loading && (
            <div className="text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}
          {byProperty.map(([propName, periods]) => (
            <PropertyCard
              key={propName}
              propertyName={propName}
              periods={periods}
              groups={groups}
              expanded={expanded.has(propName)}
              onExpand={() => {
                const n = new Set(expanded);
                n.has(propName) ? n.delete(propName) : n.add(propName);
                setExpanded(n);
              }}
              onSavePeriod={savePeriod}
              onDeletePeriod={deletePeriod}
              onSplitPeriod={splitPeriod}
              onToggleGroup={togglePeriodInGroup}
            />
          ))}
        </div>

        <div className="glass-card p-4">
          <h2 className="text-base font-semibold text-slate-100 mb-3">Groups</h2>
          <GroupsPanel
            groups={groups}
            periods={periods}
            onCreate={createGroup}
            onUpdate={updateGroup}
            onDelete={deleteGroup}
          />
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// One property card with its periods inline
// ────────────────────────────────────────────────────────────────────
function PropertyCard({
  propertyName, periods, groups, expanded, onExpand,
  onSavePeriod, onDeletePeriod, onSplitPeriod, onToggleGroup,
}: {
  propertyName: string;
  periods: PropertyPeriod[];
  groups: Group[];
  expanded: boolean;
  onExpand: () => void;
  onSavePeriod: (id: string, patch: Partial<PropertyPeriod> & { group_ids?: string[] }) => Promise<void>;
  onDeletePeriod: (id: string) => Promise<void>;
  onSplitPeriod: (id: string, split_date: string, new_holding_company: string) => Promise<void>;
  onToggleGroup: (period: PropertyPeriod, groupId: string) => Promise<void>;
}) {
  const activePeriod = periods.find(p => p.is_active);
  const allGroups = new Set<string>();
  for (const p of periods) for (const g of p.groups) allGroups.add(g.id);
  const activeGroupBadges = Array.from(new Set(
    periods.flatMap(p => p.groups.map(g => g))
  )).filter((g, i, arr) => arr.findIndex(x => x.id === g.id) === i);

  return (
    <div className="glass-card p-4">
      <button
        type="button"
        onClick={onExpand}
        className="w-full flex items-center gap-3 text-left hover:bg-white/[0.03] -mx-2 -my-1 px-2 py-1 rounded transition-colors"
      >
        <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-100 truncate">{propertyName}</div>
          <div className="text-xs text-slate-500 truncate">
            {periods.length > 1
              ? `${periods.length} periods · current: ${activePeriod?.holding_company || '—'}`
              : (activePeriod?.holding_company || <span className="italic text-slate-600">no holding company set</span>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-1 justify-end max-w-[40%]">
          {activeGroupBadges.map(g => (
            <span key={g.id}
              className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={{ backgroundColor: g.color + '22', color: g.color, border: `1px solid ${g.color}55` }}>
              {g.name}
            </span>
          ))}
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-[var(--glass-border)] pt-3">
          {periods.map(p => (
            <PeriodEditor
              key={p.id}
              period={p}
              groups={groups}
              onSave={onSavePeriod}
              onDelete={onDeletePeriod}
              onSplit={onSplitPeriod}
              onToggleGroup={onToggleGroup}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// One period editor — covers dates / holding company / financials /
// groups / split / delete in one inline panel.
// ────────────────────────────────────────────────────────────────────
function PeriodEditor({
  period, groups, onSave, onDelete, onSplit, onToggleGroup,
}: {
  period: PropertyPeriod;
  groups: Group[];
  onSave: (id: string, patch: Partial<PropertyPeriod> & { group_ids?: string[] }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSplit: (id: string, split_date: string, new_holding_company: string) => Promise<void>;
  onToggleGroup: (period: PropertyPeriod, groupId: string) => Promise<void>;
}) {
  const [edit, setEdit] = useState(false);
  const [start, setStart] = useState(period.period_start || '');
  const [end, setEnd] = useState(period.period_end || '');
  const [holding, setHolding] = useState(period.holding_company || '');
  const [ins, setIns] = useState(period.monthly_insurance == null ? '' : String(period.monthly_insurance));
  const [tax, setTax] = useState(period.monthly_taxes == null ? '' : String(period.monthly_taxes));
  const [debt, setDebt] = useState(period.monthly_debt_service == null ? '' : String(period.monthly_debt_service));
  const [notes, setNotes] = useState(period.notes || '');
  const [saving, setSaving] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [splitDate, setSplitDate] = useState(new Date().toISOString().slice(0, 10));
  const [splitHolding, setSplitHolding] = useState('');

  // Sync local form state on upstream changes
  useEffect(() => {
    setStart(period.period_start || ''); setEnd(period.period_end || '');
    setHolding(period.holding_company || '');
    setIns(period.monthly_insurance == null ? '' : String(period.monthly_insurance));
    setTax(period.monthly_taxes == null ? '' : String(period.monthly_taxes));
    setDebt(period.monthly_debt_service == null ? '' : String(period.monthly_debt_service));
    setNotes(period.notes || '');
  }, [period]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(period.id, {
        period_start: start || null,
        period_end: end || null,
        holding_company: holding || null,
        monthly_insurance: ins === '' ? null : Number(ins) as any,
        monthly_taxes: tax === '' ? null : Number(tax) as any,
        monthly_debt_service: debt === '' ? null : Number(debt) as any,
        notes: notes || null,
      });
      setEdit(false);
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const runSplit = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(splitDate)) { alert('Split date must be YYYY-MM-DD'); return; }
    setSaving(true);
    try {
      await onSplit(period.id, splitDate, splitHolding);
      setShowSplit(false);
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const memberGroupIds = new Set(period.groups.map(g => g.id));
  const fmt$ = (v: number | null) => v == null
    ? <span className="text-slate-600 italic">—</span>
    : <span className="tabular-nums">${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>;

  return (
    <div className={`rounded-md border ${period.is_active ? 'border-cyan-500/30 bg-cyan-500/[0.04]' : 'border-slate-700/50 bg-slate-900/40'} p-3`}>
      {/* Header row */}
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-100 truncate">{period.holding_company || <span className="italic text-slate-500">no holding company</span>}</span>
            {period.is_active && (
              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">Active</span>
            )}
            {period.source === 'manual' && (
              <span className="text-[10px] text-cyan-400 uppercase font-semibold tracking-wide">edited</span>
            )}
          </div>
          <div className="text-xs text-slate-500 tabular-nums">
            {fmtDate(period.period_start)} → {period.period_end ? fmtDate(period.period_end) : <em className="not-italic text-emerald-400">present</em>}
          </div>
        </div>
        {!edit && (
          <>
            <button type="button" onClick={() => setEdit(true)}
              className="p-1 text-slate-500 hover:text-slate-200 hover:bg-white/5 rounded" title="Edit period">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            {period.is_active && (
              <button type="button" onClick={() => setShowSplit(s => !s)}
                className="p-1 text-slate-500 hover:text-cyan-300 hover:bg-white/5 rounded" title="Split this period (new ownership)">
                <Scissors className="w-3.5 h-3.5" />
              </button>
            )}
            <button type="button" onClick={() => onDelete(period.id)}
              className="p-1 text-slate-500 hover:text-rose-400 hover:bg-white/5 rounded" title="Delete period">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Financials pills (read mode) */}
      {!edit && (
        <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-slate-500">
          <span>Ins <span className="ml-1 text-xs text-slate-300 normal-case tracking-normal">{fmt$(period.monthly_insurance)}</span></span>
          <span>Tax <span className="ml-1 text-xs text-slate-300 normal-case tracking-normal">{fmt$(period.monthly_taxes)}</span></span>
          <span>Debt <span className="ml-1 text-xs text-slate-300 normal-case tracking-normal">{fmt$(period.monthly_debt_service)}</span></span>
        </div>
      )}

      {/* Edit form */}
      {edit && (
        <div className="space-y-2 mt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Holding company</span>
              <input value={holding} onChange={e => setHolding(e.target.value)}
                className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Period start → end</span>
              <div className="flex items-center gap-1">
                <input type="date" value={start} onChange={e => setStart(e.target.value)}
                  className="flex-1 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200" />
                <span className="text-slate-500">→</span>
                <input type="date" value={end} onChange={e => setEnd(e.target.value)} placeholder="present"
                  className="flex-1 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200" />
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Monthly insurance</span>
              <input type="number" step="0.01" min="0" value={ins} onChange={e => setIns(e.target.value)}
                className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 tabular-nums" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Monthly taxes</span>
              <input type="number" step="0.01" min="0" value={tax} onChange={e => setTax(e.target.value)}
                className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 tabular-nums" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Monthly debt service</span>
              <input type="number" step="0.01" min="0" value={debt} onChange={e => setDebt(e.target.value)}
                className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 tabular-nums" />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Notes</span>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200" />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEdit(false)} disabled={saving}
              className="px-2.5 py-1 text-xs rounded text-slate-400 hover:text-slate-200">Cancel</button>
            <button onClick={save} disabled={saving}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-emerald-600/80 hover:bg-emerald-600 text-white font-medium disabled:opacity-50">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
            </button>
          </div>
        </div>
      )}

      {/* Split form */}
      {showSplit && (
        <div className="mt-3 p-2 rounded border border-cyan-500/30 bg-cyan-500/[0.05]">
          <div className="text-[11px] uppercase tracking-wide text-cyan-300 mb-2">Split this period — property changed hands</div>
          <div className="flex flex-wrap items-end gap-2 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Split date</span>
              <input type="date" value={splitDate} onChange={e => setSplitDate(e.target.value)}
                className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200" />
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">New holding company</span>
              <input value={splitHolding} onChange={e => setSplitHolding(e.target.value)}
                placeholder="e.g. Summit Ridge Townhomes, LLC"
                className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200" />
            </label>
            <div className="flex gap-2 ml-auto">
              <button onClick={() => setShowSplit(false)} disabled={saving}
                className="px-2.5 py-1 text-xs rounded text-slate-400 hover:text-slate-200">Cancel</button>
              <button onClick={runSplit} disabled={saving}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-medium disabled:opacity-50">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scissors className="w-3 h-3" />} Split
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Group memberships */}
      {!edit && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Groups</div>
          {groups.length === 0 ? (
            <div className="text-xs text-slate-500 italic">No groups defined yet.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {groups.map(g => {
                const in_ = memberGroupIds.has(g.id);
                return (
                  <button key={g.id} type="button"
                    onClick={() => onToggleGroup(period, g.id)}
                    className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${
                      in_ ? '' : 'ring-1 ring-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                    style={in_ ? {
                      backgroundColor: g.color + '22', color: g.color,
                      boxShadow: `inset 0 0 0 1px ${g.color}55`,
                    } : undefined}>
                    {in_ && <Check className="inline w-3 h-3 mr-0.5 -mt-0.5" />}
                    {g.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Right pane: groups manager (same shape as before, period-aware)
// ────────────────────────────────────────────────────────────────────
function GroupsPanel({
  groups, periods, onCreate, onUpdate, onDelete,
}: {
  groups: Group[];
  periods: PropertyPeriod[];
  onCreate: (name: string, color: string) => Promise<void>;
  onUpdate: (id: string, patch: any) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(GROUP_PALETTE[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [busy, setBusy] = useState(false);

  // Resolve each group → set of property names it currently filters to
  const groupResolution = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const g of groups) m.set(g.id, new Set<string>());
    for (const p of periods) {
      if (!p.is_active) continue;
      for (const g of p.groups) m.get(g.id)?.add(p.property_name);
    }
    return m;
  }, [groups, periods]);

  const beginAdd = () => {
    setNewName(''); setNewColor(GROUP_PALETTE[groups.length % GROUP_PALETTE.length]); setAdding(true);
  };
  const submitNew = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try { await onCreate(newName.trim(), newColor); setAdding(false); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };
  const beginEdit = (g: Group) => { setEditingId(g.id); setEditName(g.name); setEditColor(g.color); };
  const submitEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    try { await onUpdate(editingId, { name: editName.trim(), color: editColor }); setEditingId(null); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      {groups.map(g => {
        const props = groupResolution.get(g.id);
        const propsArr = props ? Array.from(props).sort() : [];
        return (
          <div key={g.id} className="rounded-md border border-[var(--glass-border)] bg-white/[0.02] p-3">
            {editingId === g.id ? (
              <div className="space-y-2">
                <input value={editName} onChange={e => setEditName(e.target.value)}
                  className="w-full px-2 py-1 text-sm rounded bg-slate-900 border border-slate-700 text-slate-100" />
                <div className="flex gap-1.5">
                  {GROUP_PALETTE.map(c => (
                    <button key={c} type="button" onClick={() => setEditColor(c)}
                      className={`w-5 h-5 rounded-full ring-2 transition-all ${editColor === c ? 'ring-white scale-110' : 'ring-transparent'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={submitEdit} disabled={busy} className="px-2.5 py-1 text-xs rounded bg-accent text-white font-medium disabled:opacity-50">Save</button>
                  <button onClick={() => setEditingId(null)} disabled={busy} className="px-2.5 py-1 text-xs rounded text-slate-400 hover:text-slate-200">Cancel</button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                  <span className="font-semibold text-slate-100 flex-1 truncate">{g.name}</span>
                  <button onClick={() => beginEdit(g)} className="p-1 text-slate-500 hover:text-slate-200 rounded" title="Rename / recolor">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => onDelete(g.id)} className="p-1 text-slate-500 hover:text-rose-400 rounded" title="Delete group">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="text-xs text-slate-500">
                  {propsArr.length === 0 ? 'no active periods' : `${propsArr.length} ${propsArr.length === 1 ? 'property' : 'properties'}`}
                </div>
                {propsArr.length > 0 && (
                  <div className="text-[11px] text-slate-500 mt-1 truncate" title={propsArr.join(', ')}>
                    → {propsArr.join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {adding ? (
        <div className="rounded-md border border-[var(--glass-border)] bg-white/[0.02] p-3 space-y-2">
          <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus
            placeholder="Group name" className="w-full px-2 py-1 text-sm rounded bg-slate-900 border border-slate-700 text-slate-100" />
          <div className="flex gap-1.5">
            {GROUP_PALETTE.map(c => (
              <button key={c} type="button" onClick={() => setNewColor(c)}
                className={`w-5 h-5 rounded-full ring-2 transition-all ${newColor === c ? 'ring-white scale-110' : 'ring-transparent'}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={submitNew} disabled={busy || !newName.trim()} className="px-2.5 py-1 text-xs rounded bg-accent text-white font-medium disabled:opacity-50">Create</button>
            <button onClick={() => setAdding(false)} disabled={busy} className="px-2.5 py-1 text-xs rounded text-slate-400 hover:text-slate-200">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={beginAdd}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-dashed border-slate-700 text-slate-400 hover:text-accent hover:border-accent/50 transition-colors">
          <Plus className="w-3.5 h-3.5" /> New group
        </button>
      )}

      <p className="text-[11px] text-slate-500 pt-2 border-t border-[var(--glass-border)]">
        Toggle group membership per-period in the left pane.
      </p>
    </div>
  );
}
