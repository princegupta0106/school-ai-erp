// The AI route only lets known portal download routes into a chat download card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDownloads, cleanReply } from '../src/routes/ai.js';

const id = '55555555-5555-5555-5555-555555555555';
const ok = [`/fees/payments/${id}/receipt`, `/fees/payments/${id}/receipt?school_id=${id}`, `/fees/students/${id}/statement`, `/fees/my/${id}/statement`,
  '/fees/pending/download?format=csv&class_name=5&min_pending=5000', '/fees/payments/download?format=pdf&period=this_month', `/documents/issued/${id}`];
const bad = ['/auth/me', '/users', `/fees/payments/${id}/cancel`, `/fees/payments/${id}/receipt/../../x`, 'https://evil.example/x', '/fees/pending/download?x=<script>'];

test('known download routes pass', () => { for (const path of ok) assert.equal(cleanDownloads([{ path }]).length, 1, path); });
test('anything else is dropped', () => { for (const path of bad) assert.equal(cleanDownloads([{ path }]).length, 0, path); });
test('replies are cleaned everywhere a card can be', () => {
  const r = cleanReply({ downloads: [{ path: bad[0] }], actions: [{ downloads: [{ path: ok[0], filename: 'a b/c.pdf', format: 'pdf' }] }], action: { downloads: [{ path: bad[1] }] } });
  assert.deepEqual(r.downloads, []); assert.deepEqual(r.action.downloads, []);
  assert.equal(r.actions[0].downloads[0].filename, 'a-b-c.pdf'); assert.equal(r.actions[0].downloads[0].format, 'PDF');
});
