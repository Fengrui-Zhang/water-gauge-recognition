import { DEFAULT_MODEL, DEFAULT_PROMPT } from "./prompt-template.js";

const EXAMPLE_IMAGES = [
  "68cm.jpg",
  "68cm-模糊.jpg",
  "中.png",
  "近.png",
  "远.jpg",
].map((name) => ({
  name,
  url: `/examples/${encodeURIComponent(name)}`,
}));

const apiKeyInput = document.querySelector("#apiKeyInput");
const modelInput = document.querySelector("#modelInput");
const promptInput = document.querySelector("#promptInput");
const fileInput = document.querySelector("#fileInput");
const sampleSelect = document.querySelector("#sampleSelect");
const useSampleButton = document.querySelector("#useSampleButton");
const analyzeButton = document.querySelector("#analyzeButton");
const analyzeButtonLabel = document.querySelector("#analyzeButtonLabel");
const previewImage = document.querySelector("#previewImage");
const loadingOverlay = document.querySelector("#loadingOverlay");
const loadingOverlayText = document.querySelector("#loadingOverlayText");
const imageMeta = document.querySelector("#imageMeta");
const statusBar = document.querySelector("#statusBar");
const resultPanel = document.querySelector(".result-panel");
const depthValue = document.querySelector("#depthValue");
const statusValue = document.querySelector("#statusValue");
const confidenceValue = document.querySelector("#confidenceValue");
const uncertaintyValue = document.querySelector("#uncertaintyValue");
const gaugeTypeValue = document.querySelector("#gaugeTypeValue");
const divisionValue = document.querySelector("#divisionValue");
const betweenMarksValue = document.querySelector("#betweenMarksValue");
const depthMeterValue = document.querySelector("#depthMeterValue");
const basisValue = document.querySelector("#basisValue");
const summaryValue = document.querySelector("#summaryValue");
const evidenceList = document.querySelector("#evidenceList");
const auxValue = document.querySelector("#auxValue");
const errorSourcesValue = document.querySelector("#errorSourcesValue");
const rawOutput = document.querySelector("#rawOutput");
const toggleRawButton = document.querySelector("#toggleRawButton");

let sampleImages = [];
let currentImageFile = null;
let rawExpanded = false;
let loadingTicker = null;

function setStatus(kind, message) {
  statusBar.className = `status-bar ${kind}`;
  statusBar.textContent = message;
}

function setLoadingState(isLoading, message = "正在上传图片并等待模型返回结果。") {
  analyzeButton.disabled = isLoading;
  analyzeButton.classList.toggle("is-loading", isLoading);
  resultPanel.classList.toggle("is-loading", isLoading);
  loadingOverlay.classList.toggle("hidden", !isLoading);
  loadingOverlayText.textContent = message;

  if (isLoading) {
    const frames = ["模型识别中", "模型识别中.", "模型识别中..", "模型识别中..."];
    let index = 0;
    analyzeButtonLabel.textContent = frames[index];
    clearInterval(loadingTicker);
    loadingTicker = window.setInterval(() => {
      index = (index + 1) % frames.length;
      analyzeButtonLabel.textContent = frames[index];
    }, 420);
    return;
  }

  clearInterval(loadingTicker);
  loadingTicker = null;
  analyzeButtonLabel.textContent = "开始识别";
}

function estimateDataUrlBytes(dataUrl) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    return dataUrl.length;
  }
  const base64 = dataUrl.slice(commaIndex + 1);
  return Math.floor((base64.length * 3) / 4);
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function summarizePlainTextError(text, status) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.includes("FUNCTION_PAYLOAD_TOO_LARGE") || status === 413) {
    return "图片请求体超过 Vercel 限制。系统已优先尝试原图；若仍失败，请先裁剪水尺区域或换更小图片。";
  }
  if (compact.includes("An error occurred") || compact.includes("<!doctype html")) {
    return "服务端返回了非 JSON 错误页，通常表示 Vercel Function 发生异常、超时或请求体超限。";
  }
  return compact || "服务端返回了无法解析的响应。";
}

function isRetriableResponse(response, payload, rawText) {
  if (!response.ok && [408, 409, 425, 429, 500, 502, 503, 504].includes(response.status)) {
    return true;
  }

  if (payload?.retryable) {
    return true;
  }

  const compact = (rawText || "").replace(/\s+/g, " ").trim();
  return compact.includes("An error occurred") || compact.includes("FUNCTION_INVOCATION_TIMEOUT");
}

async function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function requestAnalyze(payload) {
  let lastResponse = null;
  let lastText = "";
  let lastData = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      setStatus("loading", "首次请求失败，正在自动重试一次。");
      loadingOverlayText.textContent = "网络或模型响应波动，系统正在自动重试。";
      await sleep(900);
    }

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    const data = tryParseJson(responseText);

    lastResponse = response;
    lastText = responseText;
    lastData = data;

    if (data && response.ok && data.ok) {
      return { response, responseText, data };
    }

    if (!isRetriableResponse(response, data, responseText) || attempt === 1) {
      return { response, responseText, data };
    }
  }

  return {
    response: lastResponse,
    responseText: lastText,
    data: lastData,
  };
}

