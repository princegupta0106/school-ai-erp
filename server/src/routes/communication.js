import { Router } from 'express';
import { httpError, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import * as C from '../communication.js';

const r = Router();
const NOTICES = ['view_announcements', 'post_announcement', 'post_school_announcement', 'manage_announcements'];
const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};
// chats are between people of one school, so they need a school account
const mySchool = (req) => { if (!req.user.school_id) throw httpError(400, 'Messages are for school accounts'); return req.user.school_id; };

// ---- notice board
r.get('/announcements', requireFeature(...NOTICES), asyncH(async (req, res) => res.json(await C.listAnnouncements(req.user, schoolOf(req), { before: req.query.before, limit: req.query.limit }))));
r.get('/announcement-classes', requireFeature('post_announcement'), asyncH(async (req, res) => res.json(await C.postableClasses(req.user, schoolOf(req)))));
r.post('/announcements', requireFeature('post_announcement', 'post_school_announcement'), asyncH(async (req, res) => res.status(201).json(await C.createAnnouncement(req.user, schoolOf(req), req.body))));
r.patch('/announcements/:id', requireFeature('post_announcement', 'post_school_announcement', 'manage_announcements'), asyncH(async (req, res) => { await C.updateAnnouncement(req.user, schoolOf(req), req.params.id, req.body); res.json({ ok: true }); }));
r.delete('/announcements/:id', requireFeature('post_announcement', 'post_school_announcement', 'manage_announcements'), asyncH(async (req, res) => { await C.deleteAnnouncement(req.user, schoolOf(req), req.params.id); res.json({ ok: true }); }));

// ---- 1-to-1 messages
r.get('/contacts', requireFeature('use_messages'), asyncH(async (req, res) => res.json(await C.searchContacts(req.user, mySchool(req), req.query.q))));
r.get('/conversations', requireFeature('use_messages'), asyncH(async (req, res) => res.json(await C.listConversations(req.user, mySchool(req)))));
r.post('/conversations', requireFeature('use_messages'), asyncH(async (req, res) => res.json(await C.startConversation(req.user, mySchool(req), req.body.user_id))));
r.get('/conversations/:id/messages', requireFeature('use_messages'), asyncH(async (req, res) => res.json(await C.getMessages(req.user, req.params.id, { before: req.query.before, after: req.query.after }))));
r.post('/conversations/:id/messages', requireFeature('use_messages'), asyncH(async (req, res) => res.status(201).json(await C.sendMessage(req.user, req.params.id, req.body.body))));

export default r;
