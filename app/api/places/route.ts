import { carerDenied, errorResponse } from "@/lib/carerAuth";
import { db, newId } from "@/lib/db";
import { relabelAllPhotos } from "@/lib/photos";
import type { Place } from "@/lib/types";

export async function GET() {
  return Response.json(await db.list<Place>("places"));
}

export async function POST(req: Request) {
  const denied = carerDenied(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Partial<Place>;
    if (!body.name?.trim() || typeof body.lat !== "number" || typeof body.lng !== "number") {
      return Response.json({ error: "Name, latitude and longitude are required" }, { status: 400 });
    }
    const place: Place = {
      id: newId(),
      name: body.name.trim(),
      lat: body.lat,
      lng: body.lng,
      radiusM: Math.max(20, Number(body.radiusM) || 150),
    };
    await db.set("places", place);
    await relabelAllPhotos();
    return Response.json(place);
  } catch (e) {
    return errorResponse(e);
  }
}
