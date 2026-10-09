CREATE TABLE request_limit (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL
);
CREATE INDEX request_limit_expiry ON request_limit(expiresAt);
CREATE TABLE attempt (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  attemptId TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE(userId, attemptId)
);
CREATE INDEX attempt_owner_sequence ON attempt(userId, sequence);
CREATE TABLE personal_best (
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  distance REAL NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(userId, category)
);
