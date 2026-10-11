import bcrypt from 'bcryptjs';
import { cfg } from './config.js';
import { db, check } from './db.js';

// creates the super admin from .env if missing (never overwrites an existing one)
export async function seedSuperAdmin() {
  const { loginId, password, name, email } = cfg.superadmin;
  const { data, error } = await db.from('users').select('user_id').eq('login_id', loginId).maybeSingle();
  if (error) {
    console.error('\nCould not reach the database:', error.message);
    console.error('Did you run db/schema.sql in the Supabase SQL editor?\n');
    process.exit(1);
  }
  if (data) return console.log(`Super admin "${loginId}" already exists`);
  const { data: u, error: e1 } = await db.from('users').insert({
    login_id: loginId, role: 'super_admin', school_id: null, password_hash: await bcrypt.hash(password, 10),
  }).select('user_id').single();
  check(e1);
  const { error: e2 } = await db.from('profiles').insert({ user_id: u.user_id, full_name: name, email });
  check(e2);
  console.log(`Super admin "${loginId}" created`);
}
