import { carerDenied, errorResponse } from "@/lib/carerAuth";
import { db } from "@/lib/db";
import { toView } from "@/lib/photoView";
import { ingestPhoto } from "@/lib/photos";
import type { Person, Photo, PhotoSource } from "@/lib/types";

export async function GET(req: Request) {
  const source = new URL(req.url).searchParams.get("source") as PhotoSource | null;
  const [photos, people] = await Promise.all([db.list<Photo>("photos"), db.list<Person>("people")]);
  const filtered = source ? photos.filter((p) => p.source === source) : photos;
  filtered.sort((a, b) => (a.exif?.takenAt ?? a.uploadedAt).localeCompare(b.exif?.takenAt ?? b.uploadedAt));
  return Response.json(filtered.map((p) => toView(p, people)));
}

/**
 * Upload one photo. Faces are detected in the browser (face-api.js) and sent as descriptors;
 * matching against the enrolled set happens here.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const source = (String(form.get("source") ?? "capture") as PhotoSource) || "capture";
    // The person's own capture path is open; carer uploads to the album or yesterday need the passcode.
    if (source !== "capture") {
      const denied = carerDenied(req);
      if (denied) return denied;
    }
    const file = form.get("file") as File | null;
    if (!file) return Response.json({ error: "No photo" }, { status: 400 });
    const faces = JSON.parse(String(form.get("faces") ?? "[]"));
    const tags = String(form.get("tags") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const lat = form.get("lat") ? Number(form.get("lat")) : undefined;
    const lng = form.get("lng") ? Number(form.get("lng")) : undefined;
    const photo = await ingestPhoto({
      data: Buffer.from(await file.arrayBuffer()),
      contentType: file.type || "image/jpeg",
      source,
      digitalOrScanned: form.get("digitalOrScanned") === "scanned" ? "scanned" : "digital",
      note: String(form.get("note") ?? ""),
      tags,
      faces,
      takenAtOverride: form.get("takenAt") ? new Date(String(form.get("takenAt"))).toISOString() : undefined,
      latOverride: lat,
      lngOverride: lng,
    });
    const people = await db.list<Person>("people");
    return Response.json(toView(photo, people));
  } catch (e) {
    return errorResponse(e);
  }
}
