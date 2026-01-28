import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

interface LeasingRecord {
  property: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  inquiry_received: string | null;
  first_contact: string | null;
  last_activity_date: string | null;
  last_activity_type: string | null;
  status: string | null;
  move_in_preference: string | null;
  max_rent: string | null;
  bed_bath_preference: string | null;
  pet_preference: string | null;
  monthly_income: string | null;
  credit_score: string | null;
  lead_type: string | null;
  source: string | null;
  unit: string | null;
  touch_points: number | null;
  follow_ups: number | null;
  source_file: string | null;
  inquiry_id: string | null;
  guest_card_id: string | null;
  rental_application_id: string | null;
}

interface ShowingRecord {
  guest_card_name: string | null;
  email: string | null;
  phone: string | null;
  property: string;
  showing_unit: string | null;
  showing_time: string | null;
  confirmation_time: string | null;
  assigned_user: string | null;
  description: string | null;
  status: string | null;
  type: string | null;
  last_activity_date: string | null;
  last_activity_type: string | null;
  guest_card_id: string | null;
  guest_card_uuid: string | null;
  inquiry_id: string | null;
  showing_id: string | null;
  unit_type_id: string | null;
  created_by_id: string | null;
  assigned_user_id: string | null;
  lead_type: string | null;
  source: string | null;
  rental_application_id: string | null;
  rental_application_group_id: string | null;
  rental_application_received: string | null;
  rental_application_status: string | null;
  source_file: string | null;
}

interface RentalApplicationRecord {
  unit: string | null;
  applicants: string | null;
  received: string | null;
  desired_move_in: string | null;
  lead_source: string | null;
  status: string | null;
  screening: string | null;
  approved_at: string | null;
  denied_at: string | null;
  rental_application_id: string | null;
  move_in_date: string | null;
  lease_start_date: string | null;
  lease_end_date: string | null;
  inquiry_id: string | null;
  application_status: string | null;
  tenant_id: string | null;
  source_file: string | null;
}

interface PropertyRecord {
  property: string;
  unit: string;
  bd_ba: string | null;
  status: string | null;
  sqft: number | null;
  total: number | null;
  past_due: number | null;
  other_charges: number | null;
  tenant_reimbursement_utilities: number | null;
  tenant_rental_income: number | null;
  cha_affordable_housing_income: number | null;
  iha_affordable_housing_income: number | null;
  kckha_affordable_housing_income: number | null;
  hakc_affordable_housing_income: number | null;
  hud_affordable_housing_income: number | null;
  pet_rent: number | null;
  storage_fee: number | null;
  parking_fee: number | null;
  insurance_services: number | null;
  lease_from: string | null;
  lease_to: string | null;
  source_file: string | null;
}

function sanitizeString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  // Remove any problematic Unicode characters and escape sequences
  return String(value).replace(/[\x00-\x1F\x7F]/g, "").trim() || null;
}

function parseExcelDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  
  if (typeof value === "number") {
    const date = new Date((value - 25569) * 86400 * 1000);
    return date.toISOString();
  }
  
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  
  return String(value);
}

function parseExcelDateOnly(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  
  if (typeof value === "number") {
    const date = new Date((value - 25569) * 86400 * 1000);
    return date.toISOString().split("T")[0];
  }
  
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }
    return value;
  }
  
  return null;
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const str = String(value).replace(/,/g, "");
  const num = Number(str);
  return isNaN(num) ? null : num;
}

function parseInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = parseInt(String(value), 10);
  return isNaN(num) ? null : num;
}

