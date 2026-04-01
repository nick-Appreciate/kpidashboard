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
    // Fetch with a wide date window: 2 years back to 2 years forward
    // This captures expired/MTM tenants with sent renewals, not just upcoming leases
    const today = new Date();
    const twoYearsAgo = new Date(today);
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const twoYearsOut = new Date(today);
    twoYearsOut.setFullYear(twoYearsOut.getFullYear() + 2);
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    const data = await fetchAppFolioReport('renewal_summary', {
      'filters[lease_end_date_from]': fmt(twoYearsAgo),
      'filters[lease_end_date_to]': fmt(twoYearsOut),
    });

    const records = data.map((row: any) => ({
      unit_name: row.unit_name || row.unit,
      property_name: row.property_name,
      tenant_name: row.tenant || null,
      lease_start: row.lease_start || null,
      lease_end: row.lease_end || null,
      rent: row.rent ? parseFloat(row.rent) : null,
      status: row.status || null,
      renewal_sent_date: row.renewal_sent_date || null,
      countersigned_date: row.countersigned_date || null,
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
      showing_id: row.showing_id || null,
      guest_card_name: row.guest_card_name || null,
      guest_card_id: row.guest_card_id || null,
      inquiry_id: row.inquiry_id || null,
      email: row.email || null,
      phone: row.phone_number || null,
      property: row.property_name,
      showing_unit: row.unit || null,
      showing_time: row.showing_time || null,
      status: row.status || null,
      source: row.source || null,
      lead_type: row.lead_type || null,
      assigned_user: row.assigned_user || null,
      updated_at: new Date().toISOString()
    }));
    
    // Use upsert with composite key (guest_card_name, property, showing_time)
    // This will insert new records and update existing ones
    const { error } = await supabase
      .from('showings')
      .upsert(records, { 
        onConflict: 'guest_card_name,property,showing_time',
        ignoreDuplicates: false 
      });
    
    if (error) throw new Error(JSON.stringify(error));
    
    return { report: 'showings', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'showings', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncRentalApplications(): Promise<SyncResult> {
  try {
    // Use from_date filter to get historical applications (required filter per API docs)
    const data = await fetchAppFolioReport('rental_applications', {
      from_date: '2025-01-01'
    });
    
    const records = data.map((row: any) => ({
      applicants: row.applicants || null,
      received: row.received || null,
      desired_move_in: row.desired_move_in || null,
      lead_source: row.lead_source || null,
      status: row.status || null,
      unit: row.unit_title || null,
      rental_application_id: row.rental_application_id ? String(row.rental_application_id) : null,
      updated_at: new Date().toISOString()
    })).filter((r: any) => r.applicants && r.received);
    
    // Use upsert to preserve historical data
    const { error } = await supabase
      .from('rental_applications')
      .upsert(records, {
        onConflict: 'applicants,received',
        ignoreDuplicates: false
      });

    if (error) throw new Error(JSON.stringify(error));

    // Backfill inquiry_source and inquiry_id from leasing_reports via name matching
    // leasing_reports uses "Last, First" format, rental_applications uses "First M. Last"
    await supabase.rpc('backfill_inquiry_source');

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
      inquiry_id: row.inquiry_id ? String(row.inquiry_id) : null,
      updated_at: new Date().toISOString()
    }));
    
    // Use upsert to preserve historical data
    const batchSize = 50;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase
        .from('leasing_reports')
        .upsert(batch, { 
          onConflict: 'name,property,inquiry_received',
          ignoreDuplicates: false 
        });
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
      in_collections: row.in_collections === 'Yes' || row.in_collections === true,
      synced_at: new Date().toISOString()
    }));
    
    // Use upsert to create daily snapshots - one record per tenant per day
    const { error } = await supabase
      .from('af_delinquency')
      .upsert(records, { 
        onConflict: 'snapshot_date,occupancy_id',
        ignoreDuplicates: false 
      });
    
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

