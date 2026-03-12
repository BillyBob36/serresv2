-- Migration 005: App settings table for configurable parameters
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default BDNB match distance: 200 meters
INSERT INTO app_settings (key, value) VALUES ('bdnb_match_distance_m', '200') ON CONFLICT DO NOTHING;
