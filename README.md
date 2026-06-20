# Sensa

Sensa is a page-aware Chrome side panel AI assistant.  
Sensa 是一个具备环境感知能力的 Chrome 侧边栏 AI 助手。

It is designed to give the model more meaningful context from the page the user is currently viewing, instead of acting like a generic chat box.  
它的目标不是做一个泛泛聊天的工具，而是尽可能把用户当前网页环境中的“感觉材料”带给 AI。

## Features / 功能

- Native Chrome `Side Panel` chat UI
- Multi-turn conversation
- Per-page chat history persistence
- Fixed bottom input box
- Optional page context for each turn
- Optional screenshot for each turn
- Screenshot mode: `viewport` or `full page`
- Expandable per-message details
- Lightweight tab-switch trail as environment context

- 使用 Chrome 原生 `Side Panel`
- 支持多轮对话
- 按页面保留历史对话
- 输入框固定在底部
- 每轮可选是否附带页面内容
- 每轮可选是否附带截图
- 支持 `当前视野` / `整个页面` 两种截图范围
- 每轮消息可展开查看上下文详情
- 会附带轻量的标签页切换轨迹，帮助 AI 理解用户所处环境

## Install / 安装

### Load unpacked / 加载已解压扩展

1. Open Chrome and visit `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder

1. 打开 Chrome，访问 `chrome://extensions`
2. 开启 `开发者模式`
3. 点击 `加载已解压的扩展程序`
4. 选择当前目录 `/Users/ruska/projects/chrome 插件/Game Copilot`

### Install from release zip / 从 release zip 安装

1. Download `sensa-v1.0.0.zip` from the GitHub Release page
2. Unzip it to a local folder
3. Open `chrome://extensions`
4. Enable `Developer mode`
5. Click `Load unpacked`
6. Select the unzipped folder

1. 从 GitHub Release 页面下载 `sensa-v1.0.0.zip`
2. 解压到本地目录
3. 打开 `chrome://extensions`
4. 开启 `开发者模式`
5. 点击 `加载已解压的扩展程序`
6. 选择解压后的文件夹

## Configuration / 配置

1. Open the side panel from the extension icon
2. Click `配置`
3. Fill in your `API Key`
4. The default `Base URL` is `https://api.aixhan.com/v1`
5. The default model is `gpt-5.4`
6. Adjust prompt, font size, and screenshot mode if needed
7. Save

1. 点击浏览器工具栏里的插件图标，打开侧边栏
2. 点击顶部 `配置`
3. 填入你的 `API Key`
4. 默认 `Base URL` 为 `https://api.aixhan.com/v1`
5. 默认模型为 `gpt-5.4`
6. 按需调整系统提示词、字体大小、截图范围
7. 保存设置

## Usage / 使用

1. Open any webpage
2. Open the Sensa side panel
3. Choose whether to include page context and screenshot for this turn
4. Type your question
5. Send

1. 打开任意网页
2. 打开 Sensa 侧边栏
3. 选择本轮是否附带页面内容和截图
4. 输入你的问题
5. 点击发送

## Notes / 说明

- Sensa does not continuously upload page data in the background
- Fresh page context is only attached when you check it for the current turn
- Fresh screenshot is only attached when you check it for the current turn
- Page context and screenshot hashes are deduplicated to avoid wasting tokens
- Chat history is persisted per page URL
- Stored session snapshots are compacted to avoid browser storage quota issues

- Sensa 不会在后台持续实时上传页面
- 只有在本轮勾选“页面内容”时，才会附带最新页面上下文
- 只有在本轮勾选“截图”时，才会附带最新截图
- 页面内容与截图都会做 hash 去重，避免浪费 token
- 历史对话按页面 URL 维度持久化
- 本地会话快照会做压缩，避免触发浏览器存储配额问题

## Name / 命名

See [SENSA_BRAND.md](./SENSA_BRAND.md).  
可参考 [SENSA_BRAND.md](./SENSA_BRAND.md) 了解命名来源。
