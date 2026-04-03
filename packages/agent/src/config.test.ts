import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig, validatePrerequisites, type AgentConfig } from "./config.js";
import * as fs from "node:fs";
import * as child_process from "node:child_process";
import { EventEmitter } from "node:events";

vi.mock("node:fs");
vi.mock("node:child_process");

const VALID_CONFIG = {
  machineId: "machine-abc-123",
  machineLabel: "dev-box-1",
  capabilities: ["node", "python"],
  repoAllowlist: ["repo-1", "repo-2"],
  workspaceRoot: "/home/user/workspace",
  pollingIntervalMs: 5000,
  maxConcurrentJobs: 2,
  bundleCacheDir: "/home/user/.cache/bundles",
  backendApiUrl: "https://api.example.com",
  sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
  logDir: "/var/log/agent",
};

describe("loadConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads a valid config file with all fields", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(VALID_CONFIG));

    const config = loadConfig("/path/to/config.json");

    expect(config).toEqual(VALID_CONFIG);
  });

  it("applies defaults for pollingIntervalMs and maxConcurrentJobs when omitted", () => {
    const { pollingIntervalMs, maxConcurrentJobs, ...rest } = VALID_CONFIG;
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(rest));

    const config = loadConfig("/path/to/config.json");

    expect(config.pollingIntervalMs).toBe(10_000);
    expect(config.maxConcurrentJobs).toBe(1);
  });

  it("defaults capabilities and repoAllowlist to empty arrays when omitted", () => {
    const { capabilities, repoAllowlist, ...rest } = VALID_CONFIG;
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(rest));

    const config = loadConfig("/path/to/config.json");

    expect(config.capabilities).toEqual([]);
    expect(config.repoAllowlist).toEqual([]);
  });

  it("throws when config file does not exist", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });

    expect(() => loadConfig("/missing/config.json")).toThrow(
      "Failed to read config file",
    );
  });

  it("throws when config file is not valid JSON", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("not json {{{");

    expect(() => loadConfig("/path/to/config.json")).toThrow(
      "not valid JSON",
    );
  });

  it("throws when required fields are missing", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ capabilities: [] }));

    expect(() => loadConfig("/path/to/config.json")).toThrow(
      "Missing required config fields",
    );
  });

  it("throws when a required field is empty string", () => {
    const config = { ...VALID_CONFIG, machineId: "" };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

    expect(() => loadConfig("/path/to/config.json")).toThrow(
      "Missing required config fields: machineId",
    );
  });
});

// ─── validatePrerequisites tests ───

function createMockChildProcess() {
  const emitter = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    stdin: null;
    stdout: null;
    stderr: null;
  };
  emitter.kill = vi.fn();
  emitter.stdin = null;
  emitter.stdout = null;
  emitter.stderr = null;
  return emitter;
}

describe("validatePrerequisites", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when both kiro-cli and git are available", async () => {
    const kiroChild = createMockChildProcess();
    const gitMock = vi.mocked(child_process.execFile);

    // First call: kiro-cli acp
    gitMock.mockImplementation(((cmd: string, args: string[], cb?: Function) => {
      if (cmd === "kiro-cli") {
        // Simulate kiro-cli starting — it will be killed by the timer
        return kiroChild;
      }
      // git --version
      if (cmd === "git" && cb) {
        cb(null, "git version 2.40.0", "");
      }
      return kiroChild;
    }) as unknown as typeof child_process.execFile);

    const promise = validatePrerequisites();

    // Advance past the 2s kiro-cli check timer
    vi.advanceTimersByTime(2000);

    await expect(promise).resolves.toBeUndefined();
    expect(kiroChild.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("rejects when kiro-cli is not on PATH", async () => {
    const kiroChild = createMockChildProcess();
    const gitMock = vi.mocked(child_process.execFile);

    gitMock.mockImplementation(((cmd: string, _args: string[], cb?: Function) => {
      if (cmd === "kiro-cli") {
        // Simulate ENOENT on next tick
        process.nextTick(() => {
          const err = new Error("spawn kiro-cli ENOENT") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          kiroChild.emit("error", err);
        });
        return kiroChild;
      }
      if (cmd === "git" && cb) {
        cb(null, "git version 2.40.0", "");
      }
      return kiroChild;
    }) as unknown as typeof child_process.execFile);

    const promise = validatePrerequisites();
    vi.advanceTimersByTime(100);

    await expect(promise).rejects.toThrow("kiro-cli is not installed");
  });

  it("rejects when git is not on PATH", async () => {
    const kiroChild = createMockChildProcess();
    const gitMock = vi.mocked(child_process.execFile);

    gitMock.mockImplementation(((cmd: string, _args: string[], cb?: Function) => {
      if (cmd === "kiro-cli") {
        // kiro-cli exits cleanly
        process.nextTick(() => kiroChild.emit("exit", 0));
        return kiroChild;
      }
      if (cmd === "git" && cb) {
        const err = new Error("spawn git ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        cb(err, "", "");
      }
      return kiroChild;
    }) as unknown as typeof child_process.execFile);

    const promise = validatePrerequisites();
    vi.advanceTimersByTime(100);

    await expect(promise).rejects.toThrow("git is not installed");
  });
});
