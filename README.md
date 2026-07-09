# OC Wiki Worldbook

SillyTavern third-party extension for binding OC Wiki shared entries as an external worldbook.

This repository only contains the SillyTavern extension. The OC Wiki application source stays in the main `WHrst/oc` repository and only needs to expose the `/api/tavern/*` endpoints.

## Install

Install this repository from SillyTavern's extension installer, or clone it into SillyTavern's third-party extensions directory:

```bash
git clone https://github.com/WHrst/oc-wiki-sillytavern-extension.git public/scripts/extensions/third-party/oc-wiki-worldbook
```

Restart SillyTavern or reload the extensions page.

## Usage

1. Open Extensions settings.
2. Find **OC Wiki Worldbook**.
3. Paste an OC Wiki share link like `https://oc.example.com/?share=TOKEN#entry=ENTRY_ID`.
4. Click **Bind share link**.
5. Keep the extension enabled. Bound entries are fetched before generation and inserted as a system context note.

## OC Wiki API

The extension expects the OC Wiki server to expose:

- `GET /api/tavern/resolve?url=<share-url>`
- `POST /api/tavern/context`

Only shared entries with a valid share token can be read.
