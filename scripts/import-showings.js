const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://hkmfsnhmxhhndzfxqmhp.supabase.co';
// Use the legacy anon key which works for inserts
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
  // Format: "02/06/2026 at 02:00 PM"
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4}) at (\d{1,2}):(\d{2}) (AM|PM)/);
  if (!match) return null;
  
  let [, month, day, year, hour, minute, ampm] = match;
  hour = parseInt(hour);
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  
  return `${year}-${month}-${day}T${String(hour).padStart(2, '0')}:${minute}:00`;
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

async function importShowings() {
  const csvPath = path.join(__dirname, '..', 'Example CSV\'s', 'showings-20260209.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parseCSV(content);
  
  console.log(`Parsed ${records.length} records from CSV`);
  
  const dbRecords = records.map(r => ({
    guest_card_name: r['Guest Card Name'] || null,
    email: r['Email'] || null,
    phone: r['Phone Number'] || null,
    property: cleanPropertyName(r['Property']),
    showing_unit: r['Showing Unit'] || null,
    showing_time: parseDateTime(r['Showing Time']),
    confirmation_time: parseDateTime(r['Confirmation Time']),
    assigned_user: r['Assigned User'] || null,
    description: r['Description'] || null,
    status: r['Status'] || null,
    type: r['Type'] || null,
    last_activity_date: r['Last Activity Date'] ? (() => {
      const match = r['Last Activity Date'].match(/(\d{2})\/(\d{2})\/(\d{4})/);
      return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
    })() : null,
    last_activity_type: r['Last Activity Type'] || null,
    guest_card_id: r['Guest Card ID'] || null,
    guest_card_uuid: r['Guest Card UUID'] || null,
    inquiry_id: r['Inquiry ID'] || null,
    showing_id: r['Showing ID'] || null,
    unit_type_id: r['Unit Type ID'] || null,
    created_by_id: r['Created By ID'] || null,
    assigned_user_id: r['Assigned User ID'] || null,
    lead_type: r['Lead Type'] || null,
    source: r['Source'] || null,
    rental_application_id: r['Rental Application ID'] || null,
    rental_application_group_id: r['Rental Application Group ID'] || null,
    rental_application_received: parseDateTime(r['Rental Application Received']),
    rental_application_status: r['Rental Application Status'] || null,
    updated_at: new Date().toISOString()
  })).filter(r => r.guest_card_name && r.property && r.showing_time);
  
  console.log(`Prepared ${dbRecords.length} valid records for import`);
  
  // Upsert in batches
  const batchSize = 50;
  let imported = 0;
  let errors = 0;
  
  for (let i = 0; i < dbRecords.length; i += batchSize) {
    const batch = dbRecords.slice(i, i + batchSize);
    const { error } = await supabase
      .from('showings')
      .upsert(batch, { 
        onConflict: 'guest_card_name,property,showing_time',
        ignoreDuplicates: false 
      });
    
    if (error) {
      console.error(`Batch ${i / batchSize + 1} error:`, error.message);
      errors += batch.length;
    } else {
      imported += batch.length;
      console.log(`Imported batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(dbRecords.length / batchSize)}`);
    }
  }
  
  console.log(`\nImport complete: ${imported} records imported, ${errors} errors`);
  
  // Check total count
  const { count } = await supabase.from('showings').select('*', { count: 'exact', head: true });
  console.log(`Total showings in database: ${count}`);
}

importShowings().catch(console.error);
