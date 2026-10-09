-- Display stats recomputed from the verified replay. Filled at startup for older rows.
ALTER TABLE entry ADD COLUMN stats TEXT;
