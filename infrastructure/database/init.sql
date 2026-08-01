CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS scenarios (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  direction text NOT NULL CHECK (direction = 'morning_inbound'),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenario_stops (
  id uuid PRIMARY KEY,
  scenario_id uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  location geography(Point, 4326) NOT NULL,
  assigned_person_count integer NOT NULL CHECK (assigned_person_count >= 0)
);

CREATE INDEX IF NOT EXISTS ix_scenario_stops_location ON scenario_stops USING GIST (location);
