import { createHash } from "crypto";
import { db } from "@/lib/db";
import type { PushToken } from "@/lib/types";

export async function POST(req: Request) {
  const { token } = (await req.json()) as { token?: string };
  if (!token) return Response.json({ error: "No token" }, { status: 400 });
  const id = createHash("sha1").update(token).digest("hex").slice(0, 16);
  await db.set<PushToken>("pushTokens", { id, token, createdAt: new Date().toISOString() });
  return Response.json({ ok: true });
}
