-- Run in Supabase SQL Editor if migrations are not applied automatically:
-- alter table public.debates
--   add column if not exists validation_score_b int,
--   add column if not exists validation_score_c int,
--   add column if not exists validation_status text,
--   add column if not exists bias_flagged boolean;

alter table public.debates
  add column if not exists validation_score_b int,
  add column if not exists validation_score_c int,
  add column if not exists validation_status text,
  add column if not exists bias_flagged boolean;
