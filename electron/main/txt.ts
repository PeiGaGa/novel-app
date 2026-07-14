import fs from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";
import jschardet from "jschardet";

export interface ParsedChapter {
  index: number;
  title: string;
  content: string;
  charCount: number;
}

export interface ParsedBook {
  title: string;
  filePath: string;
  encoding: string;
  totalChars: number;
  chapters: ParsedChapter[];
}

const FALLBACK_CHUNK_SIZE = 12000;
const ENCODING_CANDIDATES = ["utf8", "gb18030", "big5", "utf16le"];

function normalizeEncoding(encoding?: string | null): string {
  const lower = (encoding ?? "").toLowerCase().replace(/[_-]/g, "");

  if (lower.includes("gb18030") || lower.includes("gb2312") || lower.includes("gbk")) {
    return "gb18030";
  }

  if (lower.includes("big5")) {
    return "big5";
  }

  if (lower.includes("utf16le") || lower.includes("unicode")) {
    return "utf16le";
  }

  if (lower.includes("utf8") || lower.includes("ascii")) {
    return "utf8";
  }

  return "utf8";
}

function decodeTxt(buffer: Buffer): { content: string; encoding: string } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      content: normalizeText(iconv.decode(buffer, "utf8")),
      encoding: "utf8"
    };
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return {
      content: normalizeText(iconv.decode(buffer, "utf16le")),
      encoding: "utf16le"
    };
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 128 * 1024));
  const detected = jschardet.detect(sample);
  const preferred = normalizeEncoding(detected.encoding);
  const candidates = Array.from(new Set([preferred, ...ENCODING_CANDIDATES]));
  const decoded = candidates
    .map((encoding) => {
      const content = normalizeText(iconv.decode(buffer, encoding));
      const replacementCount = (content.match(/\uFFFD/g) ?? []).length;
      const chineseCount = (content.match(/[\u4e00-\u9fff]/g) ?? []).length;

      return {
        encoding,
        content,
        score: replacementCount * 20 - chineseCount
      };
    })
    .sort((a, b) => a.score - b.score)[0];

  return {
    content: decoded.content,
    encoding: decoded.encoding
  };
}

function normalizeText(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function cleanTitle(value: string, fallback: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  return title.length > 0 ? title.slice(0, 80) : fallback;
}

function cleanChapterText(value: string): string {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function fallbackChapters(content: string): ParsedChapter[] {
  const chapters: ParsedChapter[] = [];
  let offset = 0;
  let index = 0;

  while (offset < content.length) {
    const slice = cleanChapterText(content.slice(offset, offset + FALLBACK_CHUNK_SIZE));
    chapters.push({
      index,
      title: `正文 ${index + 1}`,
      content: slice,
      charCount: slice.length
    });
    offset += FALLBACK_CHUNK_SIZE;
    index += 1;
  }

  return chapters.length > 0
    ? chapters
    : [
        {
          index: 0,
          title: "正文",
          content: "",
          charCount: 0
        }
      ];
}

function parseChapters(content: string): ParsedChapter[] {
  const headingPattern =
    /^\s*((?:第\s*[0-9零〇一二两三四五六七八九十百千万]+\s*[章节回卷集部篇][^\n]{0,60})|(?:Chapter\s+\d+[^\n]{0,60}))\s*$/gim;
  const matches: Array<{ title: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(content))) {
    matches.push({
      title: cleanTitle(match[1], `章节 ${matches.length + 1}`),
      start: match.index,
      end: match.index + match[0].length
    });
  }

  if (matches.length === 0) {
    return fallbackChapters(content);
  }

  const chapters: ParsedChapter[] = [];
  const preface = cleanChapterText(content.slice(0, matches[0].start));

  if (preface.length > 120) {
    chapters.push({
      index: chapters.length,
      title: "序章",
      content: preface,
      charCount: preface.length
    });
  }

  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    const body = cleanChapterText(content.slice(current.end, next ? next.start : content.length));
    const chapterContent = body.length > 0 ? body : current.title;

    chapters.push({
      index: chapters.length,
      title: current.title,
      content: chapterContent,
      charCount: chapterContent.length
    });
  }

  return chapters;
}

export async function parseTxtBook(filePath: string): Promise<ParsedBook> {
  const extension = path.extname(filePath).toLowerCase();

  if (extension !== ".txt") {
    throw new Error("只支持导入 .txt 文件。");
  }

  const stat = await fs.promises.stat(filePath);

  if (!stat.isFile()) {
    throw new Error("请选择有效的 TXT 文件。");
  }

  const buffer = await fs.promises.readFile(filePath);

  if (buffer.length === 0) {
    throw new Error("文件内容为空。");
  }

  const { content, encoding } = decodeTxt(buffer);
  const title = cleanTitle(path.basename(filePath, extension), "未命名小说");
  const normalized = content.trim();

  if (normalized.length === 0) {
    throw new Error("没有读取到有效文本内容。");
  }

  return {
    title,
    filePath,
    encoding,
    totalChars: normalized.length,
    chapters: parseChapters(normalized)
  };
}
