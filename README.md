# StarLists++

GitHub starred lists 的原生增强扩展，当前版本优先聚焦 3 个核心动作，并以同一份代码同时兼容 Chrome 与 Firefox：

- 在 `https://github.com/stars` 页面把“未分组”变成默认整理入口
- 在 stars 卡片上显示 `Starred on ...` 日期与 list 标签
- 在仓库页 Star 区域旁增加 `Lists` 管理入口，尝试把原生 lists 菜单改造成可搜索、多选保存的面板

## 当前结构

- `manifest.json`：Chrome/Edge/Brave 可直接加载的 Manifest V3 扩展
- `src/background.js`：负责 GitHub API 请求与批量取消 Star
- `src/content.js`：负责 stars 页面增强与仓库页增强
- `src/options.*`：设置页，支持日期开关、隐藏已分组、PAT Token
- `src/shared/*`：运行时公共工具与存储封装

## 已实现能力

### stars 页面

- 视图切换：`全部` / `未分组` / 已发现的各个 list
- 默认支持“全部视图隐藏已分组仓库”设置
- 搜索仓库名、描述、list 名
- 按 Star 时间本地排序
- 在卡片上显示 Star 日期
- 在卡片上显示所属 list 标签（最多 3 个）
- 复选批量选择 + 批量取消 Star

### 仓库页

- 在 Star 区域旁新增 `Lists` 按钮
- 已缓存分组会显示为标签
- Star 新仓库后可自动尝试打开 lists 面板
- lists 面板支持搜索、勾选、多选后一次保存

## 设置项

- 显示 Star 日期
- 全部视图隐藏已分组仓库
- 显示 list 标签
- Star 后自动打开 lists 面板
- PAT Token（可选）

## 安装方式

### Chrome / Edge / Brave

1. 打开扩展管理页
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 选择当前仓库目录

### Firefox

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点击“临时载入附加组件”
3. 选择当前目录下的 `manifest.json`

## 测试

### 本地 smoke test

```bash
./scripts/test-extension.sh
```

覆盖内容：

- 所有扩展脚本语法检查
- Chrome callback 风格 API 兼容
- Firefox Promise 风格 API 兼容
- manifest 的 Chrome / Firefox 关键字段完整性

### 浏览器侧最小验证

- Chrome：可使用 headless + `--load-extension` 方式验证扩展目录可被真实浏览器加载
- Firefox：当前更适合通过 `about:debugging#/runtime/this-firefox` 做临时加载人工确认

## 当前已知限制

- GitHub 原生 star / lists 下拉的 DOM 比较容易变化，仓库页多选保存这部分目前依赖运行时解析原生菜单；如果 GitHub 又改结构，可能需要再做一轮选择器适配。
- list 归属信息优先通过 stars 页面上的 list 入口做抓取缓存，list 数量很多时首次计算会稍慢。
- 批量“加入/移出 list”还没有接进 stars 页面悬浮工具栏，下一步建议补这一块。
