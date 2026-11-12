export async function withOperation<T>(id: string, fn: () => Promise<T>): Promise<T> {
  return navigator.locks.request(
    `supaworld/project/${id}/operation`,
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error(
          'This project is busy in another tab. Try again when its operation finishes.',
        );
      return fn();
    },
  );
}
export async function withStore<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return navigator.locks.request(
    `supa-wasm/${name}`,
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      if (!lock) throw new Error('This project is open in another tab. Stop it there first.');
      return fn();
    },
  );
}
export async function storeRoot() {
  return (await navigator.storage.getDirectory()).getDirectoryHandle('supa-wasm', { create: true });
}
export async function findStore(name: string) {
  try {
    return await (await storeRoot()).getDirectoryHandle(name);
  } catch (error) {
    if ((error as DOMException).name === 'NotFoundError') return null;
    throw error;
  }
}
export async function hasMarker(name: string) {
  const dir = await findStore(name);
  if (!dir) return false;
  try {
    const text = await (await (await dir.getFileHandle('ready')).getFile()).text();
    return /^[^\0\n]+\n$/.test(text);
  } catch (error) {
    if ((error as DOMException).name === 'NotFoundError') return false;
    throw error;
  }
}
export async function removeStore(name: string) {
  if (!/^supaworld-[0-9a-f-]{36}$/.test(name))
    throw new Error('Refusing to remove an unknown store.');
  for (let i = 0; i < 30; i++) {
    try {
      await (await storeRoot()).removeEntry(name, { recursive: true });
      return;
    } catch (error) {
      if ((error as DOMException).name === 'NotFoundError') return;
      if ((error as DOMException).name !== 'NoModificationAllowedError' || i === 29) throw error;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
export async function directoryFiles(
  dir: FileSystemDirectoryHandle,
  prefix = '',
): Promise<Array<{ path: string; file: File }>> {
  const result: Array<{ path: string; file: File }> = [];
  for await (const [name, entry] of (
    dir as FileSystemDirectoryHandle & {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    }
  ).entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === 'file')
      result.push({ path, file: await (entry as FileSystemFileHandle).getFile() });
    else result.push(...(await directoryFiles(entry as FileSystemDirectoryHandle, path)));
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
