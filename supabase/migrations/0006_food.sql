-- ---------------------------------------------------------------------------
-- 0006: Food delivery — restaurants + menu items
--
-- Adds:
--   • restaurants(...)                  — a partner restaurant that we serve
--   • menu_items(restaurant_id, ...)    — what they sell
--   • orders.restaurant_id              — nullable FK for food orders
--   • Public-read RLS on active rows so the customer app can browse
--     without auth.
--   • Food rate card for Hyderabad (delivery fee formula, not menu price).
--   • Three sample restaurants + menus for demo/screenshots.
--
-- Fully idempotent — every CREATE / INSERT uses IF NOT EXISTS / ON CONFLICT.
-- ---------------------------------------------------------------------------

-- ── RESTAURANTS ────────────────────────────────────────────────────────────
create table if not exists restaurants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  cuisine       text not null,           -- 'North Indian', 'Chinese', 'Biryani', 'Fast Food'
  description   text,
  address       text not null,
  city          text not null,
  lat           double precision not null,
  lng           double precision not null,
  phone         text,
  image_url     text,
  avg_prep_min  int not null default 20,
  min_order     numeric(6, 2) not null default 100,
  active        boolean not null default true,
  rating        numeric(2, 1) default 4.2,
  created_at    timestamptz not null default now()
);
create index if not exists restaurants_city_active_idx on restaurants(city, active);
create index if not exists restaurants_cuisine_idx on restaurants(cuisine);

