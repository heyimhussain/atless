-- Run once from your machine (never commit the connection string):
--   psql "<tiger-connection-string>" -f server/schema.sql
create table if not exists shares (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
