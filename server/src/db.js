import { createClient } from '@supabase/supabase-js';
import { cfg } from './config.js';

export const db = createClient(cfg.supabaseUrl, cfg.supabaseSecret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const httpError = (status, message) => Object.assign(new Error(message), { status });

// throw if a supabase call returned an error
export const check = (error) => {
  if (!error) return;
  const e = new Error(error.code === '23505' ? 'That value is already taken' : error.message);
  e.status = error.code === '23505' ? 409 : error.code === 'P0001' ? 400 : 500;
  throw e;
};

export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
