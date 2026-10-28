import { createHash } from "node:crypto";
import { v5 as uuidv5 } from "uuid";

const CHUNK_NAMESPACE = "8c1b0e3a-6d4f-4a1e-9c3b-2f7a6e5d4c3b";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableChunkId(material: string): string {
  return uuidv5(material, CHUNK_NAMESPACE);
}
