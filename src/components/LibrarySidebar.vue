<script setup lang="ts">
import { computed, ref } from "vue";
import { AlertCircle, BookOpen, CheckCircle2, Clock3, Globe2, Search, Trash2, Upload } from "lucide-vue-next";
import type { BookSummary, ImportBookResult } from "@/shared/types";

const props = defineProps<{
  books: BookSummary[];
  activeBookId: string;
  loading: boolean;
  importing: boolean;
  crawling: boolean;
  lastImport: ImportBookResult | null;
}>();

const emit = defineEmits<{
  import: [];
  crawl: [];
  select: [bookId: string];
  delete: [bookId: string];
}>();

const keyword = ref("");

const filteredBooks = computed(() => {
  const value = keyword.value.trim().toLowerCase();

  if (!value) {
    return props.books;
  }

  return props.books.filter((book) => `${book.title} ${book.filePath}`.toLowerCase().includes(value));
});

const failedImports = computed(() => props.lastImport?.failed.slice(0, 3) ?? []);

function fileNameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function confirmDelete(book: BookSummary): void {
  if (window.confirm(`删除《${book.title}》及其阅读记录？`)) {
    emit("delete", book.id);
  }
}
</script>

<template>
  <aside class="library-sidebar" aria-label="书库">
    <header class="sidebar-header">
      <div>
        <p class="eyebrow">TXT Library</p>
        <h1>小说朗读器</h1>
      </div>
      <div class="header-actions">
        <button class="icon-button" type="button" title="网页抓取" :disabled="crawling" @click="emit('crawl')">
          <Globe2 :size="18" aria-hidden="true" />
        </button>
        <button class="icon-text-button primary" type="button" :disabled="importing" @click="emit('import')">
          <Upload :size="18" aria-hidden="true" />
          <span>{{ importing ? "导入中" : "导入" }}</span>
        </button>
      </div>
    </header>

    <label class="search-box">
      <Search :size="17" aria-hidden="true" />
      <input v-model="keyword" type="search" placeholder="搜索书名或路径" />
    </label>

    <div
      v-if="lastImport && (lastImport.failed.length > 0 || lastImport.imported.length > 0)"
      class="import-result"
      :class="{ failed: lastImport.failed.length > 0 }"
      role="status"
    >
      <template v-if="lastImport.failed.length > 0">
        <div class="import-result-title">
          <AlertCircle :size="16" aria-hidden="true" />
          <strong>{{ lastImport.failed.length }} 个文件未导入</strong>
        </div>
        <div v-for="item in failedImports" :key="item.filePath" class="import-failure">
          <span>{{ fileNameOf(item.filePath) }}</span>
          <small>{{ item.message }}</small>
        </div>
      </template>
      <template v-else>
        <div class="import-result-title">
          <CheckCircle2 :size="16" aria-hidden="true" />
          <strong>已导入 {{ lastImport.imported.length }} 本</strong>
        </div>
      </template>
    </div>

    <div class="book-list" :aria-busy="loading">
      <button
        v-for="book in filteredBooks"
        :key="book.id"
        class="book-item"
        :class="{ active: book.id === activeBookId }"
        type="button"
        @click="emit('select', book.id)"
      >
        <span class="book-icon"><BookOpen :size="18" aria-hidden="true" /></span>
        <span class="book-main">
          <span class="book-title">{{ book.title }}</span>
          <span class="book-meta">
            <Clock3 :size="13" aria-hidden="true" />
            {{ formatPercent(book.progress.percent) }} · {{ book.totalChapters }} 章
          </span>
        </span>
        <span class="progress-track" aria-hidden="true">
          <span class="progress-fill" :style="{ width: `${book.progress.percent}%` }"></span>
        </span>
        <span class="delete-wrap">
          <button class="icon-button subtle" type="button" title="删除" @click.stop="confirmDelete(book)">
            <Trash2 :size="16" aria-hidden="true" />
          </button>
        </span>
      </button>

      <div v-if="filteredBooks.length === 0" class="empty-library">
        <BookOpen :size="28" aria-hidden="true" />
        <span>{{ books.length === 0 ? "书库为空" : "没有匹配结果" }}</span>
      </div>
    </div>
  </aside>
</template>