-- ── MENU ITEMS ─────────────────────────────────────────────────────────────
create table if not exists menu_items (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,
  description   text,
  price         numeric(6, 2) not null check (price >= 0),
  category      text not null default 'Mains', -- 'Starters', 'Mains', 'Rice', 'Breads', 'Sides', 'Drinks', 'Desserts'
  image_url     text,
  is_veg        boolean not null default true,
  available     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists menu_items_restaurant_idx on menu_items(restaurant_id, category, sort_order);

-- ── ORDERS.RESTAURANT_ID ───────────────────────────────────────────────────
alter table orders add column if not exists restaurant_id uuid references restaurants(id);
create index if not exists orders_restaurant_idx on orders(restaurant_id) where restaurant_id is not null;

-- ── RLS: public browse for active rows; admin writes ───────────────────────
alter table restaurants enable row level security;
alter table menu_items  enable row level security;

drop policy if exists "restaurant: public read active"  on restaurants;
drop policy if exists "restaurant: admin write"         on restaurants;
drop policy if exists "menu_item: public read available" on menu_items;
drop policy if exists "menu_item: admin write"          on menu_items;

create policy "restaurant: public read active" on restaurants
  for select using (active = true or auth_role() = 'admin');
create policy "restaurant: admin write" on restaurants
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');

create policy "menu_item: public read available" on menu_items
  for select using (
    (available = true and exists (
      select 1 from restaurants r where r.id = menu_items.restaurant_id and r.active = true
    ))
    or auth_role() = 'admin'
  );
create policy "menu_item: admin write" on menu_items
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ── FOOD RATE CARD ─────────────────────────────────────────────────────────
-- Delivery fee formula. Menu prices come from menu_items, this is only
-- what the customer pays to get it delivered.
insert into rate_cards
  (city, service, base_fare, base_km, per_km, per_min, min_fare, parcel_weight_limit_kg, commission_pct)
values
  ('Hyderabad', 'food', 30.00, 2.0, 8.00, 0.00, 40.00, null, 20.00)
on conflict (city, service) do update set
  base_fare      = excluded.base_fare,
  base_km        = excluded.base_km,
  per_km         = excluded.per_km,
  per_min        = excluded.per_min,
  min_fare       = excluded.min_fare,
  commission_pct = excluded.commission_pct,
  updated_at     = now();

-- ── SEED: SAMPLE RESTAURANTS (idempotent by name+city) ─────────────────────
-- We use ON CONFLICT DO NOTHING keyed on a unique index for safe re-run.
create unique index if not exists restaurants_name_city_uidx on restaurants(name, city);

insert into restaurants (name, cuisine, description, address, city, lat, lng, phone, image_url, avg_prep_min, min_order, rating) values
  ('Paradise Biryani',    'Biryani',       'Legendary Hyderabadi dum biryani since 1953.',   'Paradise Circle, Secunderabad',       'Hyderabad', 17.4399, 78.4983, '+911140000001', 'https://images.unsplash.com/photo-1631515243349-e0cb75fb8d3a?w=800', 25, 200, 4.5),
  ('Bawarchi',            'Biryani',       'Family favourite for chicken and mutton biryani.','RTC Cross Roads, Chikkadpalli',       'Hyderabad', 17.4027, 78.4890, '+911140000002', 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=800', 30, 250, 4.3),
  ('Ohri''s Jiva Imperia','North Indian',  'Rooftop dining and tandoori classics.',           'Green Park Road, Ameerpet',           'Hyderabad', 17.4374, 78.4482, '+911140000003', 'https://images.unsplash.com/photo-1517244683847-7456b63c5969?w=800', 35, 300, 4.4),
  ('Chutneys',            'South Indian',  'Iconic South Indian breakfast + chutney counter.','Banjara Hills, Road No. 3',           'Hyderabad', 17.4145, 78.4400, '+911140000004', 'https://images.unsplash.com/photo-1630383249896-424e482df921?w=800', 15, 120, 4.4),
  ('Pista House',         'Biryani',       'Famous for haleem (Ramzan) and biryani.',         'Charminar, Old City',                  'Hyderabad', 17.3616, 78.4747, '+911140000005', 'https://images.unsplash.com/photo-1633945274309-2c16c7fda0a2?w=800', 30, 150, 4.2)
on conflict (name, city) do nothing;

-- ── SEED: MENU ITEMS ───────────────────────────────────────────────────────
-- We use a CTE to get restaurant IDs then insert items with an idempotency
-- guard on (restaurant_id, name).
create unique index if not exists menu_items_restaurant_name_uidx on menu_items(restaurant_id, name);

with r as (
  select id, name from restaurants where city = 'Hyderabad'
)
insert into menu_items (restaurant_id, name, description, price, category, is_veg, sort_order) values
  -- Paradise Biryani (5 items)
  ((select id from r where name = 'Paradise Biryani'), 'Chicken Dum Biryani',   'Signature long-grain basmati with chicken, saffron, mint.', 320, 'Rice',    false, 1),
  ((select id from r where name = 'Paradise Biryani'), 'Mutton Dum Biryani',    'Slow-cooked with tender mutton pieces.',                     420, 'Rice',    false, 2),
  ((select id from r where name = 'Paradise Biryani'), 'Veg Biryani',           'Basmati with mixed vegetables and paradise masala.',         220, 'Rice',    true,  3),
  ((select id from r where name = 'Paradise Biryani'), 'Chicken 65',            'Spicy fried chicken starter, Hyderabad style.',              260, 'Starters',false, 4),
  ((select id from r where name = 'Paradise Biryani'), 'Double Ka Meetha',      'Bread pudding in cardamom-saffron syrup.',                   140, 'Desserts',true,  5),
  -- Bawarchi (4 items)
  ((select id from r where name = 'Bawarchi'),         'Chicken Biryani',       'Full plate. Comes with raita and mirchi ka salan.',          300, 'Rice',    false, 1),
  ((select id from r where name = 'Bawarchi'),         'Mutton Biryani',        'Full plate. Comes with raita and mirchi ka salan.',          400, 'Rice',    false, 2),
  ((select id from r where name = 'Bawarchi'),         'Chicken 65',            'Bawarchi''s house special dry chilli chicken.',              250, 'Starters',false, 3),
  ((select id from r where name = 'Bawarchi'),         'Qubani Ka Meetha',      'Apricot compote with vanilla ice cream.',                    160, 'Desserts',true,  4),
  -- Ohri's (5 items)
  ((select id from r where name = 'Ohri''s Jiva Imperia'), 'Paneer Tikka Masala', 'Cottage cheese in a creamy tomato-onion gravy.',           340, 'Mains',   true,  1),
  ((select id from r where name = 'Ohri''s Jiva Imperia'), 'Butter Chicken',      'Slow-simmered tandoori chicken in a rich makhani sauce.',   380, 'Mains',   false, 2),
  ((select id from r where name = 'Ohri''s Jiva Imperia'), 'Dal Makhani',         'Overnight-simmered black lentils, finished with cream.',    280, 'Mains',   true,  3),
  ((select id from r where name = 'Ohri''s Jiva Imperia'), 'Butter Naan',         'Soft leavened bread, buttered fresh from the tandoor.',      60, 'Breads',  true,  4),
  ((select id from r where name = 'Ohri''s Jiva Imperia'), 'Gulab Jamun (2 pc)',  'Milk-solid dumplings in rose-cardamom syrup.',              120, 'Desserts',true,  5),
  -- Chutneys (5 items)
  ((select id from r where name = 'Chutneys'),         'Masala Dosa',           'Crispy dosa with spiced potato filling and 4 chutneys.',     140, 'Mains',   true,  1),
  ((select id from r where name = 'Chutneys'),         'Idli Sambar (3 pc)',    'Steamed rice cakes with lentil-vegetable stew.',             110, 'Mains',   true,  2),
  ((select id from r where name = 'Chutneys'),         'Pesarattu',             'Green-gram crepe with ginger chutney.',                      130, 'Mains',   true,  3),
  ((select id from r where name = 'Chutneys'),         'Filter Coffee',         'Strong South Indian filter coffee in the tumbler-dabara.',    60, 'Drinks',  true,  4),
  ((select id from r where name = 'Chutneys'),         'Mysore Bonda (4 pc)',   'Deep-fried lentil dumplings, tea-time favourite.',            80, 'Starters',true,  5),
  -- Pista House (4 items)
  ((select id from r where name = 'Pista House'),      'Chicken Haleem',        'Slow-cooked wheat + mutton + spices, seasonal special.',     220, 'Mains',   false, 1),
  ((select id from r where name = 'Pista House'),      'Chicken Biryani',       'Old-city style pukka biryani.',                              280, 'Rice',    false, 2),
  ((select id from r where name = 'Pista House'),      'Osmania Biscuit (500g)','Buttery cardamom tea biscuits.',                             160, 'Desserts',true,  3),
  ((select id from r where name = 'Pista House'),      'Irani Chai',            'Frothy sweet milk tea, Old City classic.',                    40, 'Drinks',  true,  4)
on conflict (restaurant_id, name) do nothing;
