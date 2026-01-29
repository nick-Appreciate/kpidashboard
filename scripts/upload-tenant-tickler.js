const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://hkmfsnhmxhhndzfxqmhp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrbWZzbmhteGhobmR6ZnhxbWhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDk3MzgsImV4cCI6MjA4NTEyNTczOH0.MY3w7-ktfuoR0bMcgMroxPSb7ehSmnqCReuuLogtm0Q';

function parseDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [month, day, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return dateStr;
}

function parseNumber(value) {
  if (!value) return null;
  const num = parseFloat(String(value).replace(/,/g, '').replace(/"/g, ''));
  return isNaN(num) ? null : num;
}

function parseTenantTicklerCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const records = [];
  
  // Get snapshot date from filename
  const filename = path.basename(filePath);
  const dateMatch = filename.match(/(\d{4})(\d{2})(\d{2})/);
  const snapshotDate = dateMatch 
    ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
    : new Date().toISOString().split('T')[0];
  
  console.log(`Parsing tenant tickler for snapshot date: ${snapshotDate}`);
  
  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Parse CSV with proper handling of quoted fields
    const fields = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.trim());
    
    const [date, event, propertyRaw, unit, tags, tenant, phone, email, rent, leaseFrom, leaseTo, deposit] = fields;
    
    if (!date || !event || !propertyRaw || !unit) continue;
    
    // Extract property name (before " - " address)
    let property = propertyRaw;
    const dashIndex = propertyRaw.indexOf(' - ');
    if (dashIndex > 0) {
      property = propertyRaw.substring(0, dashIndex).trim();
    }
    
    records.push({
      event_date: parseDate(date),
      event_type: event,
      property: property,
      unit: unit,
      tags: tags || null,
      tenant_name: tenant || null,
      tenant_phone: phone ? phone.replace(/^Phone:\s*/i, '') : null,
      tenant_email: email || null,
      rent: parseNumber(rent),
      lease_from: parseDate(leaseFrom),
      lease_to: parseDate(leaseTo),
      deposit: parseNumber(deposit),
      snapshot_date: snapshotDate
    });
  }
  
  return records;
}

async function deleteExisting(snapshotDate) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/tenant_events?snapshot_date=eq.${snapshotDate}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    }
  });
  
  if (!response.ok) {
    console.log(`Warning: Could not delete existing records: ${response.status}`);
  }
}

async function uploadBatch(records) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/tenant_events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(records)
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  
  return true;
}

async function main() {
  const csvPath = path.join(__dirname, '..', "Example CSV's", 'tenant_tickler-20260128.csv');
  
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }
  
  const records = parseTenantTicklerCSV(csvPath);
  console.log(`Parsed ${records.length} records`);
  
  if (records.length === 0) {
    console.log('No records to upload');
    return;
  }
  
  const snapshotDate = records[0].snapshot_date;
  
  // Delete existing records for this snapshot date
  console.log(`Deleting existing records for ${snapshotDate}...`);
  await deleteExisting(snapshotDate);
  
  // Upload in batches
  console.log('Uploading records...');
  const batchSize = 100;
  let uploaded = 0;
  
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await uploadBatch(batch);
    uploaded += batch.length;
    process.stdout.write(`\rUploaded ${uploaded}/${records.length}`);
  }
  
  console.log(`\nDone! Uploaded ${uploaded} tenant event records.`);
}

main().catch(console.error);
