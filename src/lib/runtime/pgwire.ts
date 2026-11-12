// Wire/SCRAM helpers adapted from supabase/supa-wasm browser/tests/pgwire.ts.
// Copyright (c) 2026 Julien Goux. MIT; see runtime/licenses/supa-wasm-LICENSE.
import type { WireConnection, RuntimeStack } from './types';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
type Bytes = Uint8Array<ArrayBuffer>;
export interface PgError {
  severity: string;
  code: string;
  message: string;
  detail: string | null;
}
function concat(parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const int32 = (n: number): Bytes => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
};

const cstring = (s: string): Bytes => concat([encoder.encode(s), Uint8Array.of(0)]);

/** A message with a type byte: type, length (which counts itself), body. */
const message = (type: string, ...body: Uint8Array[]): Bytes => {
  const payload = concat(body);
  return concat([Uint8Array.of(type.charCodeAt(0)), int32(payload.length + 4), payload]);
};

/** The nul-terminated strings of `body` from `at` on, up to the empty one that ends the list. */
function strings(body: Uint8Array, at: number): string[] {
  const out: string[] = [];
  let start = at;
  for (let i = at; i < body.length; i++) {
    if (body[i] !== 0) continue;
    if (i === start) break;
    out.push(decoder.decode(body.subarray(start, i)));
    start = i + 1;
  }
  return out;
}

function parseError(body: Uint8Array): PgError {
  const fields: Record<string, string> = {};
  let at = 0;
  while (at < body.length && body[at] !== 0) {
    const code = String.fromCharCode(body[at]!);
    let end = at + 1;
    while (end < body.length && body[end] !== 0) end++;
    fields[code] = decoder.decode(body.subarray(at + 1, end));
    at = end + 1;
  }
  return {
    severity: fields['V'] ?? fields['S'] ?? '',
    code: fields['C'] ?? '',
    message: fields['M'] ?? '',
    detail: fields['D'] ?? null,
  };
}

// --- SCRAM-SHA-256 -------------------------------------------------------------------------------

const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const unb64 = (s: string): Bytes => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Bytes> {
  const k = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new Uint8Array(data)));
}

async function sha256(data: Uint8Array): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data)));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations },
    k,
    256,
  );
  return new Uint8Array(bits);
}

/** The attributes of a SCRAM message: `r=...,s=...,i=...` as a map. */
function attributes(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of text.split(',')) out.set(part.slice(0, 1), part.slice(2));
  return out;
}

/** The two client messages of SCRAM, and the check of the server's. */
class Scram {
  private readonly nonce: string;
  private readonly bare: string;
  private serverSignature: Bytes | null = null;

  constructor(private readonly password: string) {
    this.nonce = b64(crypto.getRandomValues(new Uint8Array(18)));
    // No gs2 channel binding, and the user name is the startup message's (the server ignores `n`).
    this.bare = `n=,r=${this.nonce}`;
  }

  first(): string {
    return `n,,${this.bare}`;
  }

  /** The answer to the server's first message. */
  async final(serverFirst: string): Promise<string> {
    const a = attributes(serverFirst);
    const nonce = a.get('r') ?? '';
    if (!nonce.startsWith(this.nonce) || nonce.length <= this.nonce.length) {
      throw new Error(`the server's nonce does not extend the client's: ${serverFirst}`);
    }
    const iterations = Number(a.get('i'));
    if (!Number.isInteger(iterations) || iterations < 1)
      throw new Error(`bad iteration count: ${serverFirst}`);
    const salt = unb64(a.get('s') ?? '');
    const withoutProof = `c=biws,r=${nonce}`;
    const authMessage = encoder.encode(`${this.bare},${serverFirst},${withoutProof}`);
    const salted = await pbkdf2(this.password, salt, iterations);
    const clientKey = await hmac(salted, encoder.encode('Client Key'));
    const clientSignature = await hmac(await sha256(clientKey), authMessage);
    const proof = clientKey.map((byte, i) => byte ^ clientSignature[i]!);
    this.serverSignature = await hmac(
      await hmac(salted, encoder.encode('Server Key')),
      authMessage,
    );
    return `${withoutProof},p=${b64(proof)}`;
  }

  /** The server's last message: it must carry the signature only a server that knows the password computes. */
  verify(serverFinal: string): void {
    const a = attributes(serverFinal);
    if (a.has('e')) throw new Error(`SCRAM error from the server: ${serverFinal}`);
    const v = a.get('v');
    if (v === undefined || this.serverSignature === null || v !== b64(this.serverSignature)) {
      throw new Error(`the server's signature is wrong: ${serverFinal}`);
    }
  }
}

export interface QueryResult {
  columns: string[];
  rows: Array<Array<string | null>>;
  tags: string[];
  error: PgError | null;
  notices: string[];
  ms: number;
  truncated: boolean;
  transactionRolledBack: boolean;
}
export class PgClient {
  private buffer: Bytes = new Uint8Array(0);
  private position = 0;
  private pid = 0;
  private secret = 0;
  private dead = false;
  private constructor(
    private connection: WireConnection,
    private stack: RuntimeStack,
  ) {}

