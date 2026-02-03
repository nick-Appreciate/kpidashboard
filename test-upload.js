const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://hkmfsnhmxhhndzfxqmhp.supabase.co/functions/v1/parse-email';

const files = [
  '/Users/test/Downloads/rent_roll_itemized-20260128.csv',
];

async function uploadFile(filePath) {
  const filename = path.basename(filePath);
  const fileContent = fs.readFileSync(filePath);
  const base64Content = fileContent.toString('base64');
  
  console.log(`\nUploading: ${filename}`);
  
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: filename,
        file_base64: base64Content,
      }),
    });
    
    const result = await response.json();
    console.log(`Status: ${response.status}`);
    console.log(`Result:`, JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error(`Error uploading ${filename}:`, error.message);
    return null;
  }
}

async function main() {
  console.log('Testing parse-email Edge Function with actual files...\n');
  
  for (const filePath of files) {
    if (fs.existsSync(filePath)) {
      await uploadFile(filePath);
    } else {
      console.log(`File not found: ${filePath}`);
    }
  }
  
  console.log('\nDone!');
}

main();
