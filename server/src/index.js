import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { cfg } from './config.js';
import { authenticate } from './auth.js';
import { seedSuperAdmin } from './seed.js';
import authRoutes from './routes/auth.js';
import schoolRoutes from './routes/schools.js';
import userRoutes from './routes/users.js';
import calendarRoutes from './routes/calendar.js';
import classRoutes from './routes/classes.js';
import attendanceRoutes from './routes/attendance.js';
import visitorRoutes from './routes/visitors.js';
import queryRoutes from './routes/queries.js';
import communicationRoutes from './routes/communication.js';
import feesRoutes from './routes/fees.js';
import payrollRoutes from './routes/payroll.js';
import academicsRoutes from './routes/academics.js';
import auditRoutes from './routes/audit.js';
import documentsRoutes from './routes/documents.js';
import homeworkRoutes from './routes/homework.js';
import notificationRoutes from './routes/notifications.js';
import aiRoutes from './routes/ai.js';
import backupRoutes from './routes/backup.js';
import { auditMiddleware } from './audit.js';
import { sweepStaging } from './homework.js';

const app = express();
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors());
// gzip every response (JSON and the built app) - much smaller downloads on phones / slow networks.
// Optional: if the package isn't installed yet the server still starts (run `npm install` in /server).
try { const { default: compression } = await import('compression'); app.use(compression()); }
catch { console.warn('Tip: run "npm install" in /server to switch on gzip compression (faster loading).'); }
app.use(express.json({ limit: '1mb' }));

app.use('/api', auditMiddleware); // records every change / sign-in into audit_logs (see audit.js)
app.use('/api/auth', authRoutes);
app.use('/api/schools', authenticate, schoolRoutes);
app.use('/api/users', authenticate, userRoutes);
app.use('/api/calendar', authenticate, calendarRoutes);
app.use('/api/classes', authenticate, classRoutes);
app.use('/api/attendance', authenticate, attendanceRoutes);
app.use('/api/visitors', authenticate, visitorRoutes);
app.use('/api/queries', authenticate, queryRoutes);
app.use('/api/communication', authenticate, communicationRoutes);
app.use('/api/fees', authenticate, feesRoutes);
app.use('/api/payroll', authenticate, payrollRoutes);
app.use('/api/academics', authenticate, academicsRoutes);
app.use('/api/documents', authenticate, documentsRoutes);
app.use('/api/homework', authenticate, homeworkRoutes);
app.use('/api/notifications', authenticate, notificationRoutes);
app.use('/api/audit', authenticate, auditRoutes);
app.use('/api/ai', authenticate, aiRoutes);
app.use('/api/backup', authenticate, backupRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

if (fs.existsSync(cfg.clientDist)) {
  app.use(express.static(cfg.clientDist, {
    maxAge: '1h',
    setHeaders(res, file) {
      if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // build files carry a content hash in their name
      else if (/(index\.html|sw\.js)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); // always re-check the shell and the service worker
    },
  }));
  app.get('*', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(cfg.clientDist, 'index.html')); });
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.locals.errorMessage = err.message; // picked up by the audit log
  res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is over 10 MB' : err.message });
});

await seedSuperAdmin();
// Files attached in the AI chat that nobody turned into homework are removed after a day (needs R2; never stops the server).
if (cfg.r2.accountId && cfg.r2.bucket) {
  const sweep = () => sweepStaging().then((n) => n && console.log(`Removed ${n} unused chat file(s)`)).catch((e) => console.warn('Chat-file cleanup skipped:', e.message));
  setTimeout(sweep, 60 * 1000).unref();
  setInterval(sweep, 6 * 60 * 60 * 1000).unref();
}
app.listen(cfg.port, () => console.log(`School portal running on http://localhost:${cfg.port}`));
