"use client";

import Link from "next/link";
import { useState } from "react";
import ConversationsTab from "./ConversationsTab";
import DemoTab from "./DemoTab";
import PeopleTab from "./PeopleTab";
import PhotosTab from "./PhotosTab";
import PlacesTab from "./PlacesTab";
import RemindersTab from "./RemindersTab";
import SetupTab from "./SetupTab";

const TABS = [
  { id: "people", label: "People", Component: PeopleTab },
  { id: "places", label: "Places", Component: PlacesTab },
  { id: "photos", label: "Photos", Component: PhotosTab },
  { id: "setup", label: "Daily tasks & schedule", Component: SetupTab },
  { id: "reminders", label: "Photo invitations", Component: RemindersTab },
  { id: "conversations", label: "Conversations", Component: ConversationsTab },
  { id: "demo", label: "Demo controls", Component: DemoTab },
] as const;

export default function CarerApp() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("people");
  const Active = TABS.find((t) => t.id === tab)!.Component;
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/" className="text-sm opacity-60">
            Companion
          </Link>
          <h1 className="text-3xl font-bold">Carer setup</h1>
          <p className="opacity-70">Everything the companion says comes from what you confirm here.</p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link className="rounded-xl bg-white/70 px-3 py-2 ring-1 ring-black/10" href="/frame" target="_blank">
            Open frame
          </Link>
          <Link className="rounded-xl bg-white/70 px-3 py-2 ring-1 ring-black/10" href="/capture" target="_blank">
            Open glasses
          </Link>
        </div>
      </header>
      <nav className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === t.id ? "bg-accent text-white" : "bg-white/70 ring-1 ring-black/10 hover:bg-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <Active />
    </div>
  );
}
