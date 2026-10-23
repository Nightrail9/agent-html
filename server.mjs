import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const model = process.env.DASHSCOPE_TTS_MODEL || "qwen-audio-3.1-tts-flash";
const apiKey = process.env.DASHSCOPE_API_KEY;
const cacheRoot = join(root, ".tts-cache");
const audioJobs = new Map();
const baseUrl = process.env.DASHSCOPE_BASE_URL;

const staticAssets = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/tts.js", { file: "tts.js", type: "text/javascript; charset=utf-8" }],
  ["/parts/part1-tech-core.js", { file: "parts/part1-tech-core.js", type: "text/javascript; charset=utf-8" }],
  ["/parts/part2-tech-eng.js", { file: "parts/part2-tech-eng.js", type: "text/javascript; charset=utf-8" }],
  ["/parts/part3-exp-soft.js", { file: "parts/part3-exp-soft.js", type: "text/javascript; charset=utf-8" }],
]);

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64 * 1024) throw new Error("请求内容过大");
  }
  return JSON.parse(body);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function synthesize(text, voice) {
  if (!apiKey || !baseUrl) throw httpError(503, "请在 .env 中配置 DASHSCOPE_API_KEY 和 DASHSCOPE_BASE_URL。");

  let endpoint;
  try {
    const configuredUrl = new URL(baseUrl);
    if (configuredUrl.protocol !== "https:" || !configuredUrl.pathname.endsWith("/compatible-mode/v1")) {
      throw new Error("DASHSCOPE_BASE_URL 格式无效");
    }
    endpoint = `${configuredUrl.origin}/api/v1/services/audio/tts/SpeechSynthesizer`;
  } catch {
    throw httpError(500, "DASHSCOPE_BASE_URL 必须是百炼 compatible-mode/v1 HTTPS 地址。");
  }

  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: { text, voice, format: "mp3", sample_rate: 24000 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!upstream.ok) {
    const details = await upstream.json().catch(() => ({}));
    throw httpError(upstream.status, details.message || details.error?.message || `百炼接口返回 HTTP ${upstream.status}`);
  }

  const result = await upstream.json();
  const audioUrl = result?.output?.audio?.url;
  if (typeof audioUrl !== "string") throw httpError(502, "百炼响应中缺少音频下载地址。");

  const audio = await fetch(audioUrl, { signal: AbortSignal.timeout(60_000) });
  if (!audio.ok) throw httpError(502, `下载合成音频失败（HTTP ${audio.status}）。`);
  return Buffer.from(await audio.arrayBuffer());
}

async function ensureAudio(text, voice) {
  const key = createHash("sha256")
    .update(JSON.stringify({ model, baseUrl, voice, text }))
    .digest("hex");
  const file = join(cacheRoot, `${key}.mp3`);
  try {
    await stat(file);
    return { key, file, cached: true };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const runningJob = audioJobs.get(key);
  if (runningJob) {
    await runningJob;
    return { key, file, cached: true };
  }

  const job = (async () => {
    await mkdir(cacheRoot, { recursive: true });
    const bytes = await synthesize(text, voice);
    const temporaryFile = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryFile, bytes, { flag: "wx" });
      await rename(temporaryFile, file);
    } catch (error) {
      await rm(temporaryFile, { force: true });
      throw error;
    }
  })();
  audioJobs.set(key, job);
  try {
    await job;
    return { key, file, cached: false };
  } finally {
    audioJobs.delete(key);
  }
}

async function prepareSpeech(request, response) {
  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return json(response, 400, { error: error.message === "请求内容过大" ? error.message : "请求体必须是有效 JSON。" });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json(response, 400, { error: "请求体必须是 JSON 对象。" });
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const voice = typeof payload.voice === "string" ? payload.voice : "longanlingxin_v3.1";
  if (!text) return json(response, 400, { error: "请输入要合成的文本。" });
  if (text.length > 3000) return json(response, 400, { error: "文本不能超过 3000 个字符。" });
  if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(voice)) return json(response, 400, { error: "音色参数无效。" });

  try {
    const audio = await ensureAudio(text, voice);
    response.setHeader("Cache-Control", "no-store");
    return json(response, 200, { audioUrl: `/api/tts/audio/${audio.key}`, cached: audio.cached });
  } catch (error) {
    const message = error.name === "TimeoutError" ? "百炼语音合成请求超时，请稍后重试。" : error.message;
    return json(response, error.status || 502, { error: message || "百炼语音合成调用失败，请检查网络、API Key 和模型权限。" });
  }
}

async function serveCachedAudio(request, response, pathname) {
  const match = pathname.match(/^\/api\/tts\/audio\/([a-f0-9]{64})$/);
  if (!match) return false;

  const file = join(cacheRoot, `${match[1]}.mp3`);
  let fileInfo;
  try {
    fileInfo = await stat(file);
  } catch (error) {
    if (error.code === "ENOENT") json(response, 404, { error: "该专题音频尚未预生成。" });
    else json(response, 500, { error: "无法读取专题音频缓存。" });
    return true;
  }

  let start = 0;
  let end = fileInfo.size - 1;
  let status = 200;
  const range = request.headers.range;
  if (range) {
    const rangeMatch = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!rangeMatch || (!rangeMatch[1] && !rangeMatch[2])) {
      response.writeHead(416, { "Content-Range": `bytes */${fileInfo.size}` });
      response.end();
      return true;
    }
    if (rangeMatch[1]) {
      start = Number(rangeMatch[1]);
      if (rangeMatch[2]) end = Number(rangeMatch[2]);
    } else {
      const suffixLength = Number(rangeMatch[2]);
      start = Math.max(0, fileInfo.size - suffixLength);
    }
    if (start >= fileInfo.size || end < start) {
      response.writeHead(416, { "Content-Range": `bytes */${fileInfo.size}` });
      response.end();
      return true;
    }
    end = Math.min(end, fileInfo.size - 1);
    status = 206;
  }

  response.writeHead(status, {
    "Content-Type": "audio/mpeg",
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${fileInfo.size}` } : {}),
  });
  const stream = createReadStream(file, { start, end });
  stream.on("error", (error) => {
    if (!response.headersSent) json(response, 500, { error: "读取专题音频失败。" });
    else response.destroy(error);
  });
  response.on("close", () => stream.destroy());
  stream.pipe(response);
  return true;
}

const server = createServer(async (request, response) => {
  const pathname = request.url?.split("?", 1)[0];
  if (request.method === "POST" && pathname === "/api/tts/prepare") return prepareSpeech(request, response);
  if (request.method === "GET" && pathname?.startsWith("/api/tts/audio/")) {
    if (await serveCachedAudio(request, response, pathname)) return;
  }
  if (request.method === "GET") {
    response.setHeader("Cache-Control", "no-store");
    const asset = staticAssets.get(pathname);
    if (asset) {
      try {
        const bytes = await readFile(join(root, asset.file));
        response.writeHead(200, {
          "Content-Type": asset.type,
          "Content-Length": bytes.length,
          "X-Content-Type-Options": "nosniff",
        });
        return response.end(bytes);
      } catch (error) {
        const missing = error.code === "ENOENT" || error.code === "ENOTDIR";
        return json(response, missing ? 404 : 500, {
          error: missing ? "未找到请求资源。" : "无法读取请求资源。",
        });
      }
    }
  }
  json(response, 404, { error: "未找到请求路径。" });
});


server.listen(port, "127.0.0.1", () => console.log(`应用已启动：http://localhost:${port}`));
