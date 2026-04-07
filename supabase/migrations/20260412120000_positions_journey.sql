alter table debates
  add column if not exists positions_shifted int,
  add column if not exists positions_flipped int,
  add column if not exists most_changed_model text;
