import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError, analyzeImage, getConfigPayload } from "./lib/ark.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const port = process.env.PORT || 3000;
const host = process.env.HOST || "127.0.0.1";
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

async function proxyAnalyze(body, res) {
  try {
    const payload = await analyzeImage(body);
    sendJson(res, 200, payload);
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.statusCode, error.payload);
      return;
    }
    sendJson(res, 500, {
      ok: false,
      error: "服务端发生异常。",
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
    sendJson(res, 200, getConfigPayload());
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

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  sendText(res, 405, "Method Not Allowed");
});

server.listen(port, host, () => {
  console.log(`Water level demo running at http://${host}:${port}`);
});
