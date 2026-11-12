import { openDB, type DBSchema } from 'idb';
import type { Project, Credentials } from './model';
interface Catalog extends DBSchema {
  projects: { key: string; value: Project };
  credentials: { key: string; value: Credentials };
  drafts: { key: string; value: { id: string; sql: string } };
  preferences: { key: string; value: unknown };
}
let connection: ReturnType<typeof openDB<Catalog>> | undefined;
function database() {
  return (connection ??= openDB<Catalog>('supaworld', 1, {
    upgrade(db) {
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('credentials', { keyPath: 'id' });
      db.createObjectStore('drafts', { keyPath: 'id' });
      db.createObjectStore('preferences');
    },
    blocking() {
      void connection?.then((db) => db.close());
      connection = undefined;
    },
    terminated() {
      connection = undefined;
    },
  }));
}
export async function listProjects() {
  return (await (await database()).getAll('projects')).sort(
    (a, b) => Date.parse(b.lastOpenedAt ?? b.createdAt) - Date.parse(a.lastOpenedAt ?? a.createdAt),
  );
}
export async function getProject(id: string) {
  const project = await (await database()).get('projects', id);
  if (!project) throw new Error('This project no longer exists.');
  return project;
}
export async function getCredentials(id: string) {
  const value = await (await database()).get('credentials', id);
  if (!value)
    throw new Error('Project credentials are missing. Restore a backup to recover this project.');
  return value;
}
export async function insertProject(project: Project, credentials: Credentials) {
  const db = await database();
  const tx = db.transaction(['projects', 'credentials'], 'readwrite');
  await Promise.all([
    tx.objectStore('projects').add(project),
    tx.objectStore('credentials').add(credentials),
  ]);
  await tx.done;
}
export async function updateProject(id: string, changes: Partial<Project>) {
  const db = await database();
  const tx = db.transaction('projects', 'readwrite');
  const old = await tx.store.get(id);
  if (!old) throw new Error('This project no longer exists.');
  const next = {
    ...old,
    ...changes,
    id: old.id,
    storeName: old.storeName,
    revision: old.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  await tx.store.put(next);
  await tx.done;
  return next;
}
export async function forgetProject(id: string) {
  const db = await database();
  const tx = db.transaction(['projects', 'credentials', 'drafts'], 'readwrite');
  await Promise.all([
    tx.objectStore('projects').delete(id),
    tx.objectStore('credentials').delete(id),
    tx.objectStore('drafts').delete(id),
  ]);
  await tx.done;
}
export async function saveDraft(id: string, sql: string) {
  await (await database()).put('drafts', { id, sql });
}
export async function loadDraft(id: string) {
  return (
    (await (await database()).get('drafts', id))?.sql ??
    '-- Make something of your own.\nSELECT now() AS hello_world, version();'
  );
}
export async function setPreference(key: string, value: unknown) {
  await (await database()).put('preferences', value, key);
}
export async function getPreference<T>(key: string) {
  return (await (await database()).get('preferences', key)) as T | undefined;
}
