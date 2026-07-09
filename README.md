# External Lore Source

SillyTavern 第三方扩展，用来把 OC Wiki、外部网页、Wiki 页面或资料站整理成外置 lore 上下文，并在生成前通过 SillyTavern 原生扩展提示词注入。

这个仓库只包含 SillyTavern 扩展。OC Wiki 本体源码仍属于 `WHrst/oc`，不会放进这个插件仓库。

## 适合做什么

- 在 SillyTavern 里绑定 OC Wiki 的共享条目。
- 绑定别人发给你的 OC Wiki 分享条目，把它作为当前聊天的外置世界书使用。
- 绑定普通网页、MediaWiki、百科页面或资料站链接，并交给配置的整理/抓取 API 处理。
- 选择使用第三方整理 API，或使用酒馆当前主 API 做 AI 整理。
- 调整注入位置、深度、角色、顺序，以及是否参与世界书扫描。

## 安装

在 SillyTavern 的扩展安装器里填入本仓库地址：

```text
https://github.com/Wellilam/oc-wiki-sillytavern-extension
```

也可以手动克隆到 SillyTavern 的第三方扩展目录：

```bash
git clone https://github.com/Wellilam/oc-wiki-sillytavern-extension.git public/scripts/extensions/third-party/external-lore-source
```

安装后重启 SillyTavern 后端，或刷新扩展页面。

## 使用方法

1. 打开 SillyTavern 的扩展设置。
2. 找到 **External Lore Source**。
3. 点击 **打开设置** 打开配置弹窗。也可以在 **世界书** 页面标题或工具栏附近点击 External Lore Source 的链条按钮进入同一个弹窗。
4. 在弹窗里绑定 OC Wiki 分享链接或外部网页链接。
5. 选择整理方式：
   - **第三方整理 API**：外部服务负责抓取、清洗和整理。
   - **酒馆主 API**：外部服务只返回网页原文，插件再调用当前 SillyTavern 主 API 整理。
6. 根据需要填写 API 地址、API Key、模型列表 API、模型、语言和 token 预算。
7. 可以点击 **获取模型**、**测试连接**、**测试上下文**，确认后点 **保存设置**。
8. 保持扩展开启。生成前，插件会读取已启用来源，并把整理后的 lore 文本注入当前请求。

## 整理 API

插件本身不在浏览器里直接抓网页。这样设计是为了避免 CORS、网页反爬、API Key 暴露和 token 预算失控。

第三方整理 API 模式下，插件会向 `整理 / 抓取 API 地址` 发送 `POST` 请求：

```json
{
  "sources": [
    {
      "id": "external-lore-...",
      "type": "url",
      "url": "https://example.org/wiki/A",
      "title": "example.org"
    }
  ],
  "options": {
    "language": "zh-CN",
    "format": "sillytavern_lore",
    "maxTokens": 2000,
    "mode": "external",
    "modelProvider": "external",
    "task": "summarize",
    "model": "your-model-name"
  },
  "client": {
    "name": "External Lore Source",
    "version": "0.4.5"
  }
}
```

如果填写了 `API Key`，插件会带上：

```text
Authorization: Bearer <API Key>
```

整理 API 可以返回以下任意一种字段：

```json
{
  "prompt": "整理后的 lore 文本",
  "entries": [
    {
      "title": "条目标题",
      "content": "条目内容"
    }
  ],
  "failures": []
}
```

插件会优先读取 `prompt`，也兼容 `context`、`content`、`text`。如果没有这些字段，则会尝试把 `entries[].content`、`entries[].summary`、`entries[].text` 拼成注入文本。

## 酒馆主 API 模式

选择 **酒馆主 API** 时，插件会把请求的 `options` 改成：

```json
{
  "mode": "tavern",
  "modelProvider": "sillytavern",
  "task": "extract",
  "tavern": {
    "mainApi": "openai",
    "model": "当前酒馆模型"
  }
}
```

