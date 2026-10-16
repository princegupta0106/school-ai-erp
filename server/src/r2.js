import { S3Client, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { cfg } from './config.js';

const { accountId, accessKeyId, secretAccessKey, bucket, publicUrl } = cfg.r2;
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

export async function uploadFile(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return `${publicUrl}/${key}`;
}
export const deleteFile = (key) => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
export const fileUrl = (key) => `${publicUrl}/${key}`;

// copy one stored file to another key (same bucket). Used to turn a chat upload into a homework attachment.
export async function copyFile(fromKey, toKey) {
  await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: toKey, CopySource: `${bucket}/${fromKey.split('/').map(encodeURIComponent).join('/')}` }));
  return `${publicUrl}/${toKey}`;
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
