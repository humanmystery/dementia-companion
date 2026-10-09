import { phrasesCrud } from "@/lib/collections";

export async function PATCH(req: Request, ctx: RouteContext<"/api/reminders/phrases/[id]">) {
  return phrasesCrud.update(req, (await ctx.params).id);
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/reminders/phrases/[id]">) {
  return phrasesCrud.remove(req, (await ctx.params).id);
}
