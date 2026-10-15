import Link from "next/link";
import { BRAND, Flower, TAGLINE } from "@/components/brand";

const SURFACES = [
  {
    href: "/frame",
    title: "Photo frame",
    body: "For the tablet in the living room. Slideshow, morning recap of yesterday, and a chat about any photo.",
  },
  {
    href: "/capture",
    title: "Glasses (phone stand-in)",
    body: "For the phone with earbuds. Who is this, help me with this task, and gentle photo invitations.",
  },
  {
    href: "/carer",
    title: "Carer setup",
    body: "Enrol familiar faces and places, add photos and notes, confirm tasks and the schedule.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-6 py-16">
      <div className="flex flex-col items-start gap-4">
        <Flower className="h-16 w-16" />
        <div>
          <h1 className="font-display text-5xl font-semibold tracking-tight">{BRAND}</h1>
          <p className="mt-1 font-display text-2xl italic text-accent">{TAGLINE}</p>
        </div>
        <p className="text-lg opacity-80">
          A gentle companion for people living with early and mid-stage dementia, and support for the family around
          them.
        </p>
      </div>
      <div className="grid gap-4">
        {SURFACES.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group flex items-start gap-4 rounded-3xl bg-white/80 p-6 shadow-sm ring-1 ring-accent/10 transition hover:bg-white hover:ring-accent/30"
          >
            <Flower className="mt-1 h-7 w-7 shrink-0 transition group-hover:rotate-12" />
            <div>
              <div className="text-2xl font-semibold">{s.title}</div>
              <div className="mt-1 opacity-75">{s.body}</div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