  static async open(stack: RuntimeStack): Promise<PgClient> {
    const client = new PgClient(await stack.connect(5432), stack);
    try {
      await client.within(async () => client.authenticate(stack.postgresPassword), 60_000);
      const settings = await client.query(
        "SET statement_timeout = '30s'; SET idle_in_transaction_session_timeout = '10s';",
      );
      if (settings.error) throw new Error(settings.error.message);
      return client;
    } catch (e) {
      await client.close();
      throw e;
    }
  }
  private async need(n: number) {
    while (this.buffer.length - this.position < n) {
      const bytes = await this.connection.read(65536);
      if (bytes === null) throw new Error('Database connection closed.');
      this.buffer = concat([this.buffer.subarray(this.position), bytes]);
      this.position = 0;
    }
  }
  private async frame() {
    await this.need(5);
    const type = String.fromCharCode(this.buffer[this.position]!);
    const length = new DataView(
      this.buffer.buffer,
      this.buffer.byteOffset + this.position + 1,
      4,
    ).getUint32(0);
    if (length < 4 || length > 16 * 1024 * 1024)
      throw new Error('Database response exceeds the 16 MB message limit. Use a smaller query.');
    await this.need(length + 1);
    const body = this.buffer.slice(this.position + 5, this.position + length + 1);
    this.position += length + 1;
    return { type, body };
  }
  private async within<T>(fn: () => Promise<T>, ms = 65_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.dead = true;
            void this.connection.close();
            reject(
              new Error(
                'Database operation timed out. Its write may have committed; check before retrying.',
              ),
            );
          }, ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private async authenticate(password: string) {
    const params = concat([
      cstring('user'),
      cstring('postgres'),
      cstring('database'),
      cstring('postgres'),
      cstring('application_name'),
      cstring('supaworld'),
      Uint8Array.of(0),
    ]);
    await this.connection.write(concat([int32(params.length + 8), int32(196608), params]));
    const scram = new Scram(password);
    let verified = false;
    let authenticated = false;
    for (;;) {
      const { type, body } = await this.frame();
      const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
      if (type === 'R') {
        const method = view.getUint32(0);
        if (method === 10) {
          if (!strings(body, 4).includes('SCRAM-SHA-256'))
            throw new Error('Unsupported database authentication.');
          const first = encoder.encode(scram.first());
          await this.connection.write(
            message('p', cstring('SCRAM-SHA-256'), int32(first.length), first),
          );
        } else if (method === 11)
          await this.connection.write(
            message('p', encoder.encode(await scram.final(decoder.decode(body.subarray(4))))),
          );
        else if (method === 12) {
          scram.verify(decoder.decode(body.subarray(4)));
          verified = true;
        } else if (method === 0 && verified) authenticated = true;
        else throw new Error('Database authentication failed.');
      } else if (type === 'E') throw new Error(parseError(body).message);
      else if (type === 'K') {
        this.pid = view.getUint32(0);
        this.secret = view.getUint32(4);
      } else if (type === 'Z') {
        if (!verified || !authenticated) throw new Error('Incomplete database authentication.');
        return;
      }
    }
  }
  async cancel() {
    if (!this.pid || this.dead) return;
    const conn = await this.stack.connect(5432, AbortSignal.timeout(5000));
    try {
      await conn.write(concat([int32(16), int32(80877102), int32(this.pid), int32(this.secret)]));
    } finally {
      await conn.close();
    }
  }
  async query(sql: string, signal?: AbortSignal): Promise<QueryResult> {
    if (this.dead) throw new Error('This database session is closed.');
    signal?.throwIfAborted();
    const cancel = () => {
      void this.cancel().catch(() => this.connection.close());
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      return await this.within(async () => {
        const started = performance.now();
        const result: QueryResult = {
          columns: [],
          rows: [],
          tags: [],
          error: null,
          notices: [],
          ms: 0,
          truncated: false,
          transactionRolledBack: false,
        };
        let bytes = 0;
        if (sql.includes('\0')) throw new Error('SQL cannot contain a null byte.');
        await this.connection.write(message('Q', cstring(sql)));
        for (;;) {
          const { type, body } = await this.frame();
          const view = new DataView(body.buffer, body.byteOffset, body.length);
          if (type === 'T') {
            result.columns = [];
            result.rows = [];
            bytes = 0;
            let at = 2;
            for (let i = 0; i < view.getUint16(0); i++) {
              let end = at;
              while (end < body.length && body[end] !== 0) end++;
              result.columns.push(decoder.decode(body.subarray(at, end)));
              at = end + 19;
            }
          } else if (type === 'D') {
            if (result.rows.length >= 1000 || bytes + body.length > 1024 * 1024) {
              result.truncated = true;
              continue;
            }
            const row: Array<string | null> = [];
            let at = 2;
            for (let i = 0; i < view.getUint16(0); i++) {
              const n = view.getInt32(at);
              at += 4;
              row.push(n < 0 ? null : decoder.decode(body.subarray(at, at + n)));
              if (n >= 0) at += n;
            }
            result.rows.push(row);
            bytes += body.length;
          } else if (type === 'C') result.tags.push(strings(body, 0)[0] ?? '');
          else if (type === 'E') result.error = parseError(body);
          else if (type === 'N' && result.notices.length < 20)
            result.notices.push(parseError(body).message);
          else if (['G', 'H', 'W'].includes(type))
            throw new Error(
              'COPY streaming is not supported in this SQL console. Use SELECT or INSERT instead.',
            );
          else if (type === 'Z') {
            result.ms = performance.now() - started;
            result.transactionRolledBack = body[0] !== 73;
            return result;
          }
        }
      });
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }
  async close() {
    if (!this.dead) {
      try {
        await this.connection.write(message('X'));
      } catch {
        /* already closed */
      }
    }
    this.dead = true;
    await this.connection.close();
  }
}
export function quoteIdentifier(s: string) {
  return '"' + s.replaceAll('"', '""') + '"';
}
