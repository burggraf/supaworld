import type { Project, Credentials } from '../projects/model';
import { storeName, validateName } from '../projects/model';
import {
  directoryFiles,
  findStore,
  hasMarker,
  withStore,
  removeStore,
  storeRoot,
  withOperation,
} from '../platform/locks';
import * as repo from '../projects/repository';
import { RUNTIME_BUILD, COMPATIBLE_RUNTIME_BUILDS } from '../runtime/config';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAGIC = encoder.encode('SUPAWORLD1\n');
export const MAX_FILE = 128 * 1024 * 1024;
export const MAX_TOTAL = 1024 * 1024 * 1024;
const MAX_HEADER = 8 * 1024 * 1024;
interface Entry {
  path: string;
  size: number;
  sha256: string;
}
export interface BackupManifest {
  format: 1;
  mode: 'clean' | 'recovery';
  project: Project;
  credentials: Credentials;
  files: Entry[];
}
export function validPath(path: string) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length < 512 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    path.split('/').every((p) => p !== '' && p !== '.' && p !== '..' && !p.includes(':'))
  );
}
const digest = async (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
export function validateManifest(value: unknown): BackupManifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid backup manifest.');
  const m = value as BackupManifest;
  if (m.format !== 1 || !['clean', 'recovery'].includes(m.mode))
    throw new Error('This backup format is not supported.');
  if (
    !m.project ||
    typeof m.project.runtimeBuildId !== 'string' ||
    !m.project.provisioning ||
    m.project.provisioningVersion !== 1
  )
    throw new Error('Project configuration is missing.');
  validateName(m.project.name);
  if (!COMPATIBLE_RUNTIME_BUILDS.includes(m.project.runtimeBuildId))
    throw new Error(
      `This backup requires runtime ${m.project.runtimeBuildId}. Keep the original file for a compatible version.`,
    );
  const p = m.project.provisioning;
  if (
    typeof p.seedSql !== 'string' ||
    p.seedSql.length > 1e6 ||
    typeof p.templateStamp !== 'string' ||
    !Array.isArray(p.services) ||
    p.services.length !== 4 ||
    new Set(p.services).size !== 4 ||
    !['postgrest', 'auth', 'storage', 'realtime'].every((s) => p.services.includes(s as never))
  )
    throw new Error('Invalid provisioning configuration.');
  if (
    !m.credentials ||
    typeof m.credentials.jwtSecret !== 'string' ||
    m.credentials.jwtSecret.length < 32 ||
    m.credentials.jwtSecret.length > 1024 ||
    typeof m.credentials.postgresPassword !== 'string' ||
    !m.credentials.postgresPassword ||
    m.credentials.postgresPassword.length > 1024 ||
    /[\0\r\n]/.test(m.credentials.postgresPassword)
  )
    throw new Error('The backup is missing valid project credentials.');
  if (!Array.isArray(m.files) || !m.files.length || m.files.length > 100_000)
    throw new Error('Invalid backup file inventory.');
  const names = new Set<string>();
  let total = 0;
  for (const f of m.files) {
    if (
      !f ||
      !validPath(f.path) ||
      names.has(f.path) ||
      !Number.isSafeInteger(f.size) ||
      f.size < 0 ||
      f.size > MAX_FILE ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      throw new Error('Invalid, duplicate, or oversized file in backup.');
    names.add(f.path);
    total += f.size;
    for (const parent of f.path
      .split('/')
      .slice(0, -1)
      .map((_, i) =>
        f.path
          .split('/')
          .slice(0, i + 1)
          .join('/'),
      ))
      if (names.has(parent)) throw new Error('Conflicting backup paths.');
  }
  for (const path of names)
    for (const other of path
      .split('/')
      .slice(0, -1)
      .map((_, i) =>
        path
          .split('/')
          .slice(0, i + 1)
          .join('/'),
      ))
      if (names.has(other)) throw new Error('Conflicting backup paths.');
  if (total > MAX_TOTAL) throw new Error('This backup exceeds the 1 GB phase 1 limit.');
  if (m.mode === 'clean' && !names.has('ready'))
    throw new Error('The backup has no database completion marker.');
  return m;
}
export async function exportProject(
  project: Project,
  credentials: Credentials,
  sink?: WritableStream<Uint8Array>,
): Promise<Blob | null> {
  const dir = await findStore(project.storeName);
  if (!dir) throw new Error('There are no project files to export.');
  const files = await directoryFiles(dir);
  const total = files.reduce((n, f) => n + f.file.size, 0);
  if (total > MAX_TOTAL || files.some((f) => f.file.size > MAX_FILE))
    throw new Error('Phase 1 backups support up to 1 GB total and 128 MB per file.');
  if (!sink && total > 256 * 1024 * 1024)
    throw new Error(
      'This backup needs the streaming save-file picker. Use desktop Chrome or Edge.',
    );
  const entries: Entry[] = [];
  for (const { path, file } of files)
    entries.push({ path, size: file.size, sha256: await digest(await file.arrayBuffer()) });
  const metadata: BackupManifest = {
    format: 1,
    mode: (await hasMarker(project.storeName)) ? 'clean' : 'recovery',
    project,
    credentials,
    files: entries,
  };
  const header = encoder.encode(JSON.stringify(metadata));
  if (header.length > MAX_HEADER) throw new Error('Backup inventory is too large.');
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, header.length);
  const parts: BlobPart[] = [];
  const writer = sink?.getWriter();
  const write = async (chunk: Uint8Array) => {
    if (writer) await writer.write(chunk);
    else parts.push(new Uint8Array(chunk));
  };
  try {
    await write(MAGIC);
    await write(length);
    await write(header);
    for (const { file } of files) {
      const reader = file.stream().getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await write(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    if (writer) {
      await writer.close();
      return null;
    }
    return new Blob(parts, { type: 'application/octet-stream' });
  } catch (e) {
    await writer?.abort(e).catch(() => undefined);
    throw e;
  } finally {
    writer?.releaseLock();
  }
}
export async function importProject(
  file: File,
  progress: (stage: string) => void,
): Promise<string> {
  const prefix = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer());
  if (prefix.length !== MAGIC.length + 4 || !MAGIC.every((b, i) => prefix[i] === b))
    throw new Error('Choose a Supaworld backup file.');
  const length = new DataView(prefix.buffer).getUint32(MAGIC.length);
  if (length < 2 || length > MAX_HEADER || length > file.size - MAGIC.length - 4)
    throw new Error('The backup header is invalid or truncated.');
  const start = MAGIC.length + 4 + length;
  const metadata = validateManifest(JSON.parse(await file.slice(MAGIC.length + 4, start).text()));
  if (metadata.mode !== 'clean')
    throw new Error(
      'This is a recovery archive without a complete database. Keep it for manual recovery; it will not be opened or reset automatically.',
    );
  if (file.size !== start + metadata.files.reduce((n, f) => n + f.size, 0))
    throw new Error('This backup is truncated or has unexpected trailing data.');
  const estimate = await navigator.storage.estimate();
  const needed = metadata.files.reduce((n, f) => n + f.size, 0);
  if (estimate.quota && estimate.usage && estimate.quota - estimate.usage < needed * 1.2)
    throw new Error('There is not enough browser storage to restore this backup.');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const project: Project = {
    ...metadata.project,
    id,
    name: validateName(`${metadata.project.name.slice(0, 68)} (restored)`),
    storeName: storeName(id),
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null,
    revision: 0,
    lifecycle: 'importing',
    operationId: crypto.randomUUID(),
    lastError: null,
    provisioning: { ...metadata.project.provisioning, credentialRef: id },
  };
  await repo.insertProject(project, { ...metadata.credentials, id });
  return withOperation(id, () =>
    withStore(project.storeName, async () => {
      try {
        const dir = await (
          await storeRoot()
        ).getDirectoryHandle(project.storeName, { create: true });
        let at = start;
        for (const entry of metadata.files) {
          progress(`Restoring files (${Math.round(((at - start) / Math.max(needed, 1)) * 100)}%)`);
          const blob = file.slice(at, at + entry.size);
          at += entry.size;
          if ((await digest(await blob.arrayBuffer())) !== entry.sha256)
            throw new Error('A backup file failed its checksum. The new restore was discarded.');
          const path = entry.path.split('/');
          const name = path.pop()!;
          let parent = dir;
          for (const part of path) parent = await parent.getDirectoryHandle(part, { create: true });
          const writable = await (
            await parent.getFileHandle(name, { create: true })
          ).createWritable();
          try {
            await writable.write(blob);
            await writable.close();
          } catch (e) {
            await writable.abort().catch(() => undefined);
            throw e;
          }
        }
        if (!(await hasMarker(project.storeName)))
          throw new Error('The restored database completion marker is invalid.');
        // Opening with the original configuration is verified by the manager before exposing data.
        return id;
      } catch (error) {
        await removeStore(project.storeName);
        await repo.forgetProject(id);
        throw error;
      }
    }),
  );
}
