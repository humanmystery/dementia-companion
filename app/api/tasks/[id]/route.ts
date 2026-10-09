import { tasksCrud } from "@/lib/collections";

export async function PATCH(req: Request, ctx: RouteContext<"/api/tasks/[id]">) {
  return tasksCrud.update(req, (await ctx.params).id);
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/tasks/[id]">) {
  return tasksCrud.remove(req, (await ctx.params).id);
}
