import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const appfolioClientId = Deno.env.get('APPFOLIO_CLIENT_ID')!;
const appfolioClientSecret = Deno.env.get('APPFOLIO_CLIENT_SECRET')!;
const appfolioDatabase = Deno.env.get('APPFOLIO_DATABASE') || 'appreciateinc';

const supabase = createClient(supabaseUrl, supabaseKey);

interface SyncResult {
  report: string;
  success: boolean;
  rowsProcessed: number;
  error?: string;
}

async function fetchAppFolioReport(reportName: string, filters: Record<string, unknown> = {}): Promise<unknown[]> {
  const url = `https://${appfolioDatabase}.appfolio.com/api/v2/reports/${reportName}.json`;
  const auth = btoa(`${appfolioClientId}:${appfolioClientSecret}`);
  
  let allResults: unknown[] = [];
  let nextPageUrl: string | null = url;
  let isFirstRequest = true;
  
  while (nextPageUrl) {
    const response = await fetch(nextPageUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: isFirstRequest ? JSON.stringify({ ...filters, paginate_results: true }) : undefined
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AppFolio API error ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    
    if (Array.isArray(data)) {
      allResults = allResults.concat(data);
      nextPageUrl = null;
    } else if (data.results) {
      allResults = allResults.concat(data.results);
      nextPageUrl = data.next_page_url || null;
    } else {
      nextPageUrl = null;
    }
    
    isFirstRequest = false;
  }
  
  return allResults;
}

async function syncRentRoll(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('rent_roll_itemized');
    const today = getTodayDate();
    
    const records = data.map((row: any) => ({
      snapshot_date: today,
      property: row.property_name,
      unit: row.unit,
      bed_bath: row.bd_ba,
      status: row.status,
      sqft: row.sqft ? parseInt(row.sqft) : null,
      total_rent: row.total ? parseFloat(row.total) : null,
      past_due: row.past_due ? parseFloat(row.past_due) : null,
      lease_from: row.lease_from || null,
      lease_to: row.lease_to || null,
      tenant_name: row.tenant || null
    }));
    
    // Delete today's records then insert fresh
    await supabase.from('rent_roll_snapshots').delete().eq('snapshot_date', today);
    
    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase.from('rent_roll_snapshots').insert(batch);
      if (error) throw new Error(JSON.stringify(error));
    }
    
    return { report: 'rent_roll', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'rent_roll', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncTenantTickler(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('tenant_tickler');
    const today = getTodayDate();
    
    const records = data.map((row: any) => ({
      snapshot_date: today,
      event_date: row.occurred_date || null,
      event_type: row.event || null,
      property: row.property_name,
      unit: row.unit || null,
      tenant_name: row.tenant || null,
      rent: row.rent ? parseFloat(row.rent) : null
    }));
    
    await supabase.from('tenant_events').delete().eq('snapshot_date', today);
    const { error } = await supabase.from('tenant_events').insert(records);
    if (error) throw new Error(JSON.stringify(error));
    
    return { report: 'tenant_tickler', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'tenant_tickler', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncRenewalSummary(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('renewal_summary');
    
    const records = data.map((row: any) => ({
      unit_name: row.unit_name || row.unit,
      property_name: row.property_name,
      tenant_name: row.tenant || null,
      lease_start: row.lease_start || null,
      lease_end: row.lease_end || null,
      rent: row.rent ? parseFloat(row.rent) : null,
      status: row.status || null,
      updated_at: new Date().toISOString()
    }));
    
    await supabase.from('renewal_summary').delete().neq('id', 0);
    const { error } = await supabase.from('renewal_summary').insert(records);
    if (error) throw new Error(JSON.stringify(error));
    
    return { report: 'renewal_summary', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'renewal_summary', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncShowings(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('showings');
    
    const records = data.map((row: any) => ({
      guest_card_name: row.guest_card_name || null,
      email: row.email || null,
      phone: row.phone_number || null,
      property: row.property_name,
      showing_unit: row.unit || null,
      showing_time: row.showing_time || null,
      status: row.status || null,
      source: row.source || null,
      updated_at: new Date().toISOString()
    }));
    
    await supabase.rpc('truncate_showings');
    const { error } = await supabase.from('showings').insert(records);
    if (error) throw new Error(JSON.stringify(error));
    
    return { report: 'showings', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'showings', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncRentalApplications(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('rental_applications', {});
    
    const records = data.map((row: any) => ({
      applicants: row.applicants || null,
      received: row.received || null,
      desired_move_in: row.desired_move_in || null,
      lead_source: row.lead_source || null,
      status: row.status || null,
      unit: row.unit_title || null,
      updated_at: new Date().toISOString()
    }));
    
    await supabase.rpc('truncate_rental_applications');
    const { error } = await supabase.from('rental_applications').insert(records);
    if (error) throw new Error(JSON.stringify(error));
    
    return { report: 'rental_applications', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'rental_applications', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncGuestCards(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('guest_cards');
    
    // Filter and deduplicate
    const validRecords = data.filter((row: any) => row.name && row.property_name && row.received);
    const seen = new Map();
    const uniqueRecords = validRecords.filter((row: any) => {
      const key = `${row.property_name}|${row.name}|${row.received}`;
      if (seen.has(key)) return false;
      seen.set(key, true);
      return true;
    });
    
    const records = uniqueRecords.map((row: any) => ({
      name: row.name,
      property: row.property_name,
      email: row.email_address || null,
      phone: row.phone_number || null,
      inquiry_received: row.received,
      last_activity_date: row.last_activity_date || null,
      last_activity_type: row.last_activity_type || null,
      status: row.status || null,
      source: row.source || null,
      unit: row.unit || null,
      guest_card_id: row.guest_card_id ? String(row.guest_card_id) : null,
      updated_at: new Date().toISOString()
    }));
    
    await supabase.rpc('truncate_leasing_reports');
    
    const batchSize = 50;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase.from('leasing_reports').insert(batch);
      if (error) throw new Error(JSON.stringify(error));
    }
    
    return { report: 'guest_cards', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'guest_cards', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncDelinquency(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('delinquency');
    const today = getTodayDate();
    
    const records = data.map((row: any) => ({
      snapshot_date: today,
      property_name: row.property_name,
      property_id: row.property_id,
      unit: row.unit,
      unit_id: row.unit_id,
      occupancy_id: row.occupancy_id,
      name: row.name,
      tenant_status: row.tenant_status,
      phone_numbers: row.phone_numbers,
      primary_tenant_email: row.primary_tenant_email,
      move_in: row.move_in || null,
      move_out: row.move_out || null,
      deposit: row.deposit ? parseFloat(row.deposit) : null,
      rent: row.rent ? parseFloat(row.rent) : null,
      amount_receivable: row.amount_receivable ? parseFloat(row.amount_receivable) : null,
      not_yet_due: row.not_yet_due ? parseFloat(row.not_yet_due) : null,
      days_0_to_30: row['00_to30'] ? parseFloat(row['00_to30']) : null,
      days_30_to_60: row['30_to60'] ? parseFloat(row['30_to60']) : null,
      days_60_to_90: row['60_to90'] ? parseFloat(row['60_to90']) : null,
      days_90_plus: row['90_plus'] ? parseFloat(row['90_plus']) : null,
      last_payment: row.last_payment || null,
      payment_amount: row.payment_amount ? parseFloat(row.payment_amount) : null,
      in_collections: row.in_collections === 'Yes' || row.in_collections === true
    }));
    
    await supabase.rpc('truncate_af_delinquency');
    const { error } = await supabase.from('af_delinquency').insert(records);
    if (error) throw new Error(JSON.stringify(error));
    
    return { report: 'delinquency', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'delinquency', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

// NEW ENDPOINTS

async function syncVendorDirectory(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('vendor_directory');
    
    const records = data.map((row: any) => ({
      vendor_id: row.vendor_id ? String(row.vendor_id) : null,
      company_name: row.company_name,
      name: row.name,
      first_name: row.first_name,
      last_name: row.last_name,
      address: row.address,
      street: row.street,
      city: row.city,
      state: row.state,
      zip: row.zip,
      phone_numbers: row.phone_numbers,
      email: row.email,
      default_gl_account: row.default_gl_account,
      payment_type: row.payment_type,
      send1099: row.send1099 === 'Yes' || row.send1099 === true,
      tags: row.tags,
      vendor_trades: row.vendor_trades,
      do_not_use_for_work_order: row.do_not_use_for_work_order === 'Yes',
      portal_activated: row.portal_activated === 'Yes'
    }));
    
    await supabase.rpc('truncate_af_vendor_directory');
    const { error } = await supabase.from('af_vendor_directory').insert(records);
    if (error) throw new Error(JSON.stringify(error));
    
    return { report: 'vendor_directory', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'vendor_directory', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncPropertyDirectory(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('property_directory');
    
    const records = data.map((row: any) => ({
      property_id: row.property_id,
      property_name: row.property_name,
      property_address: row.property_address,
      property_street: row.property_street,
      property_city: row.property_city,
      property_state: row.property_state,
      property_zip: row.property_zip,
      property_type: row.property_type,
      market_rent: row.market_rent ? parseFloat(row.market_rent) : null,
      units: row.units ? parseInt(row.units) : null,
      sqft: row.sqft ? parseInt(row.sqft) : null,
      management_fee_percent: row.management_fee_percent ? parseFloat(row.management_fee_percent) : null,
      reserve: row.reserve ? parseFloat(row.reserve) : null,
      portfolio: row.portfolio,
      year_built: row.year_built ? parseInt(row.year_built) : null,
      amenities: row.amenities
    }));
    
    await supabase.rpc('truncate_af_property_directory');
    const { error } = await supabase.from('af_property_directory').insert(records);
    if (error) throw new Error(JSON.stringify(error));
    
    return { report: 'property_directory', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'property_directory', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncTenantLedger(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('tenant_ledger');
    
    const records = data.map((row: any) => ({
      date: row.date || null,
      payer: row.payer,
      description: row.description,
      debit: row.debit ? parseFloat(row.debit) : null,
      credit: row.credit ? parseFloat(row.credit) : null,
      credit_debit_balance: row.credit_debit_balance ? parseFloat(row.credit_debit_balance) : null
    }));
    
    await supabase.rpc('truncate_af_tenant_ledger');
    
    // Insert in batches
    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase.from('af_tenant_ledger').insert(batch);
      if (error) throw new Error(JSON.stringify(error));
    }
    
    return { report: 'tenant_ledger', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'tenant_ledger', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncLeaseHistory(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('lease_history');
    
    const records = data.map((row: any) => ({
      unit_name: row.unit_name,
      property_name: row.property_name,
      property_id: row.property_id,
      unit_type: row.unit_type,
      tenant_name: row.tenant_name,
      lease_start: row.lease_start || null,
      lease_end: row.lease_end || null,
      rent: row.rent ? parseFloat(row.rent) : null,
      most_recent_rent: row.most_recent_rent ? parseFloat(row.most_recent_rent) : null,
      market_rent: row.market_rent ? parseFloat(row.market_rent) : null,
      status: row.status,
      renewal: row.renewal === 'Yes' || row.renewal === true,
      security_deposit: row.security_deposit ? parseFloat(row.security_deposit) : null,
      move_in: row.move_in || null,
      move_out: row.move_out || null,
      occupancy_id: row.occupancy_id,
      tenant_id: row.tenant_id,
      unit_id: row.unit_id
    }));
    
    await supabase.rpc('truncate_af_lease_history');
    const { error } = await supabase.from('af_lease_history').insert(records);
    if (error) throw new Error(JSON.stringify(error));
    
    return { report: 'lease_history', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'lease_history', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncOccupancySummary(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('occupancy_summary');
    const today = getTodayDate();
    
    const records = data.map((row: any) => ({
      snapshot_date: today,
      property: row.property,
      property_id: row.property_id,
      unit_type: row.unit_type,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      number_of_units: row.number_of_units ? parseInt(row.number_of_units) : null,
      occupied: row.occupied ? parseInt(row.occupied) : null,
      percent_occupied: row.percent_occupied ? parseFloat(row.percent_occupied) : null,
      average_square_feet: row.average_square_feet ? parseFloat(row.average_square_feet) : null,
      average_market_rent: row.average_market_rent ? parseFloat(row.average_market_rent) : null,
      average_rent: row.average_rent ? parseFloat(row.average_rent) : null,
      vacant_rented: row.vacant_rented ? parseInt(row.vacant_rented) : null,
      vacant_unrented: row.vacant_unrented ? parseInt(row.vacant_unrented) : null,
      notice_rented: row.notice_rented ? parseInt(row.notice_rented) : null,
      notice_unrented: row.notice_unrented ? parseInt(row.notice_unrented) : null
    }));
    
    await supabase.rpc('truncate_af_occupancy_summary');
    const { error } = await supabase.from('af_occupancy_summary').insert(records);
    if (error) throw new Error(JSON.stringify(error));
    
    return { report: 'occupancy_summary', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'occupancy_summary', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

function parseDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  // Handle multiple dates like "02/01/2026, 02/04/2026" - take first one
  const firstDate = dateStr.split(',')[0].trim();
  // Try to parse and return ISO format
  const parsed = new Date(firstDate);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split('T')[0];
}

async function syncChargeDetail(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('charge_detail');
    
    const records = data.map((row: any) => ({
      txn_id: row.txn_id ? String(row.txn_id) : null,
      property_name: row.property_name,
      property_id: row.property_id,
      unit: row.unit,
      unit_id: row.unit_id,
      charge_date: parseDate(row.charge_date),
      account_name: row.account_name,
      account_number: row.account_number,
      received_from: row.received_from,
      charge_amount: row.charge_amount ? parseFloat(row.charge_amount) : null,
      charge_description: row.charge_description,
      paid_amount: row.paid_amount ? parseFloat(row.paid_amount) : null,
      receipt_date: parseDate(row.receipt_date),
      created_at: row.created_at || null
    }));
    
    await supabase.rpc('truncate_af_charge_detail');
    
    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase.from('af_charge_detail').insert(batch);
      if (error) throw new Error(JSON.stringify(error));
    }
    
    return { report: 'charge_detail', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'charge_detail', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncGeneralLedger(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('general_ledger');
    
    const records = data.map((row: any) => ({
      txn_id: row.txn_id ? String(row.txn_id) : null,
      account_name: row.account_name,
      account_number: row.account_number,
      property_name: row.property_name,
      property_id: row.property_id,
      unit: row.unit,
      unit_id: row.unit_id,
      post_date: row.post_date || null,
      month: row.month ? parseInt(row.month) : null,
      quarter: row.quarter ? parseInt(row.quarter) : null,
      year: row.year ? parseInt(row.year) : null,
      party_name: row.party_name,
      type: row.type,
      reference: row.reference,
      debit: row.debit ? parseFloat(row.debit) : null,
      credit: row.credit ? parseFloat(row.credit) : null,
      credit_debit_balance: row.credit_debit_balance ? parseFloat(row.credit_debit_balance) : null,
      description: row.description,
      remarks: row.remarks,
      created_by: row.created_by
    }));
    
    await supabase.rpc('truncate_af_general_ledger');
    
    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase.from('af_general_ledger').insert(batch);
      if (error) throw new Error(JSON.stringify(error));
    }
    
    return { report: 'general_ledger', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'general_ledger', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncChartOfAccounts(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('chart_of_accounts');
    
    const records = data.map((row: any) => ({
      gl_account_id: row.gl_account_id,
      number: row.number,
      account_name: row.account_name,
      account_type: row.account_type,
      sub_accountof: row.sub_accountof,
      offset_account: row.offset_account,
      hidden: row.hidden === 'Yes' || row.hidden === true
    }));
    
    await supabase.rpc('truncate_af_chart_of_accounts');
    const { error } = await supabase.from('af_chart_of_accounts').insert(records);
    if (error) throw new Error(JSON.stringify(error));
    
    return { report: 'chart_of_accounts', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'chart_of_accounts', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncTrialBalance(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('trial_balance');
    const today = getTodayDate();
    
    const records = data.map((row: any) => ({
      snapshot_date: today,
      account_name: row.account_name,
      balance_forward: row.balance_forward ? parseFloat(row.balance_forward) : null,
      debit: row.debit ? parseFloat(row.debit) : null,
      credit: row.credit ? parseFloat(row.credit) : null,
      ending_balance: row.ending_balance ? parseFloat(row.ending_balance) : null
    }));
    
    await supabase.rpc('truncate_af_trial_balance');
    const { error } = await supabase.from('af_trial_balance').insert(records);
    if (error) throw new Error(JSON.stringify(error));
    
    return { report: 'trial_balance', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'trial_balance', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncProspectSourceTracking(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('prospect_source_tracking');
    const today = getTodayDate();
    
    const records = data.map((row: any) => ({
      snapshot_date: today,
      source: row.source,
      guest_card_inquiries: row.guest_card_inquiries ? parseInt(row.guest_card_inquiries) : null,
      showings: row.showings ? parseInt(row.showings) : null,
      applications: row.applications ? parseInt(row.applications) : null,
      approved_applications: row.approved_applications ? parseInt(row.approved_applications) : null,
      converted_tenants: row.converted_tenants ? parseInt(row.converted_tenants) : null
    }));
    
    await supabase.rpc('truncate_af_prospect_source_tracking');
    const { error } = await supabase.from('af_prospect_source_tracking').insert(records);
    if (error) throw new Error(JSON.stringify(error));
    
    return { report: 'prospect_source_tracking', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'prospect_source_tracking', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

// Helper function for Central Time
function getTodayDate(): string {
  const now = new Date();
  const centralOffset = -6 * 60;
  const utcOffset = now.getTimezoneOffset();
  const centralTime = new Date(now.getTime() + (utcOffset + centralOffset) * 60 * 1000);
  return centralTime.toISOString().split('T')[0];
}

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const reportParam = url.searchParams.get('report');
    
    const results: SyncResult[] = [];
    const delay = () => new Promise(resolve => setTimeout(resolve, 2200));
    
    if (!reportParam || reportParam === 'all') {
      console.log('Syncing all reports from AppFolio...');
      console.log('Today (Central):', getTodayDate());
      
      // Core reports (existing)
      results.push(await syncRentRoll()); await delay();
      results.push(await syncTenantTickler()); await delay();
      results.push(await syncRenewalSummary()); await delay();
      results.push(await syncShowings()); await delay();
      results.push(await syncRentalApplications()); await delay();
      results.push(await syncGuestCards()); await delay();
      results.push(await syncDelinquency()); await delay();
      
      // New reports
      results.push(await syncVendorDirectory()); await delay();
      results.push(await syncPropertyDirectory()); await delay();
      results.push(await syncTenantLedger()); await delay();
      results.push(await syncLeaseHistory()); await delay();
      results.push(await syncOccupancySummary()); await delay();
      results.push(await syncChargeDetail()); await delay();
      results.push(await syncGeneralLedger()); await delay();
      results.push(await syncChartOfAccounts()); await delay();
      results.push(await syncTrialBalance()); await delay();
      results.push(await syncProspectSourceTracking());
      
    } else if (reportParam === 'core') {
      // Just the core reports for faster sync
      results.push(await syncRentRoll()); await delay();
      results.push(await syncTenantTickler()); await delay();
      results.push(await syncRenewalSummary()); await delay();
      results.push(await syncShowings()); await delay();
      results.push(await syncRentalApplications()); await delay();
      results.push(await syncGuestCards()); await delay();
      results.push(await syncDelinquency());
      
    } else if (reportParam === 'financial') {
      // Financial reports
      results.push(await syncTenantLedger()); await delay();
      results.push(await syncChargeDetail()); await delay();
      results.push(await syncGeneralLedger()); await delay();
      results.push(await syncChartOfAccounts()); await delay();
      results.push(await syncTrialBalance());
      
    } else {
      // Individual report sync
      const syncFunctions: Record<string, () => Promise<SyncResult>> = {
        'rent_roll': syncRentRoll,
        'tenant_tickler': syncTenantTickler,
        'renewal_summary': syncRenewalSummary,
        'showings': syncShowings,
        'rental_applications': syncRentalApplications,
        'guest_cards': syncGuestCards,
        'delinquency': syncDelinquency,
        'vendor_directory': syncVendorDirectory,
        'property_directory': syncPropertyDirectory,
        'tenant_ledger': syncTenantLedger,
        'lease_history': syncLeaseHistory,
        'occupancy_summary': syncOccupancySummary,
        'charge_detail': syncChargeDetail,
        'general_ledger': syncGeneralLedger,
        'chart_of_accounts': syncChartOfAccounts,
        'trial_balance': syncTrialBalance,
        'prospect_source_tracking': syncProspectSourceTracking
      };
      
      const syncFn = syncFunctions[reportParam];
      if (!syncFn) {
        return new Response(JSON.stringify({ error: `Unknown report: ${reportParam}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      results.push(await syncFn());
    }
    
    const successCount = results.filter(r => r.success).length;
    const totalRows = results.reduce((sum, r) => sum + r.rowsProcessed, 0);
    
    return new Response(JSON.stringify({
      success: successCount === results.length,
      syncedAt: new Date().toISOString(),
      today: getTodayDate(),
      summary: {
        reportsProcessed: results.length,
        successfulReports: successCount,
        totalRowsProcessed: totalRows
      },
      results
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Sync error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: String(error) 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
