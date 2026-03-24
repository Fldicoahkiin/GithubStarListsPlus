# GitHub StarLists++

[![Package](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/package.yml/badge.svg)](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/package.yml)
[![English README](https://img.shields.io/badge/docs-English-2563EB)](./README.md)
[![Userscript](https://img.shields.io/badge/userscript-Tampermonkey%20%2F%20Violentmonkey-14B8A6)](https://www.tampermonkey.net/)

GitHub StarLists++ 是一个小型 browser extension / userscript，用来让 GitHub stars 更容易整理、筛选和清理。

它不替换 GitHub，也不另造一套系统，而是在 GitHub 原生 stars 和官方 lists 的基础上补齐一些真正常用的小功能。

产品名是 **GitHub StarLists++**，仓库 slug 保持为 **GithubStarListsPlus**。

## 这是做什么的

GitHub 的 Star 很方便，但把它们持续整理进有用的 lists 这件事，默认体验还是偏慢，也很容易一拖再拖。

GitHub StarLists++ 做的事情很直接：

- 继续使用 GitHub 原生 stars 和官方 lists
- 让仓库归类更快
- 让未分组的 stars 更容易被看见和处理
- 在原本点 Star 的地方顺手补上一些工作流能力

## 主要功能

- 在 stars 页面切换 `全部`、`未分组` 和已发现的 lists
- 在仓库卡片上显示 `Starred on ...` 时间信息
- 在 stars 卡片和仓库页显示 list 标签
- 在 stars 页面做本地搜索和排序
- 批量加入 lists、移出 lists、取消 Star
- 在仓库页原生 Star 区域旁增加 `Lists` 操作入口
- Star 后可自动弹出 list 面板

## 安装方式

先按自己的使用方式选运行形态：

- **Extension**：更适合长期使用，有独立设置页，整体更完整
- **Userscript**：更适合低门槛快速试用，安装更轻

当前预发布版本通过 `Package` workflow 的 artifacts 分发。

### Chrome / Edge / Brave

1. 打开 `chrome://extensions`
2. 开启开发者模式
3. 从 [`Package` workflow](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/package.yml) 下载最新产物
4. 解压 `github-star-lists-plus-chrome-unpacked.zip`
5. 点击 `Load unpacked`，选择解压后的目录

### Firefox

1. 打开 `about:debugging#/runtime/this-firefox`
2. 从 [`Package` workflow](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/package.yml) 下载最新产物
3. 使用 `firefox-unsigned` 目录或 `github-star-lists-plus-firefox-unsigned.xpi`
4. 点击 `Load Temporary Add-on`，选择目录中的 `manifest.json`，或直接选择 unsigned `.xpi`

### Tampermonkey / Violentmonkey

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)
2. 从 [`Package` workflow](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/package.yml) 下载最新产物
3. 打开 `github-star-lists-plus.user.js`
4. 在 userscript 管理器中确认安装

## 设置说明

### Extension

当前扩展设置页支持：

- 在 `https://github.com/stars` 显示 Star 日期
- 在 `全部` 里隐藏已经分组的仓库
- 在卡片和仓库页显示 list 标签
- Star 后自动打开 list 面板
- 保存可选的 GitHub token，用于提升 API 配额和 `starred_at` 覆盖率

### Userscript

userscript 版本没有独立设置页，而是通过 GM 菜单命令配置。

可以用来：

- 开关 stars 页和仓库页的主要功能
- 保存或移除 GitHub token
- 清理缓存并刷新页面

GitHub token 是可选的，只是用来提升 API 配额和元数据获取成功率。

## 开发说明

### 快速开始

```bash
pnpm run test:all
pnpm run build
```

### 常用命令

```bash
pnpm run check:syntax
pnpm run test:smoke
pnpm run test:artifacts
pnpm run test:browser
pnpm run build
```

### 目录概览

- `manifest.json` - 共用扩展清单
- `src/content.js` - stars 页面和仓库页增强逻辑
- `src/background.js` - 扩展侧 GitHub API 桥接
- `src/options.*` - 扩展设置页
- `src/userscript/*` - userscript 适配层和 GM 菜单命令
- `src/shared/*` - 共用运行时、存储和服务逻辑
- `tests/*` - smoke 与产物校验
- `scripts/*` - 本地测试与打包脚本入口

构建输出目录为 `dist/`。

## CI 产物

当前仓库使用 4 个 GitHub Actions workflow：

- [`Lint`](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/lint.yml) - 语法检查
- [`Smoke`](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/smoke.yml) - 运行时 smoke test
- [`Package`](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/package.yml) - 构建并上传安装产物
- [`Browser`](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/browser.yml) - 手动触发的 Playwright 浏览器测试

`Package` workflow 会上传：

- `chrome-unpacked/`
- `github-star-lists-plus-chrome-unpacked.zip`
- `firefox-unsigned/`
- `github-star-lists-plus-firefox-unsigned.xpi`
- `github-star-lists-plus.user.js`
- `checksums.txt`
- `install-notes.txt`
- `artifact-metadata.json`

## 常见问题

### 为什么不单独建一个 lists 数据库？

因为这个项目的目标是增强 GitHub 原生 stars 和官方 lists，而不是替换它们。

### 我该用 extension 还是 userscript？

如果你想长期使用、需要独立设置页，就用 extension。如果你只是想快速试用，就用 userscript。

### CI 产物可以直接安装吗？

可以。

- Chromium 浏览器当前主要通过 unpacked 方式加载
- Firefox 当前以临时安装为主，后续如果签名再走正式分发
- Tampermonkey 和 Violentmonkey 可以直接安装生成出来的 `.user.js`

### 会不会把数据发到别的地方？

不会。项目没有外部分析服务，也没有独立后端。

当前只会使用：

- `storage` 保存本地设置和缓存
- `https://github.com/*` 做页面增强
- `https://api.github.com/*` 在需要时发起 GitHub API 请求

如果你保存了 GitHub token，它只会保存在本地扩展存储或 userscript 管理器存储中，并且仅用于 GitHub API 请求。

### 为什么 Firefox 现在还是临时安装？

因为 Firefox 的长期分发需要签名，当前产物主要用于本地测试和预发布使用。

英文文档请查看 [README.md](./README.md)。
