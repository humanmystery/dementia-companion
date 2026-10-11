import "server-only";
import type { Person, Photo } from "./types";

export type FactPerson = { name: string; relationship: string; deceased: boolean; personNotes: string[] };

export type FactPack = {
  photoId: string;
  note?: string;
  tags: string[];
  people: FactPerson[];
  unknownFaces: number;
  timeOfDay?: string;
  year?: number;
  takenAt?: string;
  place?: { label: string; kind: "saved" | "town" };
  /** Yesterday and glasses photos were taken by the person, so they were there even though they're not in the frame. */
  takenByThem: boolean;
};

export function timeOfDay(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "at night";
  if (h < 12) return "in the morning";
  if (h < 14) return "around lunchtime";
  if (h < 18) return "in the afternoon";
  return "in the evening";
}

export function buildFactPack(photo: Photo, people: Person[], opts: { includeYear: boolean }): FactPack {
  const byId = new Map(people.map((p) => [p.id, p]));
  const matched: FactPerson[] = [];
  let unknownFaces = 0;
  for (const m of photo.faceMatches ?? []) {
    const p = m.personId ? byId.get(m.personId) : undefined;
    if (p) {
      matched.push({
        name: p.nickname || p.name,
        relationship: p.relationship,
        deceased: p.deceased,
        personNotes: p.notes ?? [],
      });
    } else {
      unknownFaces++;
    }
  }

  const pack: FactPack = {
    photoId: photo.id,
    note: photo.note?.trim() || undefined,
    tags: photo.tags ?? [],
    people: matched,
    unknownFaces,
    takenByThem: photo.source !== "album" || !!photo.movedFrom,
  };

  // Scanned prints carry the scan date, not the photo date, so their metadata is ignored.
  if (photo.digitalOrScanned === "digital") {
    if (photo.exif?.takenAt) {
      const d = new Date(photo.exif.takenAt);
      pack.takenAt = photo.exif.takenAt;
      pack.timeOfDay = timeOfDay(d);
      if (opts.includeYear) pack.year = d.getFullYear();
    }
    if (photo.placeLabel && photo.placeKind) pack.place = { label: photo.placeLabel, kind: photo.placeKind };
  }
  return pack;
}

/** Facts as ranked text for the prompt. Higher rank wins when two facts disagree. */
export function renderFacts(pack: FactPack, label = "PHOTO"): string {
  const lines: string[] = [`${label} (id ${pack.photoId})`];
  lines.push(
    `1. CARER NOTE (highest truth for who/where/what): ${pack.note ? `"${pack.note}"` : "none"}`,
  );
  if (pack.tags.length) lines.push(`   tags: ${pack.tags.join(", ")}`);
  if (pack.takenByThem) {
    lines.push(
      '   TAKEN BY THE PERSON YOU ARE TALKING TO: they were there, just behind the camera. Tell it as their own moment ("you were with Bee at the park"), not as a report about other people.',
    );
  }
  if (pack.people.length) {
    lines.push("2. PEOPLE RECOGNISED IN THE PHOTO (confirmed by face matching):");
    for (const p of pack.people) {
      lines.push(
        `   - ${p.name}, ${p.relationship}${p.deceased ? " (has passed away: past tense, gentle)" : ""}${
          p.personNotes.length ? `. Carer notes: ${p.personNotes.join("; ")}` : ""
        }`,
      );
    }
  } else {
    lines.push("2. PEOPLE RECOGNISED IN THE PHOTO: none");
  }
  if (pack.unknownFaces) {
    lines.push(
      `   - ${pack.unknownFaces} other face(s) not recognised: refer to them only as "someone with you", never guess a name.`,
    );
  }
  const meta: string[] = [];
  if (pack.timeOfDay) meta.push(`time of day: ${pack.timeOfDay}`);
  if (pack.year) meta.push(`year: ${pack.year}`);
  if (pack.place) meta.push(pack.place.kind === "saved" ? `place: ${pack.place.label}` : `town/area: ${pack.place.label}`);
  lines.push(`3. PHOTO METADATA: ${meta.length ? meta.join("; ") : "none"}`);
  lines.push(
    "4. WHAT YOU SEE IN THE IMAGE: visual detail only (setting, objects, expressions). It may never add a person, name, place or event.",
  );
  return lines.join("\n");
}

export function allowedNames(packs: FactPack[]): string[] {
  const names = new Set<string>();
  for (const pack of packs) for (const p of pack.people) names.add(p.name);
  return [...names];
}

export function deceasedNames(packs: FactPack[]): string[] {
  const names = new Set<string>();
  for (const pack of packs) for (const p of pack.people) if (p.deceased) names.add(p.name);
  return [...names];
}
