-- Snowball Effect — database schema for Supabase (PostgreSQL).
--
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- It is safe to re-run (everything is "if not exists" / "or replace").
--
-- Design:
--   * The browser never touches tables directly. Row Level Security is on and there are no policies,
--     so the public "anon" key can neither read nor write any table.
--   * All game data arrives through ONE function, public.track(payload), which validates and
--     truncates the input. It is "security definer", so it can write while callers cannot.
--   * IP addresses are never stored. track() hashes the caller's IP with a secret salt plus today's
--     date, so a visitor is countable within a day but the IP can't be recovered or linked across days.
--   * The admin dashboard reads through public.admin_overview(), which only answers to emails listed
--     in private.admins (log in with a Supabase Auth user first).

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

-- ---------- private (not exposed by the API) ----------

create table if not exists private.settings (
  key text primary key,
  value text not null
);
insert into private.settings (key, value)
values ('ip_salt', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create table if not exists private.admins (
  email text primary key
);

-- ---------- game data ----------

create table if not exists public.players (
  id uuid primary key,
  name text,
  avatar text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  progress jsonb,
  stats jsonb
);

create table if not exists public.sessions (
  id uuid primary key,
  player_id uuid references public.players (id) on delete cascade,
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  ip_hash text,
  country text,
  device text,
  lang text,
  screen text,
  referrer text,
  test boolean not null default false
);
create index if not exists sessions_started_idx on public.sessions (started_at);

create table if not exists public.rolls (
  id uuid primary key,
  player_id uuid references public.players (id) on delete cascade,
  session_id uuid,
  mode text,
  roll_date date,
  roll_number int,
  archive boolean not null default false,
  prompts int,
  test boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  points int
);
create index if not exists rolls_started_idx on public.rolls (started_at);

create table if not exists public.rounds (
  id bigint generated always as identity primary key,
  roll_id uuid references public.rolls (id) on delete cascade,
  player_id uuid,
  idx int,
  category_id text,
  pack text,
  answer text,
  input text,
  tier text,
  points int,
  misses text[],
  timed_out boolean,
  time_ms int,
  test boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists rounds_created_idx on public.rounds (created_at);
create index if not exists rounds_category_idx on public.rounds (category_id);

create table if not exists public.events (
  id bigint generated always as identity primary key,
  session_id uuid,
  player_id uuid,
  kind text,
  data jsonb,
  test boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists events_created_idx on public.events (created_at);

alter table public.players enable row level security;
alter table public.sessions enable row level security;
alter table public.rolls enable row level security;
alter table public.rounds enable row level security;
alter table public.events enable row level security;

-- ---------- writes: public.track(payload) ----------

create or replace function public.track(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  hdr json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  ip text := trim(split_part(coalesce(hdr ->> 'cf-connecting-ip', hdr ->> 'x-forwarded-for', hdr ->> 'x-real-ip', ''), ',', 1));
  salt text := (select value from private.settings where key = 'ip_salt');
  p jsonb := payload -> 'player';
  s jsonb := payload -> 'session';
  pid uuid := (p ->> 'id')::uuid;
  sid uuid := (s ->> 'id')::uuid;
  is_test boolean := coalesce((s ->> 'test')::boolean, false);
  e jsonb;
  d jsonb;
  n int := 0;
begin
  if pid is null or sid is null then
    return;
  end if;

  insert into players (id, name, avatar, progress, stats)
  values (pid, left(p ->> 'name', 40), left(p ->> 'avatar', 40), p -> 'progress', p -> 'stats')
  on conflict (id) do update
    set name = excluded.name,
        avatar = excluded.avatar,
        progress = coalesce(excluded.progress, players.progress),
        stats = coalesce(excluded.stats, players.stats),
        last_seen = now();

  insert into sessions (id, player_id, ip_hash, country, device, lang, screen, referrer, test)
  values (
    sid, pid,
    case when ip <> '' then encode(extensions.digest(salt || current_date::text || ip, 'sha256'), 'hex') end,
    left(hdr ->> 'cf-ipcountry', 2),
    left(s ->> 'device', 20), left(s ->> 'lang', 20), left(s ->> 'screen', 20), left(s ->> 'referrer', 200),
    is_test
  )
  on conflict (id) do update set last_seen = now();

  for e in select * from jsonb_array_elements(coalesce(payload -> 'events', '[]'::jsonb))
  loop
    n := n + 1;
    exit when n > 100;
    d := coalesce(e -> 'data', '{}'::jsonb);
    case e ->> 'kind'
      when 'ping' then
        null; -- only keeps sessions.last_seen fresh (done above)
      when 'roll_start' then
        insert into rolls (id, player_id, session_id, mode, roll_date, roll_number, archive, prompts, test)
        values ((d ->> 'rollId')::uuid, pid, sid, left(d ->> 'mode', 10), (d ->> 'date')::date,
                (d ->> 'number')::int, coalesce((d ->> 'archive')::boolean, false), (d ->> 'prompts')::int, is_test)
        on conflict (id) do nothing;
      when 'round' then
        insert into rounds (roll_id, player_id, idx, category_id, pack, answer, input, tier, points, misses, timed_out, time_ms, test)
        select (d ->> 'rollId')::uuid, pid, (d ->> 'idx')::int, left(d ->> 'categoryId', 60), left(d ->> 'pack', 40),
               left(d ->> 'answer', 120), left(d ->> 'input', 120), left(d ->> 'tier', 20), (d ->> 'points')::int,
               (select coalesce(array_agg(left(m, 80)), '{}') from (select jsonb_array_elements_text(coalesce(d -> 'misses', '[]'::jsonb)) as m limit 30) ms),
               coalesce((d ->> 'timedOut')::boolean, false), least((d ->> 'timeMs')::int, 600000), is_test
        where exists (select 1 from rolls where id = (d ->> 'rollId')::uuid);
      when 'roll_finish' then
        update rolls set finished_at = now(), points = (d ->> 'points')::int
        where id = (d ->> 'rollId')::uuid and player_id = pid and finished_at is null;
      else
        insert into events (session_id, player_id, kind, data, test)
        values (sid, pid, left(e ->> 'kind', 30), d, is_test);
    end case;
  end loop;
end;
$$;

revoke all on function public.track(jsonb) from public;
grant execute on function public.track(jsonb) to anon, authenticated;

-- ---------- reads: public.admin_overview(days, include_test) ----------

create or replace function public.admin_overview(days int default 30, include_test boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(days, 365)));
  result jsonb;
begin
  if not exists (select 1 from private.admins where email = lower(auth.jwt() ->> 'email')) then
    raise exception 'not an admin';
  end if;

  with
  s as (select * from sessions where started_at >= since and (include_test or not test)),
  r as (select * from rolls where started_at >= since and (include_test or not test)),
  rd as (select * from rounds where created_at >= since and (include_test or not test))
  select jsonb_build_object(
    'since', since,
    'totals', jsonb_build_object(
      'visits', (select count(*) from s),
      'uniqueVisitorDays', (select count(distinct (ip_hash, started_at::date)) from s where ip_hash is not null),
      'players', (select count(distinct player_id) from s),
      'newPlayers', (select count(*) from players where first_seen >= since),
      'allTimePlayers', (select count(*) from players),
      'rollsStarted', (select count(*) from r),
      'rollsFinished', (select count(*) from r where finished_at is not null),
      'dailyRollsFinished', (select count(*) from r where finished_at is not null and mode = 'daily' and not archive),
      'avgPoints', (select round(avg(points)) from r where finished_at is not null),
      'perfectRolls', (select count(*) from r where finished_at is not null and points >= prompts * 100),
      'answers', (select count(*) from rd where not timed_out),
      'timeouts', (select count(*) from rd where timed_out),
      'avgAnswerMs', (select round(avg(time_ms)) from rd where not timed_out),
      'wrongGuesses', (select coalesce(sum(cardinality(misses)), 0) from rd),
      'avgSessionSec', (select round(avg(extract(epoch from last_seen - started_at))) from s)
    ),
    'perDay', coalesce((
      select jsonb_agg(x order by x ->> 'day') from (
        select jsonb_build_object(
          'day', dd::date,
          'visits', (select count(*) from s where started_at::date = dd::date),
          'uniqueVisitors', (select count(distinct ip_hash) from s where started_at::date = dd::date),
          'players', (select count(distinct player_id) from s where started_at::date = dd::date),
          'rollsStarted', (select count(*) from r where started_at::date = dd::date),
          'rollsFinished', (select count(*) from r where finished_at::date = dd::date),
          'dailyFinished', (select count(*) from r where finished_at::date = dd::date and mode = 'daily' and not archive),
          'avgPoints', (select round(avg(points)) from r where finished_at::date = dd::date)
        ) as x
        from generate_series(since::date, now()::date, interval '1 day') as dd
      ) days_t
    ), '[]'::jsonb),
    'modes', coalesce((select jsonb_agg(jsonb_build_object('mode', case when archive then 'archive' else mode end, 'started', c, 'finished', f))
                       from (select mode, archive, count(*) c, count(finished_at) f from r group by mode, archive) m), '[]'::jsonb),
    'tiers', coalesce((select jsonb_agg(jsonb_build_object('tier', coalesce(tier, 'timeout'), 'count', c) order by c desc)
                       from (select tier, count(*) c from rd group by tier) t), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('device', coalesce(device, '?'), 'count', c) order by c desc)
                         from (select device, count(*) c from s group by device) t), '[]'::jsonb),
    'countries', coalesce((select jsonb_agg(jsonb_build_object('country', coalesce(country, '?'), 'count', c) order by c desc)
                           from (select country, count(*) c from s group by country order by c desc limit 20) t), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(x order by (x ->> 'plays')::int desc) from (
        select jsonb_build_object(
          'category', category_id, 'plays', count(*),
          'avgPoints', round(avg(points)), 'timeoutRate', round(100.0 * avg(case when timed_out then 1 else 0 end)),
          'avgMs', round(avg(time_ms) filter (where not timed_out)),
          'wrongGuesses', sum(cardinality(misses))
        ) as x
        from rd group by category_id order by count(*) desc limit 60) c), '[]'::jsonb),
    'topWrongGuesses', coalesce((select jsonb_agg(jsonb_build_object('category', category_id, 'guess', guess, 'count', c) order by c desc)
        from (select category_id, lower(trim(m)) as guess, count(*) c
              from rd, unnest(misses) as m group by category_id, lower(trim(m)) order by count(*) desc limit 60) w), '[]'::jsonb),
    'topAnswers', coalesce((select jsonb_agg(jsonb_build_object('category', category_id, 'answer', answer, 'tier', tier, 'count', c) order by c desc)
        from (select category_id, answer, tier, count(*) c from rd where answer is not null
              group by category_id, answer, tier order by count(*) desc limit 40) a), '[]'::jsonb),
    'unlocks', coalesce((select jsonb_agg(jsonb_build_object('skin', k, 'count', c) order by c desc)
        from (select data ->> 'id' as k, count(*) c from events
              where kind = 'unlock' and created_at >= since and (include_test or not test) group by 1) u), '[]'::jsonb),
    'recentPlayers', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object(
          -- Unnamed players get a stable number by first visit: "Nameless snowman #12".
          'name', coalesce(nullif(trim(pl.name), ''), 'Nameless snowman #' || (
            select count(*) from players p2
            where coalesce(trim(p2.name), '') = '' and (p2.first_seen, p2.id) <= (pl.first_seen, pl.id)
          )),
          'avatar', pl.avatar, 'firstSeen', pl.first_seen, 'lastSeen', pl.last_seen,
          'rolls', (select count(*) from rolls where player_id = pl.id and finished_at is not null),
          'best', (select max(points) from rolls where player_id = pl.id),
          'streak', pl.stats -> 'streak'
        ) as x
        from players pl order by pl.last_seen desc limit 25) p), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.admin_overview(int, boolean) from public;
grant execute on function public.admin_overview(int, boolean) to authenticated;

-- ---------- after running this file ----------
-- 1. Authentication → Users → "Add user": create YOUR admin login (email + password).
-- 2. Then run, with your own email:
--      insert into private.admins (email) values (lower('you@example.com'));
