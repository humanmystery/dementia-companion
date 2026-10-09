"use client";

import { useCallback, useState } from "react";
import { api, carerKey, setCarerKey } from "@/lib/client/api";
import { useOnMount } from "@/lib/client/hooks";
import { toLocalInput } from "@/lib/client/time";
import { Button, Card, Field, Input } from "../ui";

export default function DemoTab() {
  const [key, setKey] = useState("");
  const [clock, setClock] = useState("");
  const [nowIso, setNowIso] = useState("");
  const [fake, setFake] = useState(false);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setKey(carerKey());
    const s = await api<{ now: string; fakeClock?: string | null }>("/api/settings");
    setNowIso(s.now);
    setFake(!!s.fakeClock);
    setClock(toLocalInput(s.now));
  }, []);
  useOnMount(load);

  async function setDemoClock(iso: string | null) {
    const s = await api<{ now: string; fakeClock?: string | null }>("/api/settings", {
      method: "PUT",
      json: { fakeClockIso: iso },
    });
    setNowIso(s.now);
    setFake(!!s.fakeClock);
    setStatus(iso ? "Demo clock set. The morning recap can play again." : "Back to the real clock.");
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setStatus(`${label}...`);
    try {
      await fn();
      setStatus(`${label}: done.`);
    } catch (e) {
      setStatus(`${label}: ${(e as Error).message}`);
    }
  }

  const morning = () => {
    const d = new Date();
    d.setHours(8, 0, 0, 0);
    return d.toISOString();
  };

  return (
    <div className="grid gap-6">
      <Card>
        <h2 className="mb-3 text-xl font-bold">Demo clock</h2>
        <p className="mb-3 text-sm opacity-70">
          Companion time is now <strong>{nowIso ? new Date(nowIso).toLocaleString() : "..."}</strong>
          {fake ? " (demo clock)" : " (real clock)"}. The morning recap plays once per day, on the first use after 7:00.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Set companion time">
            <Input type="datetime-local" value={clock} onChange={(e) => setClock(e.target.value)} />
          </Field>
          <Button onClick={() => setDemoClock(new Date(clock).toISOString())}>Set</Button>
          <Button variant="ghost" onClick={() => setDemoClock(morning())}>
            Make it 8:00 this morning
          </Button>
          <Button variant="ghost" onClick={() => setDemoClock(null)}>
            Use real clock
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-xl font-bold">Demo data</h2>
        <p className="mb-3 text-sm opacity-70">
          Loads a sample profile, the three practice tasks (ironing, rice, towels), an appointment with Dr. Chan in an
          hour, and approved photo invitations. Add people and photos yourself on the other tabs.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => run("Loading demo setup", () => api("/api/admin/seed", { method: "POST", json: {} }))}>
            Load demo setup
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              confirm("Delete all people, photos, places, tasks and settings?") &&
              run("Resetting", () => api("/api/admin/seed", { method: "POST", json: { reset: true, seed: false } }))
            }
          >
            Reset everything
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-xl font-bold">Carer passcode</h2>
        <div className="flex items-end gap-2">
          <Field label="Passcode for this browser" hint="Only needed if CARER_PASSCODE is set on the server">
            <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          <Button
            onClick={() => {
              setCarerKey(key);
              setStatus("Passcode saved in this browser.");
            }}
          >
            Save
          </Button>
        </div>
      </Card>

      {status && <p className="text-sm opacity-75">{status}</p>}
    </div>
  );
}
