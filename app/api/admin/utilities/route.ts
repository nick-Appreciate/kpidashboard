import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '../../../../lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────

interface Reading {
  reading_timestamp: string;
  account_number: string;
  name: string;
  meter: string;
  location: string | null;
  address: string;
  estimated_indicator: string;
  ccf: number | null;
  cost: string;
  source?: 'bpu' | 'como';
}

interface MeterProfile {
  meter: string;
  address: string;
  accountNumber: string;
  name: string;
  source: 'bpu' | 'como';
  dailyUsage: Map<string, number>;
  dailyCost: Map<string, number>;
  hourlyProfile: Map<number, number[]>;
  readings: { timestamp: string; ccf: number; cost: number; hour: number; date: string }[];
  totalDays: number;
}

interface Alert {
  type: 'daily_spike' | 'hourly_spike' | 'sustained_elevated' | 'overnight_usage';
  severity: 'info' | 'warning' | 'critical';
  meter: string;
  label: string;
  address: string;
  name: string;
  date: string;
  actual: number;
  expected: number;
  zScore?: number;
  message: string;
}

interface MeterSummary {
  meter: string;
  label: string;
  address: string;
  name: string;
  accountNumber: string;
  totalCcf: number;
  avgHourly: number;
  maxHourly: number;
  overnightAvg: number;
  pctActive: number;
  dayCount: number;
  readingCount: number;
}

