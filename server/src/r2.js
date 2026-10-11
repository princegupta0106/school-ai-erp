import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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
