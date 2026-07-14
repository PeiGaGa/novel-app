import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import type {
  CrawlNovelInput,
  CrawlNovelProgress,
  CrawlNovelResult,
  ImportBookResult,
  ReaderSettings,
  SaveProgressInput
} from "../../src/shared/types";
import type { NovelDatabase } from "./database";
import { parseTxtBook } from "./txt";
import { crawlNovelToTxt, crawlNovelWithBrowser } from "./webCrawler";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerIpcHandlers(database: NovelDatabase): void {
  ipcMain.handle("books:list", () => database.listBooks());

  ipcMain.handle("books:get", (_event, bookId: string) => database.getBook(bookId));

  ipcMain.handle("books:delete", (_event, bookId: string) => {
    database.deleteBook(bookId);
  });

  ipcMain.handle("books:importTxt", async (event): Promise<ImportBookResult> => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "导入 TXT 小说",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "TXT 小说",
          extensions: ["txt"]
        }
      ]
    };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);

    if (result.canceled) {
      return { imported: [], failed: [] };
    }

    const imported: ImportBookResult["imported"] = [];
    const failed: ImportBookResult["failed"] = [];

    for (const filePath of result.filePaths) {
      try {
        const parsed = await parseTxtBook(filePath);
        imported.push(database.upsertBook(parsed));
      } catch (error) {
        failed.push({
          filePath,
          message: messageOf(error)
        });
      }
    }

    return { imported, failed };
  });

  ipcMain.handle("books:crawlNovel", async (_event, input: CrawlNovelInput): Promise<CrawlNovelResult> => {
    const outputDir = path.join(app.getPath("documents"), "小说朗读器", "网页抓取");
    const reportProgress = (progress: CrawlNovelProgress): void => {
      if (!_event.sender.isDestroyed()) _event.sender.send("books:crawlProgress", progress);
    };
    const crawled = await crawlNovelToTxt(input, outputDir, reportProgress);
    const parsed = await parseTxtBook(crawled.filePath);
    const book = database.upsertBook(parsed);

    return {
      book,
      filePath: crawled.filePath,
      sourceUrl: crawled.sourceUrl,
      chapterCount: crawled.chapterCount,
      failedChapters: crawled.failedChapters
    };
  });

  ipcMain.handle("books:crawlNovelWithBrowser", async (_event, input: CrawlNovelInput): Promise<CrawlNovelResult> => {
    const outputDir = path.join(app.getPath("documents"), "小说朗读器", "网页抓取");
    const reportProgress = (progress: CrawlNovelProgress): void => {
      if (!_event.sender.isDestroyed()) _event.sender.send("books:crawlProgress", progress);
    };
    const crawled = await crawlNovelWithBrowser(input, outputDir, reportProgress);
    const parsed = await parseTxtBook(crawled.filePath);
    const book = database.upsertBook(parsed);

    return {
      book,
      filePath: crawled.filePath,
      sourceUrl: crawled.sourceUrl,
      chapterCount: crawled.chapterCount,
      failedChapters: crawled.failedChapters
    };
  });

  ipcMain.handle("progress:save", (_event, input: SaveProgressInput) => database.updateProgress(input));

  ipcMain.handle("settings:get", () => database.getSettings());

  ipcMain.handle("settings:save", (_event, settings: ReaderSettings) => database.saveSettings(settings));
}
