"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/client/api";
import { useOnMount } from "@/lib/client/hooks";
import type { ReminderPhrase, Settings } from "@/lib/types";
import { Badge, Button, Card, Field, Input } from "../ui";

export default function RemindersTab() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [phrases, setPhrases] = useState<ReminderPhrase[]>([]);
  const [custom, setCustom] = useState("");
  const [status, setStatus] = useState("");

  const reload = useCallback(async () => {
    const [s, p] = await Promise.all([api<Settings>("/api/settings"), api<ReminderPhrase[]>("/api/reminders/phrases")]);
    setSettings(s);
    setPhrases(p.sort((a, b) => Number(b.approved) - Number(a.approved) || a.createdAt.localeCompare(b.createdAt)));
  }, []);
  useOnMount(reload);

  if (!settings) return null;

  async function saveSettings() {
    await api("/api/settings", { method: "PUT", json: settings });
    setStatus("Saved.");
  }

  return (
    <div className="grid gap-6">
      <Card>
        <h2 className="mb-1 text-xl font-bold">Gentle photo invitations</h2>
        <p className="mb-4 text-sm opacity-70">
          About every two hours in their active day, the phone (later the glasses) asks if they&rsquo;d like to keep a
          photo. They can always say no or ignore it, and it never asks again straight away.
        </p>
        <div className="grid gap-3 sm:grid-cols-5">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={settings.remindersEnabled}
              onChange={(e) => setSettings({ ...settings, remindersEnabled: e.target.checked })}
            />
            Enabled
          </label>
          <Field label="Active from">
            <Input
              type="time"
              value={settings.activeHours.start}
              onChange={(e) => setSettings({ ...settings, activeHours: { ...settings.activeHours, start: e.target.value } })}
            />
          </Field>
          <Field label="Until">
            <Input
              type="time"
              value={settings.activeHours.end}
              onChange={(e) => setSettings({ ...settings, activeHours: { ...settings.activeHours, end: e.target.value } })}
            />
          </Field>
          <Field label="Every (minutes)" hint={`± ${settings.jitterMin} min so it never feels like an alarm`}>
            <Input
              type="number"
              value={settings.intervalMin}
              onChange={(e) => setSettings({ ...settings, intervalMin: Number(e.target.value) })}
            />
          </Field>
          <Field label="At most per day">
            <Input
              type="number"
              value={settings.maxPerDay}
              onChange={(e) => setSettings({ ...settings, maxPerDay: Number(e.target.value) })}
            />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button onClick={saveSettings}>Save</Button>
          <Button
            variant="ghost"
            onClick={async () => {
              const r = await api<{ fired: { text: string } | null }>("/api/reminders/tick", {
                method: "POST",
                json: { force: true },
              });
              setStatus(r.fired ? `Sent: "${r.fired.text}"` : "Nothing sent.");
            }}
          >
            Send one now (demo)
          </Button>
          {status && <span className="text-sm opacity-70">{status}</span>}
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">What it says</h2>
            <p className="text-sm opacity-70">Only approved lines are used. Gemini can suggest new ones for you to check.</p>
          </div>
          <Button
            variant="ghost"
            onClick={async () => {
              setStatus("Asking Gemini...");
              try {
                await api("/api/reminders/phrases", { method: "POST", json: { draft: true } });
                setStatus("");
              } catch (e) {
                setStatus((e as Error).message);
              }
              await reload();
            }}
          >
            Suggest more with Gemini
          </Button>
        </div>
        <div className="grid gap-2">
          {phrases.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2 ring-1 ring-black/5">
              <span className="flex-1">&ldquo;{p.text}&rdquo;</span>
              {p.slot && p.slot !== "any" && <Badge>{p.slot}</Badge>}
              <Button
                variant={p.approved ? "ghost" : "primary"}
                onClick={async () => {
                  await api(`/api/reminders/phrases/${p.id}`, { method: "PATCH", json: { approved: !p.approved } });
                  await reload();
                }}
              >
                {p.approved ? "Approved ✓" : "Approve"}
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  await api(`/api/reminders/phrases/${p.id}`, { method: "DELETE" });
                  await reload();
                }}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Input className="flex-1" placeholder="Add your own line" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button
            disabled={!custom.trim()}
            onClick={async () => {
              await api("/api/reminders/phrases", { method: "POST", json: { text: custom, approved: true } });
              setCustom("");
              await reload();
            }}
          >
            Add
          </Button>
        </div>
      </Card>
    </div>
  );
}
