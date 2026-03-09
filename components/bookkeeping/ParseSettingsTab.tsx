import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Search, Loader2, Check, Building2 } from "lucide-react";
import type { CorporateMerchantRule } from "../../types/bookkeeping";
import { formatMerchantName } from "./BillRow";

interface ParseSettingsTabProps {
  userEmail: string | undefined;
  onMerchantToggled?: () => void;
}

export default function ParseSettingsTab({ userEmail, onMerchantToggled }: ParseSettingsTabProps) {
  const [merchants, setMerchants] = useState<CorporateMerchantRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  const fetchMerchants = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/brex/corporate-merchants");
      const data = await res.json();
      if (data.merchants) {
        // Apply formatMerchantName to display names
        setMerchants(data.merchants.map((m: CorporateMerchantRule) => ({
          ...m,
          display_name: formatMerchantName(m.display_name),
        })));
      }
    } catch (err) {
      console.error("Failed to fetch corporate merchants:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMerchants();
  }, [fetchMerchants]);

  const handleToggle = useCallback(async (merchant: CorporateMerchantRule) => {
    setTogglingId(merchant.merchant_name_normalized);
    setFeedback(null);

    try {
      if (merchant.is_corporate_merchant) {
        // Disable the rule
        await fetch("/api/admin/brex/corporate-merchants", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            merchant_name_normalized: merchant.merchant_name_normalized,
          }),
        });
        setFeedback({ message: `Removed ${merchant.display_name} from corporate merchants`, type: 'info' });
      } else {
        // Enable the rule
        const res = await fetch("/api/admin/brex/corporate-merchants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            merchant_name_normalized: merchant.merchant_name_normalized,
            display_name: merchant.display_name,
            created_by: userEmail || null,
          }),
        });
        const data = await res.json();
        const count = data.affected_count || 0;
        setFeedback({
          message: count > 0
            ? `Marked ${count} expense${count !== 1 ? 's' : ''} from ${merchant.display_name} as corporate`
            : `${merchant.display_name} added as corporate merchant (all expenses already archived)`,
          type: 'success',
        });
      }

      await fetchMerchants();
      onMerchantToggled?.();
    } catch (err) {
      console.error("Error toggling corporate merchant:", err);
      setFeedback({ message: "Failed to update merchant rule", type: 'info' });
    } finally {
      setTogglingId(null);
      // Auto-clear feedback after 4 seconds
      setTimeout(() => setFeedback(null), 4000);
    }
  }, [fetchMerchants, onMerchantToggled, userEmail]);

  const filtered = useMemo(() => {
    if (!search.trim()) return merchants;
    const q = search.toLowerCase();
    return merchants.filter(m =>
      m.display_name.toLowerCase().includes(q) ||
      m.merchant_name_normalized.toLowerCase().includes(q)
    );
  }, [merchants, search]);

  const corporateCount = useMemo(() => merchants.filter(m => m.is_corporate_merchant).length, [merchants]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading merchants...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-400">
            <span className="text-white font-medium">{merchants.length}</span> merchants
            {" · "}
            <span className="text-amber-400 font-medium">{corporateCount}</span> marked corporate
          </p>
          <p className="text-xs text-slate-600 mt-0.5">
            Checked merchants will automatically have all expenses categorized as corporate
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder="Search merchants..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
        />
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div className={`px-3 py-2 rounded-lg text-sm ${
          feedback.type === 'success'
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
        }`}>
          {feedback.message}
        </div>
      )}

      {/* Merchant list */}
      <div className="border border-white/10 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-800/95 backdrop-blur">
            <tr className="border-b border-white/10">
              <th className="w-10 px-3 py-2.5"></th>
              <th className="text-left px-3 py-2.5 text-slate-400 font-medium">Merchant</th>
              <th className="text-center px-3 py-2.5 text-slate-400 font-medium w-24">Expenses</th>
              <th className="text-center px-3 py-2.5 text-slate-400 font-medium w-24">Corporate</th>
              <th className="text-center px-3 py-2.5 text-slate-400 font-medium w-28">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-slate-500">
                  {search ? "No merchants match your search" : "No merchants found"}
                </td>
              </tr>
            ) : (
              filtered.map((merchant) => {
                const isToggling = togglingId === merchant.merchant_name_normalized;
                const allCorporate = merchant.expense_count > 0 && merchant.corporate_count === merchant.expense_count;

                return (
                  <tr
                    key={merchant.merchant_name_normalized}
                    className={`border-b border-white/5 transition-colors ${
                      merchant.is_corporate_merchant ? 'bg-amber-500/5' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-2.5 text-center">
                      <button
                        onClick={() => handleToggle(merchant)}
                        disabled={isToggling}
                        className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                          merchant.is_corporate_merchant
                            ? 'bg-amber-500 border-amber-500 text-white'
                            : 'border-white/20 hover:border-white/40'
                        } ${isToggling ? 'opacity-50' : ''}`}
                      >
                        {isToggling ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : merchant.is_corporate_merchant ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : null}
                      </button>
                    </td>

                    {/* Merchant name */}
                    <td className="px-3 py-2.5">
                      <span className={`font-medium ${merchant.is_corporate_merchant ? 'text-amber-300' : 'text-white'}`}>
                        {merchant.display_name}
                      </span>
                      <span className="ml-2 text-[10px] text-slate-600 font-mono">
                        {merchant.merchant_name_normalized}
                      </span>
                    </td>

                    {/* Total expenses */}
                    <td className="px-3 py-2.5 text-center text-slate-400">
                      {merchant.expense_count}
                    </td>

                    {/* Corporate count */}
                    <td className="px-3 py-2.5 text-center">
                      <span className={merchant.corporate_count > 0 ? 'text-amber-400' : 'text-slate-600'}>
                        {merchant.corporate_count}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-3 py-2.5 text-center">
                      {merchant.is_corporate_merchant ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/15 text-amber-400">
                          <Building2 className="w-3 h-3" />
                          Corporate
                        </span>
                      ) : allCorporate ? (
                        <span className="text-[10px] text-slate-500">All archived</span>
                      ) : (
                        <span className="text-[10px] text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
