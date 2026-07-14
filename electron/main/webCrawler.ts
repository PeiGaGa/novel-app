import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { load, type Cheerio, type CheerioAPI, type Element } from "cheerio";
import iconv from "iconv-lite";
import type { CrawlNovelInput, CrawlNovelProgress } from "../../src/shared/types";

interface ChapterLink {
  title: string;
  url: string;
}

interface CrawledChapter extends ChapterLink {
  content: string;
}

type HtmlFetcher = (url: URL) => Promise<string>;
type ProgressReporter = (progress: CrawlNovelProgress) => void;

export interface CrawledNovelFile {
  title: string;
  filePath: string;
  sourceUrl: string;
  chapterCount: number;
  failedChapters: Array<{
    url: string;
    title: string;
    message: string;
  }>;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const AUTO_CONTENT_SELECTORS = [
  "#content",
  "#chaptercontent",
  "#chapterContent",
  "#BookText",
  "#bookText",
  ".content",
  ".chapter-content",
  ".chapterContent",
  ".read-content",
  ".reader-content",
  ".book-content",
  ".article-content",
  ".entry-content",
  ".post-content",
  ".chapter",
  ".text",
  ".txt-content",
  "article",
  "main"
];
const NAV_WORDS = /上一章|下一章|上一页|下一页|目录|书架|返回|首页|登录|注册|推荐|收藏|评论|广告|下载|手机阅读|作者介绍|投票|打赏|微信|公众号/g;
const CHAPTER_TEXT_PATTERN =
  /(第\s*[0-9零〇一二两三四五六七八九十百千万]+\s*[章节回卷集部篇]|chapter\s*\d+|^\s*\d+\s*[\.、\-_ ]|序章|楔子|番外|正文)/i;
const CHAPTER_PATH_PATTERN = /(chapter|read|article|html|txt|novel|book|text|\/\d+\/\d+|\/\d+\.html)/i;
const CHAPTER_CLASS_PATTERN = /(chapter|read|article|book|novel|txt|content|text)/i;

let logFilePath: string | null = null;

function initLogger(): string {
  if (!logFilePath) {
    const documentsDir = app?.getPath ? app.getPath("documents") : process.cwd();
    const logsDir = path.join(documentsDir, "小说朗读器", "日志");
    fs.mkdirSync(logsDir, { recursive: true });
    logFilePath = path.join(logsDir, `crawl-${Date.now()}.log`);
  }

  return logFilePath;
}

function writeLog(level: "INFO" | "ERROR", message: string, error?: unknown): void {
  const details = error instanceof Error ? `\n${error.stack ?? error.message}` : error ? `\n${String(error)}` : "";

  try {
    fs.appendFileSync(initLogger(), `${new Date().toISOString()} [${level}] ${message}${details}\n`, "utf8");
  } catch (logError) {
    console.error("[crawler] 写入日志失败", logError);
  }
}

function logInfo(message: string): void {
  console.log(`[crawler] ${message}`);
  writeLog("INFO", message);
}

function logError(message: string, error?: unknown): void {
  console.error(`[crawler] ${message}`, error);
  writeLog("ERROR", message, error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function safeFileName(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim();
  return (cleaned || "网页小说").slice(0, 80);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeUrl(rawUrl: string): URL {
  let url: URL;

  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("请输入有效的目录页或第一章 URL。");
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("只支持 http/https 网页。");
  }

  url.hash = "";
  return url;
}

function resolveLink(baseUrl: URL, href: string): URL | null {
  if (!href || /^(javascript:|mailto:|tel:)/i.test(href)) {
    return null;
  }

  try {
    const url = new URL(href, baseUrl);
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function normalizeEncoding(value: string): string {
  const encoding = value.trim().replace(/["']/g, "").toLowerCase();

  if (/^(gb2312|gbk|gb_2312|cp936)$/.test(encoding)) {
    return "gb18030";
  }

  if (/^(utf-8|utf8)$/.test(encoding)) {
    return "utf8";
  }

  return iconv.encodingExists(encoding) ? encoding : "utf8";
}

function detectHtmlEncoding(buffer: Buffer, contentType: string): string {
  const headerEncoding = /charset\s*=\s*([^;\s]+)/i.exec(contentType)?.[1];

  if (headerEncoding) {
    return normalizeEncoding(headerEncoding);
  }

  // HTML 标签和 charset 名称均为 ASCII，可先用 latin1 安全扫描原始字节。
  const head = buffer.subarray(0, Math.min(buffer.length, 16384)).toString("latin1");
  const metaEncoding =
    /<meta[^>]+charset\s*=\s*["']?\s*([^\s"'/>;]+)/i.exec(head)?.[1] ??
    /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([^\s"';>]+)/i.exec(head)?.[1];

  return normalizeEncoding(metaEncoding ?? "utf8");
}

function requestHtml(url: URL, redirectCount = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.get(
      url,
      {
        headers: {
          "user-agent": DEFAULT_USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
          "cache-control": "no-cache",
          referer: `${url.origin}/`
        },
        timeout: 20000
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;

        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume();

          if (redirectCount >= 5) {
            reject(new Error("网页重定向次数过多。"));
            return;
          }

          const redirected = resolveLink(url, location);
          if (!redirected) {
            reject(new Error("网页返回了无效的重定向地址。"));
            return;
          }

          requestHtml(redirected, redirectCount + 1).then(resolve, reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`网页请求失败：HTTP ${statusCode}`));
          return;
        }

        const contentType = String(response.headers["content-type"] ?? "");
        if (contentType && !/(text\/html|application\/xhtml|text\/plain)/i.test(contentType)) {
          response.resume();
          reject(new Error("目标地址不是 HTML 网页。"));
          return;
        }

        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const encoding = detectHtmlEncoding(buffer, contentType);
          logInfo(`已获取 ${url.toString()}，${buffer.length} 字节，编码 ${encoding}`);
          resolve(iconv.decode(buffer, encoding));
        });
        response.on("error", reject);
      }
    );

    request.on("timeout", () => request.destroy(new Error("网页请求超时。")));
    request.on("error", reject);
  });
}

async function fetchHtml(url: URL): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await requestHtml(url);
    } catch (error) {
      lastError = error;
      logError(`第 ${attempt} 次请求失败：${url.toString()}`, error);

      if (attempt < 3) {
        await sleep(attempt * 1000);
      }
    }
  }

  throw new Error(`网页请求失败（已重试 3 次）：${messageOf(lastError)}`);
}

function fetchHtmlWithBrowser(url: URL): Promise<string> {
  logInfo(`使用浏览器内核加载：${url.toString()}`);

  return new Promise((resolve, reject) => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    let settled = false;

    const finish = (error?: Error, html?: string): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (!window.isDestroyed()) {
        window.destroy();
      }

      if (error) {
        reject(error);
      } else {
        resolve(html ?? "");
      }
    };

    const timeout = setTimeout(() => finish(new Error("浏览器内核加载网页超时。")), 30000);

    window.webContents.once("did-fail-load", (_event, code, description, validatedUrl, isMainFrame) => {
      if (isMainFrame) {
        finish(new Error(`网页加载失败：${description} (${code}) ${validatedUrl}`));
      }
    });

    window.webContents.once("did-finish-load", () => {
      window.webContents
        .executeJavaScript("document.documentElement.outerHTML", true)
        .then((html) => finish(undefined, String(html)))
        .catch((error) => finish(new Error(`读取网页内容失败：${messageOf(error)}`)));
    });

    window.loadURL(url.toString(), { userAgent: DEFAULT_USER_AGENT }).catch((error) => {
      finish(new Error(`浏览器内核打开网页失败：${messageOf(error)}`));
    });
  });
}

