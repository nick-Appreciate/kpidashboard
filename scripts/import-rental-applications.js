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
    
    // Skip section headers (lines starting with "->")
    if (values[0] && values[0].startsWith('->')) continue;
    
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

function parseDateTime(dateStr) {
  if (!dateStr) return null;
  // Format: "01/08/2026 at 09:09 PM" or "11/09/2025"
  const matchFull = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4}) at (\d{1,2}):(\d{2}) (AM|PM)/);
  if (matchFull) {
    let [, month, day, year, hour, minute, ampm] = matchFull;
    hour = parseInt(hour);
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    return `${year}-${month}-${day}T${String(hour).padStart(2, '0')}:${minute}:00`;
  }
  
  // Simple date format: "11/09/2025"
  const matchSimple = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (matchSimple) {
    const [, month, day, year] = matchSimple;
    return `${year}-${month}-${day}`;
  }
  
  return null;
}

async function importRentalApplications() {
  const csvPath = path.join(__dirname, '..', 'Example CSV\'s', 'rental_applications-20260209.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parseCSV(content);
  
  console.log(`Parsed ${records.length} records from CSV`);
  
  const dbRecords = records.map(r => ({
    applicants: r['Applicant(s)'] || null,
    received: parseDateTime(r['Received']),
    desired_move_in: parseDateTime(r['Desired Move In']),
    lead_source: r['Lead Source'] || null,
    status: r['Status'] || null,
    screening: r['Screening'] || null,
    approved_at: parseDateTime(r['Approved At']),
    denied_at: parseDateTime(r['Denied At']),
    rental_application_id: r['Rental Application ID'] || null,
    move_in_date: parseDateTime(r['Move In Date']),
    lease_start_date: parseDateTime(r['Lease Start Date']),
    lease_end_date: parseDateTime(r['Lease End Date']),
    inquiry_id: r['Inquiry ID'] || null,
    application_status: r['Application Status'] || null,
    tenant_id: r['Tenant ID'] || null,
    updated_at: new Date().toISOString()
  })).filter(r => r.applicants && r.received);
  
  console.log(`Prepared ${dbRecords.length} valid records for import`);
  
  // Upsert in batches
  const batchSize = 20;
  let imported = 0;
  let errors = 0;
  
  for (let i = 0; i < dbRecords.length; i += batchSize) {
    const batch = dbRecords.slice(i, i + batchSize);
    const { error } = await supabase
      .from('rental_applications')
      .upsert(batch, { 
        onConflict: 'applicants,received',
        ignoreDuplicates: false 
      });
    
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
  const { count } = await supabase.from('rental_applications').select('*', { count: 'exact', head: true });
  console.log(`Total rental applications in database: ${count}`);
}

importRentalApplications().catch(console.error);
