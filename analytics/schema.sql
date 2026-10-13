-- One row per page view. No IP, no cookie: `visitor` is a hash keyed by a salt that is
-- replaced every day (KST), so the same person cannot be linked across days.
CREATE TABLE IF NOT EXISTS hits (
  ts      INTEGER NOT NULL,   -- unix ms
  day     TEXT    NOT NULL,   -- YYYY-MM-DD, Asia/Seoul
  path    TEXT    NOT NULL,
  ref     TEXT,               -- referrer host, NULL for direct / same-site
  country TEXT,               -- ISO code from Cloudflare
  device  TEXT    NOT NULL,   -- mobile | desktop
  visitor TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS hits_day ON hits(day);

CREATE TABLE IF NOT EXISTS salts (
  day  TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);
