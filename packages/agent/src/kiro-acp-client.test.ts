import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  KiroAcpClient,
  KiroAcpError,
  KIRO_ACP_CRASH,
  KIRO_ACP_TIMEOUT,
  type AcpUpdate,
} from "./kiro-acp-client";

// ─── Mock child_process.spawn ───

interface MockProcess extends EventEmitter {
  stdin: { write: ReturnType<typeof vi.fn> };
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn>;
}

function createMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdin = { write: vi.fn() };
  const stdout = new EventEmitter() as MockProcess["stdout"];
  stdout.setEncoding = vi.fn();
  proc.stdout = stdout;
  const stderr = new EventEmitter() as MockProcess["stderr"];
  stderr.setEncoding = vi.fn();
  proc.stderr = stderr;
  proc.exitCode = null;
  proc.kill = vi.fn();
  return proc;
}

let mockProcess: MockProcess;

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => mockProcess),
}));

// ─── Helpers ───

function sendJsonLine(proc: MockProcess, obj: unknown): void {
  proc.stdout.emit("data", JSON.stringify(obj) + "\n");
}

function getLastWrittenRequest(proc: MockProcess): { id: number; method: string; params: unknown } {
  const calls = proc.stdin.write.mock.calls;
  const lastCall = calls[calls.length - 1][0] as string;
  return JSON.parse(lastCall);
}

// ─── Tests ───

