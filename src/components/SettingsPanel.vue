<script setup lang="ts">
import { SlidersHorizontal, Volume2 } from "lucide-vue-next";
import type { ReaderSettings, ReaderTheme } from "@/shared/types";

const props = defineProps<{
  settings: ReaderSettings;
  voices: SpeechSynthesisVoice[];
  speechSupported: boolean;
}>();

const emit = defineEmits<{
  update: [patch: Partial<ReaderSettings>];
}>();

function patch(update: Partial<ReaderSettings>): void {
  emit("update", update);
}

function numberValue(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}

function textValue(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}
</script>

<template>
  <aside class="settings-panel" aria-label="阅读设置">
    <header class="panel-title">
      <SlidersHorizontal :size="18" aria-hidden="true" />
      <h2>设置</h2>
    </header>

    <label class="field">
      <span>主题</span>
      <select :value="settings.theme" @change="patch({ theme: textValue($event) as ReaderTheme })">
        <option value="paper">纸页</option>
        <option value="light">明亮</option>
        <option value="night">夜间</option>
      </select>
    </label>

    <label class="field">
      <span>语音</span>
      <select
        :value="settings.voiceURI"
        :disabled="!speechSupported"
        @change="patch({ voiceURI: textValue($event) })"
      >
        <option value="">系统默认</option>
        <option v-for="voice in voices" :key="voice.voiceURI" :value="voice.voiceURI">
          {{ voice.name }} · {{ voice.lang }}
        </option>
      </select>
    </label>

    <label class="field range-field">
      <span>字号 {{ settings.fontSize }}</span>
      <input
        type="range"
        min="14"
        max="34"
        step="1"
        :value="settings.fontSize"
        @input="patch({ fontSize: numberValue($event) })"
      />
    </label>

    <label class="field range-field">
      <span>行距 {{ settings.lineHeight.toFixed(2) }}</span>
      <input
        type="range"
        min="1.3"
        max="2.4"
        step="0.05"
        :value="settings.lineHeight"
        @input="patch({ lineHeight: numberValue($event) })"
      />
    </label>

    <label class="field range-field">
      <span>语速 {{ settings.rate.toFixed(1) }}</span>
      <input
        type="range"
        min="0.5"
        max="2"
        step="0.1"
        :value="settings.rate"
        @input="patch({ rate: numberValue($event) })"
      />
    </label>

    <label class="field range-field">
      <span>音调 {{ settings.pitch.toFixed(1) }}</span>
      <input
        type="range"
        min="0.5"
        max="2"
        step="0.1"
        :value="settings.pitch"
        @input="patch({ pitch: numberValue($event) })"
      />
    </label>

    <label class="field range-field">
      <span class="field-inline"><Volume2 :size="15" aria-hidden="true" /> 音量 {{ Math.round(settings.volume * 100) }}%</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        :value="settings.volume"
        @input="patch({ volume: numberValue($event) })"
      />
    </label>

    <label class="toggle-field">
      <input
        type="checkbox"
        :checked="settings.autoNext"
        @change="patch({ autoNext: ($event.target as HTMLInputElement).checked })"
      />
      <span>自动下一章</span>
    </label>
  </aside>
</template>
