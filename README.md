# OC Wiki Worldbook

SillyTavern 第三方扩展，用来把 OC Wiki 的共享条目绑定为外置世界书。

这个仓库只包含 SillyTavern 扩展源码。OC Wiki 本体源码仍然在 `WHrst/oc` 仓库里，本体只需要提供 `/api/tavern/*` 对接接口。

## 适合做什么

- 在 SillyTavern 里绑定 OC Wiki 的共享条目。
- 让别人发给你的 OC Wiki 共享条目，也能作为当前聊天的外置世界书使用。
- 在生成前自动拉取已绑定条目的正文、概述和引用关系，插入为系统上下文。

它不会把 OC Wiki 的源码塞进酒馆，也不会替代 OC Wiki 本体。它只是一个连接器。

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

## 使用方法

1. 打开 SillyTavern 的扩展设置。
2. 找到 **OC Wiki Worldbook**。
3. 粘贴 OC Wiki 条目的分享链接，例如：

```text
https://oc.example.com/?share=TOKEN#entry=ENTRY_ID
```

4. 点击 **Bind share link** 绑定条目。
5. 保持扩展开启。生成前，扩展会自动向 OC Wiki 请求已绑定条目的上下文，并插入到当前请求里。

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
