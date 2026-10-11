"use client";

import { useCallback, useEffect, useState } from "react";
import { api, carerKey } from "@/lib/client/api";
import { useOnMount } from "@/lib/client/hooks";
import { detectFaces, loadFaceApi } from "@/lib/client/faces";
import { canvasToBlob, fileToImage, resizeToCanvas } from "@/lib/client/images";
import { toLocalInput } from "@/lib/client/time";
import type { PhotoView } from "@/lib/photoView";
import type { PhotoSource, Place } from "@/lib/types";
import { Badge, Button, Card, Field, Input, TextArea } from "../ui";

type Source = PhotoSource;

async function readExifInBrowser(file: File) {
  try {
    const exifr = (await import("exifr")).default;
    const out = await exifr.parse(file, { gps: true, pick: ["DateTimeOriginal", "CreateDate", "latitude", "longitude"] });
    const taken: Date | undefined = out?.DateTimeOriginal ?? out?.CreateDate;
    return {
      takenAt: taken instanceof Date && !isNaN(taken.getTime()) ? taken.toISOString() : undefined,
      lat: typeof out?.latitude === "number" ? out.latitude : undefined,
      lng: typeof out?.longitude === "number" ? out.longitude : undefined,
    };
  } catch {
    return {};
  }
}

export default function PhotosTab() {
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [filter, setFilter] = useState<Source>("album");
  const [upload, setUpload] = useState({ source: "album" as Source, kind: "digital", note: "" });
  const [progress, setProgress] = useState("");

  const reload = useCallback(async () => {
    const [ph, pl] = await Promise.all([api<PhotoView[]>("/api/photos"), api<Place[]>("/api/places")]);
    setPhotos(ph);
    setPlaces(pl);
  }, []);
  useOnMount(reload);
  useEffect(() => void loadFaceApi(), []);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    let done = 0;
    for (const file of [...files]) {
      setProgress(`Adding ${done + 1} of ${files.length}: looking for familiar faces...`);
      const exif = await readExifInBrowser(file);
      const canvas = await resizeToCanvas(await fileToImage(file), 1600);
      const faces = await detectFaces(canvas);
      const fd = new FormData();
      fd.append("file", await canvasToBlob(canvas), file.name.replace(/\.\w+$/, ".jpg"));
      fd.append("source", upload.source);
      fd.append("digitalOrScanned", upload.kind);
      fd.append("note", upload.note);
      fd.append("faces", JSON.stringify(faces));
      if (exif.takenAt) fd.append("takenAt", exif.takenAt);
      if (exif.lat != null && exif.lng != null) {
        fd.append("lat", String(exif.lat));
        fd.append("lng", String(exif.lng));
      }
      await fetch("/api/photos", { method: "POST", body: fd, headers: { "x-carer-key": carerKey() } });
      done++;
    }
    setProgress(`Added ${done} photo${done === 1 ? "" : "s"}.`);
    setFilter(upload.source);
    await reload();
  }

  const shown = photos.filter((p) => p.source === filter);

  return (
    <div className="grid gap-6">
      <Card>
        <h2 className="mb-1 text-xl font-bold">Add photos</h2>
        <p className="mb-4 text-sm opacity-70">
          Familiar faces are matched automatically. Dates and places come from the photo itself (digital photos only).
          A note is optional, and always wins over anything else.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Where does it go?">
            <select
              className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
              value={upload.source}
              onChange={(e) => setUpload({ ...upload, source: e.target.value as Source })}
            >
              <option value="album">Old album (for chats)</option>
              <option value="yesterday">Yesterday (for the morning recap)</option>
            </select>
          </Field>
          <Field label="Digital or scanned print?" hint="Scanned prints carry the scan date, so their date is ignored">
            <select
              className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
              value={upload.kind}
              onChange={(e) => setUpload({ ...upload, kind: e.target.value })}
            >
              <option value="digital">Digital photo</option>
              <option value="scanned">Scanned print</option>
            </select>
          </Field>
          <Field label="Note for these photos (optional)">
            <Input
              value={upload.note}
              placeholder="Tom and me at Brighton, summer holiday"
              onChange={(e) => setUpload({ ...upload, note: e.target.value })}
            />
          </Field>
        </div>
        <label className="mt-4 inline-block cursor-pointer rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white">
          Choose photos
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
        </label>
        {progress && <span className="ml-3 text-sm opacity-75">{progress}</span>}
      </Card>

      <div className="flex gap-2">
        {(["album", "yesterday", "capture", "archived"] as Source[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
              filter === s ? "bg-foreground text-background" : "bg-white/70 ring-1 ring-black/10"
            }`}
          >
            {{ album: "Old album", yesterday: "Yesterday", capture: "Taken on the glasses", archived: "Filed away" }[s]} (
            {photos.filter((p) => p.source === s).length})
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((p) => (
          <PhotoCard key={p.id} photo={p} places={places} onChange={reload} />
        ))}
        {!shown.length && <p className="opacity-60">No photos here yet.</p>}
      </div>
    </div>
  );
}

function PhotoCard({ photo, places, onChange }: { photo: PhotoView; places: Place[]; onChange: () => Promise<void> }) {
  const [note, setNote] = useState(photo.note ?? "");

  async function patch(body: Record<string, unknown>) {
    await api(`/api/photos/${photo.id}`, { method: "PATCH", json: body });
    await onChange();
  }

  return (
    <Card className="p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt="" className="aspect-[4/3] w-full rounded-xl object-cover" />
      <div className="mt-2 flex flex-wrap gap-1">
        {photo.people.map((p) => (
          <Badge key={p.id} tone="good">
            {p.name} · {p.relationship}
            {p.deceased ? " · passed away" : ""}
          </Badge>
        ))}
        {photo.unknownFaces > 0 && <Badge>{photo.unknownFaces} not recognised</Badge>}
        {photo.digitalOrScanned === "scanned" && <Badge>Scanned</Badge>}
        {photo.talkedAbout && <Badge tone="good">Talked about</Badge>}
        {photo.movedFrom && photo.source === "album" && <Badge>Joined the album from {photo.movedFrom === "capture" ? "the glasses" : "yesterday"}</Badge>}
        {photo.digitalOrScanned === "digital" && photo.placeLabel && (
          <Badge>{photo.placeKind === "saved" ? `At ${photo.placeLabel}` : `In ${photo.placeLabel}`}</Badge>
        )}
      </div>
      <TextArea
        className="mt-2 w-full"
        rows={2}
        value={note}
        placeholder="Note (who, where, what). Optional."
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== (photo.note ?? "") && patch({ note })}
      />
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer opacity-70">Date, place and more</summary>
        <div className="mt-2 grid gap-2">
          <Field label="Taken at">
            <Input
              type="datetime-local"
              defaultValue={toLocalInput(photo.exif?.takenAt)}
              onBlur={(e) => e.target.value && patch({ exif: { takenAt: new Date(e.target.value).toISOString() } })}
            />
          </Field>
          <Field label="Location">
            <select
              className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v === "clear") void patch({ exif: { lat: null, lng: null } });
                const place = places.find((p) => p.id === v);
                if (place) void patch({ exif: { lat: place.lat, lng: place.lng } });
              }}
            >
              <option value="">
                {photo.exif?.lat != null ? `${photo.exif.lat.toFixed(3)}, ${photo.exif.lng?.toFixed(3)}` : "No location"}
              </option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  Set to {p.name}
                </option>
              ))}
              <option value="clear">Clear location</option>
            </select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => patch({ digitalOrScanned: photo.digitalOrScanned === "digital" ? "scanned" : "digital" })}
            >
              Mark {photo.digitalOrScanned === "digital" ? "scanned" : "digital"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => patch({ source: photo.source === "album" ? "yesterday" : "album" })}
            >
              Move to {photo.source === "album" ? "yesterday" : "album"}
            </Button>
            {photo.source === "archived" && (
              <Button variant="ghost" onClick={() => patch({ source: "yesterday" })}>
                Move to yesterday
              </Button>
            )}
            <Button
              variant="danger"
              onClick={async () => {
                await api(`/api/photos/${photo.id}`, { method: "DELETE" });
                await onChange();
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </details>
    </Card>
  );
}
