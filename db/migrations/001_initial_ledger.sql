CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_id TEXT NOT NULL UNIQUE,
  locale TEXT NOT NULL DEFAULT 'en-US',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  opening_balance_minor NUMERIC(20, 0) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, currency)
);

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  normalized_name TEXT GENERATED ALWAYS AS (lower(trim(name))) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, normalized_name)
);

CREATE TYPE transaction_type AS ENUM ('Pengeluaran', 'Pemasukan');
CREATE TYPE transaction_status AS ENUM ('approved', 'pending', 'voided');

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  source_message_id TEXT NOT NULL UNIQUE,
  transaction_type transaction_type NOT NULL,
  status transaction_status NOT NULL DEFAULT 'approved',
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  amount_minor NUMERIC(20, 0) NOT NULL CHECK (amount_minor > 0),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX transactions_wallet_occurred_at_idx ON transactions (wallet_id, occurred_at DESC);
CREATE INDEX transactions_user_occurred_at_idx ON transactions (user_id, occurred_at DESC);