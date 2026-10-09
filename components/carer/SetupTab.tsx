"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/client/api";
import { useOnMount } from "@/lib/client/hooks";
import { toLocalInput } from "@/lib/client/time";
import type { Profile, ScheduleItem, Task } from "@/lib/types";
import { Badge, Button, Card, Field, Input, TextArea } from "../ui";

export default function SetupTab() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const [p, t, s] = await Promise.all([
      api<Profile>("/api/profile"),
      api<Task[]>("/api/tasks"),
      api<ScheduleItem[]>("/api/schedule"),
    ]);
    setProfile(p);
    setTasks(t.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    setSchedule(s.sort((a, b) => a.time.localeCompare(b.time)));
  }, []);
  useOnMount(reload);

  if (!profile) return null;

  async function draft() {
    setDrafting(true);
    setError("");
    try {
      await api("/api/setup/draft", { method: "POST", json: profile });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  }

  const listField = (key: "regularActivities" | "attentionEvents") => (
    <TextArea
      rows={3}
      value={profile[key].join("\n")}
      onChange={(e) => setProfile({ ...profile, [key]: e.target.value.split("\n") })}
    />
  );

  return (
    <div className="grid gap-6">
      <Card>
        <h2 className="mb-1 text-xl font-bold">A few questions</h2>
        <p className="mb-4 text-sm opacity-70">
          The companion drafts daily tasks and a schedule from your answers. Nothing is used until you confirm it.
        </p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Their name">
            <Input value={profile.name ?? ""} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          </Field>
          <Field label="Gender">
            <Input value={profile.gender ?? ""} onChange={(e) => setProfile({ ...profile, gender: e.target.value })} />
          </Field>
          <Field label="Age">
            <Input
              type="number"
              value={profile.age ?? ""}
              onChange={(e) => setProfile({ ...profile, age: Number(e.target.value) || undefined })}
            />
          </Field>
          <Field label="Stage">
            <select
              className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
              value={profile.stage ?? "early"}
              onChange={(e) => setProfile({ ...profile, stage: e.target.value as Profile["stage"] })}
            >
              <option value="early">Early: they tap for help</option>
              <option value="mid">Mid: movement can trigger help</option>
            </select>
          </Field>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr]">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={!!profile.livingAlone}
              onChange={(e) => setProfile({ ...profile, livingAlone: e.target.checked })}
            />
            Lives alone
          </label>
          <Input
            placeholder="If yes, tell us a little (e.g. daughter visits most evenings)"
            value={profile.livingDetails ?? ""}
            onChange={(e) => setProfile({ ...profile, livingDetails: e.target.value })}
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Regular activities to put on the schedule" hint="One per line">
            {listField("regularActivities")}
          </Field>
          <Field label="Specific events that need extra attention" hint="One per line">
            {listField("attentionEvents")}
          </Field>
        </div>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <div className="mt-4 flex gap-2">
          <Button onClick={draft} disabled={drafting}>
            {drafting ? "Drafting..." : "Draft tasks and schedule with Gemini"}
          </Button>
          <Button variant="ghost" onClick={() => api("/api/profile", { method: "PUT", json: profile })}>
            Save answers only
          </Button>
        </div>
      </Card>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xl font-bold">Daily tasks</h2>
          <Button
            variant="ghost"
            onClick={async () => {
              await api("/api/tasks", { method: "POST", json: { name: "New task", steps: [], confirmed: false } });
              await reload();
            }}
          >
            Add task
          </Button>
        </div>
        <p className="mb-3 text-sm opacity-70">
          When they ask for help, the companion repeats your steps word for word. It never makes up its own.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} onChange={reload} />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xl font-bold">Schedule</h2>
          <Button
            variant="ghost"
            onClick={async () => {
              const t = new Date(Date.now() + 3600_000);
              t.setMinutes(0);
              await api("/api/schedule", {
                method: "POST",
                json: { title: "New event", time: toLocalInput(t), confirmed: false },
              });
              await reload();
            }}
          >
            Add event
          </Button>
        </div>
        <div className="grid gap-3">
          {schedule.map((s) => (
            <ScheduleRow key={s.id} item={s} onChange={reload} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskCard({ task, onChange }: { task: Task; onChange: () => Promise<void> }) {
  const [draft, setDraft] = useState({ name: task.name, sceneHints: task.sceneHints, steps: task.steps.join("\n") });
  const save = async (confirmed = task.confirmed) => {
    await api(`/api/tasks/${task.id}`, {
      method: "PATCH",
      json: { name: draft.name, sceneHints: draft.sceneHints, steps: draft.steps.split("\n"), confirmed },
    });
    await onChange();
  };
  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <Input className="flex-1 font-semibold" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        {task.confirmed ? <Badge tone="good">Confirmed</Badge> : <Badge tone="warn">Draft</Badge>}
      </div>
      <Field label="What the camera would see">
        <TextArea rows={2} value={draft.sceneHints} onChange={(e) => setDraft({ ...draft, sceneHints: e.target.value })} />
      </Field>
      <div className="mt-2">
        <Field label="Steps, in order (one per line)">
          <TextArea rows={4} value={draft.steps} onChange={(e) => setDraft({ ...draft, steps: e.target.value })} />
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => save(true)}>{task.confirmed ? "Save" : "Confirm"}</Button>
        {task.confirmed && (
          <Button variant="ghost" onClick={() => save(false)}>
            Unconfirm
          </Button>
        )}
        <Button
          variant="danger"
          onClick={async () => {
            await api(`/api/tasks/${task.id}`, { method: "DELETE" });
            await onChange();
          }}
        >
          Delete
        </Button>
      </div>
    </Card>
  );
}

function ScheduleRow({ item, onChange }: { item: ScheduleItem; onChange: () => Promise<void> }) {
  const [draft, setDraft] = useState({ title: item.title, time: item.time, carerWording: item.carerWording ?? "" });
  const save = async (confirmed = item.confirmed) => {
    await api(`/api/schedule/${item.id}`, { method: "PATCH", json: { ...draft, confirmed } });
    await onChange();
  };
  return (
    <Card className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1.4fr_auto]">
      <Field label="Event">
        <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      </Field>
      <Field label="When">
        <Input type="datetime-local" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
      </Field>
      <Field label="Your words (spoken as-is)">
        <Input
          value={draft.carerWording}
          placeholder="You have an appointment with Dr. Chan soon"
          onChange={(e) => setDraft({ ...draft, carerWording: e.target.value })}
        />
      </Field>
      <div className="flex items-center gap-2">
        {item.confirmed ? <Badge tone="good">Confirmed</Badge> : <Badge tone="warn">Draft</Badge>}
        <Button onClick={() => save(true)}>{item.confirmed ? "Save" : "Confirm"}</Button>
        <Button
          variant="danger"
          onClick={async () => {
            await api(`/api/schedule/${item.id}`, { method: "DELETE" });
            await onChange();
          }}
        >
          ✕
        </Button>
      </div>
    </Card>
  );
}
