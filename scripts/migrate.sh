#!/bin/sh
# Railway pre-deploy step for the api service: apply pending migrations to the database.
# A failure here aborts the deploy (docs/architecture.md, Deployment).
# DATABASE_URL must be percent-encoded (the Supabase CLI requires it).
set -eu
cd "$(dirname "$0")/.."
echo "applying pending database migrations"
exec supabase db push --db-url "$DATABASE_URL" --yes
