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
const previewImage = document.querySelector("#previewImage");
const imageMeta = document.querySelector("#imageMeta");
const statusBar = document.querySelector("#statusBar");
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

function setStatus(kind, message) {
  statusBar.className = `status-bar ${kind}`;
  statusBar.textContent = message;
}

function estimateDataUrlBytes(dataUrl) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    return dataUrl.length;
  }
  const base64 = dataUrl.slice(commaIndex + 1);
  return Math.floor((base64.length * 3) / 4);
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

async function toOriginalImageDataUrl(file) {
  const dataUrl = await readFileAsDataUrl(file);
  if (typeof dataUrl !== "string") {
    throw new Error("无法生成图片数据。");
  }

  const estimatedBytes = estimateDataUrlBytes(dataUrl);
  const vercelSafeLimitBytes = 3.2 * 1024 * 1024;
  if (estimatedBytes > vercelSafeLimitBytes) {
    throw new Error(
      "图片过大。当前 Vercel 部署的函数请求体上限约为 4.5 MB，原图经过 base64 后会继续膨胀。请先裁剪水尺区域，或压缩到 3.2 MB 以下再上传。"
    );
  }

  return dataUrl;
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
  analyzeButton.disabled = true;
  setStatus("loading", "正在上传原始图片并调用豆包视觉模型，请稍候。");
  rawOutput.textContent = "请求中...";

  try {
    const file = await ensureSelectedFile();
    const imageDataUrl = await toOriginalImageDataUrl(file);
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apiKey: apiKeyInput.value.trim(),
        model: modelInput.value.trim(),
        prompt: promptInput.value.trim(),
        imageDataUrl,
      }),
    });

    const data = await response.json();
    rawOutput.textContent = JSON.stringify(data, null, 2);

    if (!response.ok || !data.ok) {
      setStatus("error", data.error || "识别失败，请检查接口配置。");
      renderResult(null, typeof data.providerBody === "string" ? data.providerBody : data.detail);
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
    analyzeButton.disabled = false;
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
