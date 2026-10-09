import { db } from "@/lib/db";
import type { Photo } from "@/lib/types";

export async function GET(_req: Request, ctx: RouteContext<"/api/photos/[id]/image">) {
  const { id } = await ctx.params;
  const photo = await db.get<Photo>("photos", id);
  const blob = photo ? await db.getBlob(photo.path) : null;
  if (!blob) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(blob.data), {
    headers: { "Content-Type": blob.contentType, "Cache-Control": "private, max-age=86400" },
  });
}
