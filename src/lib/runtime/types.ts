export interface WireConnection {
  read(maxBytes: number): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
export type ServiceName = 'postgrest' | 'auth' | 'storage' | 'realtime';
export interface GateState {
  phase: string;
  generation: number;
  passes: number;
  lost?: { at: number; log: string };
}
export interface RuntimeStack {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  jwtSecret: string;
  postgresPassword: string;
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
  ready: Promise<void>;
  timings: {
    provisioned: boolean | null;
    totalMs: number | null;
    kernelBootMs: number | null;
    loadMs: number | null;
    provisionMs: number | null;
    migrationsMs: Record<string, number | null>;
  };
  gates(): Record<string, GateState>;
  kernel(): { state: string; failure: { message: string } | null; retired: number; wakes: number };
  connect(port: number, signal?: AbortSignal): Promise<WireConnection>;
  stop(): Promise<{ left: string[]; trapped: string[]; ms: number }>;
}
export interface RuntimeApi {
  stack: {
    start(options: {
      persist: string;
      jwtSecret: string;
      postgresPassword: string;
      url: string;
      siteUrl: string;
      services: ServiceName[];
      seedSql: string;
      artifacts: Record<string, string>;
      waitForReady: boolean;
      serviceIdleMs?: number;
      dbIdleMs?: number;
    }): Promise<RuntimeStack>;
  };
  terminate(): Promise<void>;
}
declare global {
  interface Window {
    supa?: RuntimeApi;
  }
}
export interface RuntimeManifest {
  buildId: string;
  commit: string;
  templateStamp: string;
  files: Array<{ name: string; size: number; sha256: string }>;
}
