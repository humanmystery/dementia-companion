import { carerDenied, errorResponse } from "@/lib/carerAuth";
import { db, newId } from "@/lib/db";
import type { Person } from "@/lib/types";

export async function GET() {
  const people = await db.list<Person>("people");
  people.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return Response.json(people.map(({ descriptors, ...p }) => ({ ...p, descriptorCount: descriptors?.length ?? 0 })));
}

export async function POST(req: Request) {
  const denied = carerDenied(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Partial<Person>;
    if (!body.name?.trim() || !body.relationship?.trim()) {
      return Response.json({ error: "Name and relationship are required" }, { status: 400 });
    }
    const person: Person = {
      id: newId(),
      name: body.name.trim(),
      nickname: body.nickname?.trim() || undefined,
      relationship: body.relationship.trim(),
      deceased: !!body.deceased,
      notes: (body.notes ?? []).map((n) => n.trim()).filter(Boolean),
      descriptors: [],
      refPhotoPaths: [],
      confirmed: !!body.confirmed,
      createdAt: new Date().toISOString(),
    };
    await db.set("people", person);
    return Response.json(person);
  } catch (e) {
    return errorResponse(e);
  }
}