function parseLeasingReport(
  workbook: XLSX.WorkBook,
  filename: string
): LeasingRecord[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const records: LeasingRecord[] = [];
  const seen = new Set<string>();
  let currentProperty = "";
  
  // Find where data starts - look for header row with "Name" in first column
  let startRow = 12; // Default for Excel files
  for (let i = 0; i < Math.min(15, data.length); i++) {
    const row = data[i];
    if (row && row[0] && String(row[0]).toLowerCase() === 'name') {
      startRow = i + 1; // Start after header
      console.log(`Found CSV header at row ${i}, starting data at row ${startRow}`);
      break;
    }
  }

  for (let i = startRow; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    
    // Skip empty rows
    if (row.every((cell) => cell === null || cell === undefined || cell === "")) continue;

    // Property header row: starts with "->" or first cell has value and rest are empty
    const firstCell = row[0] ? String(row[0]) : "";
    if (firstCell.startsWith("->") || firstCell.startsWith("-> ")) {
      currentProperty = firstCell.replace(/^->\s*/, "").trim();
      continue;
    }
    
    if (row[0] && row.slice(1).every((cell) => cell === null || cell === undefined || cell === "")) {
      currentProperty = String(row[0]);
      continue;
    }

    // Data row: has name and inquiry_received date
    if (row[0] && row[3]) {
      const inquiryReceived = parseExcelDate(row[3]);
      const name = row[0] ? String(row[0]) : null;
      
      // Create unique key for deduplication
      const key = `${currentProperty}|${name}|${inquiryReceived}`;
      if (seen.has(key)) {
        console.log(`Skipping duplicate: ${key}`);
        continue;
      }
      seen.add(key);
      
      records.push({
        property: currentProperty,
        name: name,
        email: sanitizeString(row[1]),
        phone: sanitizeString(row[2]),
        inquiry_received: inquiryReceived,
        first_contact: parseExcelDateOnly(row[4]),
        last_activity_date: parseExcelDateOnly(row[5]),
        last_activity_type: sanitizeString(row[6]),
        status: sanitizeString(row[7]),
        move_in_preference: sanitizeString(row[8]),
        max_rent: sanitizeString(row[9]),
        bed_bath_preference: sanitizeString(row[10]),
        pet_preference: sanitizeString(row[11]),
        monthly_income: sanitizeString(row[12]),
        credit_score: sanitizeString(row[13]),
        lead_type: sanitizeString(row[14]),
        source: sanitizeString(row[15]),
        unit: sanitizeString(row[16]),
        touch_points: parseInteger(row[17]),
        follow_ups: parseInteger(row[18]),
        source_file: filename,
        inquiry_id: sanitizeString(row[19]),
        guest_card_id: sanitizeString(row[21]),
        rental_application_id: sanitizeString(row[22]),
      });
    }
  }

  console.log(`Parsed ${records.length} unique leasing records from ${filename}`);
  return records;
}

function parseShowingsReport(
  workbook: XLSX.WorkBook,
  filename: string
): ShowingRecord[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const records: ShowingRecord[] = [];
  const seen = new Set<string>();
  let currentProperty = "";
  
  // Find header row
  let startRow = 1;
  for (let i = 0; i < Math.min(15, data.length); i++) {
    const row = data[i];
    if (row && row[0] && String(row[0]).toLowerCase().includes('guest card name')) {
      startRow = i + 1;
      console.log(`Found showings header at row ${i}, starting data at row ${startRow}`);
      break;
    }
  }

  for (let i = startRow; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    if (row.every((cell) => cell === null || cell === undefined || cell === "")) continue;

    const firstCell = row[0] ? String(row[0]) : "";
    
    // Property header row
    if (firstCell.startsWith("->") || firstCell.startsWith("-> ")) {
      currentProperty = sanitizeString(firstCell.replace(/^->\s*/, "")) || "";
      continue;
    }
    
    // Skip if only first cell has value (property header without ->)
    if (row[0] && row.slice(1).every((cell) => cell === null || cell === undefined || cell === "")) {
      currentProperty = sanitizeString(row[0]) || "";
      continue;
    }

    // Data row - must have showing_id (column 16)
    const showingId = sanitizeString(row[16]);
    if (!showingId) continue;
    
    // Deduplicate by showing_id
    if (seen.has(showingId)) {
      continue;
    }
    seen.add(showingId);
    
    // Use property from column 3 if available, otherwise use currentProperty
    const property = sanitizeString(row[3]) || currentProperty;
    
    records.push({
      guest_card_name: sanitizeString(row[0]),
      email: sanitizeString(row[1]),
      phone: sanitizeString(row[2]),
      property: property,
      showing_unit: sanitizeString(row[4]),
      showing_time: parseExcelDate(row[5]),
      confirmation_time: parseExcelDate(row[6]),
      assigned_user: sanitizeString(row[7]),
      description: sanitizeString(row[8]),
      status: sanitizeString(row[9]),
      type: sanitizeString(row[10]),
      last_activity_date: parseExcelDateOnly(row[11]),
      last_activity_type: sanitizeString(row[12]),
      guest_card_id: sanitizeString(row[13]),
      guest_card_uuid: sanitizeString(row[14]),
      inquiry_id: sanitizeString(row[15]),
      showing_id: showingId,
      unit_type_id: sanitizeString(row[17]),
      created_by_id: sanitizeString(row[18]),
      assigned_user_id: sanitizeString(row[19]),
      lead_type: sanitizeString(row[20]),
      source: sanitizeString(row[21]),
      rental_application_id: sanitizeString(row[22]),
      rental_application_group_id: sanitizeString(row[23]),
      rental_application_received: parseExcelDate(row[24]),
      rental_application_status: sanitizeString(row[25]),
      source_file: filename,
    });
  }

  console.log(`Parsed ${records.length} unique showing records from ${filename}`);
  return records;
}

