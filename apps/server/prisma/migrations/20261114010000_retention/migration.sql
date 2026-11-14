-- Lets exactly one server instance run maintenance at a time without holding a long transaction.
CREATE TABLE "maintenance_leases" (
    "name" VARCHAR(64) NOT NULL,
    "holder" VARCHAR(64) NOT NULL,
    "until" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "maintenance_leases_pkey" PRIMARY KEY ("name")
);

-- Drops monthly events partitions whose whole range is older than keep_days. Per-project
-- retention shorter than this is enforced by row deletes; this keeps storage bounded cheaply.
CREATE OR REPLACE FUNCTION drop_old_event_partitions(keep_days integer) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  cutoff timestamptz := now() - make_interval(days => keep_days);
  part record;
  month_start date;
  dropped integer := 0;
BEGIN
  FOR part IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'events' AND c.relname ~ '^events_\d{4}_\d{2}$'
  LOOP
    month_start := to_date(substring(part.relname FROM 8), 'YYYY_MM');
    IF (month_start + interval '1 month') <= cutoff THEN
      EXECUTE format('DROP TABLE %I', part.relname);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  RETURN dropped;
END;
$$;
