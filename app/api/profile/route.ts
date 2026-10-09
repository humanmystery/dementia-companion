import { carerDenied, errorResponse } from "@/lib/carerAuth";
import { getProfile, saveProfile } from "@/lib/config";
import type { Profile } from "@/lib/types";

export async function GET() {
  return Response.json(await getProfile());
}

export async function PUT(req: Request) {
  const denied = carerDenied(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Partial<Profile>;
    return Response.json(await saveProfile(body));
  } catch (e) {
    return errorResponse(e);
  }
}
