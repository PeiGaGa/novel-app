import { contextBridge, ipcRenderer } from "electron";
import type {
  BookDetail,
  BookSummary,
  CrawlNovelInput,
  CrawlNovelProgress,
  CrawlNovelResult,
  ImportBookResult,
  NovelApi,
  ProgressRecord,
  ReaderSettings,
  SaveProgressInput
} from "../../src/shared/types";

const api: NovelApi = {
  selectTxtFiles: () => ipcRenderer.invoke("books:importTxt") as Promise<ImportBookResult>,
  crawlNovel: (input: CrawlNovelInput) =>
    ipcRenderer.invoke("books:crawlNovel", input) as Promise<CrawlNovelResult>,
  crawlNovelWithBrowser: (input: CrawlNovelInput) =>
    ipcRenderer.invoke("books:crawlNovelWithBrowser", input) as Promise<CrawlNovelResult>,
  onCrawlProgress: (callback: (progress: CrawlNovelProgress) => void) => {
    ipcRenderer.removeAllListeners("books:crawlProgress");
    ipcRenderer.on("books:crawlProgress", (_event, progress: CrawlNovelProgress) => callback(progress));
  },
  clearCrawlProgressListener: () => {
    ipcRenderer.removeAllListeners("books:crawlProgress");
  },
  listBooks: () => ipcRenderer.invoke("books:list") as Promise<BookSummary[]>,
  getBook: (bookId: string) => ipcRenderer.invoke("books:get", bookId) as Promise<BookDetail>,
  deleteBook: (bookId: string) => ipcRenderer.invoke("books:delete", bookId) as Promise<void>,
  saveProgress: (input: SaveProgressInput) =>
    ipcRenderer.invoke("progress:save", input) as Promise<ProgressRecord>,
  getSettings: () => ipcRenderer.invoke("settings:get") as Promise<ReaderSettings>,
  saveSettings: (settings: ReaderSettings) =>
    ipcRenderer.invoke("settings:save", settings) as Promise<ReaderSettings>,
  openWebview: (url: string) => {
    ipcRenderer.send("webview:open", url);
  }
};

contextBridge.exposeInMainWorld("novelAPI", api);
