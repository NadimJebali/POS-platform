-- POS-platform database schema.
--
-- Design notes:
--  * Money is stored in TND millimes (integers), matching the POS app's money model.
--  * Timestamps are Unix epoch milliseconds (integers), matching the license `exp`
--    the app compares against Date.now().
--  * Nothing here references POS staff-users, but the schema deliberately leaves
--    room for a future staff-user-sync feature: it would hang off a customer/license,
--    not off any table below, so no column here needs to change to add it.

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,          -- café / owner name
  phone      TEXT,
  city       TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS licenses (
  id              INTEGER PRIMARY KEY,
  customer_id     INTEGER NOT NULL REFERENCES customers(id),
  activation_code TEXT    NOT NULL UNIQUE,          -- canonical (no dashes, upper)
  status          TEXT    NOT NULL DEFAULT 'active',-- active | suspended | revoked
  max_machines    INTEGER NOT NULL DEFAULT 1,
  name            TEXT,                              -- embedded in the signed payload
  created_at      INTEGER NOT NULL,
  CHECK (status IN ('active', 'suspended', 'revoked')),
  CHECK (max_machines >= 1)
);

-- One row per (license, machine) pair ever seen. An ACTIVE binding is a row with
-- unbound_at IS NULL; rebind/manual-unbind sets unbound_at rather than deleting,
-- so history survives. A machine that re-activates flips unbound_at back to NULL.
CREATE TABLE IF NOT EXISTS machines (
  id           INTEGER PRIMARY KEY,
  license_id   INTEGER NOT NULL REFERENCES licenses(id),
  machine_id   TEXT    NOT NULL,
  app_version  TEXT,
  bound_at     INTEGER NOT NULL,
  last_seen_at INTEGER,
  unbound_at   INTEGER,
  UNIQUE (license_id, machine_id)
);

-- Append-only billing ledger. paid_until is DERIVED by replaying these rows in
-- created_at order (see licenses domain logic), never stored as an editable scalar.
CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY,
  license_id     INTEGER NOT NULL REFERENCES licenses(id),
  amount_millimes INTEGER NOT NULL DEFAULT 0,
  method         TEXT    NOT NULL,          -- cash | transfer | card | gateway | ...
  months         INTEGER NOT NULL,          -- coverage added: 1 (month) or 12 (year)
  note           TEXT,
  created_at     INTEGER NOT NULL,
  CHECK (months > 0)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Admin sessions. A row is a live login: the random token lives in an httpOnly
-- cookie, and expired rows are ignored (and swept on access).
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Machine transfers (self-service rebind). One row per completed move, used both to
-- enforce the rolling-year transfer limit and to show history in the admin.
CREATE TABLE IF NOT EXISTS transfers (
  id              INTEGER PRIMARY KEY,
  license_id      INTEGER NOT NULL REFERENCES licenses(id),
  from_machine_id TEXT,
  to_machine_id   TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
