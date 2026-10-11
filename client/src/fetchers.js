import { api } from './api.js';
const q = (sid) => (sid ? `?school_id=${sid}` : '');
export const fetchers = {
  schools: () => api.get('/schools'),
  users: () => api.get('/users'),
  classes: () => api.get('/classes'),
  sessions: (sid) => api.get(`/calendar/sessions${q(sid)}`),
  attClasses: (sid, date) => api.get(`/attendance/classes?${new URLSearchParams({ ...(sid ? { school_id: sid } : {}), ...(date ? { date } : {}) })}`),
  holidays: (sid) => api.get(`/calendar/holidays${q(sid)}`),
};
