import type { WebContents } from "electron";

const READER_MODE_CSS = `
  :root {
    color-scheme: light;
    font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
  }

  * {
    box-sizing: border-box;
  }

  html,
  body {
    min-height: 100%;
    margin: 0;
    background: #f4f3ee;
    color: #202528;
  }

  body {
    padding: 0 24px 64px;
  }

  .reader-navigation {
    position: sticky;
    top: 0;
    z-index: 10;
    display: grid;
    grid-template-columns: repeat(3, minmax(96px, 1fr));
    gap: 10px;
    width: min(860px, 100%);
    margin: 0 auto;
    padding: 14px 0;
    background: #f4f3ee;
    border-bottom: 1px solid #d5d6d2;
  }

  .reader-navigation a,
  .reader-navigation span {
    display: grid;
    min-height: 40px;
    place-items: center;
    border: 1px solid #bfc5c4;
    border-radius: 6px;
    background: #ffffff;
    color: #176e6b;
    font-size: 15px;
    text-decoration: none;
  }

  .reader-navigation a:hover,
  .reader-navigation a:focus-visible {
    border-color: #168984;
    outline: 2px solid rgba(22, 137, 132, 0.18);
  }

  .reader-navigation span {
    color: #9a9f9e;
    background: #ececea;
  }

  .reader-title {
    width: min(860px, 100%);
    margin: 42px auto 28px;
    font-size: 28px;
    font-weight: 700;
    line-height: 1.45;
    text-align: center;
  }

  .reader-content {
    width: min(860px, 100%);
    margin: 0 auto;
    font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
    font-size: 20px;
    line-height: 1.95;
    overflow-wrap: anywhere;
  }

  .reader-content p,
  .reader-content div {
    margin: 0 0 1em;
  }

  @media (max-width: 640px) {
    body {
      padding-right: 14px;
      padding-left: 14px;
    }

    .reader-navigation {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 7px;
    }

    .reader-navigation a,
    .reader-navigation span {
      min-width: 0;
      font-size: 14px;
    }

    .reader-title {
      margin-top: 30px;
      font-size: 23px;
    }

    .reader-content {
      font-size: 18px;
    }
  }
`;

const READER_MODE_SCRIPT = String.raw`
(() => {
  const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const findHref = (pattern) => {
    const anchor = anchors.find((item) => pattern.test(normalize(item.textContent)));
    return anchor ? anchor.href : "";
  };
  const resolveFallback = (value) => {
    if (!value || typeof value !== "string") return "";
    try {
      return new URL(value, location.href).href;
    } catch {
      return "";
    }
  };

  const previousHref =
    findHref(/上一章|上一页|上章|上页/) || resolveFallback(window.preview_page || window.prev_page);
  const catalogHref =
    findHref(/返回目录|章节目录|回到目录|目录/) || resolveFallback(window.index_page);
  const nextHref =
    findHref(/下一章|下一页|下章|下页/) || resolveFallback(window.next_page);

  const heading = document.querySelector("h1, .chapter-title, .read-title, .title");
  const title = normalize(heading && heading.textContent) || normalize(document.title).replace(/[_|].*$/, "") || "小说阅读";
  const contentSelectors = [
    "#content",
    "#chaptercontent",
    "#chapterContent",
    "#BookText",
    "#bookText",
    ".chapter-content",
    ".chapterContent",
    ".read-content",
    ".reader-content",
    ".book-content",
    ".article-content",
    ".entry-content",
    ".post-content",
    "article",
    "main"
  ];
  const contentSource = contentSelectors
    .map((selector) => document.querySelector(selector))
    .find((element) => element && normalize(element.textContent).length >= 80);
  const content = document.createElement("article");
  content.className = "reader-content";

  if (contentSource) {
    const clone = contentSource.cloneNode(true);
    clone.querySelectorAll("script, style, noscript, iframe, form, button, input, select, textarea, nav, header, footer, aside, img, video, audio, canvas, svg").forEach((element) => element.remove());
    clone.querySelectorAll("a").forEach((element) => element.replaceWith(document.createTextNode(element.textContent || "")));
    content.append(...Array.from(clone.childNodes));
  } else {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll("script, style, noscript, iframe, form, button, input, select, textarea, nav, header, footer, aside, h1, table, img, video, audio, canvas, svg, #guild, #shop, .toplink, .bottomlink, .status, .mode, #Commenddiv, #feit2, [class*=advert], [id*=advert], [class*=ad-], [id^=ad]").forEach((element) => element.remove());
    clone.querySelectorAll("a").forEach((element) => element.remove());
    content.append(...Array.from(clone.childNodes));
  }

  const navigation = document.createElement("nav");
  navigation.className = "reader-navigation";
  navigation.setAttribute("aria-label", "章节导航");

  const addNavigation = (label, href) => {
    const element = document.createElement(href ? "a" : "span");
    element.textContent = label;
    if (href) element.href = href;
    else element.setAttribute("aria-disabled", "true");
    navigation.appendChild(element);
  };

  addNavigation("上一页", previousHref);
  addNavigation("返回目录", catalogHref);
  addNavigation("下一页", nextHref);

  const titleElement = document.createElement("h1");
  titleElement.className = "reader-title";
  titleElement.textContent = title;
  document.head.replaceChildren();
  document.body.replaceChildren(navigation, titleElement, content);
  document.title = title;
})();
`;

export async function applyReaderMode(webContents: WebContents): Promise<string> {
  await webContents.executeJavaScript(READER_MODE_SCRIPT, true);
  return webContents.insertCSS(READER_MODE_CSS);
}
