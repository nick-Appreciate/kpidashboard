import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(request) {
  try {
    const { csvData } = await request.json();
    
    if (!csvData) {
      return NextResponse.json({ error: 'No CSV data provided' }, { status: 400 });
    }
    
    // Parse CSV data handling quoted fields with commas
    const lines = csvData.split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    
    const renewalData = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('->') || line === '') continue;
      
      // Parse CSV with quoted fields support
      const values = [];
      let current = '';
      let inQuotes = false;
      
      for (let char of line) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim()); // Add last value
      
      if (values.length < headers.length) continue;
      
      const row = {};
      headers.forEach((header, index) => {
        row[header.toLowerCase().replace(/\s+/g, '_')] = values[index] || null;
      });
      
      // Skip header rows
      if (row.unit_name === 'Unit Name' || !row.unit_name) continue;
      
      // Debug logging
      console.log('Parsed row:', row);
      
      // Helper function to safely parse dates
      const parseDate = (dateStr) => {
        if (!dateStr || dateStr.trim() === '') return null;
        try {
          return new Date(dateStr).toISOString().split('T')[0];
        } catch (error) {
          return null;
        }
      };
      
      // Clean and format data
      const renewalRecord = {
        unit_name: row.unit_name,
        property_name: row.property_name,
        tenant_name: row.tenant_name,
        lease_start: parseDate(row.lease_start),
        lease_end: parseDate(row.lease_end),
        previous_lease_start: parseDate(row.previous_lease_start),
        previous_lease_end: parseDate(row.previous_lease_end),
        previous_rent: row.previous_rent && row.previous_rent !== '' ? parseFloat(row.previous_rent.replace(/[$,]/g, '')) : null,
        rent: row.rent && row.rent !== '' ? parseFloat(row.rent.replace(/[$,]/g, '')) : null,
        percent_difference: row.percent_difference && row.percent_difference !== '' ? parseFloat(row.percent_difference.replace('%', '')) : null,
        dollar_difference: row.dollar_difference && row.dollar_difference !== '' ? parseFloat(row.dollar_difference.replace(/[$,]/g, '')) : null,
        status: row.status || null,
        term: row.term || null,
        renewal_sent_date: parseDate(row.renewal_sent_date),
        countersigned_date: parseDate(row.countersigned_date),
        tenant_id: row.tenant_id || null
      };
      
      renewalData.push(renewalRecord);
    }
    
    // Insert data into database
    if (renewalData.length > 0) {
      const { error } = await supabase
        .from('renewal_summary')
        .insert(renewalData);
      
      if (error) {
        console.error('Database error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    
    return NextResponse.json({ 
      success: true, 
      imported: renewalData.length,
      message: `Successfully imported ${renewalData.length} renewal records`
    });
    
  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