// ─── API Handler ─────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get('days') || '30';
    const meterParam = searchParams.get('meter');

    // Calculate date range in Central Time
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

    let startDateStr: string | null = null;
    if (daysParam !== 'all') {
      const days = parseInt(daysParam, 10);
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - days);
      startDateStr = startDate.toISOString().split('T')[0];
    }

    // Always fetch at least 30 days for alert detection (recurring leaks need history)
    const days = daysParam === 'all' ? Infinity : parseInt(daysParam, 10);
    const MIN_ALERT_DAYS = 30;
    let fetchStartDateStr = startDateStr;
    if (startDateStr && days < MIN_ALERT_DAYS) {
      const fetchStart = new Date(today);
      fetchStart.setDate(fetchStart.getDate() - MIN_ALERT_DAYS);
      fetchStartDateStr = fetchStart.toISOString().split('T')[0];
    }
    let allData: Reading[] = [];

    if (days > 90) {
      // Use SQL aggregation for large ranges to avoid fetching 600K+ rows
      // RPC returns a single JSON array (bypasses PostgREST row limits)
      const { data: aggResult, error: aggError } = await supabaseAdmin
        .rpc('get_daily_meter_usage', {
          start_date: fetchStartDateStr || null,
          end_date: null,
          meter_filter: meterParam || null,
        })
        .single();

      const aggData = aggResult as any[] | null;

      if (!aggError && aggData) {
        for (const row of aggData) {
          allData.push({
            reading_timestamp: row.day + 'T12:00:00',
            account_number: row.account_number,
            name: row.name,
            meter: row.meter,
            location: null,
            address: row.address,
            estimated_indicator: '',
            ccf: row.total_ccf,
            cost: '$' + (row.total_cost || 0).toFixed(2),
            source: 'bpu',
          });
        }
      } else if (aggError) {
        console.warn('RPC failed, falling back to paginated fetch:', aggError.message);
      }
    }

    // For short ranges (<=90 days) or if aggregation failed, use paginated fetch
    if (allData.length === 0) {
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        let query = supabase
          .from('bpu_meter_readings')
          .select('*')
          .order('reading_timestamp', { ascending: true })
          .range(from, from + pageSize - 1);

        if (fetchStartDateStr) {
          query = query.gte('reading_timestamp', fetchStartDateStr);
        }
        if (meterParam) {
          query = query.eq('meter', meterParam);
        }

        const { data, error } = await query;
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        allData = allData.concat((data || []) as Reading[]);
        hasMore = (data?.length || 0) === pageSize;
        from += pageSize;
      }
    }

    // ─── Fetch COMO data ──────────────────────────────────────────────────
    // COMO has ~500 rows total (monthly billing reads), no pagination needed.
    // We fetch from 90 days before startDate to capture the preceding billing
    // read needed for spreading monthly reads into daily values.
    let comoQuery = supabaseAdmin
      .from('como_meter_readings')
      .select('reading_timestamp, account_number, name, meter, location, address, ccf')
      .order('reading_timestamp', { ascending: true });

    if (fetchStartDateStr) {
      const comoLookback = new Date(fetchStartDateStr);
      comoLookback.setDate(comoLookback.getDate() - 90);
      comoQuery = comoQuery.gte('reading_timestamp', comoLookback.toISOString().split('T')[0]);
    }
    if (meterParam) {
      comoQuery = comoQuery.eq('meter', meterParam);
    }

    const { data: comoData } = await comoQuery;
    if (comoData && comoData.length > 0) {
      const comoDailyReadings = spreadComoToDailyReadings(comoData as any[], fetchStartDateStr);
      allData = allData.concat(comoDailyReadings);
    }

    // Process data — profiles use full fetched range (≥30d) for alert detection
    const profiles = buildMeterProfiles(allData);
    const alerts = detectLeaks(profiles);

    // Filter chart data to the requested time range (startDateStr)
    const filterDate = (arr: any[]) =>
      startDateStr ? arr.filter(d => d.date >= startDateStr) : arr;

    const stats = computeStats(allData, profiles, startDateStr);
    const dailyUsage = filterDate(computeDailyUsage(allData, profiles));
    const dailyCost = filterDate(computeDailyCost(allData, profiles));
    const dailyWaste = filterDate(computeDailyWaste(profiles));
    const baselineDeviation = filterDate(computeBaselineDeviation(allData, profiles));
    const meters = computeMeterSummaries(profiles, startDateStr);

    return NextResponse.json({
      stats: { ...stats, alertCount: alerts.length },
      dailyUsage,
      dailyCost,
      dailyWaste,
      baselineDeviation,
      alerts,
      meters,
    });
  } catch (error) {
    console.error('Error fetching utilities data:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// ─── Data Processing ─────────────────────────────────────────────────────

function buildMeterProfiles(data: Reading[]): Map<string, MeterProfile> {
  const profiles = new Map<string, MeterProfile>();

  for (const row of data) {
    const ccf = row.ccf ?? 0;
    const costVal = parseCost(row.cost);
    const ts = new Date(row.reading_timestamp);
    const date = ts.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const hour = parseInt(ts.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }));

    if (!profiles.has(row.meter)) {
      profiles.set(row.meter, {
        meter: row.meter,
        address: row.address,
        accountNumber: row.account_number,
        name: row.name,
        source: row.source || 'bpu',
        dailyUsage: new Map(),
        dailyCost: new Map(),
        hourlyProfile: new Map(),
        readings: [],
        totalDays: 0,
      });
    }

    const profile = profiles.get(row.meter)!;
    profile.dailyUsage.set(date, (profile.dailyUsage.get(date) || 0) + ccf);
    profile.dailyCost.set(date, (profile.dailyCost.get(date) || 0) + costVal);

    if (!profile.hourlyProfile.has(hour)) {
      profile.hourlyProfile.set(hour, []);
    }
    profile.hourlyProfile.get(hour)!.push(ccf);

    profile.readings.push({ timestamp: row.reading_timestamp, ccf, cost: costVal, hour, date });
  }

  // Set totalDays
  Array.from(profiles.values()).forEach(profile => {
    profile.totalDays = profile.dailyUsage.size;
  });

  return profiles;
}

function computeStats(data: Reading[], profiles: Map<string, MeterProfile>, filterStart?: string | null) {
  const totalMeters = profiles.size;
  let activeMeters = 0;
  let totalCcf = 0;

  for (const profile of Array.from(profiles.values())) {
    let usage = 0;
    for (const [date, ccf] of Array.from(profile.dailyUsage)) {
      if (filterStart && date < filterStart) continue;
      usage += ccf;
    }
    totalCcf += usage;
    if (usage > 0) activeMeters++;
  }

  return { totalMeters, activeMeters, totalCcf: Math.round(totalCcf * 100) / 100 };
}

