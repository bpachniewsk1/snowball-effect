# Saving & stats (Supabase)

The game sends anonymous gameplay stats to a Supabase (PostgreSQL) database, and `admin.html` shows
them. Until the two keys below are set, nothing is sent and the admin page says "not configured".
Preview the dashboard any time with `admin.html?demo`.

## One-time setup (≈10 minutes)

1. **Create a project** at [supabase.com](https://supabase.com) (free plan). Pick an **EU region**
   (e.g. Frankfurt) — the privacy page says data is stored in the EU.
2. **Create the schema:** Dashboard → SQL Editor → New query → paste [`schema.sql`](schema.sql) → Run.
   It is safe to run again after updates.
3. **Create your admin login:** Authentication → Users → *Add user* → email + password
   (tick "auto confirm"). Then in the SQL Editor:
   ```sql
   insert into private.admins (email) values (lower('you@example.com'));
   ```
4. **Copy the keys:** Project Settings → API → *Project URL* and the *anon public* key.
   The anon key is meant to be public — it can only call `public.track()`; every table is locked.
5. **Give them to the build** (GitHub repo variables, used by the deploy workflow):
   ```bash
   gh variable set SUPABASE_URL --body "https://xxxx.supabase.co"
   gh variable set SUPABASE_ANON_KEY --body "eyJ..."
   ```
   For local dev, put the same values in `.env.local` as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   (dev traffic is flagged as test and hidden from the dashboard by default).
6. Push or re-run the deploy, then open `…/admin.html` and log in.
7. Fill in your name and contact on [`privacy.html`](../privacy.html) (`[YOUR NAME]`, `[CONTACT EMAIL]`).

## What is stored

| Table | What |
| --- | --- |
| `players` | anonymous player id (random, from the browser), nickname, snowman, progress + stats snapshot |
| `sessions` | one per page load: start/last seen, **salted IP hash (rotates daily)**, country, device, language, screen, referrer domain, test flag |
| `rolls` | mode, date/number, archive, prompts, start/finish, points |
| `rounds` | category, answer, typed input, tier, points, wrong guesses, timeout, **time to answer** |
| `events` | visits, unlocks, "suggest it" clicks |

Raw IP addresses are never written: `track()` stores `sha256(secret salt + date + ip)`. Players can opt
out on the privacy page; browsers sending Global Privacy Control are never tracked.

## Retention (optional)

To delete data older than 24 months automatically, enable the `pg_cron` extension (Database →
Extensions) and run:

```sql
select cron.schedule('snowball-retention', '0 3 * * *', $$
  delete from public.events where created_at < now() - interval '24 months';
  delete from public.rounds where created_at < now() - interval '24 months';
  delete from public.rolls where started_at < now() - interval '24 months';
  delete from public.sessions where started_at < now() - interval '24 months';
  delete from public.players where last_seen < now() - interval '24 months';
$$);
```
