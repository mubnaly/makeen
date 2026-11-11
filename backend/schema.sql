-- Makeen (مَكِين) PostgreSQL Production Database Schema
-- Run this script in PostgreSQL (psql, Supabase SQL Editor, Neon, or Railway)

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255),
  full_name VARCHAR(128),
  avatar_url TEXT,
  role VARCHAR(32) DEFAULT 'learner',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Community Shares & Courses Table (supports playlists, learning paths, pdfs, flashcards)
CREATE TABLE IF NOT EXISTS community_shares (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(32) NOT NULL DEFAULT 'playlist', -- 'playlist' | 'path' | 'pdf' | 'cards' | 'notes' | 'video'
  title VARCHAR(255) NOT NULL,
  title_en VARCHAR(255),
  description TEXT,
  description_en TEXT,
  author_id VARCHAR(64),
  author_name VARCHAR(128) NOT NULL,
  author_avatar TEXT,
  is_anonymous BOOLEAN DEFAULT FALSE,
  category VARCHAR(64) DEFAULT 'general',
  is_paid BOOLEAN DEFAULT FALSE,
  price NUMERIC(10,2) DEFAULT 0,
  currency VARCHAR(16) DEFAULT 'EGP',
  visits INT DEFAULT 1,
  rating NUMERIC(3,2) DEFAULT 5.0,
  ratings_count INT DEFAULT 1,
  items_count INT DEFAULT 1,
  total_duration_seconds INT DEFAULT 0,
  thumbnail TEXT,
  items_json JSONB DEFAULT '[]'::jsonb,
  path_courses_json JSONB DEFAULT '[]'::jsonb,
  playlist_data_json JSONB,
  pdf_data_json JSONB,
  cards_data_json JSONB,
  note_content TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_shares_type ON community_shares(type);
CREATE INDEX IF NOT EXISTS idx_community_shares_author_id ON community_shares(author_id);
CREATE INDEX IF NOT EXISTS idx_community_shares_created_at ON community_shares(created_at DESC);

-- 3. Orders & Purchase Receipts Table
CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(64) PRIMARY KEY,
  share_id VARCHAR(64) REFERENCES community_shares(id) ON DELETE CASCADE,
  share_title VARCHAR(255) NOT NULL,
  share_price NUMERIC(10,2) NOT NULL,
  buyer_id VARCHAR(64) NOT NULL,
  buyer_name VARCHAR(128) NOT NULL,
  buyer_email VARCHAR(255),
  buyer_note TEXT,
  receipt_image TEXT,
  status VARCHAR(32) DEFAULT 'pending', -- 'pending' | 'accepted' | 'rejected'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reviewed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_orders_share_id ON orders(share_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- 4. Reviews & Ratings Table
CREATE TABLE IF NOT EXISTS reviews (
  id VARCHAR(64) PRIMARY KEY,
  share_id VARCHAR(64) REFERENCES community_shares(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL,
  user_name VARCHAR(128) NOT NULL,
  rating INT CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_share_id ON reviews(share_id);

-- 5. User Personal Library (PDFs metadata JSON, Videos, Playlists, Reading Progress)
CREATE TABLE IF NOT EXISTS user_library (
  id VARCHAR(128) PRIMARY KEY, -- Composite or uuid (e.g. user_id:doc_id)
  user_id VARCHAR(64) NOT NULL,
  doc_id VARCHAR(64) NOT NULL,
  kind VARCHAR(32) NOT NULL DEFAULT 'pdf', -- 'pdf' | 'video' | 'audio'
  title VARCHAR(255) NOT NULL,
  filename VARCHAR(255),
  url TEXT,
  last_page INT DEFAULT 1,
  total_pages INT DEFAULT 0,
  last_seconds NUMERIC(10,2) DEFAULT 0,
  duration NUMERIC(10,2) DEFAULT 0,
  bookmarks_json JSONB DEFAULT '[]'::jsonb,
  notes_json JSONB DEFAULT '[]'::jsonb,
  highlights_json JSONB DEFAULT '[]'::jsonb,
  metadata_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_user_doc UNIQUE (user_id, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_user_library_user_id ON user_library(user_id);
CREATE INDEX IF NOT EXISTS idx_user_library_kind ON user_library(kind);

-- 6. User Planner Tasks & Scheduled Events
CREATE TABLE IF NOT EXISTS user_planner_tasks (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  due_date VARCHAR(32), -- YYYY-MM-DD
  start_time VARCHAR(16), -- HH:mm
  duration_minutes INT DEFAULT 60,
  status VARCHAR(32) DEFAULT 'todo', -- 'todo' | 'done' | 'in_progress'
  priority VARCHAR(16) DEFAULT 'medium',
  links_json JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_planner_user_id ON user_planner_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_planner_due_date ON user_planner_tasks(due_date);

-- 7. User Markdown Notes
CREATE TABLE IF NOT EXISTS user_notes (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  folder_id VARCHAR(64),
  content TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_notes_user_id ON user_notes(user_id);

-- 8. Cloud Backups (Full snapshot of user data for 1-click restore)
CREATE TABLE IF NOT EXISTS user_backups (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  backup_type VARCHAR(32) DEFAULT 'full', -- 'full' | 'library' | 'planner'
  data_json JSONB NOT NULL,
  device_info VARCHAR(128),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_backups_user_id ON user_backups(user_id);
