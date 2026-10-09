import "server-only";
import { now } from "./config";
import { db } from "./db";
import { generateJson, type ImageInput } from "./gemini";
import type { ScheduleItem, Task } from "./types";

export type Trigger = "manual" | "auto";

export type TaskResult = {
  status: "clear_match" | "unclear" | "no_match" | "ambiguous" | "error";
  /** Spoken text. Empty means stay quiet. */
  text: string;
  taskId?: string;
  stepIndex?: number;
  /** Manual mode: offer one retake. */
  retake?: boolean;
  /** Automatic mode: capture another frame silently. */
  autoRetake?: boolean;
  choices?: { taskId: string; label: string }[];
  seen?: string;
};

type Vision = {
  status: "clear_match" | "unclear" | "no_match" | "ambiguous";
  taskId: string;
  candidateTaskIds: string[];
  stepIndex: number;
  activityPhrase: string;
  seen: string;
};

const SYSTEM = `You look at one photo taken from the point of view of an older person wearing camera glasses, and compare it with the carer's task list.
You only classify. You never write instructions or advice.
Status:
- "clear_match": you can plainly see what is happening and it matches exactly one task on the list.
- "ambiguous": the scene plausibly fits two or more tasks on the list and you cannot tell which.
- "no_match": the scene is clear but none of the tasks on the list apply.
- "unclear": you genuinely cannot tell what is happening (blur, darkness, bad angle, ambiguous framing).
For clear_match, pick stepIndex: the index of the NEXT step the person still needs to do, judged from what is visible (e.g. if clothes are already ironed and piled on a chair, the next step is folding).
activityPhrase: 1-3 words in -ing form describing the matched task, e.g. "ironing", "preparing rice", "folding towels".
seen: one short neutral sentence of what you see (for the carer log).`;

const SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["clear_match", "unclear", "no_match", "ambiguous"] },
    taskId: { type: "string" },
    candidateTaskIds: { type: "array", items: { type: "string" } },
    stepIndex: { type: "integer" },
    activityPhrase: { type: "string" },
    seen: { type: "string" },
  },
  required: ["status", "taskId", "candidateTaskIds", "stepIndex", "activityPhrase", "seen"],
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const stripDot = (s: string) => s.trim().replace(/[.!]+$/, "");

/** Next step, plus the rest when at most two remain (so a closing safety step like "switch the iron off" is included). */
export function stepsCue(task: Task, stepIndex: number): string {
  const i = Math.min(Math.max(stepIndex, 0), task.steps.length - 1);
  const remaining = task.steps.slice(i);
  const said = remaining.length <= 2 ? remaining : [remaining[0]];
  return said.map((s, k) => (k === 0 ? stripDot(s) : lowerFirst(stripDot(s)))).join(", and ");
}

export async function upcomingEvent(withinMin = 120): Promise<ScheduleItem | null> {
  const current = await now();
  const items = (await db.list<ScheduleItem>("schedule")).filter((s) => s.confirmed);
  const soon = items
    .map((s) => ({ s, t: new Date(s.time).getTime() }))
    .filter(({ t }) => !isNaN(t) && t >= current.getTime() - 5 * 60_000 && t - current.getTime() <= withinMin * 60_000)
    .sort((a, b) => a.t - b.t);
  return soon[0]?.s ?? null;
}

function activityFrom(task: Task, phrase: string): string {
  const p = phrase.trim().toLowerCase();
  if (p && p.split(/\s+/).length <= 4 && /ing\b/.test(p)) return p;
  return lowerFirst(task.name);
}

async function buildCue(task: Task, stepIndex: number, activityPhrase: string): Promise<string> {
  const activity = activityFrom(task, activityPhrase);
  let text = `You're ${activity}. Next, ${lowerFirst(stepsCue(task, stepIndex))}.`;
  const event = await upcomingEvent();
  if (event) {
    const wording = stripDot(event.carerWording || `You have ${lowerFirst(event.title)} soon`);
    text += ` ${wording}, so maybe get ready after ${activity}.`;
  }
  return text;
}

export async function assistTask(input: {
  image: ImageInput;
  trigger: Trigger;
  attempt: number;
  chosenTaskId?: string;
}): Promise<TaskResult> {
  const tasks = (await db.list<Task>("tasks")).filter((t) => t.confirmed && t.steps.length);
  const manual = input.trigger === "manual";
  if (!tasks.length) {
    return { status: "no_match", text: manual ? "I don't have anything on your list yet." : "" };
  }

  const list = tasks
    .map(
      (t) =>
        `- id "${t.id}": ${t.name}. Scene: ${t.sceneHints || "n/a"}. Steps: ${t.steps.map((s, i) => `[${i}] ${s}`).join(" ")}`,
    )
    .join("\n");

  let vision: Vision;
  try {
    vision = await generateJson<Vision>({
      system: SYSTEM,
      schema: SCHEMA,
      temperature: 0.1,
      images: [input.image],
      prompt: input.chosenTaskId
        ? `The person has told us they are doing task id "${input.chosenTaskId}". Use status "clear_match" with that taskId unless the photo is genuinely unclear, and pick the next step.\n\nTask list:\n${list}`
        : `Task list:\n${list}`,
    });
  } catch (e) {
    console.error("task vision failed", e);
    return {
      status: "error",
      text: manual ? "Sorry, I couldn't check just now. Let's try again in a moment." : "",
    };
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const task = byId.get(vision.taskId);

  if (vision.status === "clear_match" && task) {
    return {
      status: "clear_match",
      text: await buildCue(task, vision.stepIndex, vision.activityPhrase),
      taskId: task.id,
      stepIndex: vision.stepIndex,
      seen: vision.seen,
    };
  }

  if (vision.status === "ambiguous") {
    const candidates = vision.candidateTaskIds.map((id) => byId.get(id)).filter((t): t is Task => !!t).slice(0, 2);
    if (manual && candidates.length === 2) {
      return {
        status: "ambiguous",
        text: `Are you ${lowerFirst(candidates[0].name)}, or ${lowerFirst(candidates[1].name)}?`,
        choices: candidates.map((t) => ({ taskId: t.id, label: t.name })),
        seen: vision.seen,
      };
    }
    return { status: "ambiguous", text: "", seen: vision.seen };
  }

  if (vision.status === "unclear" || (vision.status === "clear_match" && !task)) {
    if (manual) {
      return input.attempt === 0
        ? { status: "unclear", text: "I can't quite see. Could we take one more photo?", retake: true, seen: vision.seen }
        : { status: "unclear", text: "I still can't quite see. That's alright, take your time.", seen: vision.seen };
    }
    return { status: "unclear", text: "", autoRetake: input.attempt < 2, seen: vision.seen };
  }

  return {
    status: "no_match",
    text: manual ? "I'm not sure about this one. It's alright to take your time." : "",
    seen: vision.seen,
  };
}
