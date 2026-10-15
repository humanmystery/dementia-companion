import Link from "next/link";

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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div>
        <h1 className="text-4xl font-bold">Forget Me Not</h1>
        <p className="mt-2 text-lg opacity-80">
          A friendly life companion for people living with early and mid-stage dementia, and support for the family
          around them.
        </p>
      </div>
      <div className="grid gap-4">
        {SURFACES.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-3xl bg-white/70 p-6 shadow-sm ring-1 ring-black/5 transition hover:bg-white"
          >
            <div className="text-2xl font-semibold">{s.title}</div>
            <div className="mt-1 opacity-75">{s.body}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