function parseRentalApplicationsReport(
  workbook: XLSX.WorkBook,
  filename: string
): RentalApplicationRecord[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const records: RentalApplicationRecord[] = [];
  const seen = new Set<string>();
  let currentUnit = "";
  
  // Find header row
  let startRow = 1;
  for (let i = 0; i < Math.min(15, data.length); i++) {
    const row = data[i];
    if (row && row[0] && String(row[0]).toLowerCase().includes('applicant')) {
      startRow = i + 1;
      console.log(`Found applications header at row ${i}, starting data at row ${startRow}`);
      break;
    }
  }

  for (let i = startRow; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    if (row.every((cell) => cell === null || cell === undefined || cell === "")) continue;

    const firstCell = row[0] ? String(row[0]) : "";
    
    // Unit header row (starts with "->")
    if (firstCell.startsWith("->") || firstCell.startsWith("-> ")) {
      currentUnit = sanitizeString(firstCell.replace(/^->\s*/, "")) || "";
      continue;
    }
    
    // Skip if only first cell has value (unit header without ->)
    if (row[0] && row.slice(1).every((cell) => cell === null || cell === undefined || cell === "")) {
      currentUnit = sanitizeString(row[0]) || "";
      continue;
    }

    // Data row - must have rental_application_id (column 8)
    const rentalApplicationId = sanitizeString(row[8]);
    if (!rentalApplicationId) continue;
    
    // Deduplicate by rental_application_id
    if (seen.has(rentalApplicationId)) {
      continue;
    }
    seen.add(rentalApplicationId);
    
    records.push({
      unit: currentUnit,
      applicants: sanitizeString(row[0]),
      received: parseExcelDate(row[1]),
      desired_move_in: parseExcelDateOnly(row[2]),
      lead_source: sanitizeString(row[3]),
      status: sanitizeString(row[4]),
      screening: sanitizeString(row[5]),
      approved_at: parseExcelDate(row[6]),
      denied_at: parseExcelDate(row[7]),
      rental_application_id: rentalApplicationId,
      move_in_date: parseExcelDateOnly(row[9]),
      lease_start_date: parseExcelDateOnly(row[10]),
      lease_end_date: parseExcelDateOnly(row[11]),
      inquiry_id: sanitizeString(row[12]),
      application_status: sanitizeString(row[13]),
      tenant_id: sanitizeString(row[14]),
      source_file: filename,
    });
  }

  console.log(`Parsed ${records.length} unique rental application records from ${filename}`);
  return records;
}

function parsePropertyReport(
  workbook: XLSX.WorkBook,
  filename: string
): PropertyRecord[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const records: PropertyRecord[] = [];
  let currentProperty = "";
  let headerIndex = -1;

  // Find header row
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (row && row[0] === "Unit") {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) return records;

  for (let i = headerIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.every((cell) => cell === null || cell === undefined || cell === "")) continue;

    // Property header row
    if (row[0] && row.slice(1).every((cell) => cell === null || cell === undefined || cell === "")) {
      currentProperty = String(row[0]);
      continue;
    }

    if (!currentProperty || row[0] === null || row[0] === undefined) continue;

    const unitStr = String(row[0]).trim();
    if (unitStr.includes("Units") && !row[1]) continue;

    records.push({
      property: currentProperty,
      unit: unitStr,
      bd_ba: row[1] ? String(row[1]) : null,
      status: row[2] ? String(row[2]) : null,
      sqft: typeof row[3] === "number" ? row[3] : null,
      total: parseNumber(row[4]),
      past_due: parseNumber(row[5]),
      other_charges: parseNumber(row[6]),
      tenant_reimbursement_utilities: parseNumber(row[7]),
      tenant_rental_income: parseNumber(row[8]),
      cha_affordable_housing_income: parseNumber(row[9]),
      iha_affordable_housing_income: parseNumber(row[10]),
      kckha_affordable_housing_income: parseNumber(row[11]),
      hakc_affordable_housing_income: parseNumber(row[12]),
      hud_affordable_housing_income: parseNumber(row[13]),
      pet_rent: parseNumber(row[14]),
      storage_fee: parseNumber(row[15]),
      parking_fee: parseNumber(row[16]),
      insurance_services: parseNumber(row[17]),
      lease_from: parseExcelDateOnly(row[18]),
      lease_to: parseExcelDateOnly(row[19]),
      source_file: filename,
    });
  }

  return records;
}

