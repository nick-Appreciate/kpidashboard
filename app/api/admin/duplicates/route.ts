import { NextResponse } from "next/server";
import { supabase } from '../../../../lib/supabase';

function normalize(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\s+(inc|llc|corp|ltd|co|lp|llp|pc|pllc|plc)\.?\s*$/i, '')
    .replace(/^\s*(the|a)\s+/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface BillRow {
  bill_id: string;
  vendor_name: string;
  amount: number;
  bill_date: string;
  bill_number: string | null;
  status: string | null;
  memo: string | null;
  property_name: string | null;
  unit: string | null;
}

interface DupeGroup {
  group_key: string;
  vendor_name: string;
  amount: number;
  property: string | null;
  unit: string | null;
  bill_month: string;
  bills: {
    bill_id: string;
    bill_date: string;
    bill_number: string | null;
    status: string | null;
    description: string | null;
  }[];
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const showResolved = url.searchParams.get('show_resolved') === 'true';
    const refreshParam = url.searchParams.get('refresh');

    if (refreshParam === 'true') {
      // Fetch all bills from af_bill_detail
      let allBills: BillRow[] = [];
      const pageSize = 1000;
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from('af_bill_detail')
          .select('bill_id, vendor_name, amount, bill_date, bill_number, status, memo, property_name, unit')
          .order('bill_date', { ascending: false })
          .range(offset, offset + pageSize - 1);

        if (error) throw new Error(error.message);
        if (!data) break;
        allBills = allBills.concat(data);
        if (data.length < pageSize) break;
        offset += pageSize;
      }

      // Build duplicate groups: same vendor + amount + property + unit + month
      const bills = allBills
        .filter(r => r.bill_date)
        .map(r => ({
          ...r,
          vnorm: normalize(r.vendor_name),
          amount: Number(r.amount),
          bill_month: r.bill_date.substring(0, 7),
        }));

      const groups = new Map<string, typeof bills>();
      for (const b of bills) {
        const key = `${b.vnorm}|${b.amount}|${b.property_name || ''}|${b.unit || '__none__'}|${b.bill_month}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(b);
      }

      // Filter to duplicates only (must have different bill_ids, not just multi-line items on same bill)
      const dupeGroups: DupeGroup[] = [];
      for (const [key, items] of groups) {
        const uniqueBillIds = new Set(items.map(b => b.bill_id));
        if (uniqueBillIds.size <= 1) continue;
        // Deduplicate line items — keep one row per unique bill_id
        const seenBillIds = new Set<string>();
        const dedupedItems = items.filter(b => {
          if (seenBillIds.has(b.bill_id)) return false;
          seenBillIds.add(b.bill_id);
          return true;
        });
        dupeGroups.push({
          group_key: key,
          vendor_name: dedupedItems[0].vendor_name,
          amount: dedupedItems[0].amount,
          property: dedupedItems[0].property_name,
          unit: dedupedItems[0].unit,
          bill_month: dedupedItems[0].bill_month,
          bills: dedupedItems.map(b => ({
            bill_id: b.bill_id,
            bill_date: b.bill_date,
            bill_number: b.bill_number,
            status: b.status,
            description: b.memo,
          })),
        });
      }

      // Upsert into duplicate_bill_groups
      for (const g of dupeGroups) {
        const { error } = await supabase
          .from('duplicate_bill_groups')
          .upsert({
            group_key: g.group_key,
            vendor_name: g.vendor_name,
            amount: g.amount,
            property: g.property,
            unit: g.unit,
            bill_month: g.bill_month,
            bill_ids: g.bills.map(b => b.bill_id),
            dup_count: g.bills.length,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'group_key' });

        if (error) console.error('Upsert error:', error);
      }

      // Remove stale groups (no longer duplicates)
      const currentKeys = dupeGroups.map(g => g.group_key);
      if (currentKeys.length > 0) {
        const { data: existing } = await supabase
          .from('duplicate_bill_groups')
          .select('id, group_key')
          .eq('resolved', false);

        if (existing) {
          const staleIds = existing
            .filter(e => !currentKeys.includes(e.group_key))
            .map(e => e.id);

          if (staleIds.length > 0) {
            await supabase
              .from('duplicate_bill_groups')
              .delete()
              .in('id', staleIds);
          }
        }
      }
    }

    // Fetch groups from table
    let query = supabase
      .from('duplicate_bill_groups')
      .select('*')
      .order('bill_month', { ascending: false })
      .order('vendor_name', { ascending: true });

    if (!showResolved) {
      query = query.eq('resolved', false);
    }

    const { data: groupRows, error: fetchError } = await query;
    if (fetchError) throw new Error(fetchError.message);

    // Enrich with bill details from af_bill_detail
    const allBillIds = (groupRows || []).flatMap(g => g.bill_ids);
    const uniqueBillIds = [...new Set(allBillIds)];

    let billDetails: Record<string, BillRow[]> = {};
    if (uniqueBillIds.length > 0) {
      // Fetch in batches of 100
      for (let i = 0; i < uniqueBillIds.length; i += 100) {
        const batch = uniqueBillIds.slice(i, i + 100);
        const { data } = await supabase
          .from('af_bill_detail')
          .select('bill_id, vendor_name, amount, bill_date, bill_number, status, memo, property_name, unit')
          .in('bill_id', batch);

        if (data) {
          for (const row of data) {
            if (!billDetails[row.bill_id]) billDetails[row.bill_id] = [];
            billDetails[row.bill_id].push(row);
          }
        }
      }
    }

    // Attach bill details to each group (one row per bill_id)
    const enrichedGroups = (groupRows || []).map(g => ({
      ...g,
      bills: g.bill_ids.map((id: string) => {
        const details = billDetails[id] || [];
        // Pick the first matching line item for this bill
        const match = details.find(d =>
          Number(d.amount) === Number(g.amount) &&
          (d.property_name || '') === (g.property || '') &&
          (d.unit || '') === (g.unit || '')
        );
        if (!match) return null;
        return {
          bill_id: match.bill_id,
          bill_date: match.bill_date,
          bill_number: match.bill_number,
          status: match.status,
          description: match.memo,
        };
      }).filter(Boolean),
    }));

    return NextResponse.json({
      groups: enrichedGroups,
      total: enrichedGroups.length,
      unresolved: enrichedGroups.filter((g: any) => !g.resolved).length,
    });
  } catch (error) {
    console.error("Error in duplicates GET:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { group_id, resolved_note, resolved_by, unresolve } = body;

    if (!group_id) {
      return NextResponse.json({ error: "group_id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = unresolve
      ? {
          resolved: false,
          resolved_by: null,
          resolved_at: null,
          resolved_note: null,
          updated_at: new Date().toISOString(),
        }
      : {
          resolved: true,
          resolved_by: resolved_by || null,
          resolved_at: new Date().toISOString(),
          resolved_note: resolved_note || null,
          updated_at: new Date().toISOString(),
        };

    const { data, error } = await supabase
      .from('duplicate_bill_groups')
      .update(updates)
      .eq('id', group_id)
      .select()
      .single();

    if (error) {
      console.error("Error updating duplicate group:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in duplicates PATCH:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
