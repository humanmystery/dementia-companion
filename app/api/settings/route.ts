import { carerDenied, errorResponse } from "@/lib/carerAuth";
import { getSettings, now, saveSettings } from "@/lib/config";
import type { Settings } from "@/lib/types";

export async function GET() {
  const [settings, current] = await Promise.all([getSettings(), now()]);
  return Response.json({ ...settings, now: current.toISOString() });
}

export async function PUT(req: Request) {
  const denied = carerDenied(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Partial<Settings> & { fakeClockIso?: string | null };
    const patch: Partial<Settings> = {};
    if (body.activeHours) patch.activeHours = body.activeHours;
    if (body.remindersEnabled !== undefined) patch.remindersEnabled = !!body.remindersEnabled;
    if (body.intervalMin !== undefined) patch.intervalMin = Math.max(30, Number(body.intervalMin));
    if (body.jitterMin !== undefined) patch.jitterMin = Math.max(0, Number(body.jitterMin));
    if (body.maxPerDay !== undefined) patch.maxPerDay = Math.max(0, Number(body.maxPerDay));
    if (body.fakeClockIso !== undefined) {
      patch.fakeClock = body.fakeClockIso ? `${new Date(body.fakeClockIso).toISOString()}|${Date.now()}` : null;
      patch.recapLastPlayedDay = null;
    }
    const settings = await saveSettings(patch);
    return Response.json({ ...settings, now: (await now()).toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}
