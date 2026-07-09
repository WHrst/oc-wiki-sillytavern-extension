# OC Wiki Worldbook

SillyTavern 第三方扩展，用来把 OC Wiki 的共享条目绑定为外置世界书。

## 适合做什么

- 在 SillyTavern 里绑定 OC Wiki 的共享条目。
- 让别人发给你的 OC Wiki 共享条目，也能作为当前聊天的外置世界书使用。
- 在生成前自动拉取已绑定条目的正文、概述和引用关系，注册为 SillyTavern 原生扩展提示词。
- 可以在扩展设置里调整注入位置、深度、角色、顺序，以及是否参与世界书扫描。

## 安装

在 SillyTavern 的扩展安装器里填入本仓库地址：

```text
https://github.com/WHrst/oc-wiki-sillytavern-extension
```

也可以手动克隆到 SillyTavern 的第三方扩展目录：

```bash
git clone https://github.com/WHrst/oc-wiki-sillytavern-extension.git public/scripts/extensions/third-party/oc-wiki-worldbook
```

安装后重启 SillyTavern，或刷新扩展页面。

## 更新后还是英文？

0.2.1 开始，插件的脚本和样式都带版本参数，例如 `index.js?v=0.2.1`，用来绕过浏览器的模块缓存。

如果扩展列表显示已经是新版，但设置面板仍然是 `Enabled / Share link / Bind share link` 这套旧英文界面：

1. 在扩展管理器里再执行一次更新，确认版本至少是 `0.2.1`。
2. 重启 SillyTavern 后端，然后在浏览器里硬刷新页面。
3. 检查 `public/scripts/extensions/third-party/` 下是否有两个 OC Wiki 插件目录；如果有，只保留当前安装器使用的那个。
4. 新版面板底部状态会显示 `待命 · v0.2.1`。如果没有这个版本号，说明浏览器仍在运行旧脚本。

## 使用方法

1. 打开 SillyTavern 的扩展设置。
2. 找到 **OC Wiki Worldbook**。
3. 粘贴 OC Wiki 条目的分享链接，例如：

```text
https://oc.example.com/?share=TOKEN#entry=ENTRY_ID
```

4. 点击 **绑定分享链接** 绑定条目。
5. 保持扩展开启。生成前，扩展会自动向 OC Wiki 请求已绑定条目的上下文，并插入到当前请求里。

## 注入设置

插件现在走 SillyTavern 的 `setExtensionPrompt`，不是手动往聊天记录里塞一条消息。

可以在扩展设置里调整：

- 注入位置：主提示词内 / In Prompt、主提示词前 / Before Prompt、聊天中 / In Chat、不注入 / None。
- 深度：对应 SillyTavern 的 Depth。选择 In Chat 时会按这个深度插入。
- 角色：系统 / 用户 / 助手。主要影响 In Chat 注入时的消息身份。
- 注入顺序：用于生成扩展提示词 key，数值越小，在同层级拼接时越靠前。
- 参与世界书扫描：开启后，这段 OC Wiki 上下文会被 SillyTavern 世界书扫描逻辑看见，可能触发其他世界书条目。

SillyTavern 的扩展提示词 API 没有独立的“权重”参数；内置世界书里的权重主要用于条目分组抽选。这个插件目前只做注入顺序，不伪造一个不会影响抽选的权重开关。之后如果 OC Wiki API 返回条目级权重，再把它接到 OC Wiki 的上下文排序/预算里。

## 共享和权限

插件只能读取已经开启分享、并且分享 token 正确的条目。

也就是说：

- 没有分享 token 的私有条目不会被读取。
- token 错误或分享关闭后，插件请求会失败。
- 绑定别人发来的分享链接时，只能读取那个分享链接允许读取的条目。

## OC Wiki API

OC Wiki 本体需要暴露以下接口：

- `GET /api/tavern/resolve?url=<share-url>`
- `POST /api/tavern/context`

`/api/tavern/context` 会返回整理后的 prompt 文本，插件会把它作为外置世界书上下文注入。

## English

SillyTavern third-party extension for binding OC Wiki shared entries as an external worldbook.

This repository only contains the SillyTavern extension. The OC Wiki application source stays in the main `WHrst/oc` repository and only needs to expose the `/api/tavern/*` endpoints.

### Install

Install this repository from SillyTavern's extension installer:

```text
https://github.com/WHrst/oc-wiki-sillytavern-extension
```

Or clone it into SillyTavern's third-party extensions directory:

```bash
git clone https://github.com/WHrst/oc-wiki-sillytavern-extension.git public/scripts/extensions/third-party/oc-wiki-worldbook
```

Restart SillyTavern or reload the extensions page.

### Usage

1. Open Extensions settings.
2. Find **OC Wiki Worldbook**.
3. Paste an OC Wiki share link like `https://oc.example.com/?share=TOKEN#entry=ENTRY_ID`.
4. Click **Bind share link**.
5. Keep the extension enabled. Bound entries are fetched before generation and inserted as a system context note.

Only shared entries with a valid share token can be read.
