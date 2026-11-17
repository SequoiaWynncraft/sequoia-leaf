-- The awards feed has its own lease and cursor. Its first run records the
-- moment it started, so milestones reached before Leaf paid for them pay nothing.
INSERT INTO sync_state (name, started_at, cursor, locked_until) VALUES ('achievements', NULL, NULL, 0);
