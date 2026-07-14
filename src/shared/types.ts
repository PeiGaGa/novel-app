export type ReaderTheme = "paper" | "light" | "night";

export interface ProgressRecord {
  bookId: string;
  chapterIndex: number;
  scrollTop: number;
  percent: number;
  updatedAt: string;
}

export interface BookSummary {
  id: string;
  title: string;
  filePath: string;
  encoding: string;
  totalChapters: number;
  totalChars: number;
  createdAt: string;
  updatedAt: string;
  progress: ProgressRecord;
}

export interface Chapter {
  id: string;
  bookId: string;
  index: number;
  title: string;
  content: string;
  charCount: number;
}

export interface BookDetail extends BookSummary {
  chapters: Chapter[];
}

export interface ImportBookResult {
  imported: BookSummary[];
  failed: Array<{
    filePath: string;
    message: string;
  }>;
}

export interface CrawlNovelInput {
  url: string;
  title?: string;
  contentSelector?: string;
  maxChapters: number;
  delayMs: number;
}

export interface CrawlNovelResult {
  book: BookSummary;
  filePath: string;
  sourceUrl: string;
  chapterCount: number;
  failedChapters: Array<{
    url: string;
    title: string;
    message: string;
  }>;
}

export interface CrawlNovelProgress {
  phase: "loading" | "discovering" | "crawling" | "saving" | "completed";
  current: number;
  total: number;
  message: string;
  currentUrl?: string;
}

export interface SaveProgressInput {
  bookId: string;
  chapterIndex: number;
  scrollTop: number;
  percent: number;
}

export interface TextRange {
  start: number;
  end: number;
}

export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  theme: ReaderTheme;
  voiceURI: string;
  rate: number;
  pitch: number;
  volume: number;
  autoNext: boolean;
}

export interface NovelApi {
  selectTxtFiles(): Promise<ImportBookResult>;
  crawlNovel(input: CrawlNovelInput): Promise<CrawlNovelResult>;
  crawlNovelWithBrowser(input: CrawlNovelInput): Promise<CrawlNovelResult>;
  onCrawlProgress(callback: (progress: CrawlNovelProgress) => void): void;
  clearCrawlProgressListener(): void;
  listBooks(): Promise<BookSummary[]>;
  getBook(bookId: string): Promise<BookDetail>;
  deleteBook(bookId: string): Promise<void>;
  saveProgress(input: SaveProgressInput): Promise<ProgressRecord>;
  getSettings(): Promise<ReaderSettings>;
  saveSettings(settings: ReaderSettings): Promise<ReaderSettings>;
  openWebview(url: string): void;
}
