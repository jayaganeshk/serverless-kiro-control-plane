import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ─── Error Codes ───

export const KIRO_ACP_CRASH = "KIRO_ACP_CRASH";
export const KIRO_ACP_TIMEOUT = "KIRO_ACP_TIMEOUT";

// ─── Types ───

export interface ClientInfo {
  name: string;
  version: string;
}

export interface McpServer {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  type?: string;
  disabled?: boolean;
}

export interface AcpUpdate {
  kind: string;
  content?: unknown;
  toolCallId?: string;
  toolName?: string;
  [key: string]: unknown;
}

export interface PromptResult {
  stopReason: string;
  transcript: string;
  toolCalls: ToolCallInfo[];
}

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  raw: AcpUpdate;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

// ─── Managed Terminal ───

interface ManagedTerminal {
  id: string;
  process: ChildProcess;
  output: string;
  truncated: boolean;
  exitCode: number | null;
  signal: string | null;
  exited: boolean;
  outputByteLimit: number;
  waiters: Array<{ resolve: (val: { exitCode: number | null; signal: string | null }) => void }>;
}

// ─── KiroAcpClient ───

export class KiroAcpClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private stdoutBuffer = "";
  private stderrOutput = "";
  private destroyed = false;
  private _agentName: string | undefined;

  private terminals = new Map<string, ManagedTerminal>();
  private nextTerminalId = 1;

  setAgentName(name: string): void {
    this._agentName = name;
  }

  // ─── Spawn ───

  spawn(agentName?: string): void {
    const effectiveAgent = agentName ?? this._agentName;
    if (this.process) {
      throw new Error("KiroAcpClient: subprocess already spawned");
    }

    const args = ["acp"];
    if (effectiveAgent) {
      args.push("--agent", effectiveAgent);
    }

    this.process = spawn("kiro-cli", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout!.setEncoding("utf-8");
    this.process.stderr!.setEncoding("utf-8");

    this.process.stdout!.on("data", (chunk: string) => {
      this.handleStdoutData(chunk);
    });

    this.process.stderr!.on("data", (chunk: string) => {
      this.stderrOutput += chunk;
      for (const line of chunk.split("\n").filter(Boolean)) {
        console.log(`[kiro-stderr] ${line}`);
      }
    });

    this.process.on("exit", (code, signal) => {
      if (!this.destroyed) {
        this.rejectAllPending(
          new KiroAcpError(
            `kiro-cli acp exited unexpectedly (code=${code}, signal=${signal}). stderr: ${this.stderrOutput}`,
            KIRO_ACP_CRASH,
          ),
        );
        this.emit("crash", { code, signal, stderr: this.stderrOutput });
      }
    });

    this.process.on("error", (err) => {
      this.rejectAllPending(
        new KiroAcpError(
          `Failed to spawn kiro-cli acp: ${err.message}`,
          KIRO_ACP_CRASH,
        ),
      );
      this.emit("error", err);
    });
  }

  // ─── Send JSON-RPC Request (client → agent) ───

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    if (!this.process || !this.process.stdin) {
      return Promise.reject(
        new KiroAcpError("KiroAcpClient: subprocess not spawned", KIRO_ACP_CRASH),
      );
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  // ─── Send JSON-RPC Response (client → agent, replying to agent's request) ───

  private sendResponse(id: number | string, result: unknown): void {
    if (!this.process?.stdin) return;
    const response = JSON.stringify({ jsonrpc: "2.0", id, result });
    this.process.stdin.write(response + "\n");
  }

  private sendErrorResponse(id: number | string, code: number, message: string): void {
    if (!this.process?.stdin) return;
    const response = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
    this.process.stdin.write(response + "\n");
  }

  // ─── Initialize ───

  async initialize(clientInfo: ClientInfo): Promise<unknown> {
    return this.sendRequest("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo,
    });
  }

  // ─── Create Session ───

  async createSession(cwd: string, mcpServers: McpServer[] = []): Promise<string> {
    const result = (await this.sendRequest("session/new", {
      cwd,
      mcpServers,
    })) as { sessionId: string };
    return result.sessionId;
  }

  // ─── Send Prompt ───

  async sendPrompt(
    sessionId: string,
    promptText: string,
    timeout: number = 20 * 60 * 1000,
  ): Promise<PromptResult> {
    let transcript = "";
    const toolCalls: ToolCallInfo[] = [];
    let turnEnded = false;

    const onUpdate = (update: AcpUpdate) => {
      const kind = update.kind;
      if (kind === "AgentMessageChunk" || kind === "agent_message_chunk") {
        const text = extractText(update);
        if (text) {
          transcript += text;
        }
      } else if (kind === "ToolCall" || kind === "tool_call") {
        toolCalls.push({
          toolCallId: String(update.toolCallId ?? ""),
          toolName: String(update.toolName ?? ""),
          raw: update,
        });
      } else if (kind === "TurnEnd" || kind === "turn_end") {
        turnEnded = true;
      }
    };

    this.on("update", onUpdate);

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const resultPromise = this.sendRequest("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: promptText }],
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(
            new KiroAcpError(
              `session/prompt timed out after ${timeout}ms`,
              KIRO_ACP_TIMEOUT,
            ),
          );
        }, timeout);
      });

      const result = (await Promise.race([resultPromise, timeoutPromise])) as {
        stopReason: string;
      };

      return {
        stopReason: result.stopReason,
        transcript,
        toolCalls,
      };
    } catch (err) {
      if (err instanceof KiroAcpError && err.code === KIRO_ACP_TIMEOUT) {
        this.killProcess();
      }
      throw err;
    } finally {
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
      }
      this.off("update", onUpdate);
    }
  }

  // ─── Destroy ───

  destroy(): void {
    this.destroyed = true;
    for (const [, term] of this.terminals) {
      if (!term.exited) {
        try { term.process.kill("SIGKILL"); } catch {}
      }
    }
    this.terminals.clear();
    this.killProcess();
    this.rejectAllPending(
      new KiroAcpError("KiroAcpClient destroyed", KIRO_ACP_CRASH),
    );
    this.removeAllListeners();
  }

  getStderr(): string {
    return this.stderrOutput;
  }

  isAlive(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  // ─── Internal: stdout parsing ───

  private handleStdoutData(chunk: string): void {
    this.stdoutBuffer += chunk;

    let newlineIdx: number;
    while ((newlineIdx = this.stdoutBuffer.indexOf("\n")) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);

      if (!line) continue;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      this.handleMessage(msg);
    }
  }

  // ─── Message Router ───

  private handleMessage(msg: Record<string, unknown>): void {
    const hasId = "id" in msg && (typeof msg.id === "number" || typeof msg.id === "string");
    const hasMethod = "method" in msg && typeof msg.method === "string";

    if (hasId && hasMethod) {
      // Incoming JSON-RPC REQUEST from kiro (agent → client)
      const reqId = msg.id as number | string;
      console.log(`[kiro-acp] ← REQUEST id=${reqId} method=${msg.method}`);
      this.handleIncomingRequest(reqId, msg.method as string, msg.params as Record<string, unknown> | undefined);
      return;
    }

    if (hasId && !hasMethod) {
      // JSON-RPC RESPONSE to a request we sent (agent → client reply)
      // Our requests use numeric IDs
      const numId = typeof msg.id === "number" ? msg.id : parseInt(String(msg.id), 10);
      const pending = this.pending.get(numId);
      if (!pending) return;
      this.pending.delete(numId);

      const response = msg as unknown as JsonRpcResponse;
      if (response.error) {
        pending.reject(
          new KiroAcpError(
            `JSON-RPC error: ${response.error.message} (code ${response.error.code})`,
            KIRO_ACP_CRASH,
          ),
        );
      } else {
        pending.resolve(response.result);
      }
      return;
    }

    // JSON-RPC NOTIFICATION (no "id", has "method")
    if (hasMethod) {
      const method = msg.method as string;
      if (method === "session/update" || method === "session/notification") {
        this.handleSessionUpdate(msg.params as Record<string, unknown> | undefined);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ACP Client-Side Request Handlers
  //  These handle requests FROM kiro TO our client (file I/O, terminal ops)
  // ═══════════════════════════════════════════════════════════════════════════

  private handleIncomingRequest(id: number | string, method: string, params: Record<string, unknown> | undefined): void {
    // Normalize for matching: lowercase, strip underscores
    const normalized = method.toLowerCase().replace(/_/g, "");

    try {
      let result: unknown;

      switch (normalized) {
        // ─── Permission (auto-approve for autonomous operation) ───
        case "session/requestpermission":
          result = this.handleRequestPermission(params);
          break;

        // ─── File System ───
        case "fs/readtextfile":
          result = this.handleFsReadTextFile(params);
          break;
        case "fs/writetextfile":
          result = this.handleFsWriteTextFile(params);
          break;

        // ─── Terminal Lifecycle ───
        case "terminal/create":
          result = this.handleTerminalCreate(params);
          break;
        case "terminal/waitforexit":
          this.handleTerminalWaitForExit(id, params);
          return; // async — sends response later
        case "terminal/output":
          result = this.handleTerminalOutput(params);
          break;
        case "terminal/kill":
          result = this.handleTerminalKill(params);
          break;
        case "terminal/release":
          result = this.handleTerminalRelease(params);
          break;

        default:
          console.log(`[kiro-acp] Unhandled method: ${method} — returning empty result`);
          result = {};
      }
      this.sendResponse(id, result);
    } catch (err: any) {
      console.error(`[kiro-acp] Error handling ${method}: ${err.message}`);
      this.sendErrorResponse(id, -32603, err.message);
    }
  }

  // ─── session/request_permission (auto-approve all operations) ───

  private handleRequestPermission(params: Record<string, unknown> | undefined): unknown {
    const options = params?.options as Array<{ optionId: string; name: string; kind: string }> | undefined;
    const toolCall = params?.toolCall as Record<string, unknown> | undefined;
    const title = toolCall?.title ?? "unknown";

    // Pick the first "allow" option, preferring allow_always over allow_once
    let selectedId = options?.[0]?.optionId ?? "allow-once";
    const allowAlways = options?.find(o => o.kind === "allow_always");
    const allowOnce = options?.find(o => o.kind === "allow_once");
    if (allowAlways) {
      selectedId = allowAlways.optionId;
    } else if (allowOnce) {
      selectedId = allowOnce.optionId;
    }

    console.log(`[kiro-acp] AUTO-APPROVE: "${title}" → ${selectedId}`);
    return { outcome: { outcome: "selected", optionId: selectedId } };
  }

  // ─── fs/read_text_file ───

  private handleFsReadTextFile(params: Record<string, unknown> | undefined): unknown {
    const filePath = String(params?.path ?? "");
    const line = params?.line != null ? Number(params.line) : undefined;
    const limit = params?.limit != null ? Number(params.limit) : undefined;

    console.log(`[kiro-fs] READ ${filePath}${line ? ` line=${line}` : ""}${limit ? ` limit=${limit}` : ""}`);

    let content = readFileSync(filePath, "utf-8");

    if (line != null || limit != null) {
      const lines = content.split("\n");
      const startIdx = line ? line - 1 : 0;
      const endIdx = limit ? startIdx + limit : lines.length;
      content = lines.slice(startIdx, endIdx).join("\n");
    }

    return { content };
  }

  // ─── fs/write_text_file ───

  private handleFsWriteTextFile(params: Record<string, unknown> | undefined): unknown {
    const filePath = String(params?.path ?? "");
    const content = String(params?.content ?? "");

    console.log(`[kiro-fs] WRITE ${filePath} (${content.length} chars)`);

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");

    return null;
  }

  // ─── terminal/create ───

  private handleTerminalCreate(params: Record<string, unknown> | undefined): unknown {
    const command = String(params?.command ?? "");
    const args = Array.isArray(params?.args) ? (params!.args as string[]) : [];
    const cwd = params?.cwd ? String(params.cwd) : undefined;
    const outputByteLimit = params?.outputByteLimit ? Number(params.outputByteLimit) : 10 * 1024 * 1024;

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (Array.isArray(params?.env)) {
      for (const e of params!.env as Array<{ name: string; value: string }>) {
        env[e.name] = e.value;
      }
    }

    const terminalId = `term_${this.nextTerminalId++}`;
    const cmdDisplay = [command, ...args].join(" ");
    console.log(`[kiro-term] CREATE ${terminalId}: ${cmdDisplay.slice(0, 200)}${cmdDisplay.length > 200 ? "..." : ""} (cwd=${cwd ?? "inherited"})`);

    const child = spawn(command, args, {
      cwd,
      env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const terminal: ManagedTerminal = {
      id: terminalId,
      process: child,
      output: "",
      truncated: false,
      exitCode: null,
      signal: null,
      exited: false,
      outputByteLimit,
      waiters: [],
    };

    const appendOutput = (chunk: string) => {
      terminal.output += chunk;
      if (Buffer.byteLength(terminal.output) > terminal.outputByteLimit) {
        const excess = Buffer.byteLength(terminal.output) - terminal.outputByteLimit;
        terminal.output = terminal.output.slice(excess);
        terminal.truncated = true;
      }
    };

    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => appendOutput(chunk));
    child.stderr?.on("data", (chunk: string) => appendOutput(chunk));

    child.on("exit", (code, signal) => {
      terminal.exited = true;
      terminal.exitCode = code;
      terminal.signal = signal as string | null;
      console.log(`[kiro-term] EXIT ${terminalId}: code=${code} signal=${signal}`);

      for (const w of terminal.waiters) {
        w.resolve({ exitCode: code, signal: signal as string | null });
      }
      terminal.waiters.length = 0;
    });

    child.on("error", (err) => {
      terminal.exited = true;
      terminal.exitCode = 1;
      terminal.output += `\nProcess error: ${err.message}\n`;
      console.error(`[kiro-term] ERROR ${terminalId}: ${err.message}`);

      for (const w of terminal.waiters) {
        w.resolve({ exitCode: 1, signal: null });
      }
      terminal.waiters.length = 0;
    });

    this.terminals.set(terminalId, terminal);
    return { terminalId };
  }

  // ─── terminal/wait_for_exit (async — responds when process exits) ───

  private handleTerminalWaitForExit(requestId: number | string, params: Record<string, unknown> | undefined): void {
    const terminalId = String(params?.terminalId ?? "");
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      this.sendErrorResponse(requestId, -32602, `Unknown terminal: ${terminalId}`);
      return;
    }

    if (terminal.exited) {
      console.log(`[kiro-term] WAIT_FOR_EXIT ${terminalId}: already exited (code=${terminal.exitCode})`);
      this.sendResponse(requestId, { exitCode: terminal.exitCode, signal: terminal.signal });
      return;
    }

    console.log(`[kiro-term] WAIT_FOR_EXIT ${terminalId}: waiting...`);
    terminal.waiters.push({
      resolve: (val) => {
        console.log(`[kiro-term] WAIT_FOR_EXIT ${terminalId}: resolved (code=${val.exitCode})`);
        this.sendResponse(requestId, val);
      },
    });
  }

  // ─── terminal/output ───

  private handleTerminalOutput(params: Record<string, unknown> | undefined): unknown {
    const terminalId = String(params?.terminalId ?? "");
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      return { output: "", truncated: false };
    }

    const result: Record<string, unknown> = {
      output: terminal.output,
      truncated: terminal.truncated,
    };

    if (terminal.exited) {
      result.exitStatus = {
        exitCode: terminal.exitCode,
        signal: terminal.signal,
      };
    }

    console.log(`[kiro-term] OUTPUT ${terminalId}: ${terminal.output.length} chars, exited=${terminal.exited}`);
    return result;
  }

  // ─── terminal/kill ───

  private handleTerminalKill(params: Record<string, unknown> | undefined): unknown {
    const terminalId = String(params?.terminalId ?? "");
    const terminal = this.terminals.get(terminalId);

    if (terminal && !terminal.exited) {
      console.log(`[kiro-term] KILL ${terminalId}`);
      try { terminal.process.kill("SIGTERM"); } catch {}
      setTimeout(() => {
        if (!terminal.exited) {
          try { terminal.process.kill("SIGKILL"); } catch {}
        }
      }, 3000);
    }
    return null;
  }

  // ─── terminal/release ───

  private handleTerminalRelease(params: Record<string, unknown> | undefined): unknown {
    const terminalId = String(params?.terminalId ?? "");
    const terminal = this.terminals.get(terminalId);

    if (terminal) {
      console.log(`[kiro-term] RELEASE ${terminalId}`);
      if (!terminal.exited) {
        try { terminal.process.kill("SIGKILL"); } catch {}
      }
      this.terminals.delete(terminalId);
    }
    return null;
  }

  // ─── Session Update Handling ───

  private handleSessionUpdate(params: Record<string, unknown> | undefined): void {
    if (!params) return;

    let updates: unknown[];
    if ("update" in params) {
      updates = [params.update];
    } else if ("updates" in params && Array.isArray(params.updates)) {
      updates = params.updates;
    } else {
      return;
    }

    for (const raw of updates) {
      if (!raw || typeof raw !== "object") continue;
      const update = raw as AcpUpdate;
      const kind = update.kind ?? (update as Record<string, unknown>).sessionUpdate;
      if (kind) {
        const normalized: AcpUpdate = { ...update, kind: String(kind) };
        this.emit("update", normalized);
      }
    }
  }

  // ─── Internal: process management ───

  private killProcess(): void {
    if (this.process && this.process.exitCode === null) {
      this.process.kill("SIGTERM");
      const forceKillTimer = setTimeout(() => {
        if (this.process && this.process.exitCode === null) {
          this.process.kill("SIGKILL");
        }
      }, 5000);
      forceKillTimer.unref();
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

// ─── Helpers ───

function extractText(update: AcpUpdate): string {
  const content = update.content;
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    if ("text" in content) return String((content as { text: unknown }).text);
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") {
            if ("text" in item) return String(item.text);
            if ("content" in item && item.content && typeof item.content === "object" && "text" in item.content) {
              return String(item.content.text);
            }
          }
          return "";
        })
        .join("");
    }
  }
  return "";
}

// ─── KiroAcpError ───

export class KiroAcpError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "KiroAcpError";
    this.code = code;
  }
}