async function debugReport(reportName: string, filters: Record<string, unknown> = {}): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport(reportName, filters);
    const sample = data.length > 0 ? Object.keys(data[0] as any).join(', ') : 'NO DATA';
    const sampleRow = data.length > 0 ? JSON.stringify(data[0]).slice(0, 800) : '';
    return { report: 'debug_' + reportName, success: true, rowsProcessed: data.length, error: `KEYS: ${sample} | SAMPLE: ${sampleRow}` };
  } catch (error: any) {
    return { report: 'debug_' + reportName, success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncOwnerDirectory(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('owner_directory');

    const records = data.map((row: any) => ({
      owner_id: row.owner_id ? Number(row.owner_id) : null,
      name: row.name,
      first_name: row.first_name || null,
      last_name: row.last_name || null,
      email: row.email || null,
      phone_numbers: row.phone_numbers || null,
      payment_type: row.payment_type || null,
      properties_owned: row.properties_owned || null,
      properties_owned_ids: row.properties_owned_i_ds || null,
      address: row.address || null,
      city: row.city || null,
      state: row.state || null,
      zip: row.zip || null,
      tags: row.tags || null,
      hold_payments: row.hold_payments === 'Yes' || row.hold_payments === true,
      synced_at: new Date().toISOString()
    }));

    await supabase.rpc('truncate_af_owner_directory');
    const { error } = await supabase.from('af_owner_directory').insert(records);
    if (error) throw new Error(JSON.stringify(error));

    return { report: 'owner_directory', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'owner_directory', success: false, rowsProcessed: 0, error: error?.message || String(error) };
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
      amenities: row.amenities,
      owner_ids: row.owner_i_ds || null,
      owners: row.owners || null,
      property_group_id: row.property_group_id ? Number(row.property_group_id) : null,
      portfolio_id: row.portfolio_id ? Number(row.portfolio_id) : null,
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
    const data = await fetchAppFolioReport('tenant_ledger', {
      from_date: '2025-10-01',
      to_date: getTodayDate()
    });
    
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

async function syncBillDetail(): Promise<SyncResult> {
  try {
    // bill_detail uses occurred_on_from/to, not from_date/to_date
    const data = await fetchAppFolioReport('bill_detail', {
      occurred_on_from: '2025-01-01',
      occurred_on_to: getTodayDate()
    });

    const records = data.map((row: any) => {
      // Amount = paid + unpaid (gives total bill amount)
      const paid = row.paid ? parseFloat(row.paid) : 0;
      const unpaid = row.unpaid ? parseFloat(row.unpaid) : 0;
      const totalAmount = paid + unpaid;

      // Derive status from payment state
      let status: string | null = null;
      if (row.payment_date) {
        status = 'Paid';
      } else if (row.approval_status === 'Approved' && unpaid > 0) {
        status = 'Unpaid';
      } else if (row.approval_status) {
        status = row.approval_status;
      }

      return {
        bill_id: row.txn_id ? String(row.txn_id) : null,
        vendor_name: row.payee_name,
        vendor_id: row.vendor_id ? String(row.vendor_id) : (row.party_id ? String(row.party_id) : null),
        property_name: row.property_name,
        property_id: row.property_id ? String(row.property_id) : null,
        bill_date: row.bill_date || null,
        due_date: row.due_date || null,
        paid_date: row.payment_date || null,
        bill_number: row.reference_number || null,
        memo: row.description || null,
        unit: row.unit || null,
        gl_account_name: row.account_name || null,
        gl_account_id: row.account_number ? String(row.account_number) : null,
        amount: totalAmount || null,
        status,
        synced_at: new Date().toISOString()
      };
    });

    await supabase.rpc('truncate_af_bill_detail');

    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase.from('af_bill_detail').insert(batch);
      if (error) throw new Error(JSON.stringify(error));
    }

    return { report: 'bill_detail', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'bill_detail', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncTenantDirectory(): Promise<SyncResult> {
  try {
    // Include all tenant statuses to get eviction/prior tenant contact info
    const data = await fetchAppFolioReport('tenant_directory', { 
      tenant_statuses: 'all'
    });
    
    const records = data.map((row: any) => ({
      // API returns 'selected_tenant_id' for tenant directory
      tenant_id: row.selected_tenant_id,
      tenant_name: row.tenant_name || row.name || row.tenantName,
      property_name: row.property_name,
      property_id: row.property_id,
      unit: row.unit,
      unit_id: row.unit_id,
      occupancy_id: row.occupancy_id,
      phone_numbers: row.phone_numbers,
      email: row.email || row.primary_email,
      status: row.status,
      move_in: row.move_in || null,
      move_out: row.move_out || null,
      lease_start: row.lease_start || null,
      lease_end: row.lease_end || null,
      synced_at: new Date().toISOString()
    }));
    
    await supabase.rpc('truncate_af_tenant_directory');
    
    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase.from('af_tenant_directory').insert(batch);
      if (error) throw new Error(JSON.stringify(error));
    }
    
    return { report: 'tenant_directory', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'tenant_directory', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncWorkOrders(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('work_order', {
      work_order_statuses: 'all'
    });

    const records = data.map((row: any) => ({
      work_order_id: row.work_order_id,
      work_order_number: row.work_order_number,
      service_request_id: row.service_request_id,
      service_request_number: row.service_request_number ? String(row.service_request_number) : null,
      service_request_description: row.service_request_description,
      job_description: row.job_description,
      instructions: row.instructions,
      status: row.status,
      priority: row.priority,
      work_order_type: row.work_order_type,
      work_order_issue: row.work_order_issue,
      property_name: row.property_name,
      property_id: row.property_id,
      unit_name: row.unit_name,
      unit_id: row.unit_id,
      occupancy_id: row.occupancy_id,
      primary_tenant: row.primary_tenant,
      primary_tenant_email: row.primary_tenant_email,
      primary_tenant_phone: row.primary_tenant_phone_number,
      requesting_tenant: row.requesting_tenant,
      submitted_by_tenant: row.submitted_by_tenant === 'Yes',
      vendor: row.vendor,
      vendor_id: row.vendor_id,
      vendor_trade: row.vendor_trade,
      created_at: row.created_at || null,
      created_by: row.created_by,
      assigned_user: row.assigned_user,
      scheduled_start: row.scheduled_start || null,
      scheduled_end: row.scheduled_end || null,
      work_completed_on: row.work_completed_on || null,
      completed_on: row.completed_on || null,
      canceled_on: row.canceled_on || null,
      follow_up_on: row.follow_up_on || null,
      estimate_req_on: row.estimate_req_on || null,
      estimated_on: row.estimated_on || null,
      estimate_amount: row.estimate_amount ? parseFloat(row.estimate_amount) : null,
      estimate_approval_status: row.estimate_approval_status,
      estimate_approved_on: row.estimate_approved_on || null,
      amount: row.amount ? parseFloat(row.amount) : null,
      invoice: row.invoice,
      vendor_bill_id: row.vendor_bill_id ? String(row.vendor_bill_id) : null,
      vendor_bill_amount: row.vendor_bill_amount ? parseFloat(row.vendor_bill_amount) : null,
      vendor_charge_id: row.vendor_charge_id ? String(row.vendor_charge_id) : null,
      vendor_charge_amount: row.vendor_charge_amount ? parseFloat(row.vendor_charge_amount) : null,
      tenant_total_charge_amount: row.tenant_total_charge_amount ? parseFloat(row.tenant_total_charge_amount) : null,
      tenant_charge_ids: row.tenant_charge_ids,
      corporate_charge_id: row.corporate_charge_id ? String(row.corporate_charge_id) : null,
      corporate_charge_amount: row.corporate_charge_amount ? parseFloat(row.corporate_charge_amount) : null,
      discount_amount: row.discount_amount ? parseFloat(row.discount_amount) : null,
      discount_bill_id: row.discount_bill_id ? String(row.discount_bill_id) : null,
      markup_amount: row.markup_amount ? parseFloat(row.markup_amount) : null,
      markup_bill_id: row.markup_bill_id ? String(row.markup_bill_id) : null,
      last_billed_on: row.last_billed_on || null,
      recurring: row.recurring === 'Yes',
      maintenance_limit: row.maintenance_limit ? parseFloat(row.maintenance_limit) : null,
      status_notes: row.status_notes,
      unit_turn_id: row.unit_turn_id,
      unit_turn_category: row.unit_turn_category,
      inspection_id: row.inspection_id,
      inspection_date: row.inspection_date || null,
      survey_id: row.survey_id,
      vendor_portal_invoices: row.vendor_portal_invoices,
      synced_at: new Date().toISOString()
    }));

    await supabase.rpc('truncate_af_work_orders');

    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase.from('af_work_orders').insert(batch);
      if (error) throw new Error(JSON.stringify(error));
    }

    return { report: 'work_order', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'work_order', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncIncomeRegister(): Promise<SyncResult> {
  try {
    const data = await fetchAppFolioReport('income_register', {
      receipt_date_from: '2025-10-01',
      receipt_date_to: getTodayDate()
    });

    const records = data.map((row: any) => ({
      txn_id: row.txn_id ? String(row.txn_id) : null,
      receipt_id: row.receipt_id ? String(row.receipt_id) : null,
      receipt_date: row.receipt_date || null,
      receipt_amount: row.receipt_amount ? parseFloat(row.receipt_amount) : null,
      charge_amount: row.charge_amount ? parseFloat(row.charge_amount) : null,
      payer: row.payer || null,
      reference: row.reference || null,
      description: row.description || null,
      property_name: row.property_name || null,
      property_id: row.property_id || null,
      unit: row.unit || null,
      unit_id: row.unit_id || null,
      account_name: row.account_name || null,
      account_number: row.account_number || null,
    }));

    await supabase.rpc('truncate_af_income_register');

    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase.from('af_income_register').insert(batch);
      if (error) throw new Error(JSON.stringify(error));
    }

    return { report: 'income_register', success: true, rowsProcessed: records.length };
  } catch (error: any) {
    return { report: 'income_register', success: false, rowsProcessed: 0, error: error?.message || String(error) };
  }
}

async function syncCashFlow(): Promise<SyncResult> {
  try {
    const today = getTodayDate();
    const todayDate = new Date(today + 'T12:00:00Z');
    const allRecords: any[] = [];

    // Build property ID -> name map from af_property_directory
    const { data: propDir } = await supabase
      .from('af_property_directory')
      .select('property_id, property_name');
    const propMap = new Map<number, string>();
    for (const p of (propDir || [])) {
      propMap.set(Number(p.property_id), p.property_name);
    }

    // Build account number -> COA info map
    const { data: coaData } = await supabase
      .from('af_chart_of_accounts')
      .select('number, account_name, account_type, sub_accountof');
    const coaMap = new Map<string, { account_type: string; sub_accountof: string | null }>();
    for (const c of (coaData || [])) {
      if (c.number) coaMap.set(c.number, { account_type: c.account_type, sub_accountof: c.sub_accountof });
    }

    // Map AppFolio account_type to our row_type categories
    function classifyByCoA(acctNum: string): { rowType: string; accountType: string; parentAccount: string | null } {
      const coa = acctNum ? coaMap.get(acctNum) : null;
      if (coa) {
        const at = coa.account_type;
        let rowType = 'income';
        if (at === 'Income') rowType = 'income';
        else if (at === 'Expense') rowType = 'expense';
        else if (at === 'Other Income') rowType = 'other_income';
        else if (at === 'Other Expense') rowType = 'other_expense';
        else rowType = 'other';
        return { rowType, accountType: at, parentAccount: coa.sub_accountof };
      }
      // Fallback by number range
      if (acctNum) {
        const num = parseFloat(acctNum);
        if (num >= 4000 && num < 5000) return { rowType: 'income', accountType: 'Income', parentAccount: null };
        if (num >= 5000 && num < 7000) return { rowType: 'expense', accountType: 'Expense', parentAccount: null };
        if (num >= 7000 && num < 8000) return { rowType: 'other_income', accountType: 'Other Income', parentAccount: null };
        if (num >= 8000) return { rowType: 'other_expense', accountType: 'Other Expense', parentAccount: null };
      }
      return { rowType: 'income', accountType: 'Income', parentAccount: null };
    }

    for (let m = 11; m >= 0; m--) {
      const monthDate = new Date(todayDate);
      monthDate.setMonth(monthDate.getMonth() - m);
      const year = monthDate.getFullYear();
      const month = monthDate.getMonth();
      const periodStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const periodEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      let data: unknown[];
      try {
        data = await fetchAppFolioReport('cash_flow_comparison', {
          posted_on_from: periodStart,
          posted_on_to: periodEnd
        });
      } catch (err: any) {
        console.error(`Cash flow fetch failed for ${periodStart}: ${err?.message}`);
        continue;
      }

      if (!data || data.length === 0) continue;

      // Track totals per property for computing summary rows
      const incomeTotals = new Map<string, number>();
      const expenseTotals = new Map<string, number>();
      const otherTotals = new Map<string, number>();

      for (const row of data as any[]) {
        const accountName = (row.account_name || '').toString().trim();
        if (!accountName) continue;
        const accountNumber = (row.account_number || '').toString().trim();

        // Skip AppFolio's built-in total/summary rows (empty account_number)
        // We compute our own summary rows (NOI, Total Income, Total Expense, etc.)
        if (!accountNumber) continue;

        const { rowType, accountType, parentAccount } = classifyByCoA(accountNumber);
        const ts = new Date().toISOString();

        // Helper to accumulate totals
        function addToTotals(propName: string, val: number) {
          if (rowType === 'income') incomeTotals.set(propName, (incomeTotals.get(propName) || 0) + val);
          else if (rowType === 'expense') expenseTotals.set(propName, (expenseTotals.get(propName) || 0) + val);
          else otherTotals.set(propName, (otherTotals.get(propName) || 0) + val);
        }

        const baseRecord = {
          period_start: periodStart, period_end: periodEnd,
          account_name: accountName, account_path: parentAccount, account_depth: parentAccount ? 1 : 0,
          row_type: rowType, account_type: accountType, account_number: accountNumber,
          parent_account: parentAccount, synced_at: ts
        };

        // Parse total column
        const totalVal = row.total ? parseFloat(String(row.total).replace(/,/g, '')) : null;
        if (totalVal !== null && !isNaN(totalVal)) {
          allRecords.push({ ...baseRecord, property_name: 'Total', amount: totalVal });
          addToTotals('Total', totalVal);
        }

        // Parse per-property amounts from properties array: [{id, value}, ...]
        const properties = row.properties;
        if (Array.isArray(properties)) {
          for (const prop of properties) {
            const propId = Number(prop.id);
            const propName = propMap.get(propId) || `Property ${propId}`;
            const val = prop.value ? parseFloat(String(prop.value).replace(/,/g, '')) : null;
            if (val === null || isNaN(val) || val === 0) continue;

            allRecords.push({ ...baseRecord, property_name: propName, amount: val });
            addToTotals(propName, val);
          }
        }
      }

      // Add computed summary rows for each property
      const allProps = new Set([...incomeTotals.keys(), ...expenseTotals.keys(), ...otherTotals.keys()]);
      for (const prop of allProps) {
        const income = incomeTotals.get(prop) || 0;
        const expense = expenseTotals.get(prop) || 0;
        const other = otherTotals.get(prop) || 0;
        const noi = income - expense;
        const cashFlow = noi + other;
        const ts = new Date().toISOString();

        for (const sr of [
          { account_name: 'Total Operating Income', row_type: 'total_income', amount: income },
          { account_name: 'Total Operating Expense', row_type: 'total_expense', amount: expense },
          { account_name: 'NOI - Net Operating Income', row_type: 'noi', amount: noi },
          { account_name: 'Net Other Items', row_type: 'net_other', amount: other },
          { account_name: 'Cash Flow', row_type: 'cash_flow', amount: cashFlow },
        ]) {
          allRecords.push({
            period_start: periodStart, period_end: periodEnd,
            account_name: sr.account_name, account_path: null, account_depth: 0,
            row_type: sr.row_type, property_name: prop, amount: sr.amount, synced_at: ts
          });
        }
      }

      // Rate limit between monthly calls
      if (m > 0) {
        await new Promise(resolve => setTimeout(resolve, 2200));
      }
    }

    if (allRecords.length === 0) {
      return { report: 'cash_flow', success: true, rowsProcessed: 0 };
    }

    // Truncate and re-insert
    await supabase.rpc('truncate_af_cash_flow');

    const batchSize = 100;
    for (let i = 0; i < allRecords.length; i += batchSize) {
      const batch = allRecords.slice(i, i + batchSize);
      const { error } = await supabase.from('af_cash_flow').insert(batch);
      if (error) throw new Error(JSON.stringify(error));
    }

    return { report: 'cash_flow', success: true, rowsProcessed: allRecords.length };
  } catch (error: any) {
    return { report: 'cash_flow', success: false, rowsProcessed: 0, error: error?.message || String(error) };
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
      results.push(await syncOwnerDirectory()); await delay();
      results.push(await syncTenantLedger()); await delay();
      results.push(await syncIncomeRegister()); await delay();
      results.push(await syncLeaseHistory()); await delay();
      results.push(await syncOccupancySummary()); await delay();
      results.push(await syncChargeDetail()); await delay();
      results.push(await syncGeneralLedger()); await delay();
      results.push(await syncChartOfAccounts()); await delay();
      results.push(await syncBillDetail()); await delay();
      results.push(await syncTrialBalance()); await delay();
      results.push(await syncProspectSourceTracking()); await delay();
      results.push(await syncTenantDirectory()); await delay();
      results.push(await syncWorkOrders()); await delay();
      results.push(await syncCashFlow());

    } else if (reportParam === 'core') {
      // Just the core reports for faster sync
      results.push(await syncRentRoll()); await delay();
      results.push(await syncTenantTickler()); await delay();
      results.push(await syncRenewalSummary()); await delay();
      results.push(await syncShowings()); await delay();
      results.push(await syncRentalApplications()); await delay();
      results.push(await syncGuestCards()); await delay();
      results.push(await syncDelinquency()); await delay();
      results.push(await syncTenantDirectory());
      
    } else if (reportParam === 'financial') {
      // Financial reports
      results.push(await syncTenantLedger()); await delay();
      results.push(await syncIncomeRegister()); await delay();
      results.push(await syncChargeDetail()); await delay();
      results.push(await syncGeneralLedger()); await delay();
      results.push(await syncChartOfAccounts()); await delay();
      results.push(await syncBillDetail()); await delay();
      results.push(await syncTrialBalance()); await delay();
      results.push(await syncCashFlow());

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
        'income_register': syncIncomeRegister,
        'lease_history': syncLeaseHistory,
        'occupancy_summary': syncOccupancySummary,
        'charge_detail': syncChargeDetail,
        'general_ledger': syncGeneralLedger,
        'chart_of_accounts': syncChartOfAccounts,
        'bill_detail': syncBillDetail,
        'trial_balance': syncTrialBalance,
        'prospect_source_tracking': syncProspectSourceTracking,
        'tenant_directory': syncTenantDirectory,
        'work_order': syncWorkOrders,
        'cash_flow': syncCashFlow,
        'owner_directory': syncOwnerDirectory
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

    // After bill_detail sync, match pending bills against AppFolio records
    const billDetailSynced = results.some(r => r.report === 'bill_detail' && r.success);
    if (billDetailSynced) {
      try {
        const { data: matches, error: matchErr } = await supabase.rpc('match_bills_to_appfolio');
        if (matchErr) {
          console.error('Bill matching error:', matchErr.message);
        } else if (matches && matches.length > 0) {
          const highConf = matches.filter((m: any) => m.confidence === 'high').length;
          const lowConf = matches.filter((m: any) => m.confidence === 'low').length;
          console.log(`Matched ${matches.length} bills to AppFolio (${highConf} auto-linked, ${lowConf} low confidence)`);
        }
      } catch (e: any) {
        console.error('Bill matching failed:', e?.message || String(e));
      }
    }

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
