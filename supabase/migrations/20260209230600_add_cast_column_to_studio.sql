-- Add cast column to studio table
ALTER TABLE studio ADD COLUMN "cast" jsonb DEFAULT '[]'::jsonb;
