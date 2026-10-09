import type { FaceBox, FaceMatch, Person } from "./types";

export const MATCH_THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD || 0.5);

function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

export type DetectedFace = { descriptor: number[]; box: FaceBox };

/**
 * Match detected faces against the enrolled set only. Each enrolled person is assigned to at most
 * one face (closest wins). Anything above the threshold stays unknown (personId null).
 */
export function matchFaces(faces: DetectedFace[], people: Person[]): FaceMatch[] {
  const enrolled = people.filter((p) => p.confirmed && p.descriptors?.length);
  const candidates: { face: number; personId: string; distance: number }[] = [];
  faces.forEach((f, i) => {
    for (const p of enrolled) {
      const d = Math.min(...p.descriptors.map((ref) => euclidean(f.descriptor, ref)));
      if (d < MATCH_THRESHOLD) candidates.push({ face: i, personId: p.id, distance: d });
    }
  });
  candidates.sort((a, b) => a.distance - b.distance);

  const result: FaceMatch[] = faces.map((f) => ({ personId: null, box: f.box, distance: 1 }));
  const usedPeople = new Set<string>();
  const usedFaces = new Set<number>();
  for (const c of candidates) {
    if (usedPeople.has(c.personId) || usedFaces.has(c.face)) continue;
    result[c.face] = { personId: c.personId, box: faces[c.face].box, distance: c.distance };
    usedPeople.add(c.personId);
    usedFaces.add(c.face);
  }
  return result;
}
