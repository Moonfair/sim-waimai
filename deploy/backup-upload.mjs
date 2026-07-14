import fs from 'node:fs';
import path from 'node:path';
import COS from 'cos-nodejs-sdk-v5';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const filename = process.argv[2];
if (!filename) {
  console.error('Usage: node deploy/backup-upload.mjs <filename-under-backups/>');
  process.exit(1);
}

// Overridable only so Task 13's remote verification can force an immediate cleanup instead
// of waiting 7 real days to prove the retention logic actually deletes stale objects.
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 7);
const Bucket = requireEnv('COS_BUCKET');
const Region = requireEnv('COS_REGION');
const cos = new COS({ SecretId: requireEnv('COS_SECRET_ID'), SecretKey: requireEnv('COS_SECRET_KEY') });

function putObject(key, body) {
  return new Promise((resolve, reject) => {
    cos.putObject({ Bucket, Region, Key: key, Body: body }, (err) => (err ? reject(err) : resolve()));
  });
}

function listBackups() {
  return new Promise((resolve, reject) => {
    cos.getBucket({ Bucket, Region, Prefix: 'backups/' }, (err, data) =>
      err ? reject(err) : resolve(data.Contents ?? []),
    );
  });
}

function deleteObjects(keys) {
  if (keys.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    cos.deleteMultipleObject({ Bucket, Region, Objects: keys.map((Key) => ({ Key })) }, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

const body = fs.readFileSync(path.join('backups', filename));
await putObject(`backups/${filename}`, body);
console.log(`Uploaded backups/${filename}`);

const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
const objects = await listBackups();
const stale = objects.filter((obj) => new Date(obj.LastModified).getTime() < cutoff);
await deleteObjects(stale.map((obj) => obj.Key));
if (stale.length > 0) {
  console.log(`Deleted ${stale.length} stale backup(s) from COS: ${stale.map((o) => o.Key).join(', ')}`);
}

const remaining = await listBackups();
console.log('Current backups/ objects on COS:');
for (const obj of remaining) console.log(`  ${obj.Key}  (${obj.LastModified})`);
