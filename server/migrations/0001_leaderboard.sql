CREATE TABLE player (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Lowercased with look-alike characters folded, so names cannot be impersonated.
  nameKey TEXT NOT NULL UNIQUE,
  keyHash TEXT NOT NULL UNIQUE,
  banned INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL
);
-- Each player's best verified jump per tick rate. Auto-hop jumps are never stored.
CREATE TABLE entry (
  id TEXT PRIMARY KEY,
  playerId TEXT NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  tickRate INTEGER NOT NULL CHECK (tickRate IN (64, 128)),
  distance REAL NOT NULL,
  mapId TEXT NOT NULL,
  preSpeed REAL NOT NULL,
  sync REAL NOT NULL,
  strafes INTEGER NOT NULL,
  ducked INTEGER NOT NULL,
  physicsVersion TEXT NOT NULL,
  replay TEXT NOT NULL,
  at INTEGER NOT NULL,
  UNIQUE(playerId, tickRate)
);
CREATE INDEX entry_distance ON entry(distance DESC);
