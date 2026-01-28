import { supabase } from '../../../../lib/supabase';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const snapshotDate = formData.get('snapshotDate');
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    
    if (!snapshotDate) {
      return NextResponse.json({ error: 'No snapshot date provided' }, { status: 400 });
    }
    
    const text = await file.text();
    const rows = parseCSV(text);
    
    // Parse the rent roll data
    const records = parseRentRollData(rows, snapshotDate);
    
    if (records.length === 0) {
      return NextResponse.json({ error: 'No valid records found in CSV' }, { status: 400 });
    }
    
    // Delete existing records for this snapshot date (upsert behavior)
    await supabase
      .from('rent_roll_snapshots')
      .delete()
      .eq('snapshot_date', snapshotDate);
    
    // Insert new records in batches of 100
    const batchSize = 100;
    let insertedCount = 0;
    
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase
        .from('rent_roll_snapshots')
        .insert(batch);
      
      if (error) {
        console.error('Error inserting batch:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      
      insertedCount += batch.length;
    }
    
    return NextResponse.json({
      success: true,
      message: `Successfully imported ${insertedCount} unit records for ${snapshotDate}`,
      recordCount: insertedCount
    });
    
  } catch (error) {
    console.error('Error importing rent roll:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function parseCSV(text) {
  const lines = text.split('\n');
  const rows = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const row = [];
    let inQuotes = false;
    let currentValue = '';
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(currentValue.trim());
        currentValue = '';
      } else {
        currentValue += char;
      }
    }
    row.push(currentValue.trim());
    rows.push(row);
  }
  
  return rows;
}

function parseRentRollData(rows, snapshotDate) {
  const records = [];
  let currentProperty = null;
  
  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 2) continue;
    
    const firstCell = row[0] || '';
    
    // Check if this is a property header row (starts with "->")
    if (firstCell.startsWith('->')) {
      // Extract property name - format: "-> Property Name - Address"
      const propertyMatch = firstCell.match(/^->\s*(.+?)\s*-\s*.+$/);
      if (propertyMatch) {
        currentProperty = propertyMatch[1].trim();
      } else {
        // Fallback: just remove the arrow
        currentProperty = firstCell.replace(/^->\s*/, '').trim();
      }
      continue;
    }
    
    // Check if this is a summary row (contains "Units" or "Total")
    if (firstCell.includes('Units') || firstCell.startsWith('Total')) {
      continue;
    }
    
    // Skip empty rows or rows without a unit identifier
    if (!firstCell || !currentProperty) continue;
    
    // This should be a unit row
    const unit = firstCell;
    const bedBath = row[1] || null;
    const status = row[2] || null;
    
    // Skip if no status (likely not a valid unit row)
    if (!status) continue;
    
    const record = {
      snapshot_date: snapshotDate,
      property: currentProperty,
      unit: unit,
      bed_bath: bedBath,
      status: status,
      sqft: parseInteger(row[3]),
      total_rent: parseDecimal(row[4]),
      past_due: parseDecimal(row[5]),
      other_charges: parseDecimal(row[6]),
      utility_reimbursement: parseDecimal(row[7]),
      tenant_rental_income: parseDecimal(row[8]),
      cha_income: parseDecimal(row[9]),
      iha_income: parseDecimal(row[10]),
      kckha_income: parseDecimal(row[11]),
      hakc_income: parseDecimal(row[12]),
      hud_income: parseDecimal(row[13]),
      pet_rent: parseDecimal(row[14]),
      storage_fee: parseDecimal(row[15]),
      parking_fee: parseDecimal(row[16]),
      insurance_services: parseDecimal(row[17]),
      lease_from: parseDate(row[18]),
      lease_to: parseDate(row[19])
    };
    
    records.push(record);
  }
  
  return records;
}

function parseDecimal(value) {
  if (!value || value === '') return null;
  // Remove commas and parse
  const cleaned = value.replace(/,/g, '').replace(/"/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseInteger(value) {
  if (!value || value === '') return null;
  const cleaned = value.replace(/,/g, '').replace(/"/g, '');
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

function parseDate(value) {
  if (!value || value === '') return null;
  // Expected format: MM/DD/YYYY
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
}
