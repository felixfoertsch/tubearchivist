#!/bin/sh
set -eu

: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD must be set}"
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 --set=app_password="$POSTGRES_APP_PASSWORD" <<'SQL'
CREATE ROLE tubearchivist
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  PASSWORD :'app_password';
CREATE DATABASE tubearchivist OWNER tubearchivist;
\connect tubearchivist
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
