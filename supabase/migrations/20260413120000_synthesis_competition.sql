alter table debates
  add column if not exists synthesis_winner text,
  add column if not exists gpt_competition_score double precision,
  add column if not exists phi_competition_score double precision,
  add column if not exists mistral_competition_score double precision;
