// Adapted from GrokExporter commit 85922d6.
import { assertSafeRelativePath } from "./paths";

export interface ArchiveFileSystem {
  writeTextAtomic(path: string, content: string): Promise<void>;
  writeBytesAtomic(path: string, content: Uint8Array): Promise<void>;
  readText(path: string): Promise<string | undefined>;
  readBytes(path: string): Promise<Uint8Array | undefined>;
  exists(path: string): Promise<boolean>;
}

export class DirectoryArchiveFileSystem implements ArchiveFileSystem {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  async writeTextAtomic(path: string, content: string): Promise<void> {
    await this.writeBytesAtomic(path, new TextEncoder().encode(content));
  }

  async writeBytesAtomic(path: string, content: Uint8Array): Promise<void> {
    const { directory, name } = await this.resolveParent(path, true);
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable({ keepExistingData: false });
    try {
      const copy = new Uint8Array(content.byteLength);
      copy.set(content);
      await writable.write(copy);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }

  async readText(path: string): Promise<string | undefined> {
    const bytes = await this.readBytes(path);
    return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
  }

  async readBytes(path: string): Promise<Uint8Array | undefined> {
    try {
      const { directory, name } = await this.resolveParent(path, false);
      const handle = await directory.getFileHandle(name);
      return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return undefined;
      throw error;
    }
  }

  async exists(path: string): Promise<boolean> {
    return (await this.readBytes(path)) !== undefined;
  }

  private async resolveParent(path: string, create: boolean): Promise<{ directory: FileSystemDirectoryHandle; name: string }> {
    assertSafeRelativePath(path);
    const parts = path.replaceAll("\\", "/").split("/");
    const name = parts.pop();
    if (!name) throw new Error(`Path has no filename: ${path}`);
    let directory = this.root;
    for (const segment of parts) directory = await directory.getDirectoryHandle(segment, { create });
    return { directory, name };
  }
}

export class MemoryArchiveFileSystem implements ArchiveFileSystem {
  private readonly files = new Map<string, Uint8Array>();

  async writeTextAtomic(path: string, content: string): Promise<void> {
    await this.writeBytesAtomic(path, new TextEncoder().encode(content));
  }
  async writeBytesAtomic(path: string, content: Uint8Array): Promise<void> {
    assertSafeRelativePath(path);
    this.files.set(path, new Uint8Array(content));
  }
  async readText(path: string): Promise<string | undefined> {
    const bytes = await this.readBytes(path);
    return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
  }
  async readBytes(path: string): Promise<Uint8Array | undefined> {
    assertSafeRelativePath(path);
    const value = this.files.get(path);
    return value === undefined ? undefined : new Uint8Array(value);
  }
  async exists(path: string): Promise<boolean> {
    assertSafeRelativePath(path);
    return this.files.has(path);
  }
  paths(): string[] {
    return [...this.files.keys()].sort();
  }
}
