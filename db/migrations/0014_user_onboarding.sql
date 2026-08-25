ALTER TABLE users
  ADD COLUMN password_change_required boolean NOT NULL DEFAULT false,
  ADD COLUMN password_changed_at timestamptz;

CREATE UNIQUE INDEX members_user_id_uq
  ON members(user_id)
  WHERE user_id IS NOT NULL;
