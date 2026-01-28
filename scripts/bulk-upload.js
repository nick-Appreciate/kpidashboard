const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://hkmfsnhmxhhndzfxqmhp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrbWZzbmhteGhobmR6ZnhxbWhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDk3MzgsImV4cCI6MjA4NTEyNTczOH0.MY3w7-ktfuoR0bMcgMroxPSb7ehSmnqCReuuLogtm0Q';

async function uploadBatch(records) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rent_roll_snapshots`, {
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
  // Read all the JSON data files
  const dates = ['2025-10-20', '2025-10-27', '2025-11-03', '2025-11-10', '2025-11-17', '2025-11-24', '2025-12-01', '2025-12-08', '2025-12-15', '2025-12-22', '2025-12-29', '2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'];
  
  let totalUploaded = 0;
  
  for (const date of dates) {
    const filePath = path.join(__dirname, '..', `rent_roll_${date}.json`);
    if (!fs.existsSync(filePath)) {
      console.log(`Skipping ${date} - file not found`);
      continue;
    }
    
    const records = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`Uploading ${records.length} records for ${date}...`);
    
    try {
      // Upload in batches of 100
      for (let i = 0; i < records.length; i += 100) {
        const batch = records.slice(i, i + 100);
        await uploadBatch(batch);
        process.stdout.write('.');
      }
      console.log(` Done!`);
      totalUploaded += records.length;
    } catch (err) {
      console.error(`\nError uploading ${date}: ${err.message}`);
    }
  }
  
  console.log(`\nTotal uploaded: ${totalUploaded} records`);
}

main().catch(console.error);
