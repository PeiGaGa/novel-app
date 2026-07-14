import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ReaderSettings, TextRange } from "@/shared/types";

const MAX_UTTERANCE_LENGTH = 220;
const MIN_HARD_BREAK_LENGTH = 18;
const MIN_SOFT_BREAK_LENGTH = 70;

interface SpeechSegment {
  text: string;
  start: number;
  end: number;
}

function isHardBreak(char: string): boolean {
  return /[。！？!?；;]/.test(char);
}

function isSoftBreak(char: string): boolean {
  return /[，,、：:]/.test(char);
}

function isBlank(char: string): boolean {
  return /\s/.test(char);
}

function trimRange(text: string, start: number, end: number): TextRange | null {
  let trimmedStart = start;
  let trimmedEnd = end;

  while (trimmedStart < trimmedEnd && isBlank(text[trimmedStart])) {
    trimmedStart += 1;
  }

  while (trimmedEnd > trimmedStart && isBlank(text[trimmedEnd - 1])) {
    trimmedEnd -= 1;
  }

  return trimmedEnd > trimmedStart ? { start: trimmedStart, end: trimmedEnd } : null;
}

function splitForSpeech(text: string): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  let start = -1;
  let lastBreak = -1;

  function pushSegment(end: number): void {
    if (start < 0) {
      return;
    }

    const range = trimRange(text, start, end);

    if (range) {
      segments.push({
        ...range,
        text: text.slice(range.start, range.end)
      });
    }

    start = -1;
    lastBreak = -1;
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (start < 0) {
      if (isBlank(char)) {
        continue;
      }

      start = index;
    }

    const length = index + 1 - start;

    if (isHardBreak(char)) {
      lastBreak = index + 1;

      if (length >= MIN_HARD_BREAK_LENGTH) {
        pushSegment(index + 1);
      }
    } else if (isSoftBreak(char)) {
      lastBreak = index + 1;

      if (length >= MIN_SOFT_BREAK_LENGTH) {
        pushSegment(index + 1);
      }
    } else if (isBlank(char)) {
      lastBreak = index + 1;
    }

    if (start >= 0 && length >= MAX_UTTERANCE_LENGTH) {
      const end = lastBreak > start + MIN_HARD_BREAK_LENGTH ? lastBreak : index + 1;
      pushSegment(end);
      index = end - 1;
    }
  }

  if (start >= 0) {
    pushSegment(text.length);
  }

  return segments;
}

export function useSpeech() {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const voices = ref<SpeechSynthesisVoice[]>([]);
  const speaking = ref(false);
  const paused = ref(false);
  const error = ref("");
  const queueSize = ref(0);
  const completedChunks = ref(0);
  const activeRange = ref<TextRange | null>(null);

  let queue: SpeechSegment[] = [];
  let cancelled = false;
  let onFinished: (() => void) | undefined;

  const progress = computed(() => {
    if (queueSize.value === 0) {
      return 0;
    }

    return Math.round((completedChunks.value / queueSize.value) * 100);
  });

  function refreshVoices(): void {
    if (!supported) {
      return;
    }

    voices.value = window.speechSynthesis.getVoices().sort((a, b) => {
      const langScore = Number(b.lang.startsWith("zh")) - Number(a.lang.startsWith("zh"));
      return langScore || a.name.localeCompare(b.name, "zh-Hans-CN");
    });
  }

  function speakNext(settings: ReaderSettings): void {
    if (!supported || cancelled) {
      return;
    }

    const segment = queue.shift();

    if (!segment) {
      speaking.value = false;
      paused.value = false;
      completedChunks.value = queueSize.value;
      activeRange.value = null;
      onFinished?.();
      return;
    }

    activeRange.value = {
      start: segment.start,
      end: segment.end
    };

    const utterance = new SpeechSynthesisUtterance(segment.text);
    const selectedVoice = voices.value.find((voice) => voice.voiceURI === settings.voiceURI);

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    utterance.volume = settings.volume;
    utterance.lang = selectedVoice?.lang || "zh-CN";

    utterance.onend = () => {
      completedChunks.value += 1;
      speakNext(settings);
    };

    utterance.onerror = (event) => {
      if (cancelled) {
        return;
      }

      error.value = `朗读中断：${event.error}`;
      speaking.value = false;
      paused.value = false;
      activeRange.value = null;
    };

    window.speechSynthesis.speak(utterance);
  }

  function speak(text: string, settings: ReaderSettings, finishCallback?: () => void): void {
    if (!supported) {
      error.value = "当前系统语音服务不可用。";
      return;
    }

    stop();
    cancelled = false;
    error.value = "";
    queue = splitForSpeech(text);
    queueSize.value = queue.length;
    completedChunks.value = 0;
    activeRange.value = null;
    onFinished = finishCallback;

    if (queue.length === 0) {
      error.value = "当前章节没有可朗读的文本。";
      return;
    }

    speaking.value = true;
    paused.value = false;
    speakNext(settings);
  }

  function pause(): void {
    if (supported && speaking.value && !paused.value) {
      window.speechSynthesis.pause();
      paused.value = true;
    }
  }

  function resume(): void {
    if (supported && speaking.value && paused.value) {
      window.speechSynthesis.resume();
      paused.value = false;
    }
  }

  function stop(): void {
    if (!supported) {
      return;
    }

    cancelled = true;
    window.speechSynthesis.cancel();
    speaking.value = false;
    paused.value = false;
    activeRange.value = null;
    queue = [];
    queueSize.value = 0;
    completedChunks.value = 0;
    onFinished = undefined;
  }

  onMounted(() => {
    refreshVoices();

    if (supported) {
      window.speechSynthesis.onvoiceschanged = refreshVoices;
    }
  });

  onBeforeUnmount(() => {
    stop();

    if (supported) {
      window.speechSynthesis.onvoiceschanged = null;
    }
  });

  return {
    supported,
    voices,
    speaking,
    paused,
    error,
    progress,
    activeRange,
    speak,
    pause,
    resume,
    stop,
    refreshVoices
  };
}
