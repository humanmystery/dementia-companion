"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/client/api";
import { useOnMount } from "@/lib/client/hooks";
import type { LiveSession } from "@/lib/types";
import { Badge, Button, Card } from "../ui";

type SessionView = LiveSession & { photoUrl: string };

const ENDINGS: Record<string, string> = {
  done: "They tapped Done",
  silence: "Ended after a quiet spell",
  turns: "Wrapped up gently",
  live_dropped: "Connection dropped, carried on with tap-to-talk",
  frame_closed: "Frame closed",
  left: "Left the chat",
  time_limit: "Reached the time limit",
  mic_failed: "Microphone not available",
};

export default function ConversationsTab() {
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const reload = useCallback(async () => setSessions(await api<SessionView[]>("/api/live/sessions")), []);
  useOnMount(reload);

  return (
    <div className="grid gap-6">
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="mb-1 text-xl font-bold">Photo conversations</h2>
            <p className="text-sm opacity-70">
              What was said in each live chat on the frame. Companion lines that break the usual rules (a recall
              question, a name that isn&rsquo;t in the facts, talking about someone who has died as if they&rsquo;re here)
              are marked so you can adjust the photo&rsquo;s note.
            </p>
          </div>
          <Button variant="ghost" onClick={reload}>
            Refresh
          </Button>
        </div>
      </Card>
      {!sessions.length && <p className="text-sm opacity-60">No live conversations yet.</p>}
      {sessions.map((s) => (
        <Card key={s.id}>
          <div className="flex gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.photoUrl} alt="" className="h-24 w-32 shrink-0 rounded-xl object-cover" />
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <strong>{new Date(s.startedAt ?? s.createdAt).toLocaleString()}</strong>
                {s.status === "active" ? (
                  <Badge>In progress</Badge>
                ) : (
                  <Badge>{ENDINGS[s.endedReason ?? ""] ?? s.endedReason}</Badge>
                )}
                {s.flagged && <Badge tone="warn">Needs a look</Badge>}
              </div>
              <ul className="grid gap-1 text-sm">
                {s.turns.map((t, i) => (
                  <li key={i} className={t.flags?.length ? "rounded-lg bg-amber-50 px-2 py-1" : ""}>
                    <span className="font-semibold">{t.role === "companion" ? "Companion" : "Them"}:</span> {t.text}
                    {t.interrupted && <span className="opacity-50"> (they talked over this)</span>}
                    {t.flags?.map((f) => (
                      <span key={f} className="block text-xs text-amber-900">
                        {f}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
