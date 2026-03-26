'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import DarkSelect from './DarkSelect';
import { CHART_PALETTE, RECHARTS_THEME } from '../lib/chartTheme';

// --- Types ---

interface CashFlowRow {
  period_start: string;
  period_end: string;
  account_name: string;
  account_number: string | null;
  account_type: string | null;
  account_depth: number;
  row_type: string;
  parent_account: string | null;
  property_name: string;
  amount: number;
}

interface CoaEntry {
  number: string;
  account_name: string;
  account_type: string;
  sub_accountof: string | null;
}

interface PropertyOwner {
  property_name: string;
  owners: string | null;
  owner_ids: string | null;
  portfolio: string | null;
}

interface ApiResponse {
  data: CashFlowRow[];
  properties: string[];
  coa: CoaEntry[];
  propertyOwners: PropertyOwner[];
}

// --- Constants ---

const METRIC_OPTIONS = [
  { value: 'noi', label: 'NOI' },
  { value: 'total_income', label: 'Total Income' },
  { value: 'total_expense', label: 'Total Expense' },
  { value: 'cash_flow', label: 'Cash Flow' },
  { value: 'capex', label: 'CapEx' },
  { value: 'value', label: 'Estimated Value' },
];

const DATE_RANGE_OPTIONS = [
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
  { value: '24', label: '24 months' },
  { value: 'custom', label: 'Custom' },
];

