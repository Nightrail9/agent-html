const TTS_VOICE = "longanlingxin_v3.1";
const TTS_MAX_TEXT_LENGTH = 2800;
const ttsState = {
  audioByTopic: new Map(),
  currentTopicId: null,
  running: false,
  error: "",
  cacheHits: 0,
  playbackRate: 1,
};

function formatAudioTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function getTopicSpeechText(entry) {
  const script = typeof entry.topic.podcastScript === "string" ? entry.topic.podcastScript.trim() : "";
  if (!script) throw new Error(`${entry.topic.title}缺少静态播客稿。`);
  return script;
}

function updatePreparationUi() {
  const total = TOPIC_INDEX.length;
  const completed = ttsState.audioByTopic.size;
  const progress = document.getElementById("tts-preparation-progress");
  const label = document.getElementById("tts-preparation-label");
  const retry = document.getElementById("tts-retry");
  if (progress) {
    progress.max = total;
    progress.value = completed;
  }
  if (label) {
    const summary = `全站语音预生成：${completed}/${total}${ttsState.cacheHits ? `（命中缓存：${ttsState.cacheHits}）` : ""}`;
    label.textContent = ttsState.error ? `${summary}；失败：${ttsState.error}` : summary;
  }
  if (retry) retry.hidden = !ttsState.error;
}

function updatePlaybackUi(audio) {
  const progress = document.getElementById("tts-progress");
  const currentTime = document.getElementById("tts-current-time");
  const duration = document.getElementById("tts-duration");
  const playButton = document.getElementById("tts-play");
  if (!progress || !currentTime || !duration || !playButton) return;
  const hasDuration = Number.isFinite(audio.duration) && audio.duration > 0;
  progress.disabled = !hasDuration;
  progress.value = hasDuration ? Math.round(audio.currentTime / audio.duration * 1000) : 0;
  currentTime.textContent = formatAudioTime(audio.currentTime);
  duration.textContent = formatAudioTime(audio.duration);
  playButton.textContent = audio.paused ? "▶ 播放" : "❚❚ 暂停";
}

function renderCurrentPlayer() {
  const audio = document.getElementById("tts-audio");
  const playButton = document.getElementById("tts-play");
  const status = document.getElementById("tts-status");
  if (!audio || !playButton || !status) return;
  const rateControl = document.getElementById("tts-playback-rate");
  if (rateControl) rateControl.value = String(ttsState.playbackRate);

  const prepared = ttsState.audioByTopic.get(ttsState.currentTopicId);
  if (prepared) {
    if (audio.dataset.audioUrl !== prepared.audioUrl) {
      audio.pause();
      audio.src = prepared.audioUrl;
      audio.dataset.audioUrl = prepared.audioUrl;
      audio.load();
    }
    playButton.disabled = false;
    status.textContent = prepared.cached ? "语音已就绪（服务端缓存）" : "语音已就绪";
  } else {
    if (audio.dataset.audioUrl) {
      audio.pause();
      audio.removeAttribute("src");
      delete audio.dataset.audioUrl;
      audio.load();
    }
    playButton.disabled = true;
    status.textContent = ttsState.error
      ? `预生成失败：${ttsState.error}`
      : ttsState.running ? "正在预生成本页语音…" : "等待预生成";
  }
  audio.playbackRate = ttsState.playbackRate;
  updatePlaybackUi(audio);
  updatePreparationUi();
}

function bindPlayerEvents() {
  const audio = document.getElementById("tts-audio");
  const playButton = document.getElementById("tts-play");
  const progress = document.getElementById("tts-progress");
  const rateControl = document.getElementById("tts-playback-rate");
  if (!audio || !playButton || !progress || !rateControl || audio.dataset.eventsBound) return;
  audio.dataset.eventsBound = "true";
  audio.addEventListener("loadedmetadata", () => updatePlaybackUi(audio));
  audio.addEventListener("timeupdate", () => updatePlaybackUi(audio));
  audio.addEventListener("play", () => updatePlaybackUi(audio));
  audio.addEventListener("pause", () => updatePlaybackUi(audio));
  audio.addEventListener("ended", () => updatePlaybackUi(audio));
  audio.addEventListener("error", () => {
    const status = document.getElementById("tts-status");
    if (status && ttsState.audioByTopic.has(ttsState.currentTopicId)) {
      status.textContent = "音频加载失败，请刷新页面后重试。";
    }
  });
  playButton.addEventListener("click", async () => {
    try {
      if (audio.paused) {
        if (audio.ended) audio.currentTime = 0;
        await audio.play();
      } else {
        audio.pause();
      }
    } catch (error) {
      const status = document.getElementById("tts-status");
      if (status) status.textContent = `播放失败：${error.message}`;
    }
  });
  rateControl.addEventListener("change", () => {
    const rate = Number(rateControl.value);
    if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) return;
    ttsState.playbackRate = rate;
    audio.playbackRate = rate;
  });
  progress.addEventListener("input", () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = Number(progress.value) / 1000 * audio.duration;
      updatePlaybackUi(audio);
    }
  });
}

async function prepareTopicAudio(entry) {
  const text = getTopicSpeechText(entry);
  if (!text || text.length > TTS_MAX_TEXT_LENGTH) {
    throw new Error(`${entry.topic.title}的语音文本超过服务端限制。`);
  }
  const response = await fetch("/api/tts/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: TTS_VOICE }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  if (typeof result.audioUrl !== "string") throw new Error("服务端未返回音频地址。");
  ttsState.audioByTopic.set(entry.topic.id, { audioUrl: result.audioUrl, cached: Boolean(result.cached) });
  if (result.cached) ttsState.cacheHits += 1;
}

async function preGenerateAllTopicAudio() {
  if (ttsState.running || ttsState.audioByTopic.size === TOPIC_INDEX.length) return;
  ttsState.running = true;
  ttsState.error = "";
  renderCurrentPlayer();
  try {
    for (const entry of TOPIC_INDEX) {
      if (ttsState.audioByTopic.has(entry.topic.id)) continue;
      await prepareTopicAudio(entry);
      if (ttsState.currentTopicId === entry.topic.id) renderCurrentPlayer();
      updatePreparationUi();
    }
  } catch (error) {
    ttsState.error = error.message;
  } finally {
    ttsState.running = false;
    renderCurrentPlayer();
  }
}

document.addEventListener("topicchange", () => {
  const audio = document.getElementById("tts-audio");
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
});

document.addEventListener("topicready", (event) => {
  ttsState.currentTopicId = event.detail.topicId;
  bindPlayerEvents();
  renderCurrentPlayer();
  if (!ttsState.running && !ttsState.error && ttsState.audioByTopic.size < TOPIC_INDEX.length) {
    void preGenerateAllTopicAudio();
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#tts-retry")) return;
  ttsState.error = "";
  void preGenerateAllTopicAudio();
});