function renderEvidence(items) {
  evidenceList.innerHTML = "";
  if (!Array.isArray(items) || items.length === 0) {
    const li = document.createElement("li");
    li.textContent = "未返回可用证据。";
    evidenceList.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    evidenceList.appendChild(li);
  });
}

function renderResult(result, fallbackText) {
  if (!result) {
    depthValue.textContent = "--";
    statusValue.textContent = "无法解析";
    confidenceValue.textContent = "--";
    uncertaintyValue.textContent = "--";
    gaugeTypeValue.textContent = "--";
    divisionValue.textContent = "--";
    betweenMarksValue.textContent = "--";
    depthMeterValue.textContent = "--";
    basisValue.textContent = "模型未返回可解析 JSON，请查看原始响应。";
    summaryValue.textContent = fallbackText || "暂无摘要。";
    auxValue.textContent = "辅助指标不可用。";
    errorSourcesValue.textContent = "未提供。";
    renderEvidence([]);
    return;
  }

  depthValue.textContent =
    typeof result.depth_cm === "number" ? `${result.depth_cm} cm` : "需复核";
  statusValue.textContent = result.status || "未知";
  confidenceValue.textContent =
    typeof result.confidence === "number"
      ? `${Math.round(result.confidence * 100)}%`
      : "--";
  uncertaintyValue.textContent =
    typeof result.uncertainty_cm === "number"
      ? `±${result.uncertainty_cm} cm`
      : "--";
  gaugeTypeValue.textContent = result.gauge_type || "--";
  divisionValue.textContent =
    typeof result.smallest_division_cm === "number"
      ? `${result.smallest_division_cm} cm`
      : "--";
  betweenMarksValue.textContent = result.between_marks || "--";
  depthMeterValue.textContent =
    typeof result.depth_m === "number" ? `${result.depth_m} m` : "--";
  basisValue.textContent = result.reading_basis || "未提供";
  summaryValue.textContent = result.reasoning_summary || "未提供";
  auxValue.textContent = [
    `水面线可见：${result.waterline_visible ? "是" : "否"}`,
    `可用水尺比例：${
      typeof result.gauge_visible_ratio === "number"
        ? `${Math.round(result.gauge_visible_ratio * 100)}%`
        : "--"
    }`,
    `刻度可靠性：${result.scale_reliability || "未提供"}`,
  ].join(" | ");
  errorSourcesValue.textContent =
    Array.isArray(result.error_sources) && result.error_sources.length > 0
      ? result.error_sources.join(" / ")
      : "未提供";
  renderEvidence(result.evidence);
}

async function loadConfig() {
  modelInput.value = DEFAULT_MODEL;
  promptInput.value = DEFAULT_PROMPT;

  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      throw new Error(`/api/config 返回 ${response.status}`);
    }

    const data = await response.json();
    if (data?.ok) {
      modelInput.value = data.model || DEFAULT_MODEL;
      if (data.hasServerKey) {
        apiKeyInput.placeholder = "服务端已配置 ARK_API_KEY，可留空";
      }
    }
  } catch (error) {
    setStatus(
      "idle",
      `配置读取失败，已回退到本地默认值。${error instanceof Error ? ` ${error.message}` : ""}`
    );
  }
}

async function loadSamples() {
  sampleImages = EXAMPLE_IMAGES;
  sampleSelect.innerHTML = "";

  sampleImages.forEach((sample, index) => {
    const option = document.createElement("option");
    option.value = sample.name;
    option.textContent = sample.name;
    if (index === 0) {
      option.selected = true;
    }
    sampleSelect.appendChild(option);
  });

  const firstSample = sampleImages[0];
  if (firstSample) {
    setPreviewFromUrl(firstSample.url, `当前为样例图：${firstSample.name}`);
  } else {
    setStatus("idle", "未配置样例图，请手动上传图片。");
  }
}

function setPreviewFromUrl(url, label) {
  previewImage.src = url;
  imageMeta.textContent = label;
}

function setPreviewFromFile(file) {
  const objectUrl = URL.createObjectURL(file);
  setPreviewFromUrl(objectUrl, `当前文件：${file.name} | ${(file.size / 1024).toFixed(1)} KB`);
}

async function fetchSampleAsFile() {
  const sampleName = sampleSelect.value || sampleImages[0]?.name;
  const selectedSample = sampleImages.find((item) => item.name === sampleName) || sampleImages[0];

  if (!selectedSample) {
    throw new Error("未找到可用样例图。");
  }

  const response = await fetch(selectedSample.url);
  const blob = await response.blob();
  return new File([blob], selectedSample.name, {
    type: blob.type || "image/jpeg",
  });
}

