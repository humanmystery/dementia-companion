import "server-only";
import { dayKey, now } from "./config";
import { db } from "./db";
import type { Photo } from "./types";

export function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return dayKey(d);
}

/** A photo uploaded as "yesterday" is told in the recap the day after it was taken, but never before the upload day. */
export function recapDayForUpload(takenAt: string | undefined, today: string): string {
  const fromTaken = takenAt ? nextDay(dayKey(new Date(takenAt))) : today;
  return fromTaken > today ? fromTaken : today;
}

export function recapDayOf(photo: Photo): string | null {
  if (photo.source !== "yesterday" && photo.source !== "capture") return null;
  if (photo.recapDay) return photo.recapDay;
  if (photo.exif?.takenAt) return nextDay(dayKey(new Date(photo.exif.takenAt)));
  return dayKey(new Date(photo.uploadedAt));
}

const worthKeeping = (p: Photo) => !!p.talkedAbout || (p.faceMatches ?? []).some((m) => m.personId);

/**
 * After a photo's recap day has passed: photos with recognised people or that they talked about join the old
 * album; other "yesterday" photos are filed away (never deleted). Glasses photos that don't qualify stay where they are.
 */
export async function moveOnDayPhotos(): Promise<{ toAlbum: number; filed: number }> {
  const today = dayKey(await now());
  const photos = await db.list<Photo>("photos");
  let toAlbum = 0;
  let filed = 0;
  for (const photo of photos) {
    const day = recapDayOf(photo);
    if (!day || day >= today || photo.movedOnAt) continue;
    const movedOnAt = new Date().toISOString();
    if (worthKeeping(photo)) {
      await db.update<Photo>("photos", photo.id, { source: "album", movedFrom: photo.source, movedOnAt });
      toAlbum++;
    } else if (photo.source === "yesterday") {
      await db.update<Photo>("photos", photo.id, { source: "archived", movedFrom: photo.source, movedOnAt });
      filed++;
    } else {
      await db.update<Photo>("photos", photo.id, { movedOnAt });
    }
  }
  return { toAlbum, filed };
}

export async function markTalkedAbout(photoId: string) {
  const photo = await db.get<Photo>("photos", photoId);
  if (photo && !photo.talkedAbout) await db.update<Photo>("photos", photoId, { talkedAbout: true });
}
