import { ApiError, analyzeImage, tryParseJson } from "../lib/ark.js";

export const maxDuration = 300;

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    const text = await request.text();
    return tryParseJson(text);
  }
}

export async function POST(request) {
  const body = await readJsonBody(request);

  if (!body) {
    return Response.json(
      {
        ok: false,
        error: "请求体不是合法 JSON。",
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  try {
    const payload = await analyzeImage(body);
    return Response.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return Response.json(error.payload, {
        status: error.statusCode,
        headers: {
          "Cache-Control": "no-store",
        },
      });
    }

    return Response.json(
      {
        ok: false,
        error: "服务端发生异常。",
        detail: error instanceof Error ? error.message : String(error),
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
