import { Notice, Plugin, FileSystemAdapter } from "obsidian";
import { spawn } from "child_process";
import path from "path";

export default class OpenGhosttyHerePlugin extends Plugin {
  async onload() {
    this.addCommand({
      id: "open-ghostty-here",
      name: "Open Ghostty Here",
      callback: () => this.openGhosttyHere()
    });
  }

  private openGhosttyHere() {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("Unsupported vault adapter. Ghostty requires a local vault.");
      return;
    }

    const basePath = adapter.getBasePath();
    const activeFile = this.app.workspace.getActiveFile();
    const relativeDir = activeFile ? activeFile.parent.path : "";
    const cwd = path.join(basePath, relativeDir);

    const child = spawn("ghostty", [`--working-directory=${cwd}`], {
      detached: true,
      stdio: "ignore",
      shell: false
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        this.openGhosttyViaOpen(cwd);
        return;
      }
      new Notice(`Failed to launch Ghostty: ${err.message}`);
    });

    child.unref();
  }

  private openGhosttyViaOpen(cwd: string) {
    const child = spawn(
      "open",
      ["-na", "Ghostty", "--args", `--working-directory=${cwd}`],
      {
        detached: true,
        stdio: "ignore",
        shell: false
      }
    );

    child.on("error", (err: NodeJS.ErrnoException) => {
      new Notice(
        `Failed to launch Ghostty. Ensure Ghostty is installed. ${err.message}`
      );
    });

    child.unref();
  }
}