function pageTitle($: CheerioAPI, fallback: string): string {
  const linkedBookTitle = cleanText($("h1 a").first().text());
  const h1 = cleanText($("h1").first().text());
  const documentTitle = cleanText($("title").first().text())
    .replace(/最新章节.*$/i, "")
    .replace(/[_\-|].*$/, "")
    .trim();
  return (linkedBookTitle || h1 || documentTitle || fallback).slice(0, 80);
}

function chapterTitle($: CheerioAPI, fallback: string): string {
  const h1 = cleanText($("h1").first().text());
  const bookTitle = cleanText($("h1 a").first().text());
  const heading = bookTitle && h1.startsWith(bookTitle) ? cleanText(h1.slice(bookTitle.length)) : h1;
  const title =
    heading ||
    cleanText($(".chapter-title,.title,.read-title").first().text()) ||
    cleanText($("title").first().text()).replace(/[_\-|].*$/, "").trim() ||
    fallback;
  return title.slice(0, 100);
}

function findNextChapterLink($: CheerioAPI, currentUrl: URL): ChapterLink | null {
  const candidates: Array<ChapterLink & { score: number }> = [];

  $("a[href]").each((_index, element) => {
    const anchor = $(element);
    const text = cleanText(anchor.text()).replace(/\s+/g, "");
    const href = anchor.attr("href") ?? "";
    const url = resolveLink(currentUrl, href);

    if (!url || url.origin !== currentUrl.origin || url.toString() === currentUrl.toString()) {
      return;
    }

    let score = 0;
    if (/下一章|下章|下一节|下节/.test(text)) score += 120;
    if (/下一页|下页/.test(text)) score += 70;
    if ((anchor.attr("rel") ?? "").toLowerCase().includes("next")) score += 60;
    if (/next/i.test(`${anchor.attr("class") ?? ""} ${anchor.attr("id") ?? ""}`)) score += 40;
    if (/上一章|上章|上一页|上页|目录|返回|首页/.test(text)) score = 0;

    if (score > 0) {
      candidates.push({ title: text || "下一章", url: url.toString(), score });
    }
  });

  const best = candidates.sort((left, right) => right.score - left.score)[0];
  if (best) {
    return { title: best.title, url: best.url };
  }

  const scripts = $("script").map((_index, element) => $(element).html() ?? "").get().join("\n");
  const scriptedHref = /\bnext_page\s*=\s*["']([^"']+)["']/i.exec(scripts)?.[1];
  const scriptedUrl = scriptedHref ? resolveLink(currentUrl, scriptedHref) : null;

  if (scriptedUrl && scriptedUrl.origin === currentUrl.origin && scriptedUrl.toString() !== currentUrl.toString()) {
    return { title: "下一章", url: scriptedUrl.toString() };
  }

  return null;
}

