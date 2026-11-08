// backend/db.js — PostgreSQL Connection Pool with SSL & Auto-Reconnect
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/makeen';
const isRemote = connectionString.includes('sslmode=require') || connectionString.includes('.supabase.') || connectionString.includes('.neon.') || process.env.NODE_ENV === 'production';

export const pool = new Pool({
  connectionString,
  ssl: isRemote ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

export async function testConnection() {
  try {
    const client = await pool.connect();
    const res = await client.query('SELECT NOW() as now, current_database() as db');
    client.release();
    return { ok: true, now: res.rows[0].now, db: res.rows[0].db };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
