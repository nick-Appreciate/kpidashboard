-- Guest Card Inquiries Database Schema for Supabase

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Inquiries table
CREATE TABLE IF NOT EXISTS inquiries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property TEXT NOT NULL,
  name TEXT,
  email TEXT,
  phone TEXT,
  inquiry_date DATE NOT NULL,
  first_contact DATE,
  last_activity_date DATE,
  last_activity_type TEXT,
  status TEXT,
  move_in_preference TEXT,
  max_rent TEXT,
  bed_bath_preference TEXT,
  pet_preference TEXT,
  monthly_income TEXT,
  credit_score TEXT,
  lead_type TEXT,
  batch_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Import batches table
CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  filename TEXT,
  email_subject TEXT,
  email_date TEXT,
  received_at TIMESTAMP WITH TIME ZONE,
  inquiry_count INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add foreign key
ALTER TABLE inquiries 
  ADD CONSTRAINT fk_batch 
  FOREIGN KEY (batch_id) 
  REFERENCES import_batches(id) 
  ON DELETE SET NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_inquiries_date ON inquiries(inquiry_date DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_property ON inquiries(property);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_batch ON inquiries(batch_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries(created_at DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for updated_at on inquiries
DROP TRIGGER IF EXISTS update_inquiries_updated_at ON inquiries;
CREATE TRIGGER update_inquiries_updated_at
    BEFORE UPDATE ON inquiries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

-- Policies for read access (allow all)
CREATE POLICY "Allow public read access" ON inquiries
  FOR SELECT USING (true);

CREATE POLICY "Allow public read access" ON import_batches
  FOR SELECT USING (true);

-- Policies for insert (only via service role key)
CREATE POLICY "Allow service role insert" ON inquiries
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow service role insert" ON import_batches
  FOR INSERT WITH CHECK (true);

-- Policies for update (only via service role key)
CREATE POLICY "Allow service role update" ON inquiries
  FOR UPDATE USING (true);

-- Policies for delete (only via service role key)
CREATE POLICY "Allow service role delete" ON inquiries
  FOR DELETE USING (true);

-- Create a view for dashboard statistics
CREATE OR REPLACE VIEW dashboard_stats AS
SELECT 
  COUNT(*) as total_inquiries,
  COUNT(DISTINCT property) as total_properties,
  COUNT(CASE WHEN status = 'Active' THEN 1 END) as active_count,
  COUNT(CASE WHEN inquiry_date >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as inquiries_last_7_days,
  COUNT(CASE WHEN inquiry_date >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as inquiries_last_30_days
FROM inquiries;

-- Grant access to the view
GRANT SELECT ON dashboard_stats TO anon, authenticated;

-- Comments for documentation
COMMENT ON TABLE inquiries IS 'Guest card inquiry data from property management system';
COMMENT ON TABLE import_batches IS 'Tracking table for email imports';
COMMENT ON COLUMN inquiries.batch_id IS 'References the import batch this inquiry came from';
