-- Migration: 005_snooze.sql
-- M6: Snooze functionality — adds snooze fields to projects

ALTER TABLE projects ADD COLUMN snooze_until TEXT;
ALTER TABLE projects ADD COLUMN snooze_mode  TEXT CHECK(snooze_mode IN ('manual', 'date', 'notification'));
