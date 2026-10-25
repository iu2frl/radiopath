-- Personal API tokens. Only the SHA-256 of a token is stored; prefix is its start, shown to tell tokens apart.
CREATE TABLE api_tokens (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  scopes       text[] NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  last_used_at timestamptz
);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id);
