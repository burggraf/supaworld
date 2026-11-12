import { describe, it, expect } from 'vitest';
import { validateManifest, validPath, MAX_FILE } from '../../src/lib/storage/backups';
import { RUNTIME_BUILD } from '../../src/lib/runtime/config';
const base = () => ({
  format: 1,
  mode: 'clean',
  project: {
    name: 'Test',
    runtimeBuildId: RUNTIME_BUILD,
    provisioningVersion: 1,
    provisioning: {
      seedSql: '',
      templateStamp: 'x',
      services: ['postgrest', 'auth', 'storage', 'realtime'],
    },
  },
  credentials: { jwtSecret: 'a'.repeat(64), postgresPassword: 'b'.repeat(64) },
  files: [
    { path: 'ready', size: 2, sha256: '0'.repeat(64) },
    { path: 'pg/manifest.0', size: 2, sha256: '1'.repeat(64) },
  ],
});
describe('physical backup validation', () => {
  it('accepts a bounded, complete inventory', () =>
    expect(validateManifest(base()).files).toHaveLength(2));
  it('accepts the previous URL-only host build without changing provisioning inputs', () => {
    const value = base();
    value.project.runtimeBuildId = 'b4397a9a-urls-v1';
    expect(validateManifest(value).project.runtimeBuildId).toBe('b4397a9a-urls-v1');
  });
  it.each([
    '../x',
    'pg/../../x',
    '/root/file',
    'pg\\file',
    'pg//file',
    'pg/./file',
    'C:/file',
    'pg/\0file',
  ])('rejects unsafe path %s', (path) => {
    const value = base();
    value.files[1]!.path = path;
    expect(() => validateManifest(value)).toThrow();
    expect(validPath(path)).toBe(false);
  });
  it('rejects duplicate entries, conflicting parent files, oversized files, missing markers and unsupported runtimes', () => {
    let value = base();
    value.files.push({ ...value.files[0]! });
    expect(() => validateManifest(value)).toThrow(/duplicate/);
    value = base();
    value.files.push({ path: 'pg', size: 2, sha256: '2'.repeat(64) });
    expect(() => validateManifest(value)).toThrow(/Conflicting/);
    value = base();
    value.files[1]!.size = MAX_FILE + 1;
    expect(() => validateManifest(value)).toThrow(/oversized/);
    value = base();
    value.files.shift();
    expect(() => validateManifest(value)).toThrow(/marker/);
    value = base();
    value.project.runtimeBuildId = 'unknown';
    expect(() => validateManifest(value)).toThrow(/requires runtime/);
  });
  it('does not accept missing credentials or incomplete service configuration', () => {
    let value = base();
    value.credentials.jwtSecret = '';
    expect(() => validateManifest(value)).toThrow(/credentials/);
    value = base();
    value.project.provisioning.services.pop();
    expect(() => validateManifest(value)).toThrow(/configuration/);
  });
});
