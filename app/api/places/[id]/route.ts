import { carerDenied } from "@/lib/carerAuth";
import { db } from "@/lib/db";
import { relabelAllPhotos } from "@/lib/photos";

export async function DELETE(req: Request, ctx: RouteContext<"/api/places/[id]">) {
  const denied = carerDenied(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  await db.remove("places", id);
  await relabelAllPhotos();
  return Response.json({ ok: true });
}
