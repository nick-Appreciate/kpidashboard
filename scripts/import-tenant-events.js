const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://hkmfsnhmxhhndzfxqmhp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrbWZzbmhteGhobmR6ZnhxbWhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDk3MzgsImV4cCI6MjA4NTEyNTczOH0.MY3w7-ktfuoR0bMcgMroxPSb7ehSmnqCReuuLogtm0Q';
const supabase = createClient(supabaseUrl, supabaseKey);

function parseCSV(content) {
  const lines = content.split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const records = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Parse CSV line handling quoted fields
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    // Skip empty rows
    if (!values[0] || values[0] === '') continue;
    
    const record = {};
    headers.forEach((header, idx) => {
      record[header] = values[idx] || null;
    });
    
    records.push(record);
  }
  
  return records;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  // Format: "10/01/2001" or "MM/DD/YYYY"
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month}-${day}`;
  }
  return null;
}

function cleanPropertyName(property) {
  if (!property) return null;
  // Extract just the property name before the dash and address
  const match = property.match(/^([^-]+)/);
  if (match) {
    return match[1].trim();
  }
  return property.trim();
}

function parseRent(rentStr) {
  if (!rentStr) return null;
  // Remove commas and parse
  const cleaned = rentStr.replace(/,/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function cleanPhone(phoneStr) {
  if (!phoneStr) return null;
  // Remove "Phone: " or "Mobile: " prefix
  return phoneStr.replace(/^(Phone|Mobile):\s*/i, '').trim();
}

async function importTenantEvents() {
  const csvPath = path.join(__dirname, '..', 'Example CSV\'s', 'tenant_tickler-20260209.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parseCSV(content);
  
  console.log(`Parsed ${records.length} records from CSV`);
  
  // Use today's date as snapshot_date for historical import
  const snapshotDate = '2026-02-09';
  
  const dbRecords = records.map(r => ({
    event_date: parseDate(r['Date']),
    event_type: r['Event'] || null,
    property: cleanPropertyName(r['Property']),
    unit: r['Unit'] || null,
    tags: r['Tags'] || null,
    tenant_name: r['Tenant'] || null,
    tenant_phone: cleanPhone(r['Tenant Phone Number']),
    tenant_email: r['Tenant Email'] || null,
    rent: parseRent(r['Rent']),
    lease_from: parseDate(r['Lease From']),
    lease_to: parseDate(r['Lease To']),
    deposit: parseRent(r['Deposit']),
    snapshot_date: snapshotDate
  })).filter(r => r.event_date && r.property);
  
  console.log(`Prepared ${dbRecords.length} valid records for import`);
  
  // First, add a unique constraint if needed
  // Then insert in batches
  const batchSize = 50;
  let imported = 0;
  let errors = 0;
  
  for (let i = 0; i < dbRecords.length; i += batchSize) {
    const batch = dbRecords.slice(i, i + batchSize);
    const { error } = await supabase
      .from('tenant_events')
      .insert(batch);
    
    if (error) {
      console.error(`Batch ${Math.floor(i / batchSize) + 1} error:`, error.message);
      errors += batch.length;
    } else {
      imported += batch.length;
      console.log(`Imported batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(dbRecords.length / batchSize)}`);
    }
  }
  
  console.log(`\nImport complete: ${imported} records imported, ${errors} errors`);
  
  // Check total count
  const { count } = await supabase.from('tenant_events').select('*', { count: 'exact', head: true });
  console.log(`Total tenant events in database: ${count}`);
}

importTenantEvents().catch(console.error);
