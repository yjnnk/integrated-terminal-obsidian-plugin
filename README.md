# Integrated Terminal (Obsidian Plugin)

Adds a VS Code-like integrated terminal pane to Obsidian.

## Features

- Command: `Open Integrated Terminal`
- Command: `Open Integrated Terminal Here (Restart)`
- Starts shell in active file folder, or vault root when no file is active
- In-pane controls: `Restart Here`, `Clear`

## Build

```bash
npm install
npm run build
```

## Install in your vault

Create exactly this folder (must match manifest id):

`<your-vault>/.obsidian/plugins/open-ghostty-here/`

Place these inside:

- `main.js`
- `manifest.json`
- `styles.css`
- `node_modules/@homebridge/node-pty-prebuilt-multiarch/`

Do not install into a different folder name (for example `obs_plugin_terminal`) unless you also mirror the same files under `open-ghostty-here`.

## Notes

- Desktop Obsidian only.
- Shell path defaults to `SHELL` env var, fallback `/bin/zsh`.
- This plugin needs the PTY dependency at runtime (folder above).
