alter table debates
  add column if not exists claim_divergence_ab float,
  add column if not exists claim_divergence_ac float,
  add column if not exists claim_divergence_bc float,
  add column if not exists claim_divergence_avg float,
  add column if not exists total_claims int,
  add column if not exists contested_claims int,
  add column if not exists unanimous_claims int,
  add column if not exists hard_disagreements int;
