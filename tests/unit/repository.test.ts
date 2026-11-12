import 'fake-indexeddb/auto';
import { it, expect } from 'vitest';
import * as repo from '../../src/lib/projects/repository';
import { secret, storeName, validateName, type Project } from '../../src/lib/projects/model';
import { quoteIdentifier } from '../../src/lib/runtime/pgwire';
it('commits credentials with the project and serializes concurrent metadata updates', async () => {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const project: Project = {
    id,
    name: 'Original',
    storeName: storeName(id),
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null,
    runtimeBuildId: 'test',
    provisioningVersion: 1,
    provisioning: {
      services: ['auth', 'postgrest', 'storage', 'realtime'],
      seedSql: '',
      templateStamp: 'x',
      credentialRef: id,
    },
    lifecycle: 'creating',
    operationId: null,
    revision: 0,
    lastError: null,
  };
  const credentials = { id, jwtSecret: secret(), postgresPassword: secret() };
  await repo.insertProject(project, credentials);
  await Promise.all([
    repo.updateProject(id, { name: 'Renamed' }),
    repo.updateProject(id, { lifecycle: 'ready' }),
  ]);
  const updated = await repo.getProject(id);
  expect(updated.name).toBe('Renamed');
  expect(updated.lifecycle).toBe('ready');
  expect(updated.revision).toBe(2);
  expect(updated.storeName).toBe(project.storeName);
  expect(await repo.getCredentials(id)).toEqual(credentials);
  await repo.saveDraft(id, 'select 42');
  await repo.forgetProject(id);
  await expect(repo.getCredentials(id)).rejects.toThrow(/missing/);
  await expect(repo.getProject(id)).rejects.toThrow(/no longer/);
});
it('validates names and immutable store identifiers', () => {
  expect(validateName(' hello ')).toBe('hello');
  expect(() => validateName(' ')).toThrow();
  expect(() => validateName('a'.repeat(81))).toThrow();
  expect(() => storeName('../data')).toThrow();
});
it('quotes unusual table identifiers without creating SQL', () =>
  expect(quoteIdentifier('a";DROP TABLE t;--')).toBe('"a"";DROP TABLE t;--"'));
