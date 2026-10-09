"use client";

import { useCallback, useEffect, useState } from "react";
import { api, carerKey } from "@/lib/client/api";
import { useOnMount } from "@/lib/client/hooks";
import { detectFaces, loadFaceApi } from "@/lib/client/faces";
import { canvasToBlob, fileToImage, resizeToCanvas } from "@/lib/client/images";
import type { Person } from "@/lib/types";
import { Badge, Button, Card, Field, Input, TextArea } from "../ui";

type PersonRow = Omit<Person, "descriptors"> & { descriptorCount: number };

export default function PeopleTab() {
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [form, setForm] = useState({ name: "", nickname: "", relationship: "", notes: "", deceased: false });
  const [error, setError] = useState("");

  const reload = useCallback(async () => setPeople(await api<PersonRow[]>("/api/people")), []);
  useOnMount(reload);
  useEffect(() => void loadFaceApi(), []);

  async function add() {
    setError("");
    try {
      await api("/api/people", {
        method: "POST",
        json: { ...form, notes: form.notes.split("\n"), confirmed: false },
      });
      setForm({ name: "", nickname: "", relationship: "", notes: "", deceased: false });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <h2 className="mb-1 text-xl font-bold">Add a familiar person</h2>
        <p className="mb-4 text-sm opacity-70">
          Only people you add and confirm here are ever named. Anyone else stays &ldquo;someone with you&rdquo;.
          Please make sure each person is happy to be enrolled.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mei" />
          </Field>
          <Field label="What they call them" hint="Optional nickname">
            <Input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
          </Field>
          <Field label="Relationship" hint='e.g. "daughter", "friend from school"'>
            <Input
              value={form.relationship}
              onChange={(e) => setForm({ ...form, relationship: e.target.value })}
              placeholder="daughter"
            />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Confirmed notes (optional, one per line)" hint="Short facts you're sure of, e.g. 'You went to high school together.'">
            <TextArea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 self-center text-sm">
            <input
              type="checkbox"
              checked={form.deceased}
              onChange={(e) => setForm({ ...form, deceased: e.target.checked })}
            />
            Has passed away
          </label>
        </div>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <Button className="mt-4" onClick={add} disabled={!form.name || !form.relationship}>
          Add person
        </Button>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {people.map((p) => (
          <PersonCard key={p.id} person={p} onChange={reload} />
        ))}
      </div>
    </div>
  );
}

function PersonCard({ person, onChange }: { person: PersonRow; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [notes, setNotes] = useState(person.notes.join("\n"));

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const problems: string[] = [];
    for (const [i, file] of [...files].entries()) {
      setBusy(`Reading face ${i + 1} of ${files.length}...`);
      const img = await fileToImage(file);
      const canvas = await resizeToCanvas(img, 1024);
      const faces = await detectFaces(canvas);
      if (faces.length !== 1) {
        problems.push(`${file.name}: found ${faces.length} faces (need exactly one)`);
        continue;
      }
      const fd = new FormData();
      fd.append("file", await canvasToBlob(canvas), "face.jpg");
      fd.append("descriptor", JSON.stringify(faces[0].descriptor));
      const res = await fetch(`/api/people/${person.id}/faces`, {
        method: "POST",
        body: fd,
        headers: { "x-carer-key": carerKey() },
      });
      if (!res.ok) problems.push(`${file.name}: upload failed`);
    }
    setBusy(problems.length ? problems.join(" · ") : "");
    await onChange();
  }

  async function patch(body: Partial<Person>) {
    await api(`/api/people/${person.id}`, { method: "PATCH", json: body });
    await onChange();
  }

  return (
    <Card>
      <div className="flex gap-4">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-accent-soft">
          {person.refPhotoPaths.length > 0 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/people/${person.id}/faces?i=0`} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold">{person.nickname || person.name}</span>
            {person.nickname && <span className="text-sm opacity-60">({person.name})</span>}
            {person.confirmed ? <Badge tone="good">Confirmed</Badge> : <Badge tone="warn">Not confirmed</Badge>}
            {person.deceased && <Badge>Passed away</Badge>}
          </div>
          <div className="opacity-75">{person.relationship}</div>
          <div className="mt-1 text-xs opacity-60">
            {person.descriptorCount} reference photo{person.descriptorCount === 1 ? "" : "s"}
            {person.descriptorCount < 3 && " · add 3-5 for reliable matching"}
          </div>
        </div>
      </div>
      <TextArea
        className="mt-3 w-full"
        rows={2}
        value={notes}
        placeholder="Confirmed notes, one per line"
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== person.notes.join("\n") && patch({ notes: notes.split("\n") })}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-xl bg-white/70 px-4 py-2 text-sm font-semibold ring-1 ring-black/10 hover:bg-white">
          Add face photos
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
        </label>
        <Button variant={person.confirmed ? "ghost" : "primary"} onClick={() => patch({ confirmed: !person.confirmed })}>
          {person.confirmed ? "Unconfirm" : "Confirm name & relationship"}
        </Button>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={person.deceased} onChange={(e) => patch({ deceased: e.target.checked })} />
          Passed away
        </label>
        <Button
          variant="danger"
          onClick={async () => {
            if (confirm(`Remove ${person.name} and their face data?`)) {
              await api(`/api/people/${person.id}`, { method: "DELETE" });
              await onChange();
            }
          }}
        >
          Remove
        </Button>
      </div>
      {busy && <p className="mt-2 text-sm opacity-75">{busy}</p>}
    </Card>
  );
}