function computeDailyUsage(data: Reading[], profiles: Map<string, MeterProfile>) {
  // Build { date: { [addressLabel]: ccf, ... } }
  const dateMap = new Map<string, Record<string, number>>();

  for (const profile of Array.from(profiles.values())) {
    const totalUsage = Array.from(profile.dailyUsage.values()).reduce((s, v) => s + v, 0);
    if (totalUsage === 0) continue; // Skip zero-usage meters

    const label = shortAddressLabel(profile.address);
    for (const [date, ccf] of Array.from(profile.dailyUsage)) {
      if (!dateMap.has(date)) dateMap.set(date, {});
      dateMap.get(date)![label] = Math.round(ccf * 10000) / 10000;
    }
  }

  return Array.from(dateMap.entries())
    .map(([date, meters]) => ({ date, ...meters }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Estimated all-in rate per CCF (includes base, sewer, stormwater, etc.)
// BPU: derived from monthly BPU bills vs metered CCF consumption
// COMO: derived from COMO MyMeter dollar view (~$95 for 20 CCF)
const BPU_RATE_PER_CCF = 35;
const COMO_RATE_PER_CCF = 5;

function rateForSource(source: 'bpu' | 'como'): number {
  return source === 'como' ? COMO_RATE_PER_CCF : BPU_RATE_PER_CCF;
}

function computeDailyCost(data: Reading[], profiles: Map<string, MeterProfile>) {
  const dateMap = new Map<string, Record<string, number>>();

  for (const profile of Array.from(profiles.values())) {
    const totalUsage = Array.from(profile.dailyUsage.values()).reduce((s, v) => s + v, 0);
    if (totalUsage === 0) continue;

    const rate = rateForSource(profile.source);
    const label = shortAddressLabel(profile.address);
    for (const [date, ccf] of Array.from(profile.dailyUsage)) {
      if (!dateMap.has(date)) dateMap.set(date, {});
      dateMap.get(date)![label] = Math.round(ccf * rate * 100) / 100;
    }
  }

  return Array.from(dateMap.entries())
    .map(([date, meters]) => ({ date, ...meters }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Estimated Waste = excess above each meter's baseline on statistically elevated days.
 *
 * For each meter:
 *   baseline = median daily CCF (robust to outliers)
 *   z-score  = modified z-score for the day (uses MAD, not std dev)
 *
 * A day counts as waste when z > 2.0 AND dailyCcf > median:
 *   wasteCcf = dailyCcf - median
 *
 * Why z > 2.0: balances sensitivity with specificity — catches real anomalies
 * without flagging normal variation. Each meter's own median defines "normal"
 * so a high-usage meter and a low-usage meter are both evaluated fairly.
 *
 * Dollar estimate = wasteCcf × ESTIMATED_RATE_PER_CCF ($35/CCF all-in).
 */
function computeDailyWaste(profiles: Map<string, MeterProfile>) {
  const dateMap = new Map<string, Record<string, number>>();

  for (const profile of Array.from(profiles.values())) {
    const dailyEntries = Array.from(profile.dailyUsage.entries()).sort(([a], [b]) => a.localeCompare(b));
    const values = dailyEntries.map(([, v]) => v);
    const totalUsage = values.reduce((s, v) => s + v, 0);
    if (totalUsage === 0 || values.length < 7) continue;

    // Each meter's own median is its baseline
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    if (median === 0) continue; // Can't define waste for a meter with zero baseline

    // Modified z-scores for this meter's daily values
    const { scores } = modifiedZScores(values);
    if (scores.length === 0) continue;

    const label = shortAddressLabel(profile.address);

    for (let i = 0; i < dailyEntries.length; i++) {
      const [date, ccf] = dailyEntries[i];

      // Only flag as waste when statistically elevated above this meter's baseline
      if (scores[i] > 2.0 && ccf > median) {
        const wasteCcf = ccf - median;
        const rate = rateForSource(profile.source);
        const wasteDollars = Math.round(wasteCcf * rate * 100) / 100;
        if (wasteDollars < 0.50) continue; // Skip noise below $0.50
        if (!dateMap.has(date)) dateMap.set(date, {});
        dateMap.get(date)![label] = wasteDollars;
      }
    }
  }

  return Array.from(dateMap.entries())
    .map(([date, meters]) => ({ date, ...meters }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function computeBaselineDeviation(data: Reading[], profiles: Map<string, MeterProfile>) {
  // For each meter, compute daily usage as a ratio of its median (baseline = 1.0)
  const dateMap = new Map<string, Record<string, number>>();

  for (const profile of Array.from(profiles.values())) {
    const dailyValues = Array.from(profile.dailyUsage.values());
    const totalUsage = dailyValues.reduce((s, v) => s + v, 0);
    if (totalUsage === 0) continue;

    // Compute median daily usage as baseline
    const sorted = [...dailyValues].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    if (median === 0) continue; // Can't compute ratio with zero baseline

    const label = shortAddressLabel(profile.address);
    for (const [date, ccf] of Array.from(profile.dailyUsage)) {
      if (!dateMap.has(date)) dateMap.set(date, {});
      dateMap.get(date)![label] = Math.round((ccf / median) * 100) / 100;
    }
  }

  return Array.from(dateMap.entries())
    .map(([date, meters]) => ({ date, ...meters }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function computeMeterSummaries(profiles: Map<string, MeterProfile>, filterStart?: string | null): MeterSummary[] {
  const summaries: MeterSummary[] = [];

  for (const profile of Array.from(profiles.values())) {
    const filteredReadings = filterStart
      ? profile.readings.filter(r => r.date >= filterStart)
      : profile.readings;
    const ccfValues = filteredReadings.map(r => r.ccf);
    const totalCcf = ccfValues.reduce((s, v) => s + v, 0);
    const avgHourly = ccfValues.length > 0 ? totalCcf / ccfValues.length : 0;
    const maxHourly = ccfValues.length > 0 ? Math.max(...ccfValues) : 0;
    const activeCount = ccfValues.filter(v => v > 0).length;
    const pctActive = ccfValues.length > 0 ? (activeCount / ccfValues.length) * 100 : 0;

    const filteredDays = filterStart
      ? Array.from(profile.dailyUsage.keys()).filter(d => d >= filterStart).length
      : profile.totalDays;

    // Compute overnight average (midnight-4am) CCF/hr
    const NIGHT_HOURS = [0, 1, 2, 3, 4];
    const nightReadings = filteredReadings.filter(r => NIGHT_HOURS.includes(r.hour));
    const overnightAvg = nightReadings.length > 0
      ? nightReadings.reduce((s, r) => s + r.ccf, 0) / nightReadings.length
      : 0;

    summaries.push({
      meter: profile.meter,
      label: shortAddressLabel(profile.address),
      address: profile.address,
      name: profile.name,
      accountNumber: profile.accountNumber,
      totalCcf: Math.round(totalCcf * 10000) / 10000,
      avgHourly: Math.round(avgHourly * 10000) / 10000,
      maxHourly: Math.round(maxHourly * 10000) / 10000,
      overnightAvg: Math.round(overnightAvg * 10000) / 10000,
      pctActive: Math.round(pctActive * 10) / 10,
      dayCount: filteredDays,
      readingCount: filteredReadings.length,
    });
  }

  return summaries.sort((a, b) => b.pctActive - a.pctActive);
}

// ─── Leak Detection ──────────────────────────────────────────────────────

function modifiedZScores(values: number[]): { median: number; mad: number; scores: number[] } {
  if (values.length === 0) return { median: 0, mad: 0, scores: [] };

  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

  const deviations = values.map(v => Math.abs(v - median));
  const sortedDev = [...deviations].sort((a, b) => a - b);
  const mad = sortedDev.length % 2 === 0
    ? (sortedDev[sortedDev.length / 2 - 1] + sortedDev[sortedDev.length / 2]) / 2
    : sortedDev[Math.floor(sortedDev.length / 2)];

  const k = 0.6745;
  const scores = values.map(v => mad === 0 ? 0 : (k * (v - median)) / mad);

  return { median, mad, scores };
}

function detectLeaks(profiles: Map<string, MeterProfile>): Alert[] {
  let allAlerts: Alert[] = [];

  for (const profile of Array.from(profiles.values())) {
    if (profile.totalDays < 7) continue;
    const totalUsage = Array.from(profile.dailyUsage.values()).reduce((s, v) => s + v, 0);
    if (totalUsage === 0) continue;

    allAlerts = allAlerts.concat(
      detectDailySpikes(profile),
      detectSustainedElevation(profile),
      detectOvernightLeaks(profile),
    );
  }

  // Sort by severity
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  allAlerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return allAlerts;
}

// Method A: Daily usage spikes
function detectDailySpikes(profile: MeterProfile): Alert[] {
  const alerts: Alert[] = [];
  const dailyEntries = Array.from(profile.dailyUsage.entries()).sort(([a], [b]) => a.localeCompare(b));
  const values = dailyEntries.map(([, v]) => v);

  if (values.length < 7) return alerts;

  const { median, mad, scores } = modifiedZScores(values);
  if (mad === 0) return alerts;

  for (let i = 0; i < dailyEntries.length; i++) {
    const [date, usage] = dailyEntries[i];
    const z = scores[i];

    if (z > 2.5) {
      alerts.push({
        type: 'daily_spike',
        severity: z > 3.5 ? 'critical' : 'warning',
        meter: profile.meter,
        label: shortAddressLabel(profile.address),
        address: profile.address,
        name: profile.name,
        date,
        actual: Math.round(usage * 10000) / 10000,
        expected: Math.round(median * 10000) / 10000,
        zScore: Math.round(z * 100) / 100,
        message: `Daily usage ${usage.toFixed(2)} CCF is ${z.toFixed(1)}x above baseline (median: ${median.toFixed(2)} CCF)`,
      });
    }
  }

  return alerts;
}

// Method C: Sustained elevation (3+ consecutive days above 2 sigma)
function detectSustainedElevation(profile: MeterProfile): Alert[] {
  const alerts: Alert[] = [];
  const dailyEntries = Array.from(profile.dailyUsage.entries()).sort(([a], [b]) => a.localeCompare(b));
  const values = dailyEntries.map(([, v]) => v);

  if (values.length < 7) return alerts;

  const { median, mad } = modifiedZScores(values);
  if (mad === 0) return alerts;

  const THRESHOLD = 2.0;
  const MIN_CONSECUTIVE = 3;

  let consecutiveElevated = 0;
  let runStart = '';

  for (let i = 0; i < dailyEntries.length; i++) {
    const [date, usage] = dailyEntries[i];
    const z = mad === 0 ? 0 : (0.6745 * (usage - median)) / mad;

    if (z > THRESHOLD) {
      if (consecutiveElevated === 0) runStart = date;
      consecutiveElevated++;
    } else {
      if (consecutiveElevated >= MIN_CONSECUTIVE) {
        const prevDate = dailyEntries[i - 1][0];
        alerts.push({
          type: 'sustained_elevated',
          severity: consecutiveElevated >= 5 ? 'critical' : 'warning',
          meter: profile.meter,
          label: shortAddressLabel(profile.address),
          address: profile.address,
          name: profile.name,
          date: `${runStart} to ${prevDate}`,
          actual: usage,
          expected: median,
          message: `${consecutiveElevated} consecutive days of elevated usage`,
        });
      }
      consecutiveElevated = 0;
    }
  }

  // Check ongoing run
  if (consecutiveElevated >= MIN_CONSECUTIVE) {
    const lastDate = dailyEntries[dailyEntries.length - 1][0];
    alerts.push({
      type: 'sustained_elevated',
      severity: 'critical',
      meter: profile.meter,
      label: shortAddressLabel(profile.address),
      address: profile.address,
      name: profile.name,
      date: `${runStart} to ${lastDate} (ongoing)`,
      actual: dailyEntries[dailyEntries.length - 1][1],
      expected: median,
      message: `${consecutiveElevated} consecutive days of elevated usage (ongoing)`,
    });
  }

  return alerts;
}

// Method D: Overnight baseline (consistent usage midnight-4am)
function detectOvernightLeaks(profile: MeterProfile): Alert[] {
  const NIGHT_HOURS = [0, 1, 2, 3, 4];
  const alerts: Alert[] = [];

  const overnightByDate = new Map<string, number[]>();
  for (const reading of profile.readings) {
    if (!NIGHT_HOURS.includes(reading.hour)) continue;
    if (!overnightByDate.has(reading.date)) overnightByDate.set(reading.date, []);
    overnightByDate.get(reading.date)!.push(reading.ccf);
  }

  let nightsWithUsage = 0;
  let totalNights = 0;

  for (const readings of Array.from(overnightByDate.values())) {
    totalNights++;
    const avg = readings.reduce((s, v) => s + v, 0) / readings.length;
    if (avg > 0.005) nightsWithUsage++;
  }

  if (totalNights >= 3 && nightsWithUsage / totalNights > 0.5) {
    const allNightReadings = Array.from(overnightByDate.values()).flat();
    const nightAvg = allNightReadings.reduce((s, v) => s + v, 0) / allNightReadings.length;

    if (nightAvg > 0.01) {
      alerts.push({
        type: 'overnight_usage',
        severity: nightAvg > 0.05 ? 'critical' : 'warning',
        meter: profile.meter,
        label: shortAddressLabel(profile.address),
        address: profile.address,
        name: profile.name,
        date: 'Recurring',
        actual: Math.round(nightAvg * 10000) / 10000,
        expected: 0,
        message: `Avg overnight usage: ${nightAvg.toFixed(4)} CCF/hr across ${nightsWithUsage}/${totalNights} nights`,
      });
    }
  }

  return alerts;
}

// ─── COMO Spreading ─────────────────────────────────────────────────────

/**
 * Spread COMO monthly billing reads into synthetic daily readings.
 * For each meter, computes days between consecutive reads and divides
 * the CCF evenly across those days. After the last known reading,
 * extrapolates forward at the same daily rate until today.
 * @param filterStart - Only include generated daily readings on or after this date (YYYY-MM-DD)
 */
function spreadComoToDailyReadings(
  comoRows: { reading_timestamp: string; account_number: string; name: string; meter: string; location: string | null; address: string; ccf: number | null | string }[],
  filterStart?: string | null,
): Reading[] {
  // Group by meter
  const byMeter = new Map<string, typeof comoRows>();
  for (const row of comoRows) {
    if (!byMeter.has(row.meter)) byMeter.set(row.meter, []);
    byMeter.get(row.meter)!.push(row);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const results: Reading[] = [];

  const emitDay = (dateObj: Date, dailyCcf: number, template: typeof comoRows[0], meter: string) => {
    const dateStr = dateObj.toISOString().split('T')[0];
    if (filterStart && dateStr < filterStart) return;
    const dailyCost = dailyCcf * COMO_RATE_PER_CCF;
    results.push({
      reading_timestamp: dateStr + 'T12:00:00',
      account_number: template.account_number,
      name: template.name || '',
      meter,
      location: template.location,
      address: template.address,
      estimated_indicator: '',
      ccf: dailyCcf,
      cost: '$' + dailyCost.toFixed(2),
      source: 'como',
    });
  };

  for (const [meter, rows] of Array.from(byMeter)) {
    // Sort by date ascending
    const sorted = rows
      .map(r => ({ ...r, date: new Date(r.reading_timestamp), ccfNum: parseFloat(String(r.ccf ?? '0')) || 0 }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    let lastDailyCcf = 0;
    let lastRow = sorted[sorted.length - 1];

    // For each pair of consecutive readings, spread the later reading's CCF
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (curr.ccfNum === 0) continue;

      const daysBetween = Math.round((curr.date.getTime() - prev.date.getTime()) / (1000 * 60 * 60 * 24));
      if (daysBetween <= 0) continue;

      const dailyCcf = curr.ccfNum / daysBetween;
      lastDailyCcf = dailyCcf;
      lastRow = curr;

      // Generate one reading per day in [prev+1, curr]
      for (let d = 1; d <= daysBetween; d++) {
        const date = new Date(prev.date);
        date.setDate(date.getDate() + d);
        emitDay(date, dailyCcf, curr, meter);
      }
    }

    // Extrapolate forward from the last reading at the last known daily rate
    if (lastDailyCcf > 0 && lastRow.date < today) {
      const daysToExtrapolate = Math.round((today.getTime() - lastRow.date.getTime()) / (1000 * 60 * 60 * 24));
      for (let d = 1; d <= daysToExtrapolate; d++) {
        const date = new Date(lastRow.date);
        date.setDate(date.getDate() + d);
        if (date > today) break;
        emitDay(date, lastDailyCcf, lastRow, meter);
      }
    }

    // For meters with no spread data, add a placeholder so they appear in the meter table
    if (lastDailyCcf === 0) {
      const latest = sorted[sorted.length - 1];
      results.push({
        reading_timestamp: latest.date.toISOString().split('T')[0] + 'T12:00:00',
        account_number: latest.account_number,
        name: latest.name || '',
        meter,
        location: latest.location,
        address: latest.address,
        estimated_indicator: '',
        ccf: 0,
        cost: '$0.00',
        source: 'como',
      });
    }
  }

  return results;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function parseCost(cost: string | null | undefined): number {
  if (!cost) return 0;
  return parseFloat(cost.replace('$', '').replace(',', '')) || 0;
}

function shortAddressLabel(address: string): string {
  // "3301 WOOD AVE KANSAS CITY, KS 66104" → "3301 Wood Ave"
  // "2613 FARROW AVE BLDG 2 KANSAS CITY, KS 66104" → "2613 Farrow Bldg 2"
  // "1900 N 77TH ST # PS KANSAS CITY, KS 66112" → "1900 N 77th #PS"
  // "2404 WHITE GATE DR COLUMBIA, MO 65202" → "2404 White Gate"
  if (!address) return '—';

  const beforeCity = address.split(/\s+(?:KANSAS\s+CITY|COLUMBIA)/i)[0].trim();

  // Extract street number + street name + unit info
  const parts = beforeCity.split(/\s+/);
  if (parts.length < 2) return beforeCity;

  // Find where unit info starts (BLDG, APT, #, UNIT)
  const unitKeywords = ['BLDG', 'APT', '#', 'UNIT'];
  let streetEnd = parts.length;
  let unitPart = '';

  for (let i = 2; i < parts.length; i++) {
    if (unitKeywords.some(k => parts[i].startsWith(k))) {
      streetEnd = i;
      unitPart = parts.slice(i).join(' ');
      break;
    }
  }

  // Take street number + first 2 words of street name
  const streetParts = parts.slice(0, Math.min(streetEnd, 3));

  // Title case
  const titleCase = (s: string) => {
    // Keep ordinals like 77TH as 77th, and directionals like N
    if (/^\d+(ST|ND|RD|TH)$/i.test(s)) return s.toLowerCase();
    if (s.length === 1) return s; // N, S, E, W
    return s.charAt(0) + s.slice(1).toLowerCase();
  };

  let label = streetParts.map(titleCase).join(' ');
  if (unitPart) {
    label += ' ' + unitPart.split(/\s+/).map(titleCase).join(' ');
  }

  return label;
}
