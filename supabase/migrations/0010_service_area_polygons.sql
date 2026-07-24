-- ---------------------------------------------------------------------------
-- 0010: Service area polygons + city metadata
--
-- Extends service_areas to support an optional GeoJSON-style polygon in
-- addition to the existing center + radius circle. When polygon IS NULL
-- (default), the API falls back to the circle. Point-in-polygon is done
-- in JS on the Worker (no PostGIS needed) — fine at pilot scale.
--
-- Also adds a `country` + `timezone` for future multi-country expansion
-- and human-readable display names (Hyderabad's UI label may be
-- "Hyderabad, TS" while `city` stays a stable slug).
--
-- Fully idempotent — every ALTER uses IF NOT EXISTS.
-- ---------------------------------------------------------------------------

alter table service_areas add column if not exists display_name text;
alter table service_areas add column if not exists country      text not null default 'IN';
alter table service_areas add column if not exists timezone     text not null default 'Asia/Kolkata';
-- polygon: JSON array of {lat, lng} vertices, closed (last vertex ≈ first).
-- Nullable — omit to keep using center + radius.
alter table service_areas add column if not exists polygon      jsonb;
-- created_at for the admin list ordering.
alter table service_areas add column if not exists created_at   timestamptz not null default now();

-- Backfill display_name from city where empty (idempotent — only writes null rows).
update service_areas set display_name = city where display_name is null;

-- ── RLS: public read (already reads active cities from the customer app),
--         admin write. Add if not present.
alter table service_areas enable row level security;

drop policy if exists "service_area: public read active" on service_areas;
drop policy if exists "service_area: admin write"        on service_areas;

create policy "service_area: public read active" on service_areas
  for select using (active = true or auth_role() = 'admin');
create policy "service_area: admin write" on service_areas
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');
