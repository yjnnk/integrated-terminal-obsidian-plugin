import {
  Notice,
  Plugin,
  FileSystemAdapter,
  ItemView,
  WorkspaceLeaf
} from "obsidian";
import path from "path";
import fs from "fs";
import { createRequire } from "module";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";

const VIEW_TYPE_INTEGRATED_TERMINAL = "integrated-terminal-view";

type PtyProcess = {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (event: { exitCode: number; signal?: number }) => void): {
    dispose(): void;
  };
};

type PtyModule = {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: NodeJS.ProcessEnv;
    }
  ): PtyProcess;
};

export default class IntegratedTerminalPlugin extends Plugin {
  private ptyModule: PtyModule | null = null;
  private ptyErrorShown = false;
  private ptyLoadError: string | null = null;

  async onload() {
    this.registerView(
      VIEW_TYPE_INTEGRATED_TERMINAL,
      (leaf) => new IntegratedTerminalView(leaf, this)
    );

    this.addCommand({
      id: "open-integrated-terminal",
      name: "Open Integrated Terminal",
      callback: () => this.openIntegratedTerminal(false)
    });

    this.addCommand({
      id: "open-integrated-terminal-here",
      name: "Open Integrated Terminal Here (Restart)",
      callback: () => this.openIntegratedTerminal(true)
    });

    this.addRibbonIcon("terminal", "Open Integrated Terminal", () =>
      this.openIntegratedTerminal(false)
    );

    this.loadPtyModule();
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_INTEGRATED_TERMINAL);
  }

  getCurrentCwd(): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("Integrated terminal requires a local filesystem vault.");
      return null;
    }

    const basePath = adapter.getBasePath();
    const activeFile = this.app.workspace.getActiveFile();
    const relativeDir = activeFile ? activeFile.parent.path : "";
    return path.join(basePath, relativeDir);
  }

  getShellPath(): string {
    return process.env.SHELL || "/bin/zsh";
  }

  getPtyModule(): PtyModule | null {
    if (this.ptyModule) return this.ptyModule;
    this.loadPtyModule();
    return this.ptyModule;
  }

  getPtyLoadError(): string | null {
    return this.ptyLoadError;
  }

  private addCandidateDir(
    bucket: string[],
    candidate: string | null | undefined
  ): void {
    if (!candidate) return;
    const normalized = path.resolve(candidate);
    if (normalized.includes("/electron.asar/")) return;
    if (!bucket.includes(normalized)) bucket.push(normalized);
  }

  private dirLooksLikePluginDir(candidate: string): boolean {
    const manifestPath = path.join(candidate, "manifest.json");
    if (!fs.existsSync(manifestPath)) return false;

    try {
      const raw = fs.readFileSync(manifestPath, "utf8");
      const parsed = JSON.parse(raw) as { id?: string };
      if (parsed.id === this.manifest.id) return true;
    } catch {
      // keep fallback checks below
    }

    return fs.existsSync(path.join(candidate, "main.js"));
  }

  private getRuntimePluginDir(): string | null {
    const candidates: string[] = [];
    const manifestDir = (this.manifest as unknown as { dir?: string }).dir;
    this.addCandidateDir(candidates, manifestDir);

    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      const pluginsRoot = path.join(
        adapter.getBasePath(),
        this.app.vault.configDir,
        "plugins"
      );

      this.addCandidateDir(candidates, path.join(pluginsRoot, this.manifest.id));

      if (fs.existsSync(pluginsRoot)) {
        const entries = fs.readdirSync(pluginsRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          this.addCandidateDir(candidates, path.join(pluginsRoot, entry.name));
        }
      }
    }

    // Keep this as a last-resort candidate, but never accept electron.asar paths.
    if (typeof __dirname === "string" && __dirname.length > 0) {
      this.addCandidateDir(candidates, __dirname);
    }

    for (const candidate of candidates) {
      if (this.dirLooksLikePluginDir(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private getScopedRequire() {
    const runtimeDir = this.getRuntimePluginDir();
    if (!runtimeDir) return require;

    try {
      return createRequire(path.join(runtimeDir, "main.js"));
    } catch {
      return require;
    }
  }

  private getPluginDir(): string | null {
    const runtimeDir = this.getRuntimePluginDir();
    if (runtimeDir && fs.existsSync(runtimeDir)) return runtimeDir;
    return runtimeDir;
  }

  private loadPtyModule() {
    const scopedRequire = this.getScopedRequire();
    const pluginDir = this.getPluginDir();
    const absolutePrebuilt = pluginDir
      ? path.join(pluginDir, "node_modules", "@homebridge", "node-pty-prebuilt-multiarch")
      : null;
    const absoluteNodePty = pluginDir
      ? path.join(pluginDir, "node_modules", "node-pty")
      : null;

    const loaders: Array<{ name: string; load: () => PtyModule }> = [
      {
        name: "@homebridge/node-pty-prebuilt-multiarch",
        load: () => scopedRequire("@homebridge/node-pty-prebuilt-multiarch") as PtyModule
      },
      {
        name: "node-pty",
        load: () => scopedRequire("node-pty") as PtyModule
      },
      {
        name: "absolute @homebridge/node-pty-prebuilt-multiarch",
        load: () => scopedRequire(absolutePrebuilt as string) as PtyModule
      },
      {
        name: "absolute node-pty",
        load: () => scopedRequire(absoluteNodePty as string) as PtyModule
      }
    ].filter((entry) => {
      if (entry.name.startsWith("absolute")) {
        const target = entry.name.includes("@homebridge")
          ? absolutePrebuilt
          : absoluteNodePty;
        return Boolean(target);
      }
      return true;
    });

    const errors: string[] = [];

    for (const loader of loaders) {
      try {
        this.ptyModule = loader.load();
        this.ptyLoadError = null;
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${loader.name}: ${message}`);
      }
    }

    this.ptyModule = null;
    this.ptyLoadError = errors.join(" | ");
    if (!this.ptyErrorShown) {
      this.ptyErrorShown = true;
      const details = this.ptyLoadError ? ` ${this.ptyLoadError}` : "";
      const pluginLocation = pluginDir ? ` dir=${pluginDir}.` : "";
      new Notice(`PTY backend unavailable.${pluginLocation}${details}`);
    }
  }

  private async openIntegratedTerminal(restartAtActivePath: boolean) {
    const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("tab");
    if (!leaf) return;

    await leaf.setViewState({ type: VIEW_TYPE_INTEGRATED_TERMINAL, active: true });
    this.app.workspace.revealLeaf(leaf);

    if (restartAtActivePath && leaf.view instanceof IntegratedTerminalView) {
      leaf.view.restartAtActivePath();
    }
  }
}

class IntegratedTerminalView extends ItemView {
  private plugin: IntegratedTerminalPlugin;
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private ptyProcess: PtyProcess | null = null;
  private terminalHostEl: HTMLDivElement | null = null;
  private cwdEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private terminalInputDisposable: { dispose(): void } | null = null;
  private ptyOutputDisposable: { dispose(): void } | null = null;
  private ptyExitDisposable: { dispose(): void } | null = null;
  private resizeFrame = 0;

  constructor(leaf: WorkspaceLeaf, plugin: IntegratedTerminalPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_INTEGRATED_TERMINAL;
  }

  getDisplayText(): string {
    return "Terminal";
  }

  getIcon(): string {
    return "terminal";
  }

  async onOpen() {
    this.renderLayout();
    this.startAtActivePath();

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.setCwdLabel(this.plugin.getCurrentCwd());
      })
    );
  }

  async onClose() {
    this.disposeTerminalProcess();
    this.terminal?.dispose();
    this.terminal = null;
    this.fitAddon = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeFrame) {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = 0;
    }
    this.contentEl.empty();
  }

  restartAtActivePath() {
    this.startAtActivePath();
  }

  private renderLayout() {
    this.contentEl.empty();
    this.contentEl.addClass("integrated-terminal");

    const toolbar = this.contentEl.createDiv({ cls: "integrated-terminal__toolbar" });
    this.cwdEl = toolbar.createDiv({ cls: "integrated-terminal__cwd" });
    this.statusEl = toolbar.createDiv({ cls: "integrated-terminal__status" });

    const actions = toolbar.createDiv({ cls: "integrated-terminal__actions" });

    const restartButton = actions.createEl("button", {
      text: "Restart Here",
      cls: "mod-cta"
    });
    restartButton.addEventListener("click", () => this.startAtActivePath());

    const clearButton = actions.createEl("button", { text: "Clear" });
    clearButton.addEventListener("click", () => {
      this.terminal?.clear();
      this.terminal?.focus();
    });

    this.terminalHostEl = this.contentEl.createDiv({ cls: "integrated-terminal__host" });

    this.terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "Menlo, Monaco, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: "#0d1117",
        foreground: "#d7dde7",
        cursor: "#9cb2d3",
        selectionBackground: "#2f3f57"
      }
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(this.terminalHostEl);
    this.terminal.focus();

    this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
    this.resizeObserver.observe(this.terminalHostEl);

    this.registerDomEvent(this.terminalHostEl, "mousedown", () => {
      this.terminal?.focus();
    });

    window.setTimeout(() => this.fitAndResizePty(), 0);
  }

  private startAtActivePath() {
    const cwd = this.plugin.getCurrentCwd();
    if (!cwd) {
      this.setStatus("Unable to resolve vault path.");
      return;
    }
    this.startProcess(cwd);
  }

  private startProcess(cwd: string) {
    const pty = this.plugin.getPtyModule();
    if (!pty) {
      const details = this.plugin.getPtyLoadError();
      this.setStatus(
        details
          ? `PTY backend missing. ${details}`
          : "PTY backend missing (node-pty). See README install notes."
      );
      return;
    }

    if (!this.terminal || !this.fitAddon) {
      this.setStatus("Terminal UI not initialized.");
      return;
    }

    this.disposeTerminalProcess();
    this.terminal.clear();
    this.setCwdLabel(cwd);

    const shellPath = this.plugin.getShellPath();
    const shellArgs = shellPath.includes("zsh") || shellPath.includes("bash") ? ["-l"] : [];

    this.fitAddon.fit();

    try {
      this.ptyProcess = pty.spawn(shellPath, shellArgs, {
        name: "xterm-256color",
        cols: Math.max(this.terminal.cols, 20),
        rows: Math.max(this.terminal.rows, 5),
        cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor"
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(`Failed to start shell: ${message}`);
      return;
    }

    this.terminalInputDisposable = this.terminal.onData((data) => {
      this.ptyProcess?.write(data);
    });

    this.ptyOutputDisposable = this.ptyProcess.onData((data) => {
      this.terminal?.write(data);
    });

    this.ptyExitDisposable = this.ptyProcess.onExit((event) => {
      this.setStatus(`Shell exited (code ${event.exitCode}). Press Restart Here.`);
      this.ptyProcess = null;
    });

    this.setStatus(`Running ${shellPath}`);
    this.fitAndResizePty();
    this.terminal.focus();
  }

  private scheduleFit() {
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = 0;
      this.fitAndResizePty();
    });
  }

  private fitAndResizePty() {
    if (!this.fitAddon || !this.terminal) return;
    this.fitAddon.fit();

    if (!this.ptyProcess) return;
    this.ptyProcess.resize(
      Math.max(this.terminal.cols, 20),
      Math.max(this.terminal.rows, 5)
    );
  }

  private setCwdLabel(cwd: string | null) {
    if (!this.cwdEl) return;
    this.cwdEl.textContent = cwd ? `cwd: ${cwd}` : "cwd: unavailable";
  }

  private setStatus(message: string) {
    if (!this.statusEl) return;
    this.statusEl.textContent = message;
  }

  private disposeTerminalProcess() {
    this.terminalInputDisposable?.dispose();
    this.terminalInputDisposable = null;
    this.ptyOutputDisposable?.dispose();
    this.ptyOutputDisposable = null;
    this.ptyExitDisposable?.dispose();
    this.ptyExitDisposable = null;

    if (!this.ptyProcess) return;
    try {
      this.ptyProcess.kill("SIGTERM");
    } catch {
      // ignore
    }
    this.ptyProcess = null;
  }
}
