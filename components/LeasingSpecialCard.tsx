'use client';

/**
 * Current leasing special — one setting that drives the website promo banner
 * ("Ask about our Winter Leasing Special") and lead follow-up text #2.
 */

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '../lib/swr';
import { supabaseBrowser } from '../lib/supabase-browser';

interface Special {
  id: string; active: boolean; name_en: string; name_es: string;
  details_en: string | null; details_es: string | null; updated_at: string;
}

export default function LeasingSpecialCard() {
  const { data, mutate } = useSWR<{ special: Special | null }>('/api/admin/leasing-special', fetcher);
  const s = data?.special || null;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name_en: '', name_es: '', details_en: '', details_es: '', active: true });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const startEdit = () => {
    setForm({
      name_en: s?.name_en || '', name_es: s?.name_es || '',
      details_en: s?.details_en || '', details_es: s?.details_es || '', active: s?.active ?? true,
    });
    setErr(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const res = await fetch('/api/admin/leasing-special', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(body.error || 'Could not save'); return; }
      await mutate();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const input = 'dark-input px-2 py-1.5 text-xs w-full';

  return (
    <div className="glass-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-slate-400">Current leasing special</div>
          {s && s.active ? (
            <>
              <div className="text-sm font-semibold text-slate-100 truncate">{s.name_en}{s.details_en ? <span className="font-normal text-slate-400"> · {s.details_en}</span> : null}</div>
              <div className="text-[11px] text-slate-500 truncate">ES: {s.name_es} · shown in the website banner and follow-up text #2</div>
            </>
          ) : (
            <div className="text-sm text-slate-400">None — banner hidden; text #2 uses “units are leasing quickly”</div>
          )}
        </div>
        {!editing && (
          <button onClick={startEdit} className="shrink-0 px-2.5 py-1 rounded bg-white/5 text-slate-300 hover:bg-white/10 text-[11px] font-medium">Edit</button>
        )}
      </div>

      {editing && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
          <label className="text-[11px] text-slate-400">Name (English)
            <input className={input} value={form.name_en} placeholder="Winter Leasing Special" onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
          </label>
          <label className="text-[11px] text-slate-400">Name (Spanish)
            <input className={input} value={form.name_es} placeholder="promoción de invierno" onChange={(e) => setForm({ ...form, name_es: e.target.value })} />
          </label>
          <label className="text-[11px] text-slate-400">Details (English, optional)
            <input className={input} value={form.details_en} placeholder="$500 off your first month" onChange={(e) => setForm({ ...form, details_en: e.target.value })} />
          </label>
          <label className="text-[11px] text-slate-400">Details (Spanish, optional)
            <input className={input} value={form.details_es} placeholder="$500 de descuento en tu primer mes" onChange={(e) => setForm({ ...form, details_es: e.target.value })} />
          </label>
          <div className="md:col-span-2 flex items-center gap-3 mt-1">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active
            </label>
            <span className="text-[11px] text-slate-500 truncate">Banner preview: “Ask about our {form.name_en || '…'}”</span>
            <div className="ml-auto flex gap-2">
              {err && <span className="text-[11px] text-rose-300">{err}</span>}
              <button onClick={() => setEditing(false)} className="px-2.5 py-1 rounded text-slate-400 hover:text-slate-200 text-[11px]">Cancel</button>
              <button onClick={save} disabled={saving} className="px-3 py-1 rounded bg-accent/20 text-accent-light hover:bg-accent/30 text-[11px] font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
