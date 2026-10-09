CREATE TABLE account_usage (
  userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0
);
INSERT INTO account_usage (userId, attempts, bytes)
  SELECT userId, COUNT(*), SUM(length(CAST(payload AS BLOB))) FROM attempt GROUP BY userId;

CREATE TRIGGER attempt_limits BEFORE INSERT ON attempt BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM attempt WHERE userId = NEW.userId AND attemptId = NEW.attemptId AND payload != NEW.payload
  ) THEN RAISE(ABORT, 'LONGJUMP_CONFLICT') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM attempt WHERE userId = NEW.userId AND attemptId = NEW.attemptId
  ) AND (
    COALESCE((SELECT attempts FROM account_usage WHERE userId = NEW.userId), 0) >= 100000
    OR COALESCE((SELECT bytes FROM account_usage WHERE userId = NEW.userId), 0) + length(CAST(NEW.payload AS BLOB)) > 134217728
  ) THEN RAISE(ABORT, 'LONGJUMP_QUOTA') END;
END;
CREATE TRIGGER attempt_usage_insert AFTER INSERT ON attempt BEGIN
  INSERT INTO account_usage (userId, attempts, bytes) VALUES (NEW.userId, 1, length(CAST(NEW.payload AS BLOB)))
    ON CONFLICT(userId) DO UPDATE SET attempts = attempts + 1, bytes = bytes + excluded.bytes;
END;
CREATE TRIGGER attempt_usage_delete AFTER DELETE ON attempt BEGIN
  UPDATE account_usage SET attempts = attempts - 1, bytes = bytes - length(CAST(OLD.payload AS BLOB)) WHERE userId = OLD.userId;
END;
