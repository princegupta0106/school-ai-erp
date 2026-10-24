// Private R2 bucket: files are saved by KEY and shown through links that expire after one hour. Offline - nothing is sent to R2.
// Run:  cd server && node --test test/r2-signed.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = 'x'; process.env.SUPABASE_URL = 'http://localhost:1'; process.env.SUPABASE_SECRET_KEY = 'x';
process.env.R2_ACCOUNT_ID = 'acc'; process.env.R2_ACCESS_KEY_ID = 'k'; process.env.R2_SECRET_ACCESS_KEY = 's'; process.env.R2_BUCKET_NAME = 'bkt';
process.env.R2_PUBLIC_URL = 'https://old-public.test'; // only to recognise rows saved before the bucket became private

const S3 = await import('@aws-sdk/client-s3');
const sent = [];
S3.S3Client.prototype.send = async function send(cmd) { sent.push(cmd); return {}; };
const { signedUrl, uploadFile, keyOf, refOf, toStored, toDisplay, SIGNED_URL_TTL } = await import('../src/r2.js');

const KEY = 'schools/s1/homework/h1/abc-Worksheet_4.pdf';

test('uploadFile returns the key, not a public address', async () => {
  assert.equal(await uploadFile(KEY, Buffer.from('x'), 'application/pdf'), KEY);
  assert.ok(sent[0] instanceof S3.PutObjectCommand);
});

test('signed link: private bucket, signed, expires after exactly one hour, no network call', async () => {
  sent.length = 0;
  const u = new URL(await signedUrl(KEY));
  assert.match(u.hostname, /r2\.cloudflarestorage\.com$/);
  assert.equal(u.searchParams.get('X-Amz-Expires'), '3600');
  assert.equal(SIGNED_URL_TTL, 3600);
  assert.ok(u.searchParams.get('X-Amz-Signature'));
  assert.ok(decodeURIComponent(u.pathname).endsWith(KEY));
  assert.equal(sent.length, 0, 'signing is local');
  assert.equal(signedUrl(''), null);
});

test('a real filename can ride along so a saved copy keeps its name', async () => {
  const u = new URL(await signedUrl(KEY, { filename: 'Worksheet 4 (final).pdf' }));
  assert.match(u.searchParams.get('response-content-disposition'), /^inline; filename\*=UTF-8''Worksheet%204%20%28final%29\.pdf$/);
});

test('a signed link, an old public link and an r2: reference all map back to the same key', async () => {
  const signed = await signedUrl(KEY);
  assert.equal(keyOf(signed), KEY);
  assert.equal(keyOf(`https://old-public.test/${KEY}`), KEY);
  assert.equal(keyOf(refOf(KEY)), KEY);
  assert.equal(keyOf('https://example.com/logo.png'), null, 'outside links are not ours');
  assert.equal(keyOf('/logo.png'), null);
  assert.equal(keyOf(''), null);
});

test('the database only ever receives permanent references; the browser only ever receives fresh links', async () => {
  assert.equal(toStored(await signedUrl(KEY)), `r2:${KEY}`);
  assert.equal(toStored(`https://old-public.test/${KEY}`), `r2:${KEY}`);
  assert.equal(toStored('https://example.com/logo.png'), 'https://example.com/logo.png');
  assert.match(await toDisplay(`r2:${KEY}`), /X-Amz-Expires=3600/);
  assert.equal(await toDisplay('https://example.com/logo.png'), 'https://example.com/logo.png');
  assert.equal(await toDisplay(''), '');
});
