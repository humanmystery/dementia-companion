"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/client/api";
import { useOnMount } from "@/lib/client/hooks";
import type { Place } from "@/lib/types";
import { Button, Card, Field, Input } from "../ui";

export default function PlacesTab() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [form, setForm] = useState({ name: "", coords: "", radiusM: "150" });
  const [error, setError] = useState("");

  const reload = useCallback(async () => setPlaces(await api<Place[]>("/api/places")), []);
  useOnMount(reload);

  function useHere() {
    navigator.geolocation.getCurrentPosition(
      (pos) => setForm((f) => ({ ...f, coords: `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}` })),
      () => setError("Couldn't get your location. Paste coordinates from Google Maps instead."),
    );
  }

  async function add() {
    setError("");
    const [lat, lng] = form.coords.split(",").map((s) => Number(s.trim()));
    if (isNaN(lat) || isNaN(lng)) return setError("Coordinates should look like 22.2819, 114.1582");
    try {
      await api("/api/places", { method: "POST", json: { name: form.name, lat, lng, radiusM: Number(form.radiusM) } });
      setForm({ name: "", coords: "", radiusM: "150" });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <h2 className="mb-1 text-xl font-bold">Save a familiar place</h2>
        <p className="mb-4 text-sm opacity-70">
          Photos taken within the radius are called by this name (&ldquo;at home&rdquo;, &ldquo;at Sarah&rsquo;s
          house&rdquo;). Elsewhere, only the town is used, never a street or shop.
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_0.6fr]">
          <Field label="Name">
            <Input value={form.name} placeholder="Home" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Location" hint="Right-click a spot in Google Maps to copy its coordinates">
            <div className="flex gap-2">
              <Input
                className="flex-1"
                value={form.coords}
                placeholder="22.2819, 114.1582"
                onChange={(e) => setForm({ ...form, coords: e.target.value })}
              />
              <Button variant="ghost" onClick={useHere} type="button">
                Here
              </Button>
            </div>
          </Field>
          <Field label="Radius (m)">
            <Input type="number" value={form.radiusM} onChange={(e) => setForm({ ...form, radiusM: e.target.value })} />
          </Field>
        </div>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <Button className="mt-4" onClick={add} disabled={!form.name || !form.coords}>
          Save place
        </Button>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        {places.map((p) => (
          <Card key={p.id} className="flex items-center justify-between">
            <div>
              <div className="text-lg font-bold">{p.name}</div>
              <a
                className="text-sm underline opacity-70"
                target="_blank"
                href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}
                rel="noreferrer"
              >
                {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
              </a>
              <span className="text-sm opacity-60"> · {p.radiusM} m</span>
            </div>
            <Button
              variant="danger"
              onClick={async () => {
                await api(`/api/places/${p.id}`, { method: "DELETE" });
                await reload();
              }}
            >
              Remove
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
