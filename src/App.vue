<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import LibrarySidebar from "@/components/LibrarySidebar.vue";
import ReaderToolbar from "@/components/ReaderToolbar.vue";
import ReaderView from "@/components/ReaderView.vue";
import SettingsPanel from "@/components/SettingsPanel.vue";
import WebCrawlerDialog from "@/components/WebCrawlerDialog.vue";
import { useSpeech } from "@/composables/useSpeech";
import { useLibraryStore } from "@/stores/library";
import { usePreferencesStore } from "@/stores/preferences";
import type { CrawlNovelInput } from "@/shared/types";

const library = useLibraryStore();
const preferences = usePreferencesStore();
const speech = useSpeech();
const crawlerOpen = ref(false);

const currentChapter = computed(() => library.currentChapter);
const hasBook = computed(() => Boolean(library.activeBook && currentChapter.value));
const globalError = computed(() => library.error || preferences.error || speech.error.value);

async function selectBook(bookId: string): Promise<void> {
  speech.stop();
  await library.openBook(bookId);
}

async function selectChapter(index: number): Promise<void> {
  speech.stop();
  library.setChapter(index);
  await library.saveProgress(0, 0);
}

async function previousChapter(): Promise<void> {
  await selectChapter(library.activeChapterIndex - 1);
}

async function nextChapter(readAfterChange = false): Promise<void> {
  if (!library.activeBook) {
    return;
  }

  const lastIndex = library.activeBook.chapters.length - 1;

  if (library.activeChapterIndex >= lastIndex) {
    speech.stop();
    return;
  }

  library.setChapter(library.activeChapterIndex + 1);
  await library.saveProgress(0, 0);

  if (readAfterChange) {
    window.setTimeout(() => readCurrentChapter(), 120);
  }
}

function readCurrentChapter(): void {
  if (!currentChapter.value) {
    return;
  }

  speech.speak(currentChapter.value.content, preferences.settings, () => {
    if (preferences.settings.autoNext) {
      void nextChapter(true);
    }
  });
}

async function saveReadingProgress(scrollTop: number, scrollPercent: number): Promise<void> {
  try {
    await library.saveProgress(scrollTop, scrollPercent);
  } catch (error) {
    library.error = error instanceof Error ? error.message : "保存进度失败。";
  }
}

async function crawlNovel(input: CrawlNovelInput): Promise<void> {
  await library.crawlNovel(input);

  if (!library.error) {
    crawlerOpen.value = false;
  }
}

watch(
  () => preferences.settings.theme,
  (theme) => {
    document.documentElement.dataset.theme = theme;
  },
  { immediate: true }
);

onMounted(async () => {
  await Promise.all([preferences.load(), library.loadBooks()]);

  if (!library.activeBook && library.books.length > 0) {
    await library.openBook(library.books[0].id);
  }
});
</script>

<template>
  <div class="app-shell">
    <LibrarySidebar
      :books="library.books"
      :active-book-id="library.activeBookId"
      :loading="library.loading"
      :importing="library.importing"
      :crawling="library.crawling"
      :last-import="library.lastImport"
      @import="library.importTxt"
      @crawl="crawlerOpen = true"
      @select="selectBook"
      @delete="library.deleteBook"
    />

    <main class="main-pane">
      <ReaderToolbar
        :has-book="hasBook"
        :speaking="speech.speaking.value"
        :paused="speech.paused.value"
        :supported="speech.supported"
        :progress="speech.progress.value"
        @previous="previousChapter"
        @next="nextChapter(false)"
        @speak="readCurrentChapter"
        @pause="speech.pause"
        @resume="speech.resume"
        @stop="speech.stop"
      />

      <p v-if="globalError" class="error-banner" role="alert">{{ globalError }}</p>

      <ReaderView
        :book="library.activeBook"
        :chapter="currentChapter"
        :chapter-index="library.activeChapterIndex"
        :font-size="preferences.settings.fontSize"
        :line-height="preferences.settings.lineHeight"
        :progress-scroll-top="library.activeBook?.progress.scrollTop ?? 0"
        :highlight-range="speech.activeRange.value"
        @select-chapter="selectChapter"
        @progress="saveReadingProgress"
      />
    </main>

    <SettingsPanel
      :settings="preferences.settings"
      :voices="speech.voices.value"
      :speech-supported="speech.supported"
      @update="preferences.save"
    />

    <WebCrawlerDialog
      :open="crawlerOpen"
      :crawling="library.crawling"
      :progress="library.crawlProgress"
      @close="crawlerOpen = false"
      @submit="crawlNovel"
    />
  </div>
</template>
