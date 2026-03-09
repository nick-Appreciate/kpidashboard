'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

interface OccupiedUnit {
  unit: string;
  tenant: string;
  rent: number;
  status: string;
  unitCcf: number | null;
  unitCost: number | null;
}

interface PropertyUtility {
  property: string;
  occupiedUnits: number;
  totalUnits: number;
  totalCcf: number;
  totalCost: number;
  costPerUnit: number;
  meterCount: number;
  hasUnitMeters: boolean;
  occupiedUnitsList: OccupiedUnit[];
}

interface Props {
  data: PropertyUtility[];
  loading: boolean;
  timeRange: string;
}

function costColor(cost: number): string {
  if (cost > 50) return 'text-rose-400';
  if (cost > 25) return 'text-amber-400';
  return 'text-emerald-400';
}

export default function BPUOccupiedUnits({ data, loading, timeRange }: Props) {
  const [expandedProperty, setExpandedProperty] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="glass-card">
        <div className="p-4 border-b border-white/10">
          <h3 className="text-lg font-semibold text-white">Occupied Metered Units</h3>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) return null;

  const totalOccupied = data.reduce((s, p) => s + p.occupiedUnits, 0);
  const totalAllUnits = data.reduce((s, p) => s + p.totalUnits, 0);
  const totalMonthlyCost = data.reduce((s, p) => s + p.costPerUnit * p.occupiedUnits, 0);

  const daysLabel = timeRange === 'all' ? 'All Time' : `${timeRange}d`;

  return (
    <div className="glass-card">
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Occupied Metered Units</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {totalOccupied} occupied of {totalAllUnits} total across {data.length} properties
              {' · '}Est. ${totalMonthlyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-800/95 backdrop-blur">
            <tr className="border-b border-white/10">
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Property</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Occupied</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Total</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Meters</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Usage ({daysLabel})</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Cost ({daysLabel})</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">$/Unit/Mo</th>
            </tr>
          </thead>
          <tbody>
            {data.map(p => {
              const isExpanded = expandedProperty === p.property;
              const vacantCount = p.totalUnits - p.occupiedUnits;

              return (
                <tr key={p.property} className="group">
                  <td colSpan={7} className="p-0">
                    {/* Property summary row */}
                    <div
                      className="flex items-center cursor-pointer hover:bg-white/5 transition-colors border-b border-white/5"
                      onClick={() => setExpandedProperty(isExpanded ? null : p.property)}
                    >
                      <div className="px-4 py-3 flex items-center gap-2 flex-1">
                        {isExpanded
                          ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                          : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                        }
                        <span className="text-slate-200 text-xs font-medium">{p.property}</span>
                        {vacantCount > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">
                            {vacantCount} vacant
                          </span>
                        )}
                      </div>
                      <div className="px-4 py-3 text-right text-xs tabular-nums text-cyan-400 w-20">{p.occupiedUnits}</div>
                      <div className="px-4 py-3 text-right text-xs tabular-nums text-slate-400 w-20">{p.totalUnits}</div>
                      <div className="px-4 py-3 text-right text-xs tabular-nums text-slate-400 w-20">{p.meterCount}</div>
                      <div className="px-4 py-3 text-right text-xs tabular-nums text-slate-300 w-28">{p.totalCcf.toFixed(1)} CCF</div>
                      <div className="px-4 py-3 text-right text-xs tabular-nums text-slate-200 w-28">
                        ${p.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                      <div className={`px-4 py-3 text-right text-xs tabular-nums w-28 ${costColor(p.costPerUnit)}`}>
                        ${p.costPerUnit.toFixed(0)}
                      </div>
                    </div>

                    {/* Expanded unit list */}
                    {isExpanded && (
                      <div className="bg-white/[0.02] border-b border-white/5">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-white/5">
                              <th className="px-8 py-2 text-left text-[10px] font-medium text-slate-500 uppercase">Unit</th>
                              <th className="px-4 py-2 text-left text-[10px] font-medium text-slate-500 uppercase">Tenant</th>
                              <th className="px-4 py-2 text-left text-[10px] font-medium text-slate-500 uppercase">Status</th>
                              {p.hasUnitMeters && (
                                <th className="px-4 py-2 text-right text-[10px] font-medium text-slate-500 uppercase">CCF ({daysLabel})</th>
                              )}
                              <th className="px-4 py-2 text-right text-[10px] font-medium text-slate-500 uppercase">$/Unit/Mo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.occupiedUnitsList.map(u => {
                              const displayCost = u.unitCost ?? p.costPerUnit;
                              return (
                                <tr key={u.unit} className="border-b border-white/[0.03] hover:bg-white/5">
                                  <td className="px-8 py-1.5 text-slate-300">{u.unit}</td>
                                  <td className="px-4 py-1.5 text-slate-400 truncate max-w-[200px]">{u.tenant}</td>
                                  <td className="px-4 py-1.5">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                      u.status === 'Current' ? 'bg-emerald-500/10 text-emerald-400' :
                                      u.status === 'Evict' ? 'bg-rose-500/10 text-rose-400' :
                                      'bg-amber-500/10 text-amber-400'
                                    }`}>
                                      {u.status}
                                    </span>
                                  </td>
                                  {p.hasUnitMeters && (
                                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-400">
                                      {u.unitCcf !== null ? u.unitCcf.toFixed(2) : '—'}
                                    </td>
                                  )}
                                  <td className={`px-4 py-1.5 text-right tabular-nums ${costColor(displayCost)}`}>
                                    ${displayCost.toFixed(0)}
                                    {u.unitCost === null && p.hasUnitMeters && (
                                      <span className="text-slate-600 ml-0.5">*</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {p.hasUnitMeters && p.occupiedUnitsList.some(u => u.unitCost === null) && (
                          <p className="px-8 py-2 text-[10px] text-slate-600">* No individual meter — using property average</p>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
