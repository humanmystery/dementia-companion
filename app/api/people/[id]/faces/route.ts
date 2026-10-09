import { carerDenied, errorResponse } from "@/lib/carerAuth";
import { db } from "@/lib/db";
import { relabelAllPhotos } from "@/lib/photos";
import type { Person } from "@/lib/types";

/** Add one reference photo plus the face descriptor computed in the carer's browser. */
export async function POST(req: Request, ctx: RouteContext<"/api/people/[id]/faces">) {
  const denied = carerDenied(req);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const person = await db.get<Person>("people", id);
    if (!person) return Response.json({ error: "Not found" }, { status: 404 });

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const descriptor = JSON.parse(String(form.get("descriptor") ?? "null")) as number[] | null;
    if (!file || !descriptor || descriptor.length !== 128) {
      return Response.json({ error: "A photo with exactly one clear face is needed" }, { status: 400 });
    }
    const path = `people/${id}/${Date.now()}.jpg`;
    await db.putBlob(path, Buffer.from(await file.arrayBuffer()), file.type || "image/jpeg");
    const updated = await db.update<Person>("people", id, {
      descriptors: [...(person.descriptors ?? []), descriptor],
      refPhotoPaths: [...(person.refPhotoPaths ?? []), path],
    });
    await relabelAllPhotos();
    return Response.json({ ok: true, descriptorCount: updated?.descriptors.length ?? 0 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(_req: Request, ctx: RouteContext<"/api/people/[id]/faces">) {
  const { id } = await ctx.params;
  const url = new URL(_req.url);
  const index = Number(url.searchParams.get("i") ?? 0);
  const person = await db.get<Person>("people", id);
  const path = person?.refPhotoPaths?.[index];
  const blob = path ? await db.getBlob(path) : null;
  if (!blob) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(blob.data), {
    headers: { "Content-Type": blob.contentType, "Cache-Control": "private, max-age=3600" },
  });
}