describe("KiroAcpClient", () => {
  let client: KiroAcpClient;

  beforeEach(() => {
    mockProcess = createMockProcess();
    client = new KiroAcpClient();
  });

  afterEach(() => {
    client.destroy();
  });

  describe("spawn", () => {
    it("should spawn subprocess and set up stdio pipes", () => {
      client.spawn();
      expect(client.isAlive()).toBe(true);
    });

    it("should throw if already spawned", () => {
      client.spawn();
      expect(() => client.spawn()).toThrow("subprocess already spawned");
    });
  });

  describe("initialize", () => {
    it("should send initialize request with correct params", async () => {
      client.spawn();

      const initPromise = client.initialize({ name: "test-agent", version: "1.0.0" });

      const req = getLastWrittenRequest(mockProcess);
      expect(req.method).toBe("initialize");
      expect(req.params).toEqual({
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: { name: "test-agent", version: "1.0.0" },
      });

      // Send response
      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        id: req.id,
        result: { protocolVersion: 1 },
      });

      const result = await initPromise;
      expect(result).toEqual({ protocolVersion: 1 });
    });
  });

  describe("createSession", () => {
    it("should send session/new and return sessionId", async () => {
      client.spawn();

      const sessionPromise = client.createSession("/workspace/repo", []);

      const req = getLastWrittenRequest(mockProcess);
      expect(req.method).toBe("session/new");
      expect(req.params).toEqual({ cwd: "/workspace/repo", mcpServers: [] });

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        id: req.id,
        result: { sessionId: "session_abc" },
      });

      const sessionId = await sessionPromise;
      expect(sessionId).toBe("session_abc");
    });

    it("should pass mcpServers when provided", async () => {
      client.spawn();

      const servers = [{ name: "test-mcp", command: "mcp-server", args: ["--port", "3000"] }];
      const sessionPromise = client.createSession("/workspace", servers);

      const req = getLastWrittenRequest(mockProcess);
      expect(req.params).toEqual({ cwd: "/workspace", mcpServers: servers });

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        id: req.id,
        result: { sessionId: "session_xyz" },
      });

      await sessionPromise;
    });
  });

  describe("sendPrompt", () => {
    it("should send session/prompt and collect transcript from AgentMessageChunk updates", async () => {
      client.spawn();

      const promptPromise = client.sendPrompt("session_abc", "Implement feature X", 30000);

      const req = getLastWrittenRequest(mockProcess);
      expect(req.method).toBe("session/prompt");
      expect(req.params).toEqual({
        sessionId: "session_abc",
        prompt: [{ type: "text", text: "Implement feature X" }],
      });

      // Simulate streaming updates
      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: { kind: "AgentMessageChunk", content: "Hello " },
        },
      });

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: { kind: "AgentMessageChunk", content: "World" },
        },
      });

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: { kind: "TurnEnd" },
        },
      });

      // Send prompt response
      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        id: req.id,
        result: { stopReason: "end_turn" },
      });

      const result = await promptPromise;
      expect(result.stopReason).toBe("end_turn");
      expect(result.transcript).toBe("Hello World");
      expect(result.toolCalls).toEqual([]);
    });

    it("should track ToolCall events", async () => {
      client.spawn();

      const promptPromise = client.sendPrompt("session_abc", "Do something", 30000);
      const req = getLastWrittenRequest(mockProcess);

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            kind: "ToolCall",
            toolCallId: "tc_1",
            toolName: "writeFile",
          },
        },
      });

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        id: req.id,
        result: { stopReason: "end_turn" },
      });

      const result = await promptPromise;
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].toolCallId).toBe("tc_1");
      expect(result.toolCalls[0].toolName).toBe("writeFile");
    });

    it("should handle snake_case update kinds", async () => {
      client.spawn();

      const promptPromise = client.sendPrompt("s1", "test", 30000);
      const req = getLastWrittenRequest(mockProcess);

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: { kind: "agent_message_chunk", content: "hi" },
        },
      });

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: { kind: "tool_call", toolCallId: "tc_2", toolName: "readFile" },
        },
      });

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        id: req.id,
        result: { stopReason: "end_turn" },
      });

      const result = await promptPromise;
      expect(result.transcript).toBe("hi");
      expect(result.toolCalls).toHaveLength(1);
    });

    it("should handle updates array format", async () => {
      client.spawn();

      const promptPromise = client.sendPrompt("s1", "test", 30000);
      const req = getLastWrittenRequest(mockProcess);

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          updates: [
            { kind: "AgentMessageChunk", content: "batch1" },
            { kind: "AgentMessageChunk", content: "batch2" },
          ],
        },
      });

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        id: req.id,
        result: { stopReason: "end_turn" },
      });

      const result = await promptPromise;
      expect(result.transcript).toBe("batch1batch2");
    });

    it("should timeout and kill process", async () => {
      vi.useFakeTimers();
      client.spawn();

      const promptPromise = client.sendPrompt("s1", "slow task", 5000);

      // Advance past timeout
      vi.advanceTimersByTime(6000);

      await expect(promptPromise).rejects.toThrow("timed out");
      await expect(promptPromise).rejects.toBeInstanceOf(KiroAcpError);

      try {
        await promptPromise;
      } catch (err) {
        expect((err as KiroAcpError).code).toBe(KIRO_ACP_TIMEOUT);
      }

      expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");

      vi.useRealTimers();
    });
  });

  describe("subprocess crash handling", () => {
    it("should reject pending requests on unexpected exit", async () => {
      client.spawn();

      const initPromise = client.initialize({ name: "test", version: "1.0" });

      // Simulate crash
      mockProcess.exitCode = 1;
      mockProcess.emit("exit", 1, null);

      await expect(initPromise).rejects.toThrow("exited unexpectedly");
      await expect(initPromise).rejects.toBeInstanceOf(KiroAcpError);
    });

    it("should emit crash event on unexpected exit", async () => {
      client.spawn();

      const crashPromise = new Promise<unknown>((resolve) => {
        client.on("crash", resolve);
      });

      mockProcess.stderr.emit("data", "fatal error\n");
      mockProcess.exitCode = 1;
      mockProcess.emit("exit", 1, null);

      const crashInfo = (await crashPromise) as { code: number; stderr: string };
      expect(crashInfo.code).toBe(1);
      expect(crashInfo.stderr).toContain("fatal error");
    });

    it("should capture stderr for diagnostics", () => {
      client.spawn();

      mockProcess.stderr.emit("data", "warning: something\n");
      mockProcess.stderr.emit("data", "error: bad thing\n");

      expect(client.getStderr()).toContain("warning: something");
      expect(client.getStderr()).toContain("error: bad thing");
    });
  });

  describe("JSON-RPC error handling", () => {
    it("should reject with KiroAcpError on JSON-RPC error response", async () => {
      client.spawn();

      const initPromise = client.initialize({ name: "test", version: "1.0" });
      const req = getLastWrittenRequest(mockProcess);

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32600, message: "Invalid request" },
      });

      await expect(initPromise).rejects.toThrow("Invalid request");
    });
  });

  describe("destroy", () => {
    it("should kill subprocess and reject pending requests", async () => {
      client.spawn();

      const initPromise = client.initialize({ name: "test", version: "1.0" });

      client.destroy();

      expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
      await expect(initPromise).rejects.toThrow("destroyed");
    });
  });

  describe("isAlive", () => {
    it("should return true when process is running", () => {
      client.spawn();
      expect(client.isAlive()).toBe(true);
    });

    it("should return false when process has exited", () => {
      client.spawn();
      mockProcess.exitCode = 0;
      expect(client.isAlive()).toBe(false);
    });

    it("should return false when not spawned", () => {
      expect(client.isAlive()).toBe(false);
    });
  });

  describe("sendRequest without spawn", () => {
    it("should reject if subprocess not spawned", async () => {
      await expect(
        client.initialize({ name: "test", version: "1.0" }),
      ).rejects.toThrow("subprocess not spawned");
    });
  });

  describe("auto-incrementing IDs", () => {
    it("should use incrementing request IDs", async () => {
      client.spawn();

      const initPromise = client.initialize({ name: "test", version: "1.0" });
      const req1 = getLastWrittenRequest(mockProcess);

      const sessionPromise = client.createSession("/workspace");
      const req2 = getLastWrittenRequest(mockProcess);

      expect(req2.id).toBe(req1.id + 1);

      // Resolve both to avoid unhandled rejections
      sendJsonLine(mockProcess, { jsonrpc: "2.0", id: req1.id, result: {} });
      sendJsonLine(mockProcess, { jsonrpc: "2.0", id: req2.id, result: { sessionId: "s" } });

      await initPromise;
      await sessionPromise;
    });
  });

  describe("content extraction", () => {
    it("should extract text from object content with text field", async () => {
      client.spawn();

      const promptPromise = client.sendPrompt("s1", "test", 30000);
      const req = getLastWrittenRequest(mockProcess);

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: { kind: "AgentMessageChunk", content: { text: "from object" } },
        },
      });

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        id: req.id,
        result: { stopReason: "end_turn" },
      });

      const result = await promptPromise;
      expect(result.transcript).toBe("from object");
    });

    it("should extract text from array content", async () => {
      client.spawn();

      const promptPromise = client.sendPrompt("s1", "test", 30000);
      const req = getLastWrittenRequest(mockProcess);

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            kind: "AgentMessageChunk",
            content: [{ text: "part1" }, { text: "part2" }],
          },
        },
      });

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        id: req.id,
        result: { stopReason: "end_turn" },
      });

      const result = await promptPromise;
      expect(result.transcript).toBe("part1part2");
    });

    it("should handle session/notification method", async () => {
      client.spawn();

      const updates: AcpUpdate[] = [];
      client.on("update", (u: AcpUpdate) => updates.push(u));

      const promptPromise = client.sendPrompt("s1", "test", 30000);
      const req = getLastWrittenRequest(mockProcess);

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        method: "session/notification",
        params: {
          update: { kind: "AgentMessageChunk", content: "notif" },
        },
      });

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        id: req.id,
        result: { stopReason: "end_turn" },
      });

      await promptPromise;
      expect(updates).toHaveLength(1);
      expect(updates[0].kind).toBe("AgentMessageChunk");
    });
  });

  describe("buffered stdout parsing", () => {
    it("should handle partial JSON lines across chunks", async () => {
      client.spawn();

      const promptPromise = client.sendPrompt("s1", "test", 30000);
      const req = getLastWrittenRequest(mockProcess);

      // Send partial line
      const fullLine = JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: { update: { kind: "AgentMessageChunk", content: "chunked" } },
      });

      const mid = Math.floor(fullLine.length / 2);
      mockProcess.stdout.emit("data", fullLine.slice(0, mid));
      mockProcess.stdout.emit("data", fullLine.slice(mid) + "\n");

      sendJsonLine(mockProcess, {
        jsonrpc: "2.0",
        id: req.id,
        result: { stopReason: "end_turn" },
      });

      const result = await promptPromise;
      expect(result.transcript).toBe("chunked");
    });
  });
});
