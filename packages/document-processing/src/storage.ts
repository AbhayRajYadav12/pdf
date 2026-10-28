import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";

export interface ObjectStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  open(key: string): Promise<Readable>;
}

export class LocalObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async open(key: string): Promise<Readable> {
    return createReadStream(this.resolve(key));
  }

  private resolve(key: string): string {
    if (!key || key.includes("..") || path.isAbsolute(key)) {
      throw new Error("Invalid storage key");
    }
    const root = path.resolve(this.root);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep) && full !== root) {
      throw new Error("Invalid storage key");
    }
    return full;
  }
}
