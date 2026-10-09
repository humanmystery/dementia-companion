import { carerDenied, errorResponse } from "@/lib/carerAuth";
import { db } from "@/lib/db";
import { resolvePlace } from "@/lib/geo";
import { toView } from "@/lib/photoView";
import type { Person, Photo, PhotoSource, Place } from "@/lib/types";

export async function PATCH(req: Request, ctx: RouteContext<"/api/photos/[id]">) {
  const denied = carerDenied(req);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as Partial<Photo>;
    const patch: Partial<Photo> = {};
    if (body.note !== undefined) patch.note = body.note.trim() || undefined;
    if (body.tags !== undefined) patch.tags = body.tags;
    if (body.source !== undefined) patch.source = body.source as PhotoSource;
    if (body.digitalOrScanned !== undefined) patch.digitalOrScanned = body.digitalOrScanned;
    const existing = await db.get<Photo>("photos", id);
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
    if (body.exif !== undefined) {
      patch.exif = { ...existing.exif, ...body.exif };
      if (patch.exif.takenAt) patch.exif.takenAt = new Date(patch.exif.takenAt).toISOString();
      const place = await resolvePlace(patch.exif.lat, patch.exif.lng, await db.list<Place>("places"));
      patch.placeLabel = place?.label;
      patch.placeKind = place?.kind;
    }
    const photo = await db.update<Photo>("photos", id, patch);
    if (!photo) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(toView(photo, await db.list<Person>("people")));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/photos/[id]">) {
  const denied = carerDenied(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const photo = await db.get<Photo>("photos", id);
  if (photo) {
    await db.removeBlob(photo.path);
    await db.remove("photos", id);
  }
  return Response.json({ ok: true });
}
