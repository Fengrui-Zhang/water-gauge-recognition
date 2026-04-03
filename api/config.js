import { getConfigPayload } from "../lib/ark.js";

export async function GET() {
  return Response.json(getConfigPayload(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
