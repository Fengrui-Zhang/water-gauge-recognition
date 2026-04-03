import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MODEL,
  DEFAULT_PROMPT,
  SYSTEM_PROMPT,
} from "./public/prompt-template.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const sampleDir = path.join(__dirname, "sample");
const port = process.env.PORT || 3000;
const host = process.env.HOST || "127.0.0.1";
const apiBaseUrl = "https://ark.cn-beijing.volces.com/api/v3/responses";
const envLocalPath = path.join(__dirname, ".env.local");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalIndex = line.indexOf("=");
    if (equalIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalIndex).trim();
    let value = line.slice(equalIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(envLocalPath);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function isImageFile(fileName) {
  return [".jpg", ".jpeg", ".png", ".webp"].includes(
    path.extname(fileName).toLowerCase()
  );
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function serveFile(res, resolvedPath) {
  fs.readFile(resolvedPath, (error, data) => {
    if (error) {
      sendText(res, 404, "Not Found");
      return;
    }
    const ext = path.extname(resolvedPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 15 * 1024 * 1024) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function stripCodeFence(text) {
  if (!text) {
    return "";
  }
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function tryParseJson(text) {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function extractOutputText(payload) {
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

function buildProviderInput(imageDataUrl, promptText) {
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

async function proxyAnalyze(body, res) {
  const apiKey = body.apiKey || process.env.ARK_API_KEY;
  const model = body.model || DEFAULT_MODEL;
  const prompt = body.prompt || DEFAULT_PROMPT;
  const imageDataUrl = body.imageDataUrl;

  if (!apiKey) {
    sendJson(res, 400, {
      ok: false,
      error: "缺少 API Key。请在页面中填写，或在启动服务前设置环境变量 ARK_API_KEY。",
    });
    return;
  }

  if (!imageDataUrl || typeof imageDataUrl !== "string") {
    sendJson(res, 400, {
      ok: false,
      error: "缺少图片数据，请重新上传图片。",
    });
    return;
  }

  const providerPayload = {
    model,
    input: buildProviderInput(imageDataUrl, prompt),
  };

  try {
    const providerResponse = await fetch(apiBaseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(providerPayload),
    });

    const providerText = await providerResponse.text();
    const providerJson = tryParseJson(providerText);

    if (!providerResponse.ok) {
      sendJson(res, providerResponse.status, {
        ok: false,
        error: "豆包接口调用失败。",
        providerStatus: providerResponse.status,
        providerBody: providerJson || providerText,
      });
      return;
    }

    const rawText = extractOutputText(providerJson);
    const parsedResult = tryParseJson(rawText);

    sendJson(res, 200, {
      ok: true,
      model,
      prompt,
      rawText,
      parsedResult,
      usage: providerJson?.usage || null,
      responseId: providerJson?.id || null,
      providerBody: providerJson,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: "请求豆包接口时发生异常。",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function serveStatic(req, res) {
  const requestedPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const safePath = requestedPath === "/" ? "/index.html" : requestedPath;
  const resolvedPath = path.normalize(path.join(publicDir, safePath));

  if (!resolvedPath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  serveFile(res, resolvedPath);
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendText(res, 400, "Bad Request");
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/config")) {
    sendJson(res, 200, {
      ok: true,
      model: DEFAULT_MODEL,
      prompt: DEFAULT_PROMPT,
      hasServerKey: Boolean(process.env.ARK_API_KEY),
    });
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/samples")) {
    try {
      const entries = fs
        .readdirSync(sampleDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && isImageFile(entry.name))
        .map((entry) => ({
          name: entry.name,
          url: `/sample/${encodeURIComponent(entry.name)}`,
        }));

      sendJson(res, 200, {
        ok: true,
        samples: entries,
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: "读取 sample 目录失败。",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/analyze") {
    try {
      const rawBody = await readRequestBody(req);
      const body = JSON.parse(rawBody || "{}");
      await proxyAnalyze(body, res);
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: "请求体不是合法 JSON。",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/sample/")) {
    const requestedPath = decodeURIComponent(
      new URL(req.url, `http://${req.headers.host}`).pathname.replace(/^\/sample\//, "")
    );
    const resolvedPath = path.normalize(path.join(sampleDir, requestedPath));

    if (!resolvedPath.startsWith(sampleDir) || !isImageFile(resolvedPath)) {
      sendText(res, 403, "Forbidden");
      return;
    }

    serveFile(res, resolvedPath);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  sendText(res, 405, "Method Not Allowed");
});

server.listen(port, host, () => {
  console.log(`Water level demo running at http://${host}:${port}`);
});
