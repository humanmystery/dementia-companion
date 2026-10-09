import type { Person, Photo } from "./types";

export type PhotoView = Omit<Photo, "faces"> & {
  url: string;
  people: { id: string; name: string; relationship: string; deceased: boolean }[];
  unknownFaces: number;
};

export function toView(photo: Photo, people: Person[]): PhotoView {
  const byId = new Map(people.map((p) => [p.id, p]));
  const rest: Omit<Photo, "faces"> & { faces?: unknown } = { ...photo };
  delete rest.faces;
  const matched = (photo.faceMatches ?? []).map((m) => (m.personId ? byId.get(m.personId) : undefined));
  return {
    ...rest,
    url: `/api/photos/${photo.id}/image`,
    people: matched
      .filter((p): p is Person => !!p)
      .map((p) => ({ id: p.id, name: p.nickname || p.name, relationship: p.relationship, deceased: p.deceased })),
    unknownFaces: matched.filter((p) => !p).length,
  };
}