// --- Helpers ---

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${value < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${value < 0 ? '-' : ''}$${(abs / 1_000).toFixed(1)}k`;
  return `${value < 0 ? '-' : ''}$${abs.toFixed(0)}`;
}

function formatFullCurrency(value: number): string {
  if (value === 0) return '-';
  return `${value < 0 ? '(' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${value < 0 ? ')' : ''}`;
}

function formatMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-');
  const d = new Date(parseInt(y), parseInt(m) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

interface TableRow {
  type: 'section' | 'account' | 'subtotal' | 'summary' | 'spacer';
  label: string;
  indent: number;
  amounts: Record<string, number>;
  bold?: boolean;
  highlight?: boolean;
}

// --- Component ---

export default function FinancialsDashboard() {
  const [data, setData] = useState<CashFlowRow[]>([]);
  const [properties, setProperties] = useState<string[]>([]);
  const [coa, setCoa] = useState<CoaEntry[]>([]);
  const [propertyOwners, setPropertyOwners] = useState<PropertyOwner[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedProperty, setSelectedProperty] = useState('Total');
  const [selectedOwner, setSelectedOwner] = useState('all');
  const [selectedMetric, setSelectedMetric] = useState('noi');
  const [dateRange, setDateRange] = useState('12');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [selectedTablePeriod, setSelectedTablePeriod] = useState('latest');
  const [tableCustomStart, setTableCustomStart] = useState('');
  const [tableCustomEnd, setTableCustomEnd] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const months = dateRange === 'custom' ? '24' : dateRange;
      const res = await fetch(`/api/financials/cash-flow?months=${months}`);
      if (res.ok) {
        const json: ApiResponse = await res.json();
        setData(json.data || []);
        setProperties(json.properties || []);
        setCoa(json.coa || []);
        setPropertyOwners(json.propertyOwners || []);
      }
    } catch (err) {
      console.error('Error fetching cash flow data:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Build owner -> properties map
  const ownerOptions = useMemo(() => {
    const ownerMap = new Map<string, string[]>();
    for (const po of propertyOwners) {
      if (po.owners && po.property_name) {
        if (!ownerMap.has(po.owners)) ownerMap.set(po.owners, []);
        ownerMap.get(po.owners)!.push(po.property_name);
      }
    }
    return [
      { value: 'all', label: 'All Owners' },
      ...Array.from(ownerMap.keys()).sort().map(o => ({ value: o, label: o }))
    ];
  }, [propertyOwners]);

  // Get properties for selected owner
  const ownerPropertyFilter = useMemo(() => {
    if (selectedOwner === 'all') return null;
    return propertyOwners.filter(po => po.owners === selectedOwner).map(po => po.property_name);
  }, [selectedOwner, propertyOwners]);

  // Property options filtered by owner
  const propertyOptions = useMemo(() => {
    let props = properties;
    if (ownerPropertyFilter) {
      props = properties.filter(p => ownerPropertyFilter.includes(p));
    }
    return [
      { value: 'Total', label: 'Portfolio (Total)' },
      ...props.map(p => ({ value: p, label: p }))
    ];
  }, [properties, ownerPropertyFilter]);

  // Reset property selection when owner changes
  useEffect(() => {
    if (selectedOwner !== 'all' && selectedProperty !== 'Total') {
      if (ownerPropertyFilter && !ownerPropertyFilter.includes(selectedProperty)) {
        setSelectedProperty('Total');
      }
    }
  }, [selectedOwner, ownerPropertyFilter, selectedProperty]);

  // Chart data
  const chartData = useMemo(() => {
    const CAP_RATE = 0.07;
    const isCapex = selectedMetric === 'capex';
    const isValue = selectedMetric === 'value';

    // When an owner is selected and property is "Total", sum that owner's properties
    const ownerSumMode = selectedProperty === 'Total' && ownerPropertyFilter != null;
    const relevantProperties = ownerSumMode
      ? ownerPropertyFilter!
      : selectedProperty === 'Total'
        ? ['Total']
        : [selectedProperty];

    const metricRows = isCapex
      ? data.filter(r => ['other', 'other_expense'].includes(r.row_type) && r.account_name.toLowerCase().includes('capex'))
      : isValue
        ? data.filter(r => r.row_type === 'noi')
        : data.filter(r => r.row_type === selectedMetric);

    const byPeriod = new Map<string, Record<string, any>>();
    for (const row of metricRows) {
      if (!relevantProperties.includes(row.property_name)) continue;
      if (dateRange === 'custom') {
        if (customStart && row.period_start < customStart) continue;
        if (customEnd && row.period_start > customEnd) continue;
      }
      if (!byPeriod.has(row.period_start)) {
        byPeriod.set(row.period_start, { period: row.period_start });
      }
      const entry = byPeriod.get(row.period_start)!;
      if (ownerSumMode) {
        // Sum all owner's properties into a single "Owner Total" line
        entry['Total'] = (entry['Total'] || 0) + row.amount;
      } else {
        entry[row.property_name] = (entry[row.property_name] || 0) + row.amount;
      }
    }

    // CapEx values are negative (outflows) — show as positive for charting
    if (isCapex) {
      for (const entry of byPeriod.values()) {
        for (const key of Object.keys(entry)) {
          if (key !== 'period' && typeof entry[key] === 'number') {
            entry[key] = Math.abs(entry[key]);
          }
        }
      }
    }

    // Value = (monthly NOI * 12) / cap rate
    if (isValue) {
      for (const entry of byPeriod.values()) {
        for (const key of Object.keys(entry)) {
          if (key !== 'period' && typeof entry[key] === 'number') {
            entry[key] = (entry[key] * 12) / CAP_RATE;
          }
        }
      }
    }

    return Array.from(byPeriod.values()).sort((a, b) => String(a.period).localeCompare(String(b.period)));
  }, [data, selectedMetric, selectedProperty, dateRange, customStart, customEnd, ownerPropertyFilter]);

  const lineKeys = useMemo(() => selectedProperty === 'Total' ? ['Total'] : [selectedProperty], [selectedProperty]);

  // Stat cards — reflect owner filter
  const stats = useMemo(() => {
    if (data.length === 0) return null;
    const periods = Array.from(new Set(data.map(r => r.period_start))).sort();
    const latestPeriod = periods[periods.length - 1];
    if (!latestPeriod) return null;

    if (ownerPropertyFilter) {
      // Sum across owner's properties for summary row_types
      const latest = data.filter(r => r.period_start === latestPeriod && ownerPropertyFilter.includes(r.property_name));
      const sum = (type: string) => latest.filter(r => r.row_type === type).reduce((s, r) => s + r.amount, 0);
      return { period: latestPeriod, noi: sum('noi'), totalIncome: sum('total_income'), totalExpense: sum('total_expense'), cashFlow: sum('cash_flow') };
    }

    const latest = data.filter(r => r.period_start === latestPeriod && r.property_name === 'Total');
    const get = (type: string) => latest.find(r => r.row_type === type)?.amount || 0;
    return { period: latestPeriod, noi: get('noi'), totalIncome: get('total_income'), totalExpense: get('total_expense'), cashFlow: get('cash_flow') };
  }, [data, ownerPropertyFilter]);

  // Available periods for the table month selector
  const periodOptions = useMemo(() => {
    const periods = Array.from(new Set(data.map(r => r.period_start))).sort();
    return [
      { value: 'latest', label: 'Latest Month' },
      { value: 'custom', label: 'Custom Range' },
      ...periods.map(p => ({ value: p, label: formatMonth(p) }))
    ];
  }, [data]);

  // Build the property comparison table
  const summaryTable = useMemo(() => {
    if (data.length === 0) return { rows: [] as TableRow[], propCols: [] as string[] };

    const periods = Array.from(new Set(data.map(r => r.period_start))).sort();
    const latestPeriod = periods[periods.length - 1];
    if (!latestPeriod) return { rows: [] as TableRow[], propCols: [] as string[], periodLabel: '' };

    // Determine which period(s) to show
    let filteredData: CashFlowRow[];
    let periodLabel: string;

    if (selectedTablePeriod === 'custom' && tableCustomStart && tableCustomEnd) {
      // Custom range: aggregate across multiple months
      filteredData = data.filter(r => r.period_start >= tableCustomStart && r.period_start <= tableCustomEnd);
      periodLabel = `${formatMonth(tableCustomStart)} - ${formatMonth(tableCustomEnd)}`;
    } else if (selectedTablePeriod !== 'latest' && selectedTablePeriod !== 'custom') {
      // Specific month
      filteredData = data.filter(r => r.period_start === selectedTablePeriod);
      periodLabel = formatMonth(selectedTablePeriod);
    } else {
      // Latest month (default)
      filteredData = data.filter(r => r.period_start === latestPeriod);
      periodLabel = formatMonth(latestPeriod);
    }

    if (filteredData.length === 0) return { rows: [] as TableRow[], propCols: [] as string[], periodLabel };

    // For custom ranges, aggregate amounts by account + property
    const aggregated = new Map<string, CashFlowRow>();
    for (const row of filteredData) {
      const key = `${row.account_name}|||${row.property_name}`;
      if (!aggregated.has(key)) {
        aggregated.set(key, { ...row, amount: 0 });
      }
      aggregated.get(key)!.amount += row.amount;
    }
    const latestData = Array.from(aggregated.values());

    // Property columns filtered by owner, then Total last
    let propCols = Array.from(new Set(latestData.map(r => r.property_name).filter(p => p !== 'Total'))).sort();
    if (ownerPropertyFilter) {
      propCols = propCols.filter(p => ownerPropertyFilter.includes(p));
    }
    propCols.push('Total');

    // Build account_name -> { property -> amount } lookup
    const amountLookup = new Map<string, Record<string, number>>();
    for (const row of latestData) {
      if (!amountLookup.has(row.account_name)) amountLookup.set(row.account_name, {});
      amountLookup.get(row.account_name)![row.property_name] = row.amount;
    }

    // COA sort map
    const coaSortMap = new Map<string, number>();
    coa.forEach((c, i) => { if (c.number) coaSortMap.set(c.number, i); });

    // Group data rows by type (use Total property as the representative)
    const incomeRows = latestData.filter(r => r.row_type === 'income' && r.property_name === 'Total');
    const expenseRows = latestData.filter(r => r.row_type === 'expense' && r.property_name === 'Total');
    const otherRows = latestData.filter(r => ['other', 'other_income', 'other_expense'].includes(r.row_type) && r.property_name === 'Total');

    const sortByAcctNum = (a: CashFlowRow, b: CashFlowRow) => {
      const ai = coaSortMap.get(a.account_number || '') ?? 9999;
      const bi = coaSortMap.get(b.account_number || '') ?? 9999;
      return ai - bi;
    };
    incomeRows.sort(sortByAcctNum);
    expenseRows.sort(sortByAcctNum);
    otherRows.sort(sortByAcctNum);

    const tableRows: TableRow[] = [];

    const addAccountRow = (r: CashFlowRow, indent: number) => {
      tableRows.push({ type: 'account', label: r.account_name, indent, amounts: amountLookup.get(r.account_name) || {} });
    };

    const addSummaryRow = (label: string, indent: number, highlight: boolean) => {
      tableRows.push({ type: 'summary', label, indent, amounts: amountLookup.get(label) || {}, bold: true, highlight });
    };

    // ---- INCOME ----
    tableRows.push({ type: 'section', label: 'Operating Income & Expense', indent: 0, amounts: {}, bold: true });
    tableRows.push({ type: 'section', label: 'Income', indent: 1, amounts: {}, bold: true });
    for (const r of incomeRows) addAccountRow(r, r.parent_account ? 3 : 2);
    addSummaryRow('Total Operating Income', 1, false);

    // ---- EXPENSE ----
    tableRows.push({ type: 'section', label: 'Expense', indent: 1, amounts: {}, bold: true });
    for (const r of expenseRows) addAccountRow(r, r.parent_account ? 3 : 2);
    addSummaryRow('Total Operating Expense', 1, false);

    // ---- NOI ----
    tableRows.push({ type: 'spacer', label: '', indent: 0, amounts: {} });
    addSummaryRow('NOI - Net Operating Income', 1, true);

    // ---- OTHER ITEMS ----
    if (otherRows.length > 0) {
      tableRows.push({ type: 'spacer', label: '', indent: 0, amounts: {} });
      tableRows.push({ type: 'section', label: 'Other Items', indent: 1, amounts: {}, bold: true });
      for (const r of otherRows) addAccountRow(r, 2);
      addSummaryRow('Net Other Items', 1, false);
    }

    // ---- CASH FLOW ----
    tableRows.push({ type: 'spacer', label: '', indent: 0, amounts: {} });
    addSummaryRow('Cash Flow', 0, true);

    return { rows: tableRows, propCols, periodLabel };
  }, [data, coa, ownerPropertyFilter, selectedTablePeriod, tableCustomStart, tableCustomEnd]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-[var(--surface-overlay)] border border-white/10 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[200px]">
        <p className="font-medium text-slate-300 mb-1.5">{formatMonth(label)}</p>
        {payload.map((entry: any, i: number) => (
          <p key={i} style={{ color: entry.color }} className="flex justify-between gap-4 font-semibold">
            <span className="truncate">{entry.name}</span>
            <span className="tabular-nums">{formatFullCurrency(Number(entry.value))}</span>
          </p>
        ))}
      </div>
    );
  };

  const metricLabel = METRIC_OPTIONS.find(m => m.value === selectedMetric)?.label || selectedMetric;

  if (loading && data.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold text-white">Financials</h1>
        <div className="glass-card p-6">
          <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: '3' }}>
            Loading cash flow data...
          </div>
        </div>
      </div>
    );
  }

  const noData = data.length === 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header + Filters */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Financials</h1>
          {loading && <span className="text-xs text-slate-500">Refreshing...</span>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DarkSelect value={selectedOwner} onChange={setSelectedOwner} options={ownerOptions} searchable />
          <DarkSelect value={selectedProperty} onChange={setSelectedProperty} options={propertyOptions} searchable />
          <DarkSelect value={selectedMetric} onChange={setSelectedMetric} options={METRIC_OPTIONS} />
          <DarkSelect value={dateRange} onChange={setDateRange} options={DATE_RANGE_OPTIONS} />
          {dateRange === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input type="month" value={customStart} onChange={e => setCustomStart(e.target.value)} className="dark-input text-xs px-2 py-1.5" />
              <span className="text-xs text-slate-500">to</span>
              <input type="month" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="dark-input text-xs px-2 py-1.5" />
            </div>
          )}
        </div>
      </div>

      {noData ? (
        <div className="glass-card p-6 text-center text-slate-500">
          No cash flow data available. Run the AppFolio sync with <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded">?report=cash_flow</code> to populate data.
        </div>
      ) : (
        <>
          {/* Line Chart */}
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              {metricLabel} — {selectedProperty === 'Total' ? 'Portfolio' : selectedProperty}
            </h2>
            {chartData.length === 0 ? (
              <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: '3' }}>
                No data for selected filters
              </div>
            ) : (
              <ResponsiveContainer width="100%" aspect={3}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={RECHARTS_THEME.grid.stroke} />
                  <XAxis dataKey="period" tickFormatter={formatMonth} stroke={RECHARTS_THEME.axis.stroke} fontSize={RECHARTS_THEME.axis.fontSize} fontFamily={RECHARTS_THEME.axis.fontFamily} />
                  <YAxis tickFormatter={formatCurrency} stroke={RECHARTS_THEME.axis.stroke} fontSize={RECHARTS_THEME.axis.fontSize} fontFamily={RECHARTS_THEME.axis.fontFamily} width={70} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                  {lineKeys.map((key, i) => (
                    <Line key={key} type="monotone" dataKey={key} name={key === 'Total' ? 'Portfolio Total' : key}
                      stroke={CHART_PALETTE[i % CHART_PALETTE.length]} strokeWidth={2}
                      dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Stat Cards */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="NOI" value={stats.noi} period={stats.period} color="text-cyan-400" />
              <StatCard label="Total Income" value={stats.totalIncome} period={stats.period} color="text-emerald-400" />
              <StatCard label="Total Expense" value={stats.totalExpense} period={stats.period} color="text-rose-400" />
              <StatCard label="Cash Flow" value={stats.cashFlow} period={stats.period} color="text-amber-400" />
            </div>
          )}

          {/* Property Comparison Table */}
          {summaryTable.rows.length > 0 && (
            <div className="glass-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-semibold text-white">
                  Cash Flow — Property Comparison — {summaryTable.periodLabel}
                  {selectedOwner !== 'all' && <span className="text-sm font-normal text-slate-400 ml-2">({selectedOwner})</span>}
                </h2>
                <div className="flex items-center gap-2">
                  <DarkSelect value={selectedTablePeriod} onChange={setSelectedTablePeriod} options={periodOptions} compact />
                  {selectedTablePeriod === 'custom' && (
                    <div className="flex items-center gap-1.5">
                      <input type="month" value={tableCustomStart} onChange={e => setTableCustomStart(e.target.value)} className="dark-input text-xs px-2 py-1" />
                      <span className="text-xs text-slate-500">to</span>
                      <input type="month" value={tableCustomEnd} onChange={e => setTableCustomEnd(e.target.value)} className="dark-input text-xs px-2 py-1" />
                    </div>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto relative">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 z-20">
                    <tr>
                      <th className="text-left text-slate-400 font-medium px-3 py-2 border-b border-white/10 min-w-[280px] sticky left-0 z-30 bg-[var(--surface-raised)]">
                        Account Name
                      </th>
                      {summaryTable.propCols.map(prop => (
                        <th key={prop} className={`text-right text-slate-400 font-medium px-3 py-2 border-b border-white/10 min-w-[110px] whitespace-nowrap bg-[var(--surface-raised)] ${prop === 'Total' ? 'font-semibold text-slate-300' : ''}`}>
                          {prop}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summaryTable.rows.map((row, idx) => {
                      if (row.type === 'spacer') {
                        return <tr key={idx}><td colSpan={summaryTable.propCols.length + 1} className="py-1.5 bg-[var(--surface-raised)]" /></tr>;
                      }

                      const isSection = row.type === 'section';
                      const isSummary = row.type === 'summary';
                      const isBold = row.bold || isSummary;
                      const isHighlight = row.highlight;

                      // Use opaque bg for sticky column — semi-transparent causes bleed-through
                      const rowBg = isHighlight ? 'bg-[#0c1e2e]' : 'bg-[var(--surface-raised)]';

                      return (
                        <tr key={idx} className={`${isSummary && !isHighlight ? 'border-t border-white/10' : 'border-b border-white/[0.03]'} hover:bg-white/[0.04] transition-colors`}>
                          <td
                            className={`px-3 py-1.5 whitespace-nowrap sticky left-0 z-10 ${rowBg} ${isBold ? 'font-semibold text-slate-200' : 'text-slate-400'}`}
                            style={{ paddingLeft: `${12 + row.indent * 16}px` }}
                          >
                            {row.label}
                          </td>
                          {isSection ? (
                            summaryTable.propCols.map(prop => (
                              <td key={prop} className={rowBg} />
                            ))
                          ) : (
                            summaryTable.propCols.map(prop => {
                              const val = row.amounts[prop];
                              const hasVal = val != null && val !== 0;
                              return (
                                <td key={prop} className={`text-right px-3 py-1.5 tabular-nums ${rowBg} ${prop === 'Total' ? 'font-medium' : ''} ${isBold ? 'font-semibold text-slate-200' : 'text-slate-400'} ${hasVal && val < 0 ? '!text-red-400' : ''}`}>
                                  {hasVal ? formatFullCurrency(val) : '-'}
                                </td>
                              );
                            })
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, period, color }: { label: string; value: number; period: string; color: string }) {
  return (
    <div className="glass-stat p-4">
      <p className="text-slate-500 text-xs mb-1">{label}</p>
      <p className={`text-xl font-bold ${value < 0 ? 'text-red-400' : color}`}>
        {formatFullCurrency(value)}
      </p>
      <p className="text-slate-600 text-xs mt-1">{formatMonth(period)}</p>
    </div>
  );
}
