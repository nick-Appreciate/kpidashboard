import { requireAdmin } from '../../../../../lib/auth';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Region definitions for notice type determination
const REGION_PROPERTIES = {
  region_kansas_city: ['hilltop', 'oakwood', 'glen oaks', 'normandy', 'maple manor'],
};
const isKCProperty = (prop: string | null) =>
  REGION_PROPERTIES.region_kansas_city.some(kc => prop?.toLowerCase().includes(kc));

/**
 * POST /api/admin/collections/auto-stage
 *
 * Runs the auto-stage logic for collections, moving tenants between stages
 * based on balance, rent, date, and notice period rules.
 *
 * This was extracted from the GET /api/collections handler to separate
 * reads from writes. It can be triggered manually or via pg_cron.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const now = new Date();
    const todayDate = now.getDate();

    const daysBetween = (dateStr: string | null) => {
      if (!dateStr) return 0;
      const diff = now.getTime() - new Date(dateStr).getTime();
      return Math.floor(diff / (1000 * 60 * 60 * 24));
    };

    // Get the latest delinquency snapshot
    const { data: latestSnapshot } = await supabase
      .from('af_delinquency')
      .select('snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1);

    const latestDate = latestSnapshot?.[0]?.snapshot_date;
    if (!latestDate) {
      return NextResponse.json({ message: 'No delinquency data found', updates: 0 });
    }

    // Get delinquency data
    const { data: delinquencyData, error: delinquencyError } = await supabase
      .from('af_delinquency')
      .select('occupancy_id, property_name, unit, name, amount_receivable, rent')
      .eq('snapshot_date', latestDate);

    if (delinquencyError) {
      return NextResponse.json({ error: delinquencyError.message }, { status: 500 });
    }

    // Get existing stages
    const occupancyIds = (delinquencyData || []).map(d => d.occupancy_id).filter(Boolean);
    const { data: stages } = await supabase
      .from('collection_stages')
      .select('*')
      .in('occupancy_id', occupancyIds);

    const stagesMap: Record<string, any> = {};
    (stages || []).forEach((s: any) => {
      stagesMap[s.occupancy_id] = s;
    });

    // Get eviction status from rent_roll_snapshots
    const { data: rentRollSnapshot } = await supabase
      .from('rent_roll_snapshots')
      .select('snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1);

    const rentRollDate = rentRollSnapshot?.[0]?.snapshot_date;
    const { data: evictionData } = await supabase
      .from('rent_roll_snapshots')
      .select('property, unit, status')
      .eq('snapshot_date', rentRollDate)
      .eq('status', 'Evict');

    const evictionMap: Record<string, boolean> = {};
    (evictionData || []).forEach((e: any) => {
      evictionMap[`${e.property}|${e.unit}`] = true;
    });

    // Compute auto-stage transitions
    const autoMoveUpdates: any[] = [];

    (delinquencyData || []).forEach((item: any) => {
      const stageData = stagesMap[item.occupancy_id];
      let currentStage = stageData?.stage || 'needs_contacted';

      // Migrate old stages
      if (currentStage === 'contact_1' || currentStage === 'contact_2' || currentStage === 'promise_to_pay') {
        currentStage = 'needs_contacted';
      }

      const unitKey = `${item.property_name}|${item.unit}`;
      const afEviction = !!evictionMap[unitKey];
      const balance = parseFloat(item.amount_receivable || 0);
      const monthlyRent = parseFloat(item.rent || 0);

      let newStage: string | null = null;

      if (afEviction) {
        if (currentStage !== 'eviction') newStage = 'eviction';
      } else if (balance <= 0) {
        if (currentStage !== 'current') newStage = 'current';
      } else if (currentStage === 'eviction' && !afEviction) {
        newStage = 'needs_contacted';
      } else if (currentStage === 'notice' && stageData?.notice_entered_at) {
        const daysInNotice = daysBetween(stageData.notice_entered_at);
        const requiredDays = stageData.notice_type === '3-day' ? 3 : 10;
        if (daysInNotice >= requiredDays) {
          newStage = 'reservation_of_rights';
        }
      } else if (currentStage === 'needs_contacted' && monthlyRent > 0 && balance > 0) {
        if (balance > monthlyRent) {
          newStage = 'notice';
        } else if (todayDate >= 9) {
          newStage = 'balance_letter';
        }
      }

      // Only create update if stage actually changed
      if (newStage && newStage !== currentStage) {
        const update: any = {
          occupancy_id: item.occupancy_id,
          property_name: item.property_name || '',
          unit: item.unit || '',
          tenant_name: item.name || '',
          stage: newStage,
          stage_updated_at: now.toISOString(),
        };

        if (newStage === 'notice') {
          update.notice_type = isKCProperty(item.property_name) ? '3-day' : '10-day';
          update.notice_entered_at = now.toISOString();
        } else if (newStage === 'balance_letter') {
          update.balance_letter_entered_at = now.toISOString();
        } else if (newStage === 'reservation_of_rights') {
          update.reservation_of_rights_entered_at = now.toISOString();
        }

        autoMoveUpdates.push(update);
      }
    });

    // Batch upsert all updates
    if (autoMoveUpdates.length > 0) {
      const { error: upsertError } = await supabase
        .from('collection_stages')
        .upsert(autoMoveUpdates, { onConflict: 'occupancy_id' });

      if (upsertError) {
        return NextResponse.json({ error: upsertError.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      message: `Auto-stage complete`,
      updates: autoMoveUpdates.length,
      transitions: autoMoveUpdates.map(u => ({
        occupancy_id: u.occupancy_id,
        property: u.property_name,
        unit: u.unit,
        new_stage: u.stage,
      })),
    });
  } catch (error: any) {
    console.error('Auto-stage error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
