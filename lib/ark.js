import {
  DEFAULT_MODEL,
  DEFAULT_PROMPT,
  SYSTEM_PROMPT,
} from "../public/prompt-template.js";

const API_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3/responses";
const PROVIDER_TIMEOUT_MS = 45000;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class ApiError extends Error {
  constructor(statusCode, payload) {
    super(payload?.error || "API request failed.");
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

export function stripCodeFence(text) {
  if (!text) {
    return "";
  }
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

export function tryParseJson(text) {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export function extractOutputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (Array.isArray(payload?.output)) {
    const fragments = [];
    for (const item of payload.output) {
      if (!Array.isArray(item?.content)) {
        continue;
      }
      for (const part of item.content) {
        if (typeof part?.text === "string" && part.text.trim()) {
          fragments.push(part.text.trim());
        }
      }
    }
    if (fragments.length > 0) {
      return fragments.join("\n");
    }
  }

  if (Array.isArray(payload?.choices)) {
    const firstChoice = payload.choices[0];
    const content = firstChoice?.message?.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const fragments = content
        .map((item) => item?.text || item?.content || "")
        .filter(Boolean);
      if (fragments.length > 0) {
        return fragments.join("\n");
      }
    }
  }

  return "";
}

export function buildProviderInput(imageDataUrl, promptText) {
  return [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: SYSTEM_PROMPT,
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "input_image",
          image_url: imageDataUrl,
        },
        {
          type: "input_text",
          text: promptText || DEFAULT_PROMPT,
        },
      ],
    },
  ];
}

export function getConfigPayload() {
  return {
    ok: true,
    model: DEFAULT_MODEL,
    prompt: DEFAULT_PROMPT,
    hasServerKey: Boolean(process.env.ARK_API_KEY),
  };
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callProvider(providerPayload, apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const providerResponse = await fetch(API_BASE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(providerPayload),
      signal: controller.signal,
    });

    const providerText = await providerResponse.text();
    const providerJson = tryParseJson(providerText);

    if (!providerResponse.ok) {
      throw new ApiError(providerResponse.status, {
        ok: false,
        error: "豆包接口调用失败。",
        providerStatus: providerResponse.status,
        providerBody: providerJson || providerText,
        retryable: RETRYABLE_STATUS_CODES.has(providerResponse.status),
      });
    }

    return providerJson;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (isAbortError(error)) {
      throw new ApiError(504, {
        ok: false,
        error: "豆包接口响应超时，请稍后重试。",
        detail: `上游在 ${Math.round(PROVIDER_TIMEOUT_MS / 1000)} 秒内未返回结果。`,
        retryable: true,
      });
    }

    throw new ApiError(502, {
      ok: false,
      error: "请求豆包接口时发生网络异常。",
      detail: error instanceof Error ? error.message : String(error),
      retryable: true,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function analyzeImage(body) {
  const apiKey = body?.apiKey || process.env.ARK_API_KEY;
  const model = body?.model || DEFAULT_MODEL;
  const prompt = body?.prompt || DEFAULT_PROMPT;
  const imageDataUrl = body?.imageDataUrl;

  if (!apiKey) {
    throw new ApiError(400, {
      ok: false,
      error: "缺少 API Key。请在页面中填写，或在部署环境中设置 ARK_API_KEY。",
    });
  }

  if (!imageDataUrl || typeof imageDataUrl !== "string") {
    throw new ApiError(400, {
      ok: false,
      error: "缺少图片数据，请重新上传图片。",
    });
  }

  const providerPayload = {
    model,
    input: buildProviderInput(imageDataUrl, prompt),
  };

  let providerJson;
  try {
    providerJson = await callProvider(providerPayload, apiKey);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.payload?.retryable
    ) {
      await sleep(900);
      providerJson = await callProvider(providerPayload, apiKey);
    } else {
      throw error;
    }
  }

  const rawText = extractOutputText(providerJson);
  const parsedResult = tryParseJson(rawText);

  return {
    ok: true,
    model,
    prompt,
    rawText,
    parsedResult,
    usage: providerJson?.usage || null,
    responseId: providerJson?.id || null,
    providerBody: providerJson,
  };
}
