'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
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

const SUMMARY_METRICS = [
  { value: 'noi', label: 'NOI' },
  { value: 'total_income', label: 'Total Income' },
  { value: 'total_expense', label: 'Total Expense' },
  { value: 'cash_flow', label: 'Cash Flow' },
  { value: 'capex', label: 'CapEx' },
  { value: 'value', label: 'Estimated Value' },
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

  // View mode
  const [viewMode, setViewMode] = useState<'byMonth' | 'byProperty'>('byMonth');

  // Snapshot mode — controls which historical snapshot of each month we read.
  // 'day_of_month' (default): for each month, the snapshot taken on today's
  //   day-of-month (e.g. if today is the 20th, shows each month's 20th).
  //   Apples-to-apples MTD comparison.
  // 'month_end': past months → final-day snapshot, current month → latest.
  //   Useful for comparing completed-month finals against month-to-date.
  const [snapshotMode, setSnapshotMode] = useState<'day_of_month' | 'month_end'>('day_of_month');

  // Filters
  const [selectedProperty, setSelectedProperty] = useState('Total');
  const [selectedOwner, setSelectedOwner] = useState('all');
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(['noi']);
  const [metricDropdownOpen, setMetricDropdownOpen] = useState(false);
  const [metricSearch, setMetricSearch] = useState('');
  const metricDropdownRef = useRef<HTMLDivElement>(null);

  // Close metric dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (metricDropdownRef.current && !metricDropdownRef.current.contains(e.target as Node)) {
        setMetricDropdownOpen(false);
        setMetricSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleMetric = useCallback((val: string) => {
    setSelectedMetrics(prev => {
      if (prev.includes(val)) return prev.length > 1 ? prev.filter(m => m !== val) : prev; // keep at least one
      return [...prev, val];
    });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/financials/cash-flow?months=24&mode=${snapshotMode}`);
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
  }, [snapshotMode]);

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

  // Build metric options: summary metrics + GL accounts from COA
  const metricOptions = useMemo(() => {
    const options = [...SUMMARY_METRICS];
    if (coa.length === 0) return options;

    const incomeAccts = coa.filter(c => c.account_type === 'Income');
    const expenseAccts = coa.filter(c => c.account_type === 'Expense');
    const otherAccts = coa.filter(c => !['Income', 'Expense'].includes(c.account_type));

    if (incomeAccts.length > 0) {
      options.push({ value: '__divider_income', label: '── Income Accounts ──' });
      for (const a of incomeAccts) options.push({ value: `gl:${a.account_name}`, label: a.account_name });
    }
    if (expenseAccts.length > 0) {
      options.push({ value: '__divider_expense', label: '── Expense Accounts ──' });
      for (const a of expenseAccts) options.push({ value: `gl:${a.account_name}`, label: a.account_name });
    }
    if (otherAccts.length > 0) {
      options.push({ value: '__divider_other', label: '── Other Accounts ──' });
      for (const a of otherAccts) options.push({ value: `gl:${a.account_name}`, label: a.account_name });
    }
    return options;
  }, [coa]);

  // Reset property selection when owner changes
  useEffect(() => {
    if (selectedOwner !== 'all' && selectedProperty !== 'Total') {
      if (ownerPropertyFilter && !ownerPropertyFilter.includes(selectedProperty)) {
        setSelectedProperty('Total');
      }
    }
  }, [selectedOwner, ownerPropertyFilter, selectedProperty]);

  // Resolve metric filter to data rows
  const getMetricRows = useCallback((metric: string, rawData: CashFlowRow[]) => {
    const isCapex = metric === 'capex';
    const isValue = metric === 'value';
    const isGL = metric.startsWith('gl:');

    if (isCapex) return rawData.filter(r => ['other', 'other_expense'].includes(r.row_type) && r.account_name.toLowerCase().includes('capex'));
    if (isValue) return rawData.filter(r => r.row_type === 'noi');
    if (isGL) {
      const glName = metric.slice(3);
      return rawData.filter(r => r.account_name === glName);
    }
    return rawData.filter(r => r.row_type === metric);
  }, []);

  // Resolve metric label
  const getMetricLabel = useCallback((m: string) => {
    const found = metricOptions.find(o => o.value === m);
    if (found) return found.label;
    return m.startsWith('gl:') ? m.slice(3) : m;
  }, [metricOptions]);

  // Chart data — supports multiple metrics
  const { chartData, chartKeys } = useMemo(() => {
    const CAP_RATE = 0.065;
    const ownerSumMode = selectedProperty === 'Total' && ownerPropertyFilter != null;
    const relevantProperties = ownerSumMode
      ? ownerPropertyFilter!
      : selectedProperty === 'Total' ? ['Total'] : [selectedProperty];

    if (viewMode === 'byProperty') {
      // By Property: X-axis = properties, default to current (latest) month
      const periods = Array.from(new Set(data.map(r => r.period_start))).sort();
      const latestPeriod = periods[periods.length - 1];
      const propList = (ownerPropertyFilter || properties).slice().sort();
      const result = propList.map(p => {
        const entry: Record<string, any> = { property: p };
        for (const metric of selectedMetrics) {
          const rows = getMetricRows(metric, data).filter(r => r.property_name === p && r.period_start === latestPeriod);
          let val = rows.reduce((s, r) => s + r.amount, 0);
          if (metric === 'capex') val = Math.abs(val);
          if (metric === 'value') val = (val * 12) / CAP_RATE;
          entry[getMetricLabel(metric)] = val;
        }
        return entry;
      });
      return { chartData: result, chartKeys: selectedMetrics.map(getMetricLabel) };
    }

    // By Month: X-axis = periods, one line per metric
    const byPeriod = new Map<string, Record<string, any>>();
    for (const metric of selectedMetrics) {
      const metricRows = getMetricRows(metric, data);
      const label = getMetricLabel(metric);
      for (const row of metricRows) {
        if (!relevantProperties.includes(row.property_name)) continue;
        if (!byPeriod.has(row.period_start)) {
          byPeriod.set(row.period_start, { period: row.period_start });
        }
        const entry = byPeriod.get(row.period_start)!;
        if (ownerSumMode) {
          entry[label] = (entry[label] || 0) + row.amount;
        } else {
          entry[label] = (entry[label] || 0) + row.amount;
        }
      }
      // Post-process capex/value
      if (metric === 'capex') {
        for (const entry of Array.from(byPeriod.values())) {
          if (typeof entry[label] === 'number') entry[label] = Math.abs(entry[label]);
        }
      }
      if (metric === 'value') {
        for (const entry of Array.from(byPeriod.values())) {
          if (typeof entry[label] === 'number') entry[label] = (entry[label] * 12) / CAP_RATE;
        }
      }
    }

    return {
      chartData: Array.from(byPeriod.values()).sort((a, b) => String(a.period).localeCompare(String(b.period))),
      chartKeys: selectedMetrics.map(getMetricLabel),
    };
  }, [data, selectedMetrics, selectedProperty, ownerPropertyFilter, viewMode, properties, getMetricRows, getMetricLabel]);

  // Stat cards — always show latest month
  const stats = useMemo(() => {
    if (data.length === 0) return null;
    const periods = Array.from(new Set(data.map(r => r.period_start))).sort();
    const latestPeriod = periods[periods.length - 1];
    if (!latestPeriod) return null;

    const label = formatMonth(latestPeriod);

    if (ownerPropertyFilter) {
      const filtered = data.filter(r => r.period_start === latestPeriod && ownerPropertyFilter.includes(r.property_name));
      const sum = (type: string) => filtered.filter(r => r.row_type === type).reduce((s, r) => s + r.amount, 0);
      return { periodLabel: label, noi: sum('noi'), totalIncome: sum('total_income'), totalExpense: sum('total_expense'), cashFlow: sum('cash_flow') };
    }

    const filtered = data.filter(r => r.period_start === latestPeriod && r.property_name === 'Total');
    const sum = (type: string) => filtered.filter(r => r.row_type === type).reduce((s, r) => s + r.amount, 0);
    return { periodLabel: label, noi: sum('noi'), totalIncome: sum('total_income'), totalExpense: sum('total_expense'), cashFlow: sum('cash_flow') };
  }, [data, ownerPropertyFilter]);


  // Build the detail table
  const summaryTable = useMemo(() => {
    if (data.length === 0) return { rows: [] as TableRow[], columns: [] as { key: string; label: string }[], title: '' };

    const periods = Array.from(new Set(data.map(r => r.period_start))).sort();
    const latestPeriod = periods[periods.length - 1];
    if (!latestPeriod) return { rows: [] as TableRow[], columns: [] as { key: string; label: string }[], title: '' };

    // COA sort map
    const coaSortMap = new Map<string, number>();
    coa.forEach((c, i) => { if (c.number) coaSortMap.set(c.number, i); });
    const sortByAcctNum = (a: CashFlowRow, b: CashFlowRow) => {
      const ai = coaSortMap.get(a.account_number || '') ?? 9999;
      const bi = coaSortMap.get(b.account_number || '') ?? 9999;
      return ai - bi;
    };

    // --- BY MONTH: columns = months, rows = accounts for selected property ---
    if (viewMode === 'byMonth') {
      // Determine which property's data to show
      const ownerSumMode = selectedProperty === 'Total' && ownerPropertyFilter != null;
      const targetProp = ownerSumMode ? null : selectedProperty; // null = sum owner props

      // Filter data to relevant property/properties
      let filteredData: CashFlowRow[];
      if (ownerSumMode) {
        filteredData = data.filter(r => ownerPropertyFilter!.includes(r.property_name));
      } else {
        filteredData = data.filter(r => r.property_name === (targetProp || 'Total'));
      }

      // Build lookup: account_name -> { period -> amount }
      const amountLookup = new Map<string, Record<string, number>>();
      for (const row of filteredData) {
        if (!amountLookup.has(row.account_name)) amountLookup.set(row.account_name, {});
        const entry = amountLookup.get(row.account_name)!;
        entry[row.period_start] = (entry[row.period_start] || 0) + row.amount;
      }

      // Columns = each period
      const columns = periods.map(p => ({ key: p, label: formatMonth(p) }));

      // Use 'Total' property rows as the representative for row structure
      const repProp = ownerSumMode ? ownerPropertyFilter![0] : (targetProp || 'Total');
      const repData = data.filter(r => r.property_name === repProp);
      const incomeRows = repData.filter(r => r.row_type === 'income');
      const expenseRows = repData.filter(r => r.row_type === 'expense');
      const otherRows = repData.filter(r => ['other', 'other_income', 'other_expense'].includes(r.row_type));
      // Deduplicate by account_name (since we have multiple periods)
      const dedup = (rows: CashFlowRow[]) => {
        const seen = new Set<string>();
        return rows.filter(r => { if (seen.has(r.account_name)) return false; seen.add(r.account_name); return true; });
      };
      const uniqueIncome = dedup(incomeRows).sort(sortByAcctNum);
      const uniqueExpense = dedup(expenseRows).sort(sortByAcctNum);
      const uniqueOther = dedup(otherRows).sort(sortByAcctNum);

      const tableRows: TableRow[] = [];
      const addRow = (r: CashFlowRow, indent: number) => {
        tableRows.push({ type: 'account', label: r.account_name, indent, amounts: amountLookup.get(r.account_name) || {} });
      };
      const addSummary = (label: string, indent: number, highlight: boolean) => {
        tableRows.push({ type: 'summary', label, indent, amounts: amountLookup.get(label) || {}, bold: true, highlight });
      };

      tableRows.push({ type: 'section', label: 'Operating Income & Expense', indent: 0, amounts: {}, bold: true });
      tableRows.push({ type: 'section', label: 'Income', indent: 1, amounts: {}, bold: true });
      for (const r of uniqueIncome) addRow(r, r.parent_account ? 3 : 2);
      addSummary('Total Operating Income', 1, false);

      tableRows.push({ type: 'section', label: 'Expense', indent: 1, amounts: {}, bold: true });
      for (const r of uniqueExpense) addRow(r, r.parent_account ? 3 : 2);
      addSummary('Total Operating Expense', 1, false);

      tableRows.push({ type: 'spacer', label: '', indent: 0, amounts: {} });
      addSummary('NOI - Net Operating Income', 1, true);

      if (uniqueOther.length > 0) {
        tableRows.push({ type: 'spacer', label: '', indent: 0, amounts: {} });
        tableRows.push({ type: 'section', label: 'Other Items', indent: 1, amounts: {}, bold: true });
        for (const r of uniqueOther) addRow(r, 2);
        addSummary('Net Other Items', 1, false);
      }

      tableRows.push({ type: 'spacer', label: '', indent: 0, amounts: {} });
      addSummary('Cash Flow', 0, true);

      const propLabel = selectedProperty === 'Total' ? 'Portfolio' : selectedProperty;
      return { rows: tableRows, columns, title: `Cash Flow — ${propLabel} — Monthly` };
    }

    // --- BY PROPERTY: columns = properties, T-12 aggregation ---
    const aggregated = new Map<string, CashFlowRow>();
    for (const row of data) {
      const key = `${row.account_name}|||${row.property_name}`;
      if (!aggregated.has(key)) {
        aggregated.set(key, { ...row, amount: 0 });
      }
      aggregated.get(key)!.amount += row.amount;
    }
    const latestData = Array.from(aggregated.values());

    let propCols = Array.from(new Set(latestData.map(r => r.property_name).filter(p => p !== 'Total'))).sort();
    if (ownerPropertyFilter) {
      propCols = propCols.filter(p => ownerPropertyFilter.includes(p));
    }
    propCols.push('Total');
    const columns = propCols.map(p => ({ key: p, label: p }));

    const amountLookup = new Map<string, Record<string, number>>();
    for (const row of latestData) {
      if (!amountLookup.has(row.account_name)) amountLookup.set(row.account_name, {});
      amountLookup.get(row.account_name)![row.property_name] = row.amount;
    }

    const incomeRows = latestData.filter(r => r.row_type === 'income' && r.property_name === 'Total');
    const expenseRows = latestData.filter(r => r.row_type === 'expense' && r.property_name === 'Total');
    const otherRows = latestData.filter(r => ['other', 'other_income', 'other_expense'].includes(r.row_type) && r.property_name === 'Total');
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

    tableRows.push({ type: 'section', label: 'Operating Income & Expense', indent: 0, amounts: {}, bold: true });
    tableRows.push({ type: 'section', label: 'Income', indent: 1, amounts: {}, bold: true });
    for (const r of incomeRows) addAccountRow(r, r.parent_account ? 3 : 2);
    addSummaryRow('Total Operating Income', 1, false);

    tableRows.push({ type: 'section', label: 'Expense', indent: 1, amounts: {}, bold: true });
    for (const r of expenseRows) addAccountRow(r, r.parent_account ? 3 : 2);
    addSummaryRow('Total Operating Expense', 1, false);

    tableRows.push({ type: 'spacer', label: '', indent: 0, amounts: {} });
    addSummaryRow('NOI - Net Operating Income', 1, true);

    if (otherRows.length > 0) {
      tableRows.push({ type: 'spacer', label: '', indent: 0, amounts: {} });
      tableRows.push({ type: 'section', label: 'Other Items', indent: 1, amounts: {}, bold: true });
      for (const r of otherRows) addAccountRow(r, 2);
      addSummaryRow('Net Other Items', 1, false);
    }

    tableRows.push({ type: 'spacer', label: '', indent: 0, amounts: {} });
    addSummaryRow('Cash Flow', 0, true);

    return { rows: tableRows, columns, title: 'Cash Flow — Property Comparison — Trailing 12 Months' };
  }, [data, coa, ownerPropertyFilter, viewMode, selectedProperty]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const labelText = viewMode === 'byProperty' ? label : formatMonth(label);
    return (
      <div className="bg-[var(--surface-overlay)] border border-white/10 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[200px]">
        <p className="font-medium text-slate-300 mb-1.5">{labelText}</p>
        {payload.map((entry: any, i: number) => (
          <p key={i} style={{ color: entry.color }} className="flex justify-between gap-4 font-semibold">
            <span className="truncate">{entry.name}</span>
            <span className="tabular-nums">{formatFullCurrency(Number(entry.value))}</span>
          </p>
        ))}
      </div>
    );
  };

  const metricLabel = selectedMetrics.map(getMetricLabel).join(', ');

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
          {/* View Mode Toggle */}
          <div className="inline-flex rounded-md border border-white/10 overflow-hidden">
            <button
              onClick={() => setViewMode('byMonth')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'byMonth' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' : 'text-slate-400 hover:text-slate-300 hover:bg-white/5'}`}
            >By Month</button>
            <button
              onClick={() => setViewMode('byProperty')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-white/10 ${viewMode === 'byProperty' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' : 'text-slate-400 hover:text-slate-300 hover:bg-white/5'}`}
            >By Property</button>
          </div>
          {/* Snapshot Mode Toggle */}
          <div
            className="inline-flex rounded-md border border-white/10 overflow-hidden"
            title={
              snapshotMode === 'day_of_month'
                ? `Apples-to-apples: each month shown as of today's day-of-month`
                : `Past months shown as of the last day of the month; current month shown as of today`
            }
          >
            <button
              onClick={() => setSnapshotMode('day_of_month')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${snapshotMode === 'day_of_month' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' : 'text-slate-400 hover:text-slate-300 hover:bg-white/5'}`}
            >Day of Month</button>
            <button
              onClick={() => setSnapshotMode('month_end')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-white/10 ${snapshotMode === 'month_end' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' : 'text-slate-400 hover:text-slate-300 hover:bg-white/5'}`}
            >Month End</button>
          </div>
          <DarkSelect value={selectedOwner} onChange={setSelectedOwner} options={ownerOptions} searchable />
          <DarkSelect value={selectedProperty} onChange={setSelectedProperty} options={propertyOptions} searchable />
          {/* Multi-select metric dropdown */}
          <div className="relative" ref={metricDropdownRef}>
            <button
              onClick={() => setMetricDropdownOpen(o => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-white/10 bg-[var(--surface-raised)] text-slate-300 hover:bg-white/5 transition-colors min-w-[120px]"
            >
              <span className="truncate max-w-[200px]">
                {selectedMetrics.length === 1 ? getMetricLabel(selectedMetrics[0]) : `${selectedMetrics.length} metrics`}
              </span>
              <svg className="w-3 h-3 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {metricDropdownOpen && (
              <div className="absolute z-50 mt-1 w-72 max-h-80 overflow-y-auto rounded-lg border border-white/10 bg-[var(--surface-overlay)] shadow-xl">
                <div className="sticky top-0 bg-[var(--surface-overlay)] p-2 border-b border-white/10">
                  <input
                    type="text"
                    value={metricSearch}
                    onChange={e => setMetricSearch(e.target.value)}
                    placeholder="Search metrics..."
                    className="w-full px-2 py-1 text-xs rounded border border-white/10 bg-white/5 text-slate-300 placeholder-slate-500 outline-none focus:border-cyan-500/50"
                    autoFocus
                  />
                </div>
                {metricOptions
                  .filter(o => !o.value.startsWith('__divider') ? o.label.toLowerCase().includes(metricSearch.toLowerCase()) : true)
                  .map(opt => {
                    if (opt.value.startsWith('__divider')) {
                      return <div key={opt.value} className="px-3 py-1 text-[10px] text-slate-500 font-medium bg-white/[0.02]">{opt.label}</div>;
                    }
                    const checked = selectedMetrics.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        onClick={() => toggleMetric(opt.value)}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${checked ? 'text-cyan-300 bg-cyan-500/10' : 'text-slate-400 hover:bg-white/5'}`}
                      >
                        <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${checked ? 'border-cyan-400 bg-cyan-500/20' : 'border-white/20'}`}>
                          {checked && <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                        </span>
                        <span className="truncate">{opt.label}</span>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      </div>

      {noData ? (
        <div className="glass-card p-6 text-center text-slate-500">
          No cash flow data available. Run the AppFolio sync with <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded">?report=cash_flow</code> to populate data.
        </div>
      ) : (
        <>
          {/* Chart */}
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              {metricLabel} — {viewMode === 'byProperty' ? `By Property (${stats?.periodLabel || 'Current Month'})` : (selectedProperty === 'Total' ? 'Portfolio' : selectedProperty)}
            </h2>
            {chartData.length === 0 ? (
              <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: '3' }}>
                No data for selected filters
              </div>
            ) : viewMode === 'byProperty' ? (
              <ResponsiveContainer width="100%" aspect={3}>
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={RECHARTS_THEME.grid.stroke} />
                  <XAxis dataKey="property" stroke={RECHARTS_THEME.axis.stroke} fontSize={10} fontFamily={RECHARTS_THEME.axis.fontFamily} angle={-35} textAnchor="end" interval={0} height={60} />
                  <YAxis tickFormatter={formatCurrency} stroke={RECHARTS_THEME.axis.stroke} fontSize={RECHARTS_THEME.axis.fontSize} fontFamily={RECHARTS_THEME.axis.fontFamily} width={70} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                  {chartKeys.map((key, i) => (
                    <Bar key={key} dataKey={key} name={key} fill={CHART_PALETTE[i % CHART_PALETTE.length]} radius={[4, 4, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" aspect={3}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={RECHARTS_THEME.grid.stroke} />
                  <XAxis dataKey="period" tickFormatter={formatMonth} stroke={RECHARTS_THEME.axis.stroke} fontSize={RECHARTS_THEME.axis.fontSize} fontFamily={RECHARTS_THEME.axis.fontFamily} />
                  <YAxis tickFormatter={formatCurrency} stroke={RECHARTS_THEME.axis.stroke} fontSize={RECHARTS_THEME.axis.fontSize} fontFamily={RECHARTS_THEME.axis.fontFamily} width={70} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                  {chartKeys.map((key, i) => (
                    <Line key={key} type="monotone" dataKey={key} name={key}
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
              <StatCard label="NOI" value={stats.noi} period={stats.periodLabel} color="text-cyan-400" />
              <StatCard label="Total Income" value={stats.totalIncome} period={stats.periodLabel} color="text-emerald-400" />
              <StatCard label="Total Expense" value={stats.totalExpense} period={stats.periodLabel} color="text-rose-400" />
              <StatCard label="Cash Flow" value={stats.cashFlow} period={stats.periodLabel} color="text-amber-400" />
            </div>
          )}

          {/* Detail Table */}
          {summaryTable.rows.length > 0 && (
            <div className="glass-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-semibold text-white">
                  {summaryTable.title}
                  {selectedOwner !== 'all' && <span className="text-sm font-normal text-slate-400 ml-2">({selectedOwner})</span>}
                </h2>
              </div>
              <div className="overflow-x-auto relative">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 z-20">
                    <tr>
                      <th className="text-left text-slate-400 font-medium px-3 py-2 border-b border-white/10 min-w-[280px] sticky left-0 z-30 bg-[var(--surface-raised)]">
                        Account Name
                      </th>
                      {summaryTable.columns.map(col => (
                        <th key={col.key} className={`text-right text-slate-400 font-medium px-3 py-2 border-b border-white/10 min-w-[110px] whitespace-nowrap bg-[var(--surface-raised)] ${col.key === 'Total' ? 'font-semibold text-slate-300' : ''}`}>
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summaryTable.rows.map((row, idx) => {
                      if (row.type === 'spacer') {
                        return <tr key={idx}><td colSpan={summaryTable.columns.length + 1} className="py-1.5 bg-[var(--surface-raised)]" /></tr>;
                      }

                      const isSection = row.type === 'section';
                      const isSummary = row.type === 'summary';
                      const isBold = row.bold || isSummary;
                      const isHighlight = row.highlight;
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
                            summaryTable.columns.map(col => (
                              <td key={col.key} className={rowBg} />
                            ))
                          ) : (
                            summaryTable.columns.map(col => {
                              const val = row.amounts[col.key];
                              const hasVal = val != null && val !== 0;
                              return (
                                <td key={col.key} className={`text-right px-3 py-1.5 tabular-nums ${rowBg} ${col.key === 'Total' ? 'font-medium' : ''} ${isBold ? 'font-semibold text-slate-200' : 'text-slate-400'} ${hasVal && val < 0 ? '!text-red-400' : ''}`}>
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
      <p className="text-slate-600 text-xs mt-1">{period}</p>
    </div>
  );
}
