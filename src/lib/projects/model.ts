import type { ServiceName } from '../runtime/types';
export interface Project {
  id: string;
  name: string;
  storeName: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  runtimeBuildId: string;
  provisioningVersion: 1;
  provisioning: {
    services: ServiceName[];
    seedSql: string;
    templateStamp: string;
    credentialRef: string;
  };
  lifecycle: 'creating' | 'ready' | 'importing' | 'deleting' | 'error';
  operationId: string | null;
  revision: number;
  lastError: { code: string; message: string } | null;
}
export interface Credentials {
  id: string;
  jwtSecret: string;
  postgresPassword: string;
}
export const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
export function validateName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80)
    throw new Error('Choose a project name between 1 and 80 characters.');
  return trimmed;
}
export function storeName(id: string) {
  if (!validId(id)) throw new Error('Invalid project ID.');
  return `supaworld-${id}`;
}
export function secret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
