import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const need = (k) => {
  if (!process.env[k]) { console.error(`Missing ${k} in .env`); process.exit(1); }
  return process.env[k];
};

// AI_URL may be typed without "https://" or with a trailing slash / "/api" - make it a clean base address.
const DEFAULT_RENDER_AI = 'https://school-ai-erp-ogqz.onrender.com';
function aiUrl() {
  let u = String(process.env.AI_URL || '').trim();
  if (!u) u = process.env.RENDER ? DEFAULT_RENDER_AI : `http://127.0.0.1:${process.env.AI_PORT || 8001}`;
  if (!/^https?:\/\//i.test(u)) u = `${/^(localhost|127\.|0\.0\.0\.0)/i.test(u) ? 'http' : 'https'}://${u}`;
  return u.replace(/\/+$/, '').replace(/\/api$/i, '');
}

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
    // OPTIONAL and only for old data: the bucket is private now. If files were saved earlier under a public address, put it here
    // so those old links are recognised and re-signed. New files never use it.
    publicUrl: (process.env.R2_PUBLIC_URL || '').replace(/\/$/, ''),
  },
  // The Python AI service (ai-server/). The portal forwards /api/ai/* to it.
  //   AI_URL=https://school-ai-erp-ogqz.onrender.com   <- set this in the backend's environment when the AI runs somewhere else (Render etc.)
  // Not set: on Render it falls back to the address below, on your own PC to http://127.0.0.1:<AI_PORT, default 8001>.
  ai: { url: aiUrl() },
  clientDist: path.resolve(here, '../../client/dist'),
};
