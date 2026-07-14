# 小说朗读器

一个 Windows/macOS 桌面版 TXT 小说朗读软件，基于 Electron、Vue 3、Vite、TypeScript、Pinia、SQLite 和 electron-builder。

## 功能

- 导入单个或多个 `.txt` 小说文件
- 自动识别常见编码：UTF-8、GBK/GB18030、Big5、UTF-16LE
- 自动拆分章节，无法识别章节时按正文长度分段
- 从公开静态小说目录页或第一章自动连续抓取，转换为本地 TXT 并导入书库
- 使用系统语音引擎朗读，支持语速、音调、音量和语音选择
- 保存书库、章节、阅读进度和偏好设置
- 支持 Windows 安装包、绿色免安装版以及 macOS DMG/ZIP 打包

## 技术栈

- Electron
- Vue 3
- Vite
- TypeScript
- Pinia
- SQLite：通过 `sql.js` 在 Electron 主进程中维护本地 SQLite 数据库文件
- electron-builder
- Node.js

## 环境要求

- Windows 10/11，或 macOS 11 及以上
- Node.js 16.20+，推荐 Node.js 18 LTS 或更高
- npm 8+

## 安装依赖

```bash
npm install
```

## 开发运行

```bash
npm run dev
```

开发模式会先编译 Electron 主进程和预加载脚本，再启动 Vite 与 Electron。

## 网页抓取为 TXT

点击书库左上角的地球图标，输入小说目录页 URL，或直接输入第一章 URL 后开始抓取。输入第一章时，软件会沿网页中的“下一章”链接连续抓取，直到末章或达到“最多章节”限制。

“纯净阅读”会在独立窗口中移除原网页的广告和工具，只保留章节标题、正文、上一页、返回目录和下一页。
翻页时阅读窗口会保持显示，新章节加载完成后直接更新正文。

- 程序会在同域名内自动识别章节链接
- 默认最多抓取 200 章，可在弹窗中调整
- 抓取结果会保存为本地 TXT，然后自动导入书库
- TXT 默认保存到：`文档\小说朗读器\网页抓取`
- 如果自动正文识别不准确，可以填写正文 CSS 选择器，例如 `#content`、`.chapter-content`

请只用于你有权访问和保存的公开静态页面。软件不会绕过登录、付费、DRM 或反爬限制。

## 构建

```bash
npm run build
```

## 打包 Windows 安装包

```bash
npm run dist:installer
```

输出目录：`release/`

## 打包绿色免安装版

```bash
npm run dist:portable
```

输出目录：`release/`

## 同时打包安装包和绿色版

```bash
npm run dist:win
```

## 打包 macOS

macOS 安装包必须在 macOS 环境中构建。在 Intel Mac、Apple Silicon Mac 或 GitHub Actions 的 macOS runner 中执行：

```bash
npm ci
npm run dist:mac
```

输出目录：`release/`，包含：

```text
小说朗读器-0.1.6-mac-x64.dmg
小说朗读器-0.1.6-mac-x64.zip
小说朗读器-0.1.6-mac-arm64.dmg
小说朗读器-0.1.6-mac-arm64.zip
```

仓库内置 `.github/workflows/build-macos.yml`。将项目推送到 GitHub 后，进入 `Actions`，选择 `Build macOS`，点击 `Run workflow`，完成后在该次任务的 `Artifacts` 中下载打包结果。

当前配置生成未签名安装包。首次打开时 macOS 可能阻止运行，可在“系统设置 → 隐私与安全性”中允许打开。正式公开分发需要 Apple Developer ID 证书并进行 notarization 公证。

默认配置关闭了 Windows 代码签名和可执行文件资源编辑：

```json
"signAndEditExecutable": false
```

这样普通 Windows 用户权限也能打包。如果后续需要自定义图标、版本资源或代码签名，可以在安装证书并开启开发者模式/管理员权限后再启用相关配置。

## 数据位置

运行后数据库会保存在 Electron 的 `userData` 目录中，文件名为：

```text
novel-reader.sqlite
```

Windows 上通常位于：

```text
%APPDATA%\小说朗读器\novel-reader.sqlite
```

macOS 上通常位于：

```text
~/Library/Application Support/小说朗读器/novel-reader.sqlite
```

## 目录结构

```text
.
├─ electron/
│  ├─ main/              # Electron 主进程：窗口、SQLite、TXT 解析、IPC
│  └─ preload/           # 安全暴露给渲染进程的 API
├─ src/
│  ├─ components/        # Vue 组件
│  ├─ composables/       # 朗读控制
│  ├─ shared/            # 主进程和渲染进程共享类型
│  ├─ stores/            # Pinia 状态
│  └─ styles/            # 全局样式
├─ package.json          # 脚本与 electron-builder 配置
├─ vite.config.ts
├─ tsconfig.json
└─ tsconfig.main.json
```

## 说明

`sql.js` 是 SQLite 编译到 WebAssembly 的版本，仍然读写标准 SQLite 数据库文件。它不依赖 Windows C++ 编译环境，打包安装包和绿色版时更稳定。

朗读能力来自操作系统提供的语音服务。可用语音取决于 Windows 或 macOS 已安装的语音。
