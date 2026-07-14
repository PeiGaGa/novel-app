<script setup lang="ts">
import { Pause, Play, RotateCcw, SkipBack, SkipForward, Square } from "lucide-vue-next";

defineProps<{
  hasBook: boolean;
  speaking: boolean;
  paused: boolean;
  supported: boolean;
  progress: number;
}>();

const emit = defineEmits<{
  previous: [];
  next: [];
  speak: [];
  pause: [];
  resume: [];
  stop: [];
}>();
</script>

<template>
  <div class="reader-toolbar" aria-label="朗读控制">
    <div class="toolbar-group">
      <button class="icon-button" type="button" title="上一章" :disabled="!hasBook" @click="emit('previous')">
        <SkipBack :size="18" aria-hidden="true" />
      </button>
      <button
        v-if="!speaking"
        class="icon-text-button primary"
        type="button"
        :disabled="!hasBook || !supported"
        @click="emit('speak')"
      >
        <Play :size="18" aria-hidden="true" />
        <span>朗读</span>
      </button>
      <button v-else-if="paused" class="icon-text-button primary" type="button" @click="emit('resume')">
        <Play :size="18" aria-hidden="true" />
        <span>继续</span>
      </button>
      <button v-else class="icon-text-button primary" type="button" @click="emit('pause')">
        <Pause :size="18" aria-hidden="true" />
        <span>暂停</span>
      </button>
      <button class="icon-button" type="button" title="停止" :disabled="!speaking" @click="emit('stop')">
        <Square :size="17" aria-hidden="true" />
      </button>
      <button class="icon-button" type="button" title="重读本章" :disabled="!hasBook || !supported" @click="emit('speak')">
        <RotateCcw :size="17" aria-hidden="true" />
      </button>
      <button class="icon-button" type="button" title="下一章" :disabled="!hasBook" @click="emit('next')">
        <SkipForward :size="18" aria-hidden="true" />
      </button>
    </div>

    <div class="speech-meter" aria-hidden="true">
      <span :style="{ width: `${progress}%` }"></span>
    </div>
  </div>
</template>
