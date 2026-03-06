import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read .env.local for Supabase creds
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function fetchAllBills() {
  const allRows = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/af_bill_detail?select=bill_id,vendor_name,amount,bill_date,bill_number,status,memo,property_name,unit&order=bill_date.desc&offset=${offset}&limit=${pageSize}`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'count=exact',
      },
    });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    allRows.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return allRows;
}

function normalize(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\s+(inc|llc|corp|ltd|co|lp|llp|pc|pllc|plc)\.?\s*$/i, '')
    .replace(/^\s*(the|a)\s+/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  console.log('Fetching af_bill_detail...');
  const data = await fetchAllBills();
  console.log(`Fetched ${data.length} bills`);

  // Build records with normalized vendor and month
  const bills = data
    .filter(r => r.bill_date)
    .map(r => ({
      bill_id: r.bill_id,
      vendor_name: r.vendor_name,
      vnorm: normalize(r.vendor_name),
      amount: Number(r.amount),
      bill_date: r.bill_date,
      bill_number: r.bill_number,
      status: r.status,
      description: r.memo,
      property: r.property_name,
      unit: r.unit || null,
      bill_month: r.bill_date.substring(0, 7), // YYYY-MM
    }));

  // Group by vendor + amount + property + unit + month
  const groups = new Map();
  for (const b of bills) {
    const key = `${b.vnorm}|${b.amount}|${b.property || ''}|${b.unit || '__none__'}|${b.bill_month}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }

  // Filter to duplicates only (must have different bill_ids, not just multi-line items on same bill)
  const dupeGroups = [...groups.entries()]
    .filter(([_, items]) => new Set(items.map(b => b.bill_id)).size > 1)
    .sort((a, b) => {
      // Sort by month desc, then vendor, then property
      const ma = a[1][0].bill_month, mb = b[1][0].bill_month;
      if (ma !== mb) return mb.localeCompare(ma);
      const va = a[1][0].vnorm, vb = b[1][0].vnorm;
      if (va !== vb) return va.localeCompare(vb);
      return a[1][0].amount - b[1][0].amount;
    });

  console.log(`Found ${dupeGroups.length} duplicate groups (same vendor + amount + property + unit within same month)\n`);

  // Build output
  const textLines = [];
  const excelRows = [];

  textLines.push('='.repeat(80));
  textLines.push('DUPLICATE BILLS REPORT — AppFolio Bills');
  textLines.push('Criteria: Same Vendor + Amount + Property + Unit within Same Month');
  textLines.push(`Generated: ${new Date().toLocaleString()}`);
  textLines.push(`Total duplicate groups: ${dupeGroups.length}`);
  textLines.push('='.repeat(80));

  // Group output by month
  let currentMonth = '';
  let groupNum = 0;

  for (const [key, items] of dupeGroups) {
    const month = items[0].bill_month;
    if (month !== currentMonth) {
      currentMonth = month;
      const monthLabel = new Date(month + '-01').toLocaleString('en-US', { month: 'long', year: 'numeric' });
      const monthGroups = dupeGroups.filter(([_, g]) => g[0].bill_month === month).length;
      textLines.push('');
      textLines.push('#'.repeat(80));
      textLines.push(`## ${monthLabel} — ${monthGroups} duplicate group(s)`);
      textLines.push('#'.repeat(80));
    }

    groupNum++;
    const amount = items[0].amount;
    const fmtAmt = '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2 });
    const unitLabel = items[0].unit ? ` | Unit: ${items[0].unit}` : '';

    textLines.push('');
    textLines.push(`  Group ${groupNum}: ${items[0].vendor_name} | ${fmtAmt} | ${items[0].property || 'N/A'}${unitLabel} (${items.length} entries)`);

    for (const b of items) {
      const link = `https://appreciateinc.appfolio.com/accounting/payable_invoices/${b.bill_id}`;
      textLines.push(`    Bill ${b.bill_id} | ${b.bill_date} | #${b.bill_number || 'N/A'} | ${b.status || 'N/A'}${b.unit ? ' | Unit: ' + b.unit : ''}`);
      if (b.description) textLines.push(`      ${b.description.substring(0, 120)}`);
      textLines.push(`      ${link}`);

      const monthLabel = new Date(b.bill_month + '-01').toLocaleString('en-US', { month: 'long', year: 'numeric' });
      excelRows.push({
        'Month': monthLabel,
        'Group': groupNum,
        'Vendor': b.vendor_name,
        'Amount': amount,
        'Property': b.property || '',
        'Unit': b.unit || '',
        'Bill ID': b.bill_id,
        'Date': b.bill_date,
        'Bill #': b.bill_number || '',
        'Status': b.status || '',
        'Description': (b.description || '').substring(0, 120),
        'Link': link,
        'Dup Count': items.length,
      });
    }
  }

  // Write text file
  const outputDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const textPath = path.join(outputDir, 'duplicate-bills.txt');
  fs.writeFileSync(textPath, textLines.join('\n'));
  console.log(`Text report: ${textPath}`);

  // Excel
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(excelRows);

  ws['!cols'] = [
    { wch: 18 },  // Month
    { wch: 6 },   // Group
    { wch: 35 },  // Vendor
    { wch: 12 },  // Amount
    { wch: 25 },  // Property
    { wch: 10 },  // Unit
    { wch: 12 },  // Bill ID
    { wch: 12 },  // Date
    { wch: 15 },  // Bill #
    { wch: 12 },  // Status
    { wch: 60 },  // Description
    { wch: 65 },  // Link
    { wch: 10 },  // Dup Count
  ];

  // Make Links clickable (column index 11)
  const linkCol = 11;
  for (let r = 1; r <= excelRows.length; r++) {
    const cellRef = XLSX.utils.encode_cell({ r, c: linkCol });
    const cell = ws[cellRef];
    if (cell && cell.v && typeof cell.v === 'string' && cell.v.startsWith('http')) {
      cell.l = { Target: cell.v, Tooltip: 'Open bill in AppFolio' };
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Duplicates');

  const xlsxPath = path.join(outputDir, 'duplicate-bills.xlsx');
  XLSX.writeFile(wb, xlsxPath);
  console.log(`Excel report: ${xlsxPath}`);

  // Copy to Downloads
  const dlPath = path.join('/Users/test/Downloads', 'duplicate-bills.xlsx');
  fs.copyFileSync(xlsxPath, dlPath);
  console.log(`Copied to: ${dlPath}`);

  // Print report
  console.log('\n' + textLines.join('\n'));
}

main().catch(console.error);
