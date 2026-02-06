const fs = require('fs');
const path = require('path');

async function reprocessRentRoll() {
  // Get the file content from the database attachment
  const SUPABASE_URL = 'https://hkmfsnhmxhhndzfxqmhp.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrbWZzbmhteGhobmR6ZnhxbWhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDk3MzgsImV4cCI6MjA4NTEyNTczOH0.MY3w7-ktfuoR0bMcgMroxPSb7ehSmnqCReuuLogtm0Q';
  
  // Fetch the attachment content
  const attachmentId = '65a10834-487b-4ef1-925f-e6ab74c6a334';
  
  const fetchRes = await fetch(`${SUPABASE_URL}/rest/v1/email_attachments?id=eq.${attachmentId}&select=filename,file_content`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  
  const attachments = await fetchRes.json();
  if (!attachments || attachments.length === 0) {
    console.error('Attachment not found');
    return;
  }
  
  const { filename, file_content } = attachments[0];
  console.log(`Reprocessing: ${filename}`);
  
  // Send to the Edge Function
  const response = await fetch(`${SUPABASE_URL}/functions/v1/parse-email`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      filename: filename,
      file_base64: file_content
    })
  });
  
  const result = await response.json();
  console.log('Result:', JSON.stringify(result, null, 2));
}

reprocessRentRoll().catch(console.error);
