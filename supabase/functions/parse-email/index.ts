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

  console.log(`Parsed ${records.length} unique records from ${filename}`);
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

    if (filenameLower.includes("guest_card") || filenameLower.includes("leasing")) {
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
          error: "Unknown report type. Filename must contain 'guest_card', 'leasing', 'rent_roll', or 'property'",
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
