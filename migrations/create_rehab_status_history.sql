-- Create rehab_status_history table to track status changes over time
CREATE TABLE IF NOT EXISTS rehab_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rehab_id UUID REFERENCES rehabs(id) ON DELETE CASCADE,
  property TEXT NOT NULL,
  unit TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  changed_by TEXT,
  checklist_completed INTEGER DEFAULT 0,
  checklist_total INTEGER DEFAULT 0
);

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_rehab_status_history_rehab_id ON rehab_status_history(rehab_id);
CREATE INDEX IF NOT EXISTS idx_rehab_status_history_changed_at ON rehab_status_history(changed_at);
CREATE INDEX IF NOT EXISTS idx_rehab_status_history_property ON rehab_status_history(property);

-- Create daily snapshot table for aggregate metrics
CREATE TABLE IF NOT EXISTS rehab_daily_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL UNIQUE,
  total_units INTEGER DEFAULT 0,
  not_started INTEGER DEFAULT 0,
  supervisor_onboard INTEGER DEFAULT 0,
  back_burner INTEGER DEFAULT 0,
  waiting INTEGER DEFAULT 0,
  in_progress INTEGER DEFAULT 0,
  needs_cleaned INTEGER DEFAULT 0,
  supervisor_review INTEGER DEFAULT 0,
  complete INTEGER DEFAULT 0,
  avg_days_vacant NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rehab_daily_snapshots_date ON rehab_daily_snapshots(snapshot_date);
