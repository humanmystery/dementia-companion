import { carerDenied, errorResponse } from "@/lib/carerAuth";
import { getProfile, now, saveProfile } from "@/lib/config";
import { db, newId } from "@/lib/db";
import { generateJson } from "@/lib/gemini";
import { toLocalInput } from "@/lib/seed";
import type { Profile, ScheduleItem, Task } from "@/lib/types";

const SYSTEM = `You help a family carer set up a home companion for an older relative with early to mid-stage dementia.
From the carer's answers, draft:
- tasks: everyday household activities the relative does, each with a short scene description (what a camera would see) and 2-4 short, plain next steps in order, written as gentle instructions ("Fold the clothes on the chair").
- schedule: one-off or upcoming events the carer mentioned that need attention.
Rules: only draft things the carer actually mentioned or that are directly implied. Never add medical, medication, dose or care-plan steps; if the carer mentions medication, create a schedule item whose wording repeats the carer's own words only. Everything you draft is a suggestion the carer must confirm.`;

const SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          sceneHints: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
        },
        required: ["name", "sceneHints", "steps"],
      },
    },
    schedule: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          time: { type: "string", description: "Local date-time YYYY-MM-DDTHH:mm" },
          carerWording: { type: "string" },
        },
        required: ["title", "time"],
      },
    },
  },
  required: ["tasks", "schedule"],
};

export async function POST(req: Request) {
  const denied = carerDenied(req);
  if (denied) return denied;
  try {
    const answers = (await req.json()) as Partial<Profile>;
    const profile = await saveProfile(answers);
    const current = await now();
    const draft = await generateJson<{
      tasks: { name: string; sceneHints: string; steps: string[] }[];
      schedule: { title: string; time: string; carerWording?: string }[];
    }>({
      system: SYSTEM,
      schema: SCHEMA,
      temperature: 0.3,
      prompt: `Today is ${current.toDateString()}, current local time ${toLocalInput(current)}.
Carer's answers:
- Gender: ${profile.gender ?? "not given"}
- Age: ${profile.age ?? "not given"}
- Living alone: ${profile.livingAlone == null ? "not given" : profile.livingAlone ? "yes" : "no"}${profile.livingDetails ? ` (${profile.livingDetails})` : ""}
- Regular activities to put on the schedule: ${profile.regularActivities.join("; ") || "none"}
- Events needing extra attention: ${profile.attentionEvents.join("; ") || "none"}`,
    });

    const existing = await getProfile();
    const tasks: Task[] = [];
    for (const t of draft.tasks ?? []) {
      tasks.push(
        await db.set<Task>("tasks", {
          id: newId(),
          name: t.name,
          sceneHints: t.sceneHints,
          steps: t.steps,
          confirmed: false,
          createdAt: new Date().toISOString(),
        }),
      );
    }
    const schedule: ScheduleItem[] = [];
    for (const s of draft.schedule ?? []) {
      schedule.push(
        await db.set<ScheduleItem>("schedule", {
          id: newId(),
          title: s.title,
          time: s.time,
          carerWording: s.carerWording,
          confirmed: false,
        }),
      );
    }
    return Response.json({ profile: existing, tasks, schedule });
  } catch (e) {
    return errorResponse(e);
  }
}
