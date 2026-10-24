import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { cfg } from './config.js';

const { accountId, accessKeyId, secretAccessKey, bucket, publicUrl } = cfg.r2;
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

// The bucket is PRIVATE. Nothing is ever served from a public address. We store only the object KEY (in the database),
// and whenever a file is shown / downloaded the server signs a temporary link for it that stops working after one hour.
export const SIGNED_URL_TTL = 60 * 60; // seconds

// upload a file; returns its key (what you keep in the database)
export async function uploadFile(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return key;
}
export const deleteFile = (key) => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

// A temporary download link for one stored file, valid for SIGNED_URL_TTL (1 hour). Signing is a local calculation
// (no request to R2), so it is cheap to do for every file in a list. `filename` makes a saved copy keep its real name.
export function signedUrl(key, { filename, expiresIn = SIGNED_URL_TTL } = {}) {
  if (!key) return null;
  const cmd = new GetObjectCommand({
    Bucket: bucket, Key: key,
    ...(filename ? { ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()]/g, escape)}` } : {}),
  });
  return getSignedUrl(s3, cmd, { expiresIn });
}

// ---- images that live in a text column (school logo, signature, seal, document background)
// Those columns may hold an outside web link (kept as it is) or a file of our bucket. A file of ours is saved as
// "r2:<key>". Older rows hold the old public address, and the browser may send back a signed link it was given
// earlier - both are recognised here and turned back into the key, so no expiring link is ever written to the database.
const REF = 'r2:';
export function keyOf(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  if (s.startsWith(REF)) return s.slice(REF.length) || null;
  if (publicUrl && s.startsWith(`${publicUrl}/`)) return decodeURIComponent(s.slice(publicUrl.length + 1).split(/[?#]/)[0]) || null;
  try {
    const u = new URL(s);
    if (u.hostname === `${accountId}.r2.cloudflarestorage.com` && u.pathname.startsWith(`/${bucket}/`)) return decodeURIComponent(u.pathname.slice(bucket.length + 2)) || null;
    if (u.hostname === `${bucket}.${accountId}.r2.cloudflarestorage.com`) return decodeURIComponent(u.pathname.slice(1)) || null;
  } catch { /* not a URL (e.g. "/logo.png") */ }
  return null;
}
export const refOf = (key) => `${REF}${key}`;
// what to write to the database for an image value: our files become "r2:<key>", outside links stay as they are
export const toStored = (v) => { const k = keyOf(v); return k ? refOf(k) : v; };
// what to send to the browser for a stored image value: our files become a fresh 1-hour link
export async function toDisplay(v) {
  const k = keyOf(v);
  return k ? signedUrl(k) : (v || '');
}

// copy one stored file to another key (same bucket). Used to turn a chat upload into a homework attachment. Returns the new key.
export async function copyFile(fromKey, toKey) {
  await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: toKey, CopySource: `${bucket}/${fromKey.split('/').map(encodeURIComponent).join('/')}` }));
  return toKey;
}
// size / type / age of a stored file, or null when it does not exist
export async function headFile(key) {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: r.ContentLength, type: r.ContentType, modified: r.LastModified };
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return null;
    throw e;
  }
}
// every object under a prefix: [{ key, modified }]
export async function listFiles(prefix) {
  const out = [];
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    (r.Contents || []).forEach((o) => out.push({ key: o.Key, modified: o.LastModified }));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

// ---- helpers for the backup system (backup.js)
// upload from a stream / buffer of any size (multipart behind the scenes)
export async function putStream(key, body, contentType) {
  const up = new Upload({ client: s3, params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType }, queueSize: 3, partSize: 8 * 1024 * 1024 });
  await up.done();
  return key;
}
// a stored file as a readable stream (null if it does not exist)
export async function getStream(key) {
  try { return (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body; }
  catch (e) { if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NoSuchKey') return null; throw e; }
}
export async function getBuffer(key) {
  const body = await getStream(key);
  if (!body) return null;
  const parts = [];
  for await (const c of body) parts.push(c);
  return Buffer.concat(parts);
}
// every object under a prefix with its size: [{ key, size, modified }]
export async function listWithSize(prefix) {
  const out = [];
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    (r.Contents || []).forEach((o) => out.push({ key: o.Key, size: o.Size, modified: o.LastModified }));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}
