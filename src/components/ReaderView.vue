<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { FileText } from "lucide-vue-next";
import type { BookDetail, Chapter, TextRange } from "@/shared/types";

const props = defineProps<{
  book: BookDetail | null;
  chapter: Chapter | null;
  chapterIndex: number;
  fontSize: number;
  lineHeight: number;
  progressScrollTop: number;
  highlightRange: TextRange | null;
}>();

const emit = defineEmits<{
  selectChapter: [index: number];
  progress: [scrollTop: number, scrollPercent: number];
}>();

const readerBody = ref<HTMLElement | null>(null);
const highlightEl = ref<HTMLElement | null>(null);
let saveTimer = 0;

const chapterTitle = computed(() => props.chapter?.title ?? "未选择章节");
const wordCount = computed(() => props.chapter?.charCount ?? 0);
const highlightedContent = computed(() => {
  const content = props.chapter?.content ?? "";
  const range = props.highlightRange;

  if (!range || range.end <= range.start || content.length === 0) {
    return null;
  }

  const start = Math.max(0, Math.min(range.start, content.length));
  const end = Math.max(start, Math.min(range.end, content.length));

  if (end <= start) {
    return null;
  }

  return {
    before: content.slice(0, start),
    active: content.slice(start, end),
    after: content.slice(end)
  };
});

function handleScroll(event: Event): void {
  const target = event.currentTarget as HTMLElement;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const maxScroll = Math.max(1, target.scrollHeight - target.clientHeight);
    emit("progress", target.scrollTop, (target.scrollTop / maxScroll) * 100);
  }, 320);
}

watch(
  () => [props.book?.id, props.chapter?.id],
  async () => {
    await nextTick();

    if (readerBody.value) {
      readerBody.value.scrollTop =
        props.book?.progress.chapterIndex === props.chapterIndex ? props.progressScrollTop : 0;
    }
  },
  { immediate: true }
);

watch(
  () => [props.highlightRange?.start, props.highlightRange?.end],
  async () => {
    await nextTick();
    highlightEl.value?.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "smooth"
    });
  }
);
</script>

<template>
  <section class="reader-view">
    <nav class="chapter-list" aria-label="章节">
      <button
        v-for="item in book?.chapters ?? []"
        :key="item.id"
        class="chapter-button"
        :class="{ active: item.index === chapterIndex }"
        type="button"
        @click="emit('selectChapter', item.index)"
      >
        <span>{{ item.title }}</span>
      </button>
    </nav>

    <article class="reader-document">
      <header class="reader-heading">
        <p v-if="book" class="eyebrow">{{ book.title }}</p>
        <h2>{{ chapterTitle }}</h2>
        <span v-if="chapter" class="chapter-count">{{ wordCount.toLocaleString("zh-CN") }} 字</span>
      </header>

      <div
        ref="readerBody"
        class="reader-body"
        :style="{ fontSize: `${fontSize}px`, lineHeight }"
        @scroll="handleScroll"
      >
        <div v-if="chapter" class="chapter-content">
          <template v-if="highlightedContent">
            <span>{{ highlightedContent.before }}</span>
            <mark ref="highlightEl" class="speech-highlight">{{ highlightedContent.active }}</mark>
            <span>{{ highlightedContent.after }}</span>
          </template>
          <template v-else>{{ chapter.content }}</template>
        </div>
        <div v-else class="empty-reader">
          <FileText :size="40" aria-hidden="true" />
          <span>选择或导入一本 TXT 小说</span>
        </div>
      </div>
    </article>
  </section>
</template>
