import { md5Hex } from './md5';

// Browser stand-in for expo-file-system's File. Pickers hand out blob: URLs; the shims that
// create them register the bytes here so size and md5 stay synchronous like on native.
type Entry = { bytes: Uint8Array; md5?: string };
const registry = new Map<string, Entry>();

export function registerBlobFile(uri: string, bytes: Uint8Array) {
  registry.set(uri, { bytes });
}

export async function registerBlob(blob: Blob) {
  const uri = URL.createObjectURL(blob);
  registerBlobFile(uri, new Uint8Array(await blob.arrayBuffer()));
  return uri;
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export class File {
  readonly uri: string;
  constructor(uri: string) {
    this.uri = uri;
  }
  private get entry() {
    const entry = registry.get(this.uri);
    if (!entry) throw new Error('This file is no longer available. Please choose it again.');
    return entry;
  }
  get exists() {
    return registry.has(this.uri);
  }
  get name() {
    return this.uri.split('/').pop() ?? '';
  }
  get size() {
    return this.entry.bytes.length;
  }
  get md5() {
    const entry = this.entry;
    entry.md5 ??= md5Hex(entry.bytes);
    return entry.md5;
  }
  async arrayBuffer() {
    const { bytes } = this.entry;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
  async bytes() {
    return this.entry.bytes;
  }
  async base64() {
    return toBase64(this.entry.bytes);
  }
  delete() {
    registry.delete(this.uri);
    URL.revokeObjectURL(this.uri);
  }
}

export class Directory {
  readonly exists = false;
  list(): (File | Directory)[] {
    return [];
  }
}

export const Paths = { cache: '', document: '' };
