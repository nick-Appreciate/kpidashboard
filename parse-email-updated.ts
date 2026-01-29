import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

interface RenewalSummaryRecord {
  unit_name: string;
  property_name: string;
  tenant_name: string | null;
  lease_start: string | null;
  lease_end: string | null;
  previous_lease_start: string | null;
  previous_lease_end: string | null;
  previous_rent: number | null;
  rent: number | null;
  percent_difference: number | null;
  dollar_difference: number | null;
  status: string | null;
  term: string | null;
  renewal_sent_date: string | null;
  countersigned_date: string | null;
  tenant_id: string | null;
}

function sanitizeString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value).replace(/[\x00-\x1F\x7F]/g, "").trim() || null;
}

function parseExcelDateOnly(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  
  if (typeof value === "number") {
    const date = new Date((value - 25569) * 86400 * 1000);
    return date.toISOString().split("T")[0];
  }
  
  if (typeof value === "string") {
    const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      const [, month, day, year] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
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
  const str = String(value).replace(/[,]/g, "").replace(/[$]/g, "").replace(/[%]/g, "");
  const num = Number(str);
  return isNaN(num) ? null : num;
}

function parseRenewalSummary(
  workbook: XLSX.WorkBook,
  filename: string
): RenewalSummaryRecord[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const records: RenewalSummaryRecord[] = [];
  
  // Find header row
  let startRow = 0;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (row && row[0] && String(row[0]).toLowerCase().includes('unit name')) {
      startRow = i + 1;
      console.log(`Found renewal summary header at row ${i}, starting data at row ${startRow}`);
      break;
    }
  }

  // Get headers from the row before startRow
  const headers = data[startRow - 1] as string[] || [];
  const normalizedHeaders = headers.map(h => String(h || "").toLowerCase().replace(/\s+/g, '_'));

  for (let i = startRow; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    
    // Skip empty rows or rows that start with '->' (property separators)
    const firstCell = row[0] ? String(row[0]) : "";
    if (firstCell.startsWith("->") || row.every((cell) => cell === null || cell === undefined || cell === "")) {
      continue;
    }

    // Create record object
    const record: RenewalSummaryRecord = {
      unit_name: sanitizeString(row[0]),
      property_name: sanitizeString(row[1]),
      tenant_name: sanitizeString(row[2]),
      lease_start: parseExcelDateOnly(row[3]),
      lease_end: parseExcelDateOnly(row[4]),
      previous_lease_start: parseExcelDateOnly(row[5]),
      previous_lease_end: parseExcelDateOnly(row[6]),
      previous_rent: parseNumber(row[7]),
      rent: parseNumber(row[8]),
      percent_difference: parseNumber(row[9]),
      dollar_difference: parseNumber(row[10]),
      status: sanitizeString(row[11]),
      term: sanitizeString(row[12]),
      renewal_sent_date: parseExcelDateOnly(row[13]),
      countersigned_date: parseExcelDateOnly(row[14]),
      tenant_id: sanitizeString(row[15])
    };

    // Only add if we have at least a unit name
    if (record.unit_name) {
      records.push(record);
    }
  }

  console.log(`Parsed ${records.length} renewal summary records from ${filename}`);
  return records;
}

Deno.serve(async (req) => {
  try {
    const contentType = req.headers.get("content-type") || "";
    const url = new URL(req.url);
    const typeOverride = url.searchParams.get("type")?.toLowerCase();

    let filename = "unknown.xlsx";
    let fileBuffer: ArrayBuffer;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const attachmentData = formData.get("attachment") as string | null;

      if (file) {
        filename = file.name;
        fileBuffer = await file.arrayBuffer();
      } else if (attachmentData) {
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
      const body = await req.json();
      filename = body.filename || "attachment.xlsx";
      const binaryString = atob(body.file_base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      fileBuffer = bytes.buffer;
    } else {
      filename = req.headers.get("x-filename") || "attachment.xlsx";
      fileBuffer = await req.arrayBuffer();
    }

    const workbook = XLSX.read(new Uint8Array(fileBuffer), { type: "array" });
    const actualFilename = filename.toLowerCase();
    let filenameLower = actualFilename;
    
    // Check for renewal summary by filename or content
    const isRenewalSummary = actualFilename.includes("renewal") || 
                           actualFilename.includes("renewal_summary") ||
                           typeOverride === "renewal";
    
    console.log(`Processing file: ${filename}, type detection: ${filenameLower}, type override: ${typeOverride}, isRenewalSummary: ${isRenewalSummary}`);

    let result: { table: string; inserted: number; total: number };

    if (isRenewalSummary) {
      const records = parseRenewalSummary(workbook, filename);

      if (records.length === 0) {
        return new Response(JSON.stringify({ error: "No records parsed from renewal summary" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase
        .from("renewal_summary")
        .insert(records)
        .select();

      if (error) {
        console.error("Insert error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      result = { table: "renewal_summary", inserted: data?.length || 0, total: records.length };
    } else {
      return new Response(
        JSON.stringify({
          error: "This endpoint only handles renewal summary files. Use the main parse-email function for other file types.",
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
