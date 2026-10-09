import { scheduleCrud } from "@/lib/collections";

export const GET = () => scheduleCrud.list();
export const POST = (req: Request) => scheduleCrud.create(req);
