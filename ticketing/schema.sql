-- Run once to set up the database:
-- psql -U postgres -d your_db_name -f schema.sql

CREATE TABLE IF NOT EXISTS tickets (
  id        SERIAL PRIMARY KEY,
  num       INTEGER NOT NULL,           -- 1 to 12
  dashboard TEXT    NOT NULL            -- 'mumbo' / 'prata'
               CHECK (dashboard IN ('mumbo', 'prata')),
  status    TEXT    NOT NULL            -- 'idle' / 'preparing' | 'ready'
               CHECK (status IN ('idle', 'preparing', 'ready'))
               DEFAULT 'idle',
  UNIQUE (num, dashboard)
);

-- Seed 12 tickets for each dashboard
INSERT INTO tickets (num, dashboard, status)
SELECT generate_series(1, 12), 'mumbo', 'idle'
ON CONFLICT (num, dashboard) DO NOTHING;

INSERT INTO tickets (num, dashboard, status)
SELECT generate_series(1, 12), 'prata', 'idle'
ON CONFLICT (num, dashboard) DO NOTHING;
