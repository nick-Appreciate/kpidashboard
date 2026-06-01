'use client';

/**
 * OwnersDashboard — /admin/owners
 *
 * Two-pane view:
 *   - Left:  list of every AppFolio owner. Click one to expand its
 *            property-ownership history (start/end dates, %) inline.
 *            Edit dates directly. Toggle group memberships with chips.
 *   - Right: ownership group manager — create / rename / recolor /
 *            delete groups, see resolved property list per group.
 *
 * Phase 2 (next commit) will add the reusable global filter component
 * that consumes these groups.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Loader2, ChevronRight, Pencil, Trash2, Plus, Save, X, Check } from 'lucide-react';

interface PropertyHistoryRow {
  id: string;
  owner_id: number;
  property_name: string;
  ownership_pct: number | null;
  start_date: string | null;
  end_date: string | null;
  source: string | null;
  notes: string | null;
}

interface Group {
  id: string;
  name: string;
  color: string;
  description: string | null;
}

interface Owner {
  owner_id: number;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  properties_owned: string | null;
  properties: PropertyHistoryRow[];
  groups: Group[];
}

interface GroupWithMembers extends Group {
  owner_ids: number[];
  properties: string[];
}

const GROUP_PALETTE = [
  '#06b6d4', '#34d399', '#8b5cf6', '#fbbf24', '#fb7185',
  '#60a5fa', '#fb923c', '#2dd4bf', '#f472b6', '#a3e635',
];

const fmtDate = (d: string | null) => d || '—';

export default function OwnersDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const router = useRouter();

  const [owners, setOwners] = useState<Owner[]>([]);
  const [groups, setGroups] = useState<GroupWithMembers[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedOwnerId, setExpandedOwnerId] = useState<number | null>(null);

  useEffect(() => {
    if (!authLoading && !appUser) router.push('/');
  }, [authLoading, appUser, router]);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [oRes, gRes] = await Promise.all([
        fetch('/api/admin/owners'),
        fetch('/api/admin/ownership-groups'),
      ]);
      if (!oRes.ok) throw new Error((await oRes.json()).error || `HTTP ${oRes.status}`);
      if (!gRes.ok) throw new Error((await gRes.json()).error || `HTTP ${gRes.status}`);
      const o = await oRes.json(); const g = await gRes.json();
      setOwners(o.owners || []);
      setGroups(g.groups || []);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (appUser) reload();
  }, [appUser, reload]);

  // ── Group CRUD ──────────────────────────────────────────────────────
  const createGroup = async (name: string, ownerIds: number[], color: string) => {
    const res = await fetch('/api/admin/ownership-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color, owner_ids: ownerIds }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${res.status}`);
    }
    await reload();
  };
  const updateGroup = async (id: string, patch: any) => {
    const res = await fetch(`/api/admin/ownership-groups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${res.status}`);
    }
    await reload();
  };
  const deleteGroup = async (id: string) => {
    const res = await fetch(`/api/admin/ownership-groups/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${res.status}`);
    }
    await reload();
  };

  // ── Owner ↔ group toggle ─────────────────────────────────────────────
  const toggleOwnerInGroup = async (ownerId: number, groupId: string) => {
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    const newIds = g.owner_ids.includes(ownerId)
      ? g.owner_ids.filter(x => x !== ownerId)
      : [...g.owner_ids, ownerId];
    try {
      await updateGroup(groupId, { owner_ids: newIds });
    } catch (e: any) { alert(e.message); }
  };

  // ── History edits ───────────────────────────────────────────────────
  const saveHistoryRow = async (id: string, patch: Partial<PropertyHistoryRow>) => {
    const res = await fetch(`/api/admin/owner-property-history/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${res.status}`);
    }
    await reload();
  };

  if (authLoading || !appUser) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Owners</h1>
        <p className="text-sm text-slate-400 mt-1">
          AppFolio owners, the properties they own + dates, and custom ownership groups
          used as a filter throughout the app.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-300 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Owners — wider column */}
        <div className="lg:col-span-2 glass-card p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-100">
              {owners.length} owners
            </h2>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>
          <div className="divide-y divide-[var(--glass-border)] -mx-4">
            {owners.map(o => (
              <OwnerRow
                key={o.owner_id}
                owner={o}
                groups={groups}
                expanded={expandedOwnerId === o.owner_id}
                onExpand={() => setExpandedOwnerId(expandedOwnerId === o.owner_id ? null : o.owner_id)}
                onToggleGroup={(gid) => toggleOwnerInGroup(o.owner_id, gid)}
                onSaveHistoryRow={saveHistoryRow}
              />
            ))}
          </div>
        </div>

        {/* Groups panel */}
        <div className="glass-card p-4">
          <h2 className="text-base font-semibold text-slate-100 mb-3">
            Ownership groups
          </h2>
          <GroupsPanel
            groups={groups}
            owners={owners}
            onCreate={createGroup}
            onUpdate={updateGroup}
            onDelete={deleteGroup}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Per-owner expandable row
