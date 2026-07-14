<script setup lang="ts">
import { computed, reactive } from "vue";
import { Globe2, X } from "lucide-vue-next";
import type { CrawlNovelInput } from "@/shared/types";
import type { CrawlNovelProgress } from "@/shared/types";

const props = defineProps<{
  open: boolean;
  crawling: boolean;
  progress: CrawlNovelProgress | null;
}>();

const emit = defineEmits<{
  close: [];
  submit: [input: CrawlNovelInput];
}>();

const form = reactive({
  url: "",
  title: "",
  contentSelector: "",
  maxChapters: 200,
  delayMs: 300
});

const canSubmit = computed(() => /^https?:\/\//i.test(form.url.trim()) && !props.crawling);
const progressPercent = computed(() => {
  if (!props.progress || props.progress.total <= 0) return 0;
  return Math.min(100, Math.max(0, (props.progress.current / props.progress.total) * 100));
});

function submit(): void {
  if (!canSubmit.value) {
    return;
  }

  emit("submit", {
    url: form.url.trim(),
    title: form.title.trim() || undefined,
    contentSelector: form.contentSelector.trim() || undefined,
    maxChapters: form.maxChapters,
    delayMs: form.delayMs
  });
}

function openInBrowser(): void {
  if (canSubmit.value) {
    window.novelAPI.openWebview(form.url.trim());
  }
}
</script>

<template>
  <div v-if="open" class="dialog-backdrop" role="presentation" @click.self="emit('close')">
    <section class="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="crawler-title">
      <header class="dialog-header">
        <div class="dialog-title">
          <Globe2 :size="19" aria-hidden="true" />
          <h2 id="crawler-title">网页抓取为 TXT</h2>
        </div>
        <button class="icon-button subtle" type="button" title="关闭" :disabled="crawling" @click="emit('close')">
          <X :size="18" aria-hidden="true" />
        </button>
      </header>

      <form class="crawler-form" @submit.prevent="submit">
        <label class="field">
          <span>小说目录页或第一章 URL</span>
          <input v-model.trim="form.url" type="url" placeholder="https://example.com/book/123/1.html" required />
        </label>

        <label class="field">
          <span>书名</span>
          <input v-model.trim="form.title" type="text" placeholder="留空时自动读取网页标题" />
        </label>

        <label class="field">
          <span>正文 CSS 选择器</span>
          <input v-model.trim="form.contentSelector" type="text" placeholder="可选，例如 #content 或 .chapter-content" />
        </label>

        <div class="crawler-grid">
          <label class="field">
            <span>最多章节</span>
            <input v-model.number="form.maxChapters" type="number" min="1" max="1000" step="1" />
          </label>
          <label class="field">
            <span>请求间隔 ms</span>
            <input v-model.number="form.delayMs" type="number" min="0" max="5000" step="100" />
          </label>
        </div>

        <p class="dialog-note">
          仅抓取同域名公开静态页面。请确认目标站点允许保存为本地 TXT，不要用于登录、付费、受 DRM 或禁止抓取的内容。
        </p>

        <section v-if="crawling && progress" class="crawl-progress" role="status" aria-live="polite">
          <div class="crawl-progress-header">
            <strong>{{ progress.message }}</strong>
            <span v-if="progress.phase === 'crawling'">{{ progress.current }} / {{ progress.total }}</span>
          </div>
          <div class="crawl-progress-track" aria-hidden="true">
            <span :style="{ width: `${progressPercent}%` }"></span>
          </div>
          <p v-if="progress.currentUrl" :title="progress.currentUrl">{{ progress.currentUrl }}</p>
        </section>

        <footer class="dialog-actions">
          <button class="icon-text-button" type="button" :disabled="crawling" @click="emit('close')">取消</button>
          <button class="icon-text-button" type="button" :disabled="!canSubmit" @click="openInBrowser" title="以纯净阅读模式打开此 URL">
            <Globe2 :size="18" aria-hidden="true" />
            <span>纯净阅读</span>
          </button>
          <button class="icon-text-button primary" type="submit" :disabled="!canSubmit" title="从目录或第一章开始抓取">
            <Globe2 :size="18" aria-hidden="true" />
            <span>{{ crawling ? "抓取中" : "开始抓取" }}</span>
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>