function looksLikeChapterPage($: CheerioAPI, url: URL): boolean {
  const heading = cleanText($("h1,.chapter-title,.read-title").first().text());
  const fileName = path.posix.basename(url.pathname);
  return CHAPTER_TEXT_PATTERN.test(heading) || /^\d+\.(?:s?html?|xhtml)$/i.test(fileName);
}

function isProbablyChapterLink(anchor: Cheerio<Element>, catalogUrl: URL): boolean {
  const text = cleanText(anchor.text()).replace(/\s+/g, " ");
  const url = resolveLink(catalogUrl, anchor.attr("href") ?? "");
  const className = [anchor.attr("class"), anchor.attr("id")].filter(Boolean).join(" ");

  if (!url || url.origin !== catalogUrl.origin || !text || text.length > 100) {
    return false;
  }

  if (/首页|书架|排行|分类|登录|注册|留言|作者|搜索|客户端|最新|推荐|收藏|评论|打赏|目录|上一章|下一章|返回/.test(text)) {
    return false;
  }

  const pathname = url.pathname.toLowerCase();
  return (
    CHAPTER_TEXT_PATTERN.test(text) ||
    CHAPTER_PATH_PATTERN.test(pathname) ||
    CHAPTER_CLASS_PATTERN.test(className) ||
    /\/\d+(?:\/|$)/.test(pathname)
  );
}

