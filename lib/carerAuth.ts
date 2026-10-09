import "server-only";

/** Prototype-grade gate for carer-only routes: a shared passcode sent as x-carer-key. */
export function carerDenied(req: Request): Response | null {
  const expected = process.env.CARER_PASSCODE;
  if (!expected || expected === "unset") return null;
  if (req.headers.get("x-carer-key") === expected) return null;
  return Response.json({ error: "Carer passcode required" }, { status: 401 });
}

export function errorResponse(e: unknown, status = 500): Response {
  console.error(e);
  return Response.json({ error: (e as Error)?.message ?? "Something went wrong" }, { status });
}
