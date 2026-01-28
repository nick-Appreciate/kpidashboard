const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://hkmfsnhmxhhndzfxqmhp.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).replace(/,/g, '');
  const num = Number(str);
  return isNaN(num) ? null : num;
}

function parseInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).replace(/,/g, '');
  const num = parseInt(str, 10);
  return isNaN(num) ? null : num;
}

function parseExcelDateOnly(value) {
  if (value === null || value === undefined || value === '') return null;
  
  if (typeof value === 'number') {
    const date = new Date((value - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  }
  
  if (typeof value === 'string') {
    const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      const [, month, day, year] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
    return value;
  }
  
  return null;
}

function parseRentRollSnapshot(workbook, filename) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const records = [];
  let currentProperty = '';
  let headerIndex = -1;

  // First, try to extract "As of:" date from file content
  let snapshotDate = '';
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    for (const cell of row) {
      if (cell && typeof cell === 'string') {
        const asOfMatch = cell.match(/As of:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
        if (asOfMatch) {
          const [, month, day, year] = asOfMatch;
          snapshotDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          console.log(`  Found 'As of' date: ${snapshotDate}`);
          break;
        }
      }
    }
    if (snapshotDate) break;
  }
  
  if (!snapshotDate) {
    const dateMatch = filename.match(/(\d{4})(\d{2})(\d{2})/);
    snapshotDate = dateMatch 
      ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
      : new Date().toISOString().split('T')[0];
    console.log(`  Using filename/fallback date: ${snapshotDate}`);
  }

  // Find header row
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (row && row[0] === 'Unit') {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) return { records, snapshotDate };

  for (let i = headerIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.every(cell => cell === null || cell === undefined || cell === '')) continue;

    const firstCell = row[0] ? String(row[0]).trim() : '';

    // Property header row - starts with "->" OR contains address pattern (has " - " and state abbreviation)
    if (firstCell.startsWith('->')) {
      const propertyMatch = firstCell.match(/^->\s*(.+?)\s*-\s*.+$/);
      if (propertyMatch) {
        currentProperty = propertyMatch[1].trim();
      } else {
        currentProperty = firstCell.replace(/^->\s*/, '').trim();
      }
      continue;
    }
    
    // Check for property row without "->" prefix (e.g., "1511 Sylvan Lane - 1511 Sylvan Lane Columbia, MO 65202")
    if (firstCell.includes(' - ') && /\b[A-Z]{2}\s+\d{5}\b/.test(firstCell)) {
      const propertyMatch = firstCell.match(/^(.+?)\s*-\s*.+$/);
      if (propertyMatch) {
        currentProperty = propertyMatch[1].trim();
      } else {
        currentProperty = firstCell;
      }
      continue;
    }

    if (firstCell.includes('Units') || firstCell.startsWith('Total')) continue;

    if (!currentProperty || !firstCell) continue;

    const status = row[2] ? String(row[2]).trim() : null;
    if (!status) continue;

    records.push({
      snapshot_date: snapshotDate,
      property: currentProperty,
      unit: firstCell,
      bed_bath: row[1] ? String(row[1]) : null,
      status: status,
      sqft: parseInteger(row[3]),
      total_rent: parseNumber(row[4]),
      past_due: parseNumber(row[5]),
      other_charges: parseNumber(row[6]),
      utility_reimbursement: parseNumber(row[7]),
      tenant_rental_income: parseNumber(row[8]),
      cha_income: parseNumber(row[9]),
      iha_income: parseNumber(row[10]),
      kckha_income: parseNumber(row[11]),
      hakc_income: parseNumber(row[12]),
      hud_income: parseNumber(row[13]),
      pet_rent: parseNumber(row[14]),
      storage_fee: parseNumber(row[15]),
      parking_fee: parseNumber(row[16]),
      insurance_services: parseNumber(row[17]),
      lease_from: parseExcelDateOnly(row[18]),
      lease_to: parseExcelDateOnly(row[19]),
    });
  }

  return { records, snapshotDate };
}

async function processFiles() {
  const folderPath = path.join(__dirname, '../Example CSV\'s/Rent Roll Snapshots');
  const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.xlsx'));
  
  console.log(`Found ${files.length} XLSX files to process\n`);
  
  const results = [];
  
  for (const file of files) {
    console.log(`Processing: ${file}`);
    const filePath = path.join(folderPath, file);
    
    try {
      const workbook = XLSX.readFile(filePath);
      const { records, snapshotDate } = parseRentRollSnapshot(workbook, file);
      
      if (records.length === 0) {
        console.log(`  No records parsed, skipping\n`);
        continue;
      }
      
      // Delete existing records for this snapshot date
      const { error: deleteError } = await supabase
        .from('rent_roll_snapshots')
        .delete()
        .eq('snapshot_date', snapshotDate);
      
      if (deleteError) {
        console.error(`  Delete error: ${deleteError.message}`);
      }
      
      // Insert new records
      const { data, error } = await supabase
        .from('rent_roll_snapshots')
        .insert(records)
        .select();
      
      if (error) {
        console.error(`  Insert error: ${error.message}\n`);
        results.push({ file, snapshotDate, success: false, error: error.message });
      } else {
        console.log(`  Inserted ${data.length} records for ${snapshotDate}\n`);
        results.push({ file, snapshotDate, success: true, count: data.length });
      }
    } catch (err) {
      console.error(`  Error: ${err.message}\n`);
      results.push({ file, success: false, error: err.message });
    }
  }
  
  console.log('\n=== Summary ===');
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`Successful: ${successful.length}`);
  successful.forEach(r => console.log(`  ${r.snapshotDate}: ${r.count} records`));
  
  if (failed.length > 0) {
    console.log(`Failed: ${failed.length}`);
    failed.forEach(r => console.log(`  ${r.file}: ${r.error}`));
  }
  
  // Show unique snapshot dates
  const uniqueDates = [...new Set(successful.map(r => r.snapshotDate))].sort();
  console.log(`\nUnique snapshot dates: ${uniqueDates.length}`);
  uniqueDates.forEach(d => console.log(`  ${d}`));
}

processFiles().catch(console.error);