function discoverChapterLinks($: CheerioAPI, catalogUrl: URL, maxChapters: number): ChapterLink[] {
  const seen = new Set<string>();
  const links: ChapterLink[] = [];

  $("a[href]").each((_index, element) => {
    const anchor = $(element);
    const url = resolveLink(catalogUrl, anchor.attr("href") ?? "");

    if (!url || seen.has(url.toString()) || !isProbablyChapterLink(anchor, catalogUrl)) {
      return;
    }

    seen.add(url.toString());
    links.push({
      title: cleanText(anchor.text()).replace(/\s+/g, " ") || `章节 ${links.length + 1}`,
      url: url.toString()
    });
  });

  return links.slice(0, maxChapters);
}

function textFromHtmlFragment(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6])>/gi, "\n");
  return cleanText(load(`<main>${withBreaks}</main>`)("main").text());
}

function scoreContent(text: string, linkCount: number, element?: Element): number {
  const chineseCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const lineCount = text.split("\n").filter((line) => line.trim()).length;
  const navPenalty = (text.match(NAV_WORDS) ?? []).length * 100;
  const className = element ? `${element.attribs?.class ?? ""} ${element.attribs?.id ?? ""}` : "";
  return text.length + chineseCount * 2 + lineCount * 25 + (CHAPTER_CLASS_PATTERN.test(className) ? 120 : 0) - linkCount * 120 - navPenalty;
}

function extractBySelector($: CheerioAPI, selector: string): string {
  let selected;

  try {
    selected = $(selector).first();
  } catch {
    throw new Error("正文 CSS 选择器无效。");
  }

  if (!selected.length) {
    throw new Error("没有找到正文 CSS 选择器对应的元素。");
  }

  selected.find("script,style,noscript,iframe,form,button,nav,header,footer,aside").remove();
  const text = textFromHtmlFragment(selected.html() ?? selected.text());

  if (text.length < 20) {
    throw new Error("正文 CSS 选择器对应的内容过短。");
  }

  return text;
}

function extractAutomatic($: CheerioAPI): string {
  $("script,style,noscript,iframe,form,button,nav,header,footer,aside").remove();
  $("[class*=ad], [id*=ad], [class*=advert], [id*=advert]").remove();

  let best = "";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const selector of AUTO_CONTENT_SELECTORS) {
    $(selector).each((_index, element) => {
      const candidate = $(element);
      const text = textFromHtmlFragment(candidate.html() ?? candidate.text());

      if (text.length < 80 || text.length > 100000) {
        return;
      }

      const score = scoreContent(text, candidate.find("a").length, element as Element);
      if (score > bestScore) {
        best = text;
        bestScore = score;
      }
    });
  }

  // 一些老式小说站把正文直接放在 body 下，没有 #content 容器。
  const nakedBody = $("body").clone();
  nakedBody
    .find("script,style,noscript,iframe,form,button,nav,header,footer,aside,h1,table,#guild,#shop,.toplink,.bottomlink,.status,.mode,#Commenddiv,#feit2")
    .remove();
  nakedBody.find("a").remove();
  const nakedText = textFromHtmlFragment(nakedBody.html() ?? nakedBody.text());
  const nakedScore = scoreContent(nakedText, 0);

  if (nakedText.length >= 80 && nakedScore > bestScore) {
    best = nakedText;
    bestScore = nakedScore;
  }

  if (best.length < 20) {
    throw new Error("没有识别到有效正文。可以尝试填写正文 CSS 选择器。");
  }

  return best;
}

