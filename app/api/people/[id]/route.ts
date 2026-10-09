import { carerDenied, errorResponse } from "@/lib/carerAuth";
import { db } from "@/lib/db";
import { relabelAllPhotos } from "@/lib/photos";
import type { Person } from "@/lib/types";

export async function PATCH(req: Request, ctx: RouteContext<"/api/people/[id]">) {
  const denied = carerDenied(req);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as Partial<Person>;
    const patch: Partial<Person> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.nickname !== undefined) patch.nickname = body.nickname.trim() || undefined;
    if (body.relationship !== undefined) patch.relationship = body.relationship.trim();
    if (body.deceased !== undefined) patch.deceased = !!body.deceased;
    if (body.notes !== undefined) patch.notes = body.notes.map((n) => n.trim()).filter(Boolean);
    if (body.confirmed !== undefined) patch.confirmed = !!body.confirmed;
    const person = await db.update<Person>("people", id, patch);
    if (!person) return Response.json({ error: "Not found" }, { status: 404 });
    if (body.confirmed !== undefined) await relabelAllPhotos();
    return Response.json(person);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/people/[id]">) {
  const denied = carerDenied(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const person = await db.get<Person>("people", id);
  if (person) {
    await Promise.all(person.refPhotoPaths.map((p) => db.removeBlob(p)));
    await db.remove("people", id);
    await relabelAllPhotos();
  }
  return Response.json({ ok: true });
}
