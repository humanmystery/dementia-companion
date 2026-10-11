import "server-only";
import { dayKey, now } from "./config";
import { recapDayForUpload } from "./dayPhotos";
import { db, newId } from "./db";
import { matchFaces, type DetectedFace } from "./faceMatch";
import { resolvePlace } from "./geo";
import type { Person, Photo, PhotoSource, Place } from "./types";

async function readExif(data: Buffer): Promise<Photo["exif"]> {
  try {
    const exifr = (await import("exifr")).default;
    const out = await exifr.parse(data, { gps: true, pick: ["DateTimeOriginal", "CreateDate", "latitude", "longitude"] });
    if (!out) return {};
    const taken: Date | undefined = out.DateTimeOriginal ?? out.CreateDate;
    return {
      takenAt: taken instanceof Date && !isNaN(taken.getTime()) ? taken.toISOString() : undefined,
      lat: typeof out.latitude === "number" ? out.latitude : undefined,
      lng: typeof out.longitude === "number" ? out.longitude : undefined,
    };
  } catch {
    return {};
  }
}

export async function ingestPhoto(input: {
  data: Buffer;
  contentType: string;
  source: PhotoSource;
  digitalOrScanned?: "digital" | "scanned";
  note?: string;
  tags?: string[];
  faces: DetectedFace[];
  takenAtOverride?: string;
  latOverride?: number;
  lngOverride?: number;
}): Promise<Photo> {
  const id = newId();
  const ext = input.contentType.includes("png") ? "png" : "jpg";
  const path = `photos/${input.source}/${id}.${ext}`;
  await db.putBlob(path, input.data, input.contentType);

  const exif = await readExif(input.data);
  if (input.takenAtOverride) exif.takenAt = input.takenAtOverride;
  if (input.latOverride != null && input.lngOverride != null) {
    exif.lat = input.latOverride;
    exif.lng = input.lngOverride;
  }
  const current = await now();
  if (input.source === "capture" || (!exif.takenAt && input.source === "yesterday")) {
    exif.takenAt = input.takenAtOverride ?? current.toISOString();
  }

  const [people, places] = await Promise.all([db.list<Person>("people"), db.list<Place>("places")]);
  const place = await resolvePlace(exif.lat, exif.lng, places);

  const photo: Photo = {
    id,
    path,
    contentType: input.contentType,
    source: input.source,
    digitalOrScanned: input.digitalOrScanned ?? "digital",
    exif,
    placeLabel: place?.label,
    placeKind: place?.kind,
    faceMatches: matchFaces(input.faces, people),
    faces: input.faces,
    note: input.note?.trim() || undefined,
    tags: input.tags ?? [],
    uploadedAt: new Date().toISOString(),
    ...(input.source === "yesterday" ? { recapDay: recapDayForUpload(exif.takenAt, dayKey(current)) } : {}),
  };
  return db.set("photos", photo);
}

/** Re-run matching and place resolution, e.g. after a new person or place is enrolled. */
export async function relabelAllPhotos(): Promise<number> {
  const [photos, people, places] = await Promise.all([
    db.list<Photo>("photos"),
    db.list<Person>("people"),
    db.list<Place>("places"),
  ]);
  for (const photo of photos) {
    const place = await resolvePlace(photo.exif?.lat, photo.exif?.lng, places);
    await db.set<Photo>("photos", {
      ...photo,
      faceMatches: matchFaces(photo.faces ?? [], people),
      placeLabel: place?.label,
      placeKind: place?.kind,
    });
  }
  return photos.length;
}