function extractChapter(html: string, link: ChapterLink, selector?: string): { chapter: CrawledChapter; next: ChapterLink | null } {
  const $ = load(html, { decodeEntities: true });
  const currentUrl = new URL(link.url);
  const next = findNextChapterLink($, currentUrl);
  const title = chapterTitle($, link.title);
  const content = selector?.trim() ? extractBySelector($, selector.trim()) : extractAutomatic($);
  return { chapter: { ...link, title, content }, next };
}

async function crawlFromFirstChapter(
  firstUrl: URL,
  firstHtml: string,
  selector: string | undefined,
  maxChapters: number,
  delayMs: number,
  fetcher: HtmlFetcher,
  reportProgress: ProgressReporter
): Promise<{ chapters: CrawledChapter[]; failed: CrawledNovelFile["failedChapters"] }> {
  const chapters: CrawledChapter[] = [];
  const failed: CrawledNovelFile["failedChapters"] = [];
  const visited = new Set<string>();
  let current: ChapterLink | null = { title: "第一章", url: firstUrl.toString() };
  let currentHtml: string | null = firstHtml;

  while (current && chapters.length < maxChapters && !visited.has(current.url)) {
    const activeChapter = current;
    visited.add(activeChapter.url);
    reportProgress({
      phase: "crawling",
      current: chapters.length,
      total: maxChapters,
      message: `正在抓取第 ${chapters.length + 1} 章`,
      currentUrl: activeChapter.url
    });

    try {
      const html = currentHtml ?? (await fetcher(new URL(activeChapter.url)));
      const extracted = extractChapter(html, activeChapter, selector);
      chapters.push(extracted.chapter);
      logInfo(`抓取成功 [${chapters.length}/${maxChapters}]：${extracted.chapter.title}`);
      reportProgress({
        phase: "crawling",
        current: chapters.length,
        total: maxChapters,
        message: `已抓取：${extracted.chapter.title}`,
        currentUrl: activeChapter.url
      });
      current = extracted.next && !visited.has(extracted.next.url) ? extracted.next : null;
      currentHtml = null;
    } catch (error) {
      failed.push({ url: activeChapter.url, title: activeChapter.title, message: messageOf(error) });
      logError(`章节抓取失败：${activeChapter.url}`, error);
      break;
    }

    if (current && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return { chapters, failed };
}

async function crawlFromCatalog(
  links: ChapterLink[],
  selector: string | undefined,
  delayMs: number,
  fetcher: HtmlFetcher,
  reportProgress: ProgressReporter
): Promise<{ chapters: CrawledChapter[]; failed: CrawledNovelFile["failedChapters"] }> {
  const chapters: CrawledChapter[] = [];
  const failed: CrawledNovelFile["failedChapters"] = [];

  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    reportProgress({
      phase: "crawling",
      current: index,
      total: links.length,
      message: `正在抓取第 ${index + 1}/${links.length} 章`,
      currentUrl: link.url
    });

    try {
      const html = await fetcher(new URL(link.url));
      const { chapter } = extractChapter(html, link, selector);
      chapters.push(chapter);
      logInfo(`抓取成功 [${index + 1}/${links.length}]：${chapter.title}`);
      reportProgress({
        phase: "crawling",
        current: index + 1,
        total: links.length,
        message: `已抓取：${chapter.title}`,
        currentUrl: link.url
      });
    } catch (error) {
      failed.push({ url: link.url, title: link.title, message: messageOf(error) });
      logError(`章节抓取失败：${link.url}`, error);
    }

    if (delayMs > 0 && index < links.length - 1) {
      await sleep(delayMs);
    }
  }

  return { chapters, failed };
}

function buildTxt(title: string, sourceUrl: string, chapters: CrawledChapter[]): string {
  const lines = [title, "", `来源：${sourceUrl}`, `生成时间：${new Date().toLocaleString("zh-CN")}`, ""];

  for (const chapter of chapters) {
    lines.push(chapter.title, "", chapter.content, "");
  }

  return `${lines.join("\n").replace(/\n/g, "\r\n")}\r\n`;
}

async function runCrawler(
  input: CrawlNovelInput,
  outputDir: string,
  fetcher: HtmlFetcher,
  reportProgress: ProgressReporter = () => undefined
): Promise<CrawledNovelFile> {
  const entryUrl = normalizeUrl(input.url);
  const maxChapters = clamp(Math.round(input.maxChapters || 200), 1, 1000);
  const delayMs = clamp(Math.round(input.delayMs || 300), 0, 5000);
  logInfo(`开始抓取：${entryUrl.toString()}，最多 ${maxChapters} 章`);
  reportProgress({
    phase: "loading",
    current: 0,
    total: maxChapters,
    message: "正在打开入口网页",
    currentUrl: entryUrl.toString()
  });

  const entryHtml = await fetcher(entryUrl);
  reportProgress({
    phase: "discovering",
    current: 0,
    total: maxChapters,
    message: "正在识别正文和章节链接",
    currentUrl: entryUrl.toString()
  });
  const $ = load(entryHtml, { decodeEntities: true });
  const title = cleanText(input.title || pageTitle($, "网页小说")) || "网页小说";
  let result: { chapters: CrawledChapter[]; failed: CrawledNovelFile["failedChapters"] };

  if (looksLikeChapterPage($, entryUrl)) {
    logInfo("入口识别为章节页，将沿“下一章”连续抓取。 ");
    result = await crawlFromFirstChapter(entryUrl, entryHtml, input.contentSelector, maxChapters, delayMs, fetcher, reportProgress);
  } else {
    const links = discoverChapterLinks($, entryUrl, maxChapters);

    if (links.length === 0) {
      logInfo("未识别到目录链接，将入口作为单章页面处理。 ");
      result = await crawlFromFirstChapter(entryUrl, entryHtml, input.contentSelector, maxChapters, delayMs, fetcher, reportProgress);
    } else {
      logInfo(`入口识别为目录页，共发现 ${links.length} 个章节链接。`);
      result = await crawlFromCatalog(links, input.contentSelector, delayMs, fetcher, reportProgress);
    }
  }

  if (result.chapters.length === 0) {
    const reason = result.failed[0]?.message ?? "没有识别到可保存的章节正文。";
    throw new Error(`网页抓取失败：${reason}`);
  }

  reportProgress({
    phase: "saving",
    current: result.chapters.length,
    total: result.chapters.length,
    message: `正在保存 ${result.chapters.length} 章为 TXT`
  });
  await fs.promises.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${safeFileName(title)}-${Date.now()}.txt`);
  await fs.promises.writeFile(filePath, buildTxt(title, entryUrl.toString(), result.chapters), "utf8");
  logInfo(`抓取完成：成功 ${result.chapters.length} 章，失败 ${result.failed.length} 章，保存到 ${filePath}`);
  reportProgress({
    phase: "completed",
    current: result.chapters.length,
    total: result.chapters.length,
    message: `抓取完成，共 ${result.chapters.length} 章`
  });

  return {
    title,
    filePath,
    sourceUrl: entryUrl.toString(),
    chapterCount: result.chapters.length,
    failedChapters: result.failed
  };
}

export function crawlNovelToTxt(
  input: CrawlNovelInput,
  outputDir: string,
  reportProgress?: ProgressReporter
): Promise<CrawledNovelFile> {
  return runCrawler(input, outputDir, fetchHtml, reportProgress);
}

export function crawlNovelWithBrowser(
  input: CrawlNovelInput,
  outputDir: string,
  reportProgress?: ProgressReporter
): Promise<CrawledNovelFile> {
  const browserFirstFetcher: HtmlFetcher = async (url) => {
    try {
      return await fetchHtmlWithBrowser(url);
    } catch (error) {
      logError("浏览器内核加载失败，尝试 HTTP 模式。", error);
      return fetchHtml(url);
    }
  };

  return runCrawler(input, outputDir, browserFirstFetcher, reportProgress);
}
