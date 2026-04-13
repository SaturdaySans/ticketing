-- Run once to set up the database:
-- psql -U postgres -d your_db_name -f schema.sql

CREATE TABLE IF NOT EXISTS tickets (
  num     INTEGER PRIMARY KEY,       -- 1 to 12
  status  TEXT    NOT NULL           -- 'idle' | 'preparing' | 'ready'
             CHECK (status IN ('idle', 'preparing', 'ready'))
             DEFAULT 'idle'
);

-- Seed all 12 tickets on first run
INSERT INTO tickets (num, status)
SELECT generate_series(1, 12), 'idle'
ON CONFLICT (num) DO NOTHING;
