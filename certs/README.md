# Certificates

`supabase-ca.crt`: Supabase's root CA certificate (public, not a secret). The api and
worker use it to verify the database server's certificate and hostname (verify-full)
when `DATABASE_CA_CERT_PATH` points to it, as it does on Railway.

Source: Supabase Dashboard > Project Settings > Database > SSL Configuration >
Download certificate. Replace this file if Supabase rotates its CA.