// ─────────────────────────────────────────────────────────────────────
function OwnerRow({
  owner, groups, expanded, onExpand, onToggleGroup, onSaveHistoryRow,
}: {
  owner: Owner;
  groups: GroupWithMembers[];
  expanded: boolean;
  onExpand: () => void;
  onToggleGroup: (groupId: string) => void;
  onSaveHistoryRow: (id: string, patch: Partial<PropertyHistoryRow>) => Promise<void>;
}) {
  const memberGroupIds = useMemo(() => new Set(owner.groups.map(g => g.id)), [owner.groups]);
  const currentProps = owner.properties.filter(p => !p.end_date);

  return (
    <div className="px-4 py-3">
      <button
        type="button"
        onClick={onExpand}
        className="w-full flex items-center gap-3 text-left hover:bg-white/[0.03] -mx-2 px-2 py-1 rounded transition-colors"
      >
        <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-100 truncate">{owner.name}</div>
          <div className="text-xs text-slate-500 truncate">
            {currentProps.length > 0
              ? currentProps.map(p =>
                  `${p.property_name}${p.ownership_pct != null ? ` (${p.ownership_pct}%)` : ''}`
                ).join(' · ')
              : <span className="italic text-slate-600">no current properties</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-1 justify-end max-w-[40%]">
          {owner.groups.map(g => (
            <span
              key={g.id}
              className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={{ backgroundColor: g.color + '22', color: g.color, border: `1px solid ${g.color}55` }}
            >
              {g.name}
            </span>
          ))}
        </div>
      </button>

      {expanded && (
        <div className="mt-3 ml-7 space-y-3">
          {/* Ownership history */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">Property history</div>
            {owner.properties.length === 0 ? (
              <div className="text-sm text-slate-500 italic">
                No properties tracked. (AppFolio's properties_owned field is empty for this owner.)
              </div>
            ) : (
              <div className="space-y-1.5">
                {owner.properties.map(h => (
                  <HistoryRow key={h.id} row={h} onSave={onSaveHistoryRow} />
                ))}
              </div>
            )}
          </div>

          {/* Group memberships */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">Groups</div>
            {groups.length === 0 ? (
              <div className="text-sm text-slate-500 italic">
                No groups defined yet. Create one in the panel on the right.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {groups.map(g => {
                  const in_ = memberGroupIds.has(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => onToggleGroup(g.id)}
                      className={`text-xs font-medium px-2 py-1 rounded-md transition-all ${
                        in_ ? 'ring-1' : 'ring-1 ring-slate-700 text-slate-400 hover:text-slate-200'
                      }`}
                      style={in_ ? {
                        backgroundColor: g.color + '22',
                        color: g.color,
                        boxShadow: `inset 0 0 0 1px ${g.color}55`,
                      } : undefined}
                    >
                      {in_ && <Check className="inline w-3 h-3 mr-1 -mt-0.5" />}
                      {g.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// One editable history row
// ─────────────────────────────────────────────────────────────────────
function HistoryRow({
  row,
  onSave,
}: {
  row: PropertyHistoryRow;
  onSave: (id: string, patch: Partial<PropertyHistoryRow>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(row.start_date || '');
  const [end, setEnd] = useState(row.end_date || '');
  const [pct, setPct] = useState(row.ownership_pct == null ? '' : String(row.ownership_pct));
  const [saving, setSaving] = useState(false);

  const cancel = () => {
    setEditing(false);
    setStart(row.start_date || '');
    setEnd(row.end_date || '');
    setPct(row.ownership_pct == null ? '' : String(row.ownership_pct));
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(row.id, {
        start_date: start || null,
        end_date: end || null,
        ownership_pct: pct === '' ? null : Number(pct) as any,
      });
      setEditing(false);
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="flex-1 text-slate-200 truncate">{row.property_name}</span>
        {row.ownership_pct != null && (
          <span className="text-xs text-slate-400 tabular-nums">{row.ownership_pct}%</span>
        )}
        <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
          {fmtDate(row.start_date)} → {row.end_date ? fmtDate(row.end_date) : <em className="not-italic text-emerald-400">present</em>}
        </span>
        {row.source === 'manual' && (
          <span className="text-[10px] text-cyan-400 uppercase font-semibold tracking-wide">edited</span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="p-1 text-slate-500 hover:text-slate-200 hover:bg-white/5 rounded"
          title="Edit dates / percentage"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm bg-white/[0.03] rounded p-2 ring-1 ring-slate-700/60">
      <span className="text-slate-200 font-medium">{row.property_name}</span>
      <input type="number" min="0" max="100" step="0.01" value={pct} onChange={e => setPct(e.target.value)}
        placeholder="%" className="w-16 px-1.5 py-0.5 text-xs rounded bg-slate-900 border border-slate-700 text-slate-200" />
      <input type="date" value={start} onChange={e => setStart(e.target.value)}
        className="px-1.5 py-0.5 text-xs rounded bg-slate-900 border border-slate-700 text-slate-200" />
      <span className="text-slate-500 text-xs">→</span>
      <input type="date" value={end} onChange={e => setEnd(e.target.value)}
        placeholder="present"
        className="px-1.5 py-0.5 text-xs rounded bg-slate-900 border border-slate-700 text-slate-200" />
      <button type="button" onClick={save} disabled={saving}
        className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/80 hover:bg-emerald-600 text-white text-xs font-medium disabled:opacity-50">
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
      </button>
      <button type="button" onClick={cancel} disabled={saving}
        className="p-1 text-slate-500 hover:text-slate-200 hover:bg-white/5 rounded disabled:opacity-50">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Groups manager panel
// ─────────────────────────────────────────────────────────────────────
function GroupsPanel({
  groups, owners, onCreate, onUpdate, onDelete,
}: {
  groups: GroupWithMembers[];
  owners: Owner[];
  onCreate: (name: string, ownerIds: number[], color: string) => Promise<void>;
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

  const beginAdd = () => {
    setNewName(''); setNewColor(GROUP_PALETTE[groups.length % GROUP_PALETTE.length]); setAdding(true);
  };
  const submitNew = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await onCreate(newName.trim(), [], newColor);
      setAdding(false);
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };
  const beginEdit = (g: Group) => {
    setEditingId(g.id); setEditName(g.name); setEditColor(g.color);
  };
  const submitEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    try {
      await onUpdate(editingId, { name: editName.trim(), color: editColor });
      setEditingId(null);
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };
  const removeGroup = async (g: Group) => {
    if (!confirm(`Delete group "${g.name}"? Members keep their other groups.`)) return;
    setBusy(true);
    try { await onDelete(g.id); } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      {groups.map(g => (
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
                <button onClick={() => removeGroup(g)} className="p-1 text-slate-500 hover:text-rose-400 rounded" title="Delete group">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="text-xs text-slate-500">
                {g.owner_ids.length} owner{g.owner_ids.length === 1 ? '' : 's'}
                {' · '}
                {g.properties.length > 0
                  ? `${g.properties.length} ${g.properties.length === 1 ? 'property' : 'properties'}`
                  : 'no properties'}
              </div>
              {g.properties.length > 0 && (
                <div className="text-[11px] text-slate-500 mt-1 truncate" title={g.properties.join(', ')}>
                  → {g.properties.join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

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
        Open an owner on the left to add / remove them from groups.
      </p>
    </div>
  );
}
