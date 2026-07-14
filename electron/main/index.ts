import path from "node:path";
import { app, BrowserWindow, Menu, nativeTheme, session, ipcMain } from "electron";
import { NovelDatabase } from "./database";
import { registerIpcHandlers } from "./ipc";
import { applyReaderMode } from "./readerMode";

let mainWindow: BrowserWindow | null = null;
let database: NovelDatabase | null = null;
const webviewWindows = new Map<number, BrowserWindow>();

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function createWindow(): void {
  const preloadPath = path.join(__dirname, "../preload/index.js");
  console.log("[Main] Preload script path:", preloadPath);

  mainWindow = new BrowserWindow({
    title: "小说朗读器",
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#f5f4ef",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    console.log("[Main] Window shown");
  });

  mainWindow.webContents.on("preload-error", (event, preloadPath, error) => {
    console.error("[Main] Preload error:", preloadPath, error);
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
    console.log("[Main] Loading dev server:", process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../../../dist/index.html"));
  }
}

function createWebviewWindow(url: string): void {
  const webviewWindow = new BrowserWindow({
    title: "纯净阅读",
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: "#f4f3ee",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  webviewWindows.set(webviewWindow.id, webviewWindow);
  webviewWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  let insertedCssKey = "";

  webviewWindow.webContents.on("did-finish-load", async () => {
    try {
      if (insertedCssKey) {
        await webviewWindow.webContents.removeInsertedCSS(insertedCssKey);
      }

      insertedCssKey = await applyReaderMode(webviewWindow.webContents);
    } catch (error) {
      console.error("应用纯净阅读模式失败：", error);
    } finally {
      if (!webviewWindow.isDestroyed()) {
        webviewWindow.show();
      }
    }
  });

  void webviewWindow.loadURL(url);

  webviewWindow.on("closed", () => {
    webviewWindows.delete(webviewWindow.id);
  });
}

async function bootstrap(): Promise<void> {
  nativeTheme.themeSource = "system";
  Menu.setApplicationMenu(null);

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  database = new NovelDatabase(app.getPath("userData"));
  await database.init();
  registerIpcHandlers(database);
  
  // 注册 webview 相关的 IPC 处理器
  ipcMain.on("webview:open", (event, url: string) => {
    createWebviewWindow(url);
  });
  
  createWindow();
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error("应用启动失败：", error);
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  database?.close();
});
