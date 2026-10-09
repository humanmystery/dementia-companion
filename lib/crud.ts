import "server-only";
import { carerDenied, errorResponse } from "./carerAuth";
import { db, newId, type Collection } from "./db";

/** List/create/update/delete handlers for simple carer-owned collections. */
export function crudHandlers<T extends { id: string }>(
  col: Collection,
  normalize: (body: Partial<T>, existing?: T) => Omit<T, "id">,
) {
  return {
    async list() {
      return Response.json(await db.list<T>(col));
    },
    async create(req: Request) {
      const denied = carerDenied(req);
      if (denied) return denied;
      try {
        const item = { ...normalize((await req.json()) as Partial<T>), id: newId() } as T;
        return Response.json(await db.set(col, item));
      } catch (e) {
        return errorResponse(e, 400);
      }
    },
    async update(req: Request, id: string) {
      const denied = carerDenied(req);
      if (denied) return denied;
      try {
        const existing = await db.get<T>(col, id);
        if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
        const item = { ...normalize({ ...existing, ...((await req.json()) as Partial<T>) }, existing), id } as T;
        return Response.json(await db.set(col, item));
      } catch (e) {
        return errorResponse(e, 400);
      }
    },
    async remove(req: Request, id: string) {
      const denied = carerDenied(req);
      if (denied) return denied;
      await db.remove(col, id);
      return Response.json({ ok: true });
    },
  };
}
