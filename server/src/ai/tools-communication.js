// Communication: notice board and 1-to-1 messages. Anything that is SENT to other people shows a Confirm card.
import { httpError } from '../db.js';
import { S, B, obj, withSchool, resolveSchoolId, resolveClass, pickOne, P, norm } from './helpers.js';

const NOTICES = ['view_announcements', 'post_announcement', 'post_school_announcement', 'manage_announcements'];
const excerpt = (s, n = 400) => (String(s || '').length > n ? `${String(s).slice(0, n)}...` : String(s || ''));
const audienceOf = (a) => (a.audience === 'class' ? `class ${((a.classes || []).map((c) => `${c.name}${c.section ? ` ${c.section}` : ''}`)).join(', ')}` : 'whole school');
async function allNotices(ctx, sid) {
  const r = await ctx.api('GET', P('/communication/announcements', { limit: 30, school_id: sid }));
  return [...r.pinned, ...r.items];
}

export const communicationTools = [
  {
    name: 'read_notice_board',
    description: 'The latest notices on the notice board (pinned first): title, text, audience, author, date.',
    features: NOTICES,
    parameters: obj(withSchool({ search: S('Only notices containing this text (optional)') })),
    run: async (ctx, a) => {
      const w = norm(a.search);
      const list = (await allNotices(ctx, await resolveSchoolId(ctx, a.school))).filter((n) => !w || norm(`${n.title} ${n.body}`).includes(w));
      return list.slice(0, 15).map((n) => ({ title: n.title, text: excerpt(n.body), for: audienceOf(n), pinned: n.is_pinned || undefined, by: n.author, at: n.created_at }));
    },
  },
  {
    name: 'post_notice',
    description: 'Post a notice on the notice board, for the whole school or for chosen classes (teachers only to their own classes). The user must confirm first because many people will see it.',
    features: ['post_announcement', 'post_school_announcement'],
    confirm: true,
    parameters: obj(withSchool({
      title: S('Short title'), text: S('The notice text'),
      audience: S('school (everyone) or class', { enum: ['school', 'class'] }),
      class_names: { type: 'array', items: { type: 'string' }, description: 'Classes like "5 A" (for audience class)' },
      pinned: B('Pin it on top'),
    }), ['title', 'text', 'audience']),
    prepare: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      let class_ids = [];
      if (a.audience === 'class') {
        if (!a.class_names?.length) throw httpError(400, 'Which classes?');
        for (const n of a.class_names) class_ids.push((await resolveClass(ctx, n, sid, ['attendance', 'academics'])).id);
      }
      return { args: { title: a.title, body: a.text, audience: a.audience, class_ids, is_pinned: !!a.pinned, school_id: sid }, describe: `Post the notice "${a.title}" to ${a.audience === 'school' ? 'the WHOLE SCHOOL' : `class ${a.class_names.join(', ')}`}${a.pinned ? ' (pinned)' : ''}: ${excerpt(a.text, 200)}` };
    },
    run: async (ctx, a) => ({ posted: true, ...(await ctx.api('POST', '/communication/announcements', a)) }),
  },
  {
    name: 'delete_notice',
    description: 'Delete a notice by its title (your own, or any with the manage-notices permission). The user must confirm first.',
    features: ['post_announcement', 'post_school_announcement', 'manage_announcements'],
    confirm: true,
    parameters: obj(withSchool({ title: S('Title of the notice') }), ['title']),
    prepare: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const n = pickOne(await allNotices(ctx, sid), a.title, (x) => x.title, 'notice', (x) => x.created_at?.slice(0, 10));
      return { args: { id: n.id, school_id: sid }, describe: `Delete the notice "${n.title}" (${audienceOf(n)}, by ${n.author})` };
    },
    run: async (ctx, a) => { await ctx.api('DELETE', P(`/communication/announcements/${a.id}`, { school_id: a.school_id })); return { deleted: true }; },
  },
  {
    name: 'find_contacts',
    description: 'People I am allowed to message (by name).',
    features: ['use_messages'],
    parameters: obj({ search: S('Part of a name') }),
    run: async (ctx, a) => (await ctx.api('GET', P('/communication/contacts', { q: a.search }))).map((c) => ({ name: c.name, login_id: c.login_id, who: c.label })),
  },
  {
    name: 'send_message',
    description: 'Send a 1-to-1 message from the signed-in person to someone they may chat with. The user must confirm first (it is sent in their name).',
    features: ['use_messages'],
    confirm: true,
    parameters: obj({ to: S('Name of the person'), text: S('The message') }, ['to', 'text']),
    prepare: async (ctx, a) => {
      const contacts = await ctx.api('GET', P('/communication/contacts', { q: a.to }));
      const c = pickOne(contacts, a.to, (x) => x.name, 'contact', (x) => x.label);
      return { args: { user_id: c.user_id, text: a.text }, describe: `Send to ${c.name} (${c.label}): "${excerpt(a.text, 300)}"` };
    },
    run: async (ctx, a) => {
      const conv = await ctx.api('POST', '/communication/conversations', { user_id: a.user_id });
      await ctx.api('POST', `/communication/conversations/${conv.id}/messages`, { body: a.text });
      return { sent: true, to: conv.other?.name };
    },
  },
  {
    name: 'read_messages',
    description: 'My chats: unread counts and last message of each. With "with" it shows the latest messages of the chat with that person.',
    features: ['use_messages'],
    parameters: obj({ with: S('Person name (optional)') }),
    run: async (ctx, a) => {
      const convs = await ctx.api('GET', '/communication/conversations');
      if (!a.with) return { unread_total: convs.reduce((t, c) => t + (c.unread || 0), 0), chats: convs.slice(0, 15).map((c) => ({ with: c.other.name, unread: c.unread, last: excerpt(c.last_preview, 120), mine: c.last_mine })) };
      const c = pickOne(convs, a.with, (x) => x.other.name, 'chat');
      const r = await ctx.api('GET', `/communication/conversations/${c.id}/messages`);
      return { with: c.other.name, messages: r.messages.slice(-15).map((m) => ({ from: m.mine ? 'me' : c.other.name, text: excerpt(m.body, 500), at: m.created_at })) };
    },
  },
];
