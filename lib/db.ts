import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { adminApp } from "./firebaseAdmin";

export type Collection =
  | "people"
  | "places"
  | "photos"
  | "tasks"
  | "schedule"
  | "phrases"
  | "reminderEvents"
  | "pushTokens"
  | "faceCooldowns"
  | "config";

type Doc = { id: string } & Record<string, unknown>;

interface Backend {
  list(col: Collection): Promise<Doc[]>;
  get(col: Collection, id: string): Promise<Doc | null>;
  set(col: Collection, id: string, data: Doc): Promise<void>;
  remove(col: Collection, id: string): Promise<void>;
  putBlob(p: string, data: Buffer, contentType: string): Promise<void>;
  getBlob(p: string): Promise<{ data: Buffer; contentType: string } | null>;
  removeBlob(p: string): Promise<void>;
}

const DATA_DIR = path.join(process.cwd(), ".data");

class LocalBackend implements Backend {
  private async readCol(col: Collection): Promise<Record<string, Doc>> {
    try {
      return JSON.parse(await fs.readFile(path.join(DATA_DIR, `${col}.json`), "utf8"));
    } catch {
      return {};
    }
  }
  private async writeCol(col: Collection, data: Record<string, Doc>) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(path.join(DATA_DIR, `${col}.json`), JSON.stringify(data, null, 2));
  }
  async list(col: Collection) {
    return Object.values(await this.readCol(col));
  }
  async get(col: Collection, id: string) {
    return (await this.readCol(col))[id] ?? null;
  }
  async set(col: Collection, id: string, data: Doc) {
    const all = await this.readCol(col);
    all[id] = data;
    await this.writeCol(col, all);
  }
  async remove(col: Collection, id: string) {
    const all = await this.readCol(col);
    delete all[id];
    await this.writeCol(col, all);
  }
  async putBlob(p: string, data: Buffer, contentType: string) {
    const file = path.join(DATA_DIR, "blobs", p);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
    await fs.writeFile(`${file}.type`, contentType);
  }
  async getBlob(p: string) {
    const file = path.join(DATA_DIR, "blobs", p);
    try {
      const [data, contentType] = await Promise.all([
        fs.readFile(file),
        fs.readFile(`${file}.type`, "utf8").catch(() => "image/jpeg"),
      ]);
      return { data, contentType };
    } catch {
      return null;
    }
  }
  async removeBlob(p: string) {
    const file = path.join(DATA_DIR, "blobs", p);
    await fs.rm(file, { force: true });
    await fs.rm(`${file}.type`, { force: true });
  }
}

class FirestoreBackend implements Backend {
  private async admin() {
    const app = await adminApp();
    const { getFirestore } = await import("firebase-admin/firestore");
    const { getStorage } = await import("firebase-admin/storage");
    return { fs: getFirestore(app), bucket: getStorage(app).bucket() };
  }
  async list(col: Collection) {
    const { fs } = await this.admin();
    const snap = await fs.collection(col).get();
    return snap.docs.map((d) => ({ ...(d.data() as Doc), id: d.id }));
  }
  async get(col: Collection, id: string) {
    const { fs } = await this.admin();
    const d = await fs.collection(col).doc(id).get();
    return d.exists ? ({ ...(d.data() as Doc), id: d.id }) : null;
  }
  async set(col: Collection, id: string, data: Doc) {
    const { fs } = await this.admin();
    await fs.collection(col).doc(id).set(JSON.parse(JSON.stringify(data)));
  }
  async remove(col: Collection, id: string) {
    const { fs } = await this.admin();
    await fs.collection(col).doc(id).delete();
  }
  async putBlob(p: string, data: Buffer, contentType: string) {
    const { bucket } = await this.admin();
    await bucket.file(p).save(data, { contentType, resumable: false });
  }
  async getBlob(p: string) {
    const { bucket } = await this.admin();
    const file = bucket.file(p);
    try {
      const [[data], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
      return { data, contentType: meta.contentType ?? "image/jpeg" };
    } catch {
      return null;
    }
  }
  async removeBlob(p: string) {
    const { bucket } = await this.admin();
    await bucket.file(p).delete({ ignoreNotFound: true });
  }
}

const backend: Backend =
  process.env.DATA_BACKEND === "firestore" ? new FirestoreBackend() : new LocalBackend();

export const db = {
  async list<T>(col: Collection): Promise<T[]> {
    return (await backend.list(col)) as T[];
  },
  async get<T>(col: Collection, id: string): Promise<T | null> {
    return (await backend.get(col, id)) as T | null;
  },
  async set<T extends { id: string }>(col: Collection, data: T): Promise<T> {
    await backend.set(col, data.id, data as unknown as Doc);
    return data;
  },
  async update<T extends { id: string }>(col: Collection, id: string, patch: Partial<T>): Promise<T | null> {
    const existing = await backend.get(col, id);
    if (!existing) return null;
    const next = { ...existing, ...patch, id } as Doc;
    await backend.set(col, id, next);
    return next as unknown as T;
  },
  remove: (col: Collection, id: string) => backend.remove(col, id),
  putBlob: (p: string, data: Buffer, contentType: string) => backend.putBlob(p, data, contentType),
  getBlob: (p: string) => backend.getBlob(p),
  removeBlob: (p: string) => backend.removeBlob(p),
};

export const newId = () => randomUUID().slice(0, 12);