这个模式仍然需要外部抓取 API 返回网页原文，字段可以是 `raw`、`rawText`、`sourceText`、`content`、`text` 或 `entries`。插件拿到原文后，会调用 SillyTavern 暴露的 `generateRaw`，用当前主 API 把资料整理成 lore。

## 模型列表 API

点击 **获取模型** 时，如果填写了 `模型列表 API`，插件会请求该地址；如果没填，会尝试从整理 API 地址推导 `https://host/v1/models`。

兼容返回格式：

```json
{ "models": ["model-a", "model-b"] }
```

或 OpenAI 风格：

```json
{ "data": [{ "id": "model-a" }, { "id": "model-b" }] }
```

也可以不提供模型列表 API，直接在模型输入框里手动填写模型名。

## OC Wiki 兼容 API

OC Wiki 本体需要暴露以下接口：

- `GET /api/tavern/resolve?url=<share-url>`
- `POST /api/tavern/context`

`/api/tavern/context` 返回整理后的 `prompt` 文本，插件会把它和外部整理 API 返回的文本合并注入。

## 注入设置

插件走 SillyTavern 的 `setExtensionPrompt`，不是手动往聊天记录里塞一条消息。

可以在扩展设置里调整：

- 注入位置：主提示词内 / In Prompt、主提示词前 / Before Prompt、聊天中 / In Chat、不注入 / None。
- 深度：对应 SillyTavern 的 Depth。选择 In Chat 时会按这个深度插入。
- 角色：系统 / 用户 / 助手。主要影响 In Chat 注入时的消息身份。
- 注入顺序：用于生成扩展提示词 key，数值越小，在同层级拼接时越靠前。
- 参与世界书扫描：开启后，这段外部 lore 上下文会被 SillyTavern 世界书扫描逻辑看见，可能触发其他世界书条目。

SillyTavern 的扩展提示词 API 没有独立的“权重”参数；内置世界书里的权重主要用于条目分组抽选。这个插件只做注入顺序，不伪造一个不会影响抽选的权重开关。

## 共享和权限

- OC Wiki 来源只能读取已经开启分享、并且分享 token 正确的条目。
- 外部网页 / Wiki 来源的权限、登录态、反爬和抓取规则由整理/抓取 API 处理。
- 绑定别人发来的 OC Wiki 分享链接时，只能读取那个分享链接允许读取的条目。

## 从旧版升级

0.3.0 起，扩展显示名改为 **External Lore Source**，但会自动迁移旧的 `OC Wiki Worldbook` 设置。0.4.0 新增整理 API 弹窗、模型获取、测试连接和酒馆主 API 模式。0.4.1 会在新版脚本加载时替换已经存在的旧版设置面板，避免扩展热更新后仍显示旧表单。0.4.2 把来源绑定、API、注入设置和测试入口都收进同一个设置弹窗，并在世界书页面增加快捷按钮。0.4.3 会在扩展设置面板渲染前先准备弹窗，并把世界书页入口改成明显的“外置 Lore”按钮。0.4.4 提高设置弹窗的主题背景和文字对比度，改善浅色/透明主题下的可读性。0.4.5 修复弹窗底部按钮在部分主题/宽度下被压成单字竖排的问题，并兼容 Persona Weaver 使用的 `TavernHelper.generateRaw` 主 API 调用方式。

如果扩展列表显示已经更新，但设置面板仍然是旧界面：

1. 在扩展管理器里再执行一次更新，确认版本至少是 `0.4.5`。
2. 重启 SillyTavern 后端，然后在浏览器里硬刷新页面。
3. 检查 `public/scripts/extensions/third-party/` 下是否有多个旧插件目录；如果有，只保留当前安装器使用的那个。
4. 新版面板底部状态会显示 `待命 · v0.4.5`。

## English

SillyTavern third-party extension for injecting external lore context from OC Wiki shared entries or user-configured external source processors.

Install this repository from SillyTavern's extension installer:

```text
https://github.com/Wellilam/oc-wiki-sillytavern-extension
```

Version 0.4.5 keeps settings modal footer actions readable across SillyTavern themes and adds compatibility with the TavernHelper `generateRaw` main API pattern used by Persona Weaver.
