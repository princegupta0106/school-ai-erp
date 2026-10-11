import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const need = (k) => {
  if (!process.env[k]) { console.error(`Missing ${k} in .env`); process.exit(1); }
  return process.env[k];
};

export const cfg = {
  port: Number(process.env.PORT || 3000),
  timezone: process.env.SCHOOL_TIMEZONE || 'Asia/Kolkata', // decides what "today" means for attendance
  authSecret: need('AUTH_SECRET'),
  supabaseUrl: need('SUPABASE_URL'),
  supabaseSecret: need('SUPABASE_SECRET_KEY'),
  superadmin: {
    loginId: (process.env.SUPERADMIN_LOGIN_ID || 'princegupta').toLowerCase(),
    password: process.env.SUPERADMIN_PASSWORD || '12345678',
    name: process.env.SUPERADMIN_NAME || 'Super Admin',
    email: process.env.SUPERADMIN_EMAIL || null,
  },
  r2: {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET_NAME,
    publicUrl: (process.env.R2_PUBLIC_URL || '').replace(/\/$/, ''),
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  },
  clientDist: path.resolve(here, '../../client/dist'),
};
