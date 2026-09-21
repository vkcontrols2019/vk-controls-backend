-- VK Controls core database foundation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','controller','manager','user')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT UNIQUE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS outlets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firestore_id TEXT UNIQUE,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  department_code TEXT NOT NULL REFERENCES departments(code),
  entity_type TEXT NOT NULL DEFAULT 'group' CHECK (entity_type IN ('group','branch')),
  parent_firestore_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_outlets (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, outlet_id)
);

INSERT INTO departments(code,name) VALUES
  ('FOOD','Food'),('LIQUOR','Liquor'),('COFFEE','Coffee')
ON CONFLICT (code) DO NOTHING;

-- Coffee is intentionally a separate department. Its masters/transactions will reference COFFEE outlets only.
CREATE INDEX IF NOT EXISTS idx_outlets_department ON outlets(department_code);
CREATE INDEX IF NOT EXISTS idx_user_outlets_user ON user_outlets(user_id);


CREATE TABLE IF NOT EXISTS coffee_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firestore_id TEXT UNIQUE NOT NULL,
  outlet_firestore_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  uom TEXT NOT NULL DEFAULT 'pcs',
  opening NUMERIC(18,6) NOT NULL DEFAULT 0,
  receipt NUMERIC(18,6) NOT NULL DEFAULT 0,
  transfer NUMERIC(18,6) NOT NULL DEFAULT 0,
  consumption NUMERIC(18,6) NOT NULL DEFAULT 0,
  physical_closing NUMERIC(18,6) NOT NULL DEFAULT 0,
  landing_cost NUMERIC(18,6) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coffee_items_outlet ON coffee_items(outlet_firestore_id);


CREATE TABLE IF NOT EXISTS coffee_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firestore_id TEXT UNIQUE NOT NULL,
  outlet_firestore_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coffee_recipes_outlet ON coffee_recipes(outlet_firestore_id);

-- Coffee daily audit: one immutable-by-date record per Coffee outlet/day.
CREATE TABLE IF NOT EXISTS coffee_audit_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firestore_id TEXT UNIQUE NOT NULL,
  outlet_firestore_id TEXT NOT NULL,
  audit_date DATE NOT NULL,
  items JSONB NOT NULL DEFAULT '{}'::jsonb,
  closed BOOLEAN NOT NULL DEFAULT FALSE,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(outlet_firestore_id, audit_date)
);
CREATE INDEX IF NOT EXISTS idx_coffee_audit_days_outlet_date ON coffee_audit_days(outlet_firestore_id, audit_date);


CREATE TABLE IF NOT EXISTS coffee_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firestore_id TEXT UNIQUE NOT NULL,
  outlet_firestore_id TEXT NOT NULL,
  recipe_firestore_id TEXT NOT NULL,
  recipe_name TEXT NOT NULL,
  sale_date DATE NOT NULL,
  qty NUMERIC(18,6) NOT NULL DEFAULT 0,
  amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  sold_by TEXT,
  ts BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coffee_sales_outlet_date ON coffee_sales(outlet_firestore_id, sale_date);

-- Food item master. Food remains a separate department from Liquor and Coffee.
CREATE TABLE IF NOT EXISTS food_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firestore_id TEXT UNIQUE NOT NULL,
  outlet_firestore_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Groceries',
  unit TEXT NOT NULL DEFAULT 'pcs',
  current_stock NUMERIC(18,6) NOT NULL DEFAULT 0,
  par_level NUMERIC(18,6) NOT NULL DEFAULT 0,
  vendor TEXT NOT NULL DEFAULT '',
  unit_cost NUMERIC(18,6) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_food_items_outlet ON food_items(outlet_firestore_id);
CREATE INDEX IF NOT EXISTS idx_food_items_name ON food_items(name);


-- Food recipe master. Food recipes are separate from Liquor and Coffee recipes.
CREATE TABLE IF NOT EXISTS food_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firestore_id TEXT UNIQUE NOT NULL,
  outlet_firestore_id TEXT NOT NULL,
  name TEXT NOT NULL,
  recipe_code TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Main Course',
  yield_qty NUMERIC(18,6) NOT NULL DEFAULT 1,
  yield_uom TEXT NOT NULL DEFAULT 'portion',
  selling_price NUMERIC(18,6) NOT NULL DEFAULT 0,
  ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_food_recipes_outlet ON food_recipes(outlet_firestore_id);
CREATE INDEX IF NOT EXISTS idx_food_recipes_name ON food_recipes(name);