Deno.serve(async (req) => {
  try {
    const contentType = req.headers.get("content-type") || "";

    let filename = "unknown.xlsx";
    let fileBuffer: ArrayBuffer;

    if (contentType.includes("multipart/form-data")) {
      // Handle multipart form data (from Zapier/email services)
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const attachmentData = formData.get("attachment") as string | null;

      if (file) {
        filename = file.name;
        fileBuffer = await file.arrayBuffer();
      } else if (attachmentData) {
        // Base64 encoded attachment
        filename = (formData.get("filename") as string) || "attachment.xlsx";
        const binaryString = atob(attachmentData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        fileBuffer = bytes.buffer;
      } else {
        return new Response(JSON.stringify({ error: "No file or attachment found" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    } else if (contentType.includes("application/json")) {
      // Handle JSON with base64 encoded file
      const body = await req.json();
      filename = body.filename || "attachment.xlsx";
      const binaryString = atob(body.file_base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      fileBuffer = bytes.buffer;
    } else {
      // Raw binary upload
      filename = req.headers.get("x-filename") || "attachment.xlsx";
      fileBuffer = await req.arrayBuffer();
    }

    const workbook = XLSX.read(new Uint8Array(fileBuffer), { type: "array" });
    const filenameLower = filename.toLowerCase();

    let result: { table: string; inserted: number; total: number };

    if (filenameLower.includes("rental_application") || filenameLower.includes("application")) {
      // Rental Applications report
      const records = parseRentalApplicationsReport(workbook, filename);

      if (records.length === 0) {
        return new Response(JSON.stringify({ error: "No records parsed from rental applications report" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase
        .from("rental_applications")
        .upsert(records, { onConflict: "rental_application_id" })
        .select();

      if (error) {
        console.error("Upsert error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      result = { table: "rental_applications", inserted: data?.length || 0, total: records.length };
    } else if (filenameLower.includes("showing")) {
      // Showings report
      const records = parseShowingsReport(workbook, filename);

      if (records.length === 0) {
        return new Response(JSON.stringify({ error: "No records parsed from showings report" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase
        .from("showings")
        .upsert(records, { onConflict: "showing_id" })
        .select();

      if (error) {
        console.error("Upsert error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      result = { table: "showings", inserted: data?.length || 0, total: records.length };
    } else if (filenameLower.includes("guest_card") || filenameLower.includes("leasing")) {
      // Leasing report
      const records = parseLeasingReport(workbook, filename);

      if (records.length === 0) {
        return new Response(JSON.stringify({ error: "No records parsed from leasing report" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase
        .from("leasing_reports")
        .upsert(records, { onConflict: "property,name,inquiry_received" })
        .select();

      if (error) {
        console.error("Upsert error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      result = { table: "leasing_reports", inserted: data?.length || 0, total: records.length };
    } else if (filenameLower.includes("rent_roll") || filenameLower.includes("property")) {
      const records = parsePropertyReport(workbook, filename);

      if (records.length === 0) {
        return new Response(JSON.stringify({ error: "No records parsed from property report" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase
        .from("property_reports")
        .upsert(records, { onConflict: "property,unit,lease_from,lease_to" })
        .select();

      if (error) {
        console.error("Upsert error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      result = { table: "property_reports", inserted: data?.length || 0, total: records.length };
    } else {
      return new Response(
        JSON.stringify({
          error: "Unknown report type. Filename must contain 'rental_application', 'application', 'showing', 'guest_card', 'leasing', 'rent_roll', or 'property'",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error processing request:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
