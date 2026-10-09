import { scheduleCrud } from "@/lib/collections";

export async function PATCH(req: Request, ctx: RouteContext<"/api/schedule/[id]">) {
  return scheduleCrud.update(req, (await ctx.params).id);
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/schedule/[id]">) {
  return scheduleCrud.remove(req, (await ctx.params).id);
}
