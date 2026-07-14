import { defineStore } from "pinia";
import type {
  BookDetail,
  BookSummary,
  Chapter,
  CrawlNovelInput,
  CrawlNovelProgress,
  CrawlNovelResult,
  ImportBookResult,
  ProgressRecord
} from "@/shared/types";

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const useLibraryStore = defineStore("library", {
  state: () => ({
    books: [] as BookSummary[],
    activeBook: null as BookDetail | null,
    activeChapterIndex: 0,
    loading: false,
    importing: false,
    crawling: false,
    crawlProgress: null as CrawlNovelProgress | null,
    error: "",
    lastImport: null as ImportBookResult | null,
    lastCrawl: null as CrawlNovelResult | null
  }),
  getters: {
    currentChapter(state): Chapter | null {
      return state.activeBook?.chapters[state.activeChapterIndex] ?? null;
    },
    activeBookId(state): string {
      return state.activeBook?.id ?? "";
    }
  },
  actions: {
    async loadBooks(): Promise<void> {
      this.loading = true;
      this.error = "";

      try {
        this.books = await window.novelAPI.listBooks();
      } catch (error) {
        this.error = messageOf(error, "读取书库失败。");
      } finally {
        this.loading = false;
      }
    },
    async importTxt(): Promise<void> {
      this.importing = true;
      this.error = "";

      try {
        const result = await window.novelAPI.selectTxtFiles();
        this.lastImport = result;
        await this.loadBooks();

        if (result.imported.length > 0) {
          await this.openBook(result.imported[0].id);
        }
      } catch (error) {
        this.error = messageOf(error, "导入 TXT 失败。");
      } finally {
        this.importing = false;
      }
    },
    async crawlNovel(input: CrawlNovelInput): Promise<void> {
      this.crawling = true;
      this.error = "";
      this.crawlProgress = {
        phase: "loading",
        current: 0,
        total: input.maxChapters,
        message: "正在准备抓取"
      };
      window.novelAPI.onCrawlProgress((progress) => {
        this.crawlProgress = progress;
      });

      try {
        // 浏览器内核能正确处理系统代理、旧式中文编码和更多网页兼容性问题。
        const result = await window.novelAPI.crawlNovelWithBrowser(input);
        this.lastCrawl = result;
        this.lastImport = {
          imported: [result.book],
          failed: result.failedChapters.map((chapter) => ({
            filePath: chapter.url,
            message: chapter.message
          }))
        };
        await this.loadBooks();
        await this.openBook(result.book.id);
      } catch (error) {
        this.error = messageOf(error, "网页抓取失败。");
      } finally {
        window.novelAPI.clearCrawlProgressListener();
        this.crawling = false;
      }
    },
    async openBook(bookId: string): Promise<void> {
      this.loading = true;
      this.error = "";

      try {
        const detail = await window.novelAPI.getBook(bookId);
        this.activeBook = detail;
        this.activeChapterIndex = clamp(detail.progress.chapterIndex, 0, Math.max(0, detail.chapters.length - 1));
      } catch (error) {
        this.error = messageOf(error, "打开小说失败。");
      } finally {
        this.loading = false;
      }
    },
    async deleteBook(bookId: string): Promise<void> {
      this.error = "";

      try {
        await window.novelAPI.deleteBook(bookId);

        if (this.activeBook?.id === bookId) {
          this.activeBook = null;
          this.activeChapterIndex = 0;
        }

        await this.loadBooks();
      } catch (error) {
        this.error = messageOf(error, "删除小说失败。");
      }
    },
    setChapter(index: number): void {
      if (!this.activeBook) {
        return;
      }

      this.activeChapterIndex = clamp(index, 0, Math.max(0, this.activeBook.chapters.length - 1));
      this.activeBook.progress = {
        ...this.activeBook.progress,
        chapterIndex: this.activeChapterIndex,
        scrollTop: 0
      };
    },
    async saveProgress(scrollTop: number, scrollPercent: number): Promise<ProgressRecord | null> {
      if (!this.activeBook) {
        return null;
      }

      const chapterCount = Math.max(1, this.activeBook.chapters.length);
      const percent = clamp(((this.activeChapterIndex + clamp(scrollPercent, 0, 100) / 100) / chapterCount) * 100, 0, 100);
      const saved = await window.novelAPI.saveProgress({
        bookId: this.activeBook.id,
        chapterIndex: this.activeChapterIndex,
        scrollTop,
        percent
      });

      this.activeBook.progress = saved;
      const summary = this.books.find((book) => book.id === this.activeBook?.id);

      if (summary) {
        summary.progress = saved;
        summary.updatedAt = saved.updatedAt;
      }

      return saved;
    }
  }
});
