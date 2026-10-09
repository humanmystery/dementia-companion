import { errorResponse } from "@/lib/carerAuth";
import { assistTask, type Trigger } from "@/lib/task";

/** multipart: file, trigger ("manual" | "auto"), attempt, chosenTaskId? */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return Response.json({ error: "No photo" }, { status: 400 });
    const result = await assistTask({
      image: { data: Buffer.from(await file.arrayBuffer()), mimeType: file.type || "image/jpeg" },
      trigger: (form.get("trigger") === "auto" ? "auto" : "manual") as Trigger,
      attempt: Number(form.get("attempt") ?? 0),
      chosenTaskId: form.get("chosenTaskId") ? String(form.get("chosenTaskId")) : undefined,
    });
    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
