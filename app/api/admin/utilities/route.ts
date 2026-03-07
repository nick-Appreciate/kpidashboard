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
}

interface MeterProfile {
  meter: string;
  address: string;
  accountNumber: string;
  name: string;
  dailyUsage: Map<string, number>;
  hourlyProfile: Map<number, number[]>;
  readings: { timestamp: string; ccf: number; hour: number; date: string }[];
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

    const days = daysParam === 'all' ? Infinity : parseInt(daysParam, 10);
    let allData: Reading[] = [];

    if (days > 90) {
      // Use SQL aggregation for large ranges to avoid fetching 600K+ rows
      // RPC returns a single JSON array (bypasses PostgREST row limits)
      const { data: aggResult, error: aggError } = await supabaseAdmin
        .rpc('get_daily_meter_usage', {
          start_date: startDateStr || null,
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
            cost: '$0.00',
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

        if (startDateStr) {
          query = query.gte('reading_timestamp', startDateStr);
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

    // Process data
    const profiles = buildMeterProfiles(allData);
    const stats = computeStats(allData, profiles);
    const dailyUsage = computeDailyUsage(allData, profiles);
    const baselineDeviation = computeBaselineDeviation(allData, profiles);
    const alerts = detectLeaks(profiles);
    const meters = computeMeterSummaries(profiles);

    return NextResponse.json({
      stats: { ...stats, alertCount: alerts.length },
      dailyUsage,
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
    const ts = new Date(row.reading_timestamp);
    const date = ts.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const hour = parseInt(ts.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }));

    if (!profiles.has(row.meter)) {
      profiles.set(row.meter, {
        meter: row.meter,
        address: row.address,
        accountNumber: row.account_number,
        name: row.name,
        dailyUsage: new Map(),
        hourlyProfile: new Map(),
        readings: [],
        totalDays: 0,
      });
    }

    const profile = profiles.get(row.meter)!;
    profile.dailyUsage.set(date, (profile.dailyUsage.get(date) || 0) + ccf);

    if (!profile.hourlyProfile.has(hour)) {
      profile.hourlyProfile.set(hour, []);
    }
    profile.hourlyProfile.get(hour)!.push(ccf);

    profile.readings.push({ timestamp: row.reading_timestamp, ccf, hour, date });
  }

  // Set totalDays
  Array.from(profiles.values()).forEach(profile => {
    profile.totalDays = profile.dailyUsage.size;
  });

  return profiles;
}

function computeStats(data: Reading[], profiles: Map<string, MeterProfile>) {
  const totalMeters = profiles.size;
  let activeMeters = 0;
  let totalCcf = 0;

  for (const profile of Array.from(profiles.values())) {
    const usage = Array.from(profile.dailyUsage.values()).reduce((s, v) => s + v, 0);
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

function computeMeterSummaries(profiles: Map<string, MeterProfile>): MeterSummary[] {
  const summaries: MeterSummary[] = [];

  for (const profile of Array.from(profiles.values())) {
    const ccfValues = profile.readings.map(r => r.ccf);
    const totalCcf = ccfValues.reduce((s, v) => s + v, 0);
    const avgHourly = ccfValues.length > 0 ? totalCcf / ccfValues.length : 0;
    const maxHourly = ccfValues.length > 0 ? Math.max(...ccfValues) : 0;
    const activeCount = ccfValues.filter(v => v > 0).length;
    const pctActive = ccfValues.length > 0 ? (activeCount / ccfValues.length) * 100 : 0;

    summaries.push({
      meter: profile.meter,
      label: shortAddressLabel(profile.address),
      address: profile.address,
      name: profile.name,
      accountNumber: profile.accountNumber,
      totalCcf: Math.round(totalCcf * 10000) / 10000,
      avgHourly: Math.round(avgHourly * 10000) / 10000,
      maxHourly: Math.round(maxHourly * 10000) / 10000,
      pctActive: Math.round(pctActive * 10) / 10,
      dayCount: profile.totalDays,
      readingCount: profile.readings.length,
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

// ─── Helpers ─────────────────────────────────────────────────────────────

function shortAddressLabel(address: string): string {
  // "3301 WOOD AVE KANSAS CITY, KS 66104" → "3301 Wood Ave"
  // "2613 FARROW AVE BLDG 2 KANSAS CITY, KS 66104" → "2613 Farrow Bldg 2"
  // "1900 N 77TH ST # PS KANSAS CITY, KS 66112" → "1900 N 77th #PS"
  if (!address) return '—';

  const beforeCity = address.split(/\s+KANSAS\s+CITY/i)[0].trim();

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