async function downscaleImage(file, maxSide, quality) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

async function toImageDataUrl(file) {
  const originalDataUrl = await readFileAsDataUrl(file);
  if (typeof originalDataUrl !== "string") {
    throw new Error("无法生成图片数据。");
  }

  const estimatedBytes = estimateDataUrlBytes(originalDataUrl);
  const vercelSafeLimitBytes = 3.2 * 1024 * 1024;
  if (estimatedBytes > vercelSafeLimitBytes) {
    setStatus("loading", "原图过大，正在自动压缩到适合在线部署的大小。");
    loadingOverlayText.textContent = "原图过大，正在压缩后再提交识别。";
    const attempts = [
      { maxSide: 1800, quality: 0.9 },
      { maxSide: 1500, quality: 0.82 },
      { maxSide: 1280, quality: 0.76 },
    ];

    for (const attempt of attempts) {
      const compressedDataUrl = await downscaleImage(
        file,
        attempt.maxSide,
        attempt.quality
      );
      if (estimateDataUrlBytes(compressedDataUrl) <= vercelSafeLimitBytes) {
        return compressedDataUrl;
      }
    }

    throw new Error(
      "图片过大，自动压缩后仍超过在线部署限制。请先裁剪出水尺区域，或改用更小的图片。"
    );
  }

  return originalDataUrl;
}

async function ensureSelectedFile() {
  if (currentImageFile) {
    return currentImageFile;
  }
  const sampleFile = await fetchSampleAsFile();
  currentImageFile = sampleFile;
  const selectedSample =
    sampleImages.find((item) => item.name === sampleFile.name) || sampleImages[0];
  if (selectedSample) {
    setPreviewFromUrl(selectedSample.url, `当前为样例图：${selectedSample.name}`);
  }
  return sampleFile;
}

async function analyze() {
  setLoadingState(true);
  setStatus("loading", "正在上传原始图片并调用豆包视觉模型，请稍候。");
  rawOutput.textContent = "请求中...";

  try {
    const file = await ensureSelectedFile();
    const imageDataUrl = await toImageDataUrl(file);
    const requestPayload = {
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim(),
      prompt: promptInput.value.trim(),
      imageDataUrl,
    };
    const { response, responseText, data } = await requestAnalyze(requestPayload);
    rawOutput.textContent = data
      ? JSON.stringify(data, null, 2)
      : responseText || "服务端未返回正文。";

    if (!data) {
      const message = summarizePlainTextError(responseText, response.status);
      setStatus("error", `识别失败：${message}`);
      renderResult(null, message);
      return;
    }

    if (!response.ok || !data.ok) {
      const message =
        data.error ||
        summarizePlainTextError(
          typeof data.providerBody === "string" ? data.providerBody : data.detail || "",
          response.status
        );
      setStatus("error", `识别失败：${message}`);
      renderResult(
        null,
        typeof data.providerBody === "string" ? data.providerBody : data.detail || message
      );
      return;
    }

    renderResult(data.parsedResult, data.rawText);
    setStatus(
      "success",
      data.parsedResult?.status === "ok"
        ? "模型已返回结构化结果。"
        : "模型已返回结果，但建议人工复核。"
    );
  } catch (error) {
    setStatus("error", `识别失败：${error instanceof Error ? error.message : String(error)}`);
    rawOutput.textContent = String(error);
    renderResult(null, "请求过程中发生异常。");
  } finally {
    setLoadingState(false);
  }
}

fileInput.addEventListener("change", () => {
  const [file] = fileInput.files || [];
  if (!file) {
    return;
  }
  currentImageFile = file;
  setPreviewFromFile(file);
  setStatus("idle", "已载入本地图片，可以开始识别。");
});

useSampleButton.addEventListener("click", async () => {
  currentImageFile = await fetchSampleAsFile();
  const selectedSample =
    sampleImages.find((item) => item.name === currentImageFile.name) || sampleImages[0];
  if (selectedSample) {
    setPreviewFromUrl(selectedSample.url, `当前为样例图：${selectedSample.name}`);
  }
  setStatus("idle", "样例图已载入，可以直接点击开始识别。");
});

sampleSelect.addEventListener("change", () => {
  currentImageFile = null;
  const selectedSample = sampleImages.find((item) => item.name === sampleSelect.value);
  if (!selectedSample) {
    return;
  }
  setPreviewFromUrl(selectedSample.url, `当前为样例图：${selectedSample.name}`);
  setStatus("idle", "已切换样例图，可以直接点击开始识别。");
});

analyzeButton.addEventListener("click", analyze);

toggleRawButton.addEventListener("click", () => {
  rawExpanded = !rawExpanded;
  rawOutput.classList.toggle("collapsed", !rawExpanded);
  toggleRawButton.textContent = rawExpanded ? "收起" : "展开";
});

loadConfig();
loadSamples();
