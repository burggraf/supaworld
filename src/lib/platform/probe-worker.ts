const scope = globalThis as unknown as { postMessage(data: unknown): void };
try {
  const wasm = WebAssembly as typeof WebAssembly & {
    Tag?: new (options: { parameters: string[] }) => unknown;
  };
  if (!wasm.Tag) throw new Error('No exceptions');
  new wasm.Tag({ parameters: [] });
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  scope.postMessage(Atomics.wait(buffer, 0, 1, 0) === 'not-equal');
} catch {
  scope.postMessage(false);
}
