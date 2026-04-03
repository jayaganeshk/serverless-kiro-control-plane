#!/usr/bin/env python3
import json
import subprocess
import threading
import time
import os

QUESTION = "What can you do? Reply in 3 short bullet points."

class KiroACP:
    def __init__(self):
        self.proc = subprocess.Popen(
            ["kiro-cli", "acp"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self.next_id = 1
        self.responses = {}
        self.lock = threading.Lock()

        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

    def _extract_text(self, update):
        content = update.get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, dict):
            return content.get("text", "")
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict):
                    if "text" in item:
                        parts.append(item["text"])
                    elif isinstance(item.get("content"), dict):
                        parts.append(item["content"].get("text", ""))
            return "".join(parts)
        return ""

    def _read_stdout(self):
        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue

            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                print(f"\n[stdout non-json] {line}")
                continue

            if "id" in msg:
                with self.lock:
                    self.responses[msg["id"]] = msg
                continue

            method = msg.get("method")
            if method not in ("session/update", "session/notification"):
                continue

            params = msg.get("params", {})

            if "update" in params:
                updates = [params["update"]]
            else:
                updates = params.get("updates", [])

            for update in updates:
                kind = update.get("kind") or update.get("sessionUpdate")

                if kind in ("AgentMessageChunk", "agent_message_chunk"):
                    text = self._extract_text(update)
                    if text:
                        print(text, end="", flush=True)

                elif kind in ("ToolCall", "tool_call"):
                    print(f"\n[tool] {json.dumps(update, ensure_ascii=False)}")

                elif kind in ("ToolCallUpdate", "tool_call_update"):
                    pass

                elif kind in ("TurnEnd", "turn_end"):
                    pass

    def _read_stderr(self):
        for line in self.proc.stderr:
            line = line.rstrip()
            if line:
                print(f"\n[kiro stderr] {line}")

    def call(self, method, params, timeout=20):
        req_id = self.next_id
        self.next_id += 1

        request = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params,
        }

        self.proc.stdin.write(json.dumps(request) + "\n")
        self.proc.stdin.flush()

        start = time.time()
        while True:
            with self.lock:
                if req_id in self.responses:
                    return self.responses.pop(req_id)

            if self.proc.poll() is not None:
                raise RuntimeError("kiro-cli exited unexpectedly")

            if time.time() - start > timeout:
                raise TimeoutError(f"Timed out waiting for {method}")

            time.sleep(0.05)

    def close(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()

def main():
    client = KiroACP()
    try:
        print("Starting Kiro ACP client...")

        init = client.call(
            "initialize",
            {
                "protocolVersion": 1,
                "clientCapabilities": {
                    "fs": {
                        "readTextFile": True,
                        "writeTextFile": True,
                    },
                    "terminal": True,
                },
                "clientInfo": {
                    "name": "simple-python-client",
                    "version": "0.1.0",
                },
            },
        )
        print("Initialize ok")

        new_session = client.call(
            "session/new",
            {
                "cwd": os.getcwd(),
                "mcpServers": [],
            },
        )
        print("Session created")

        session_id = new_session["result"]["sessionId"]

        print("\nQuestion:", QUESTION)
        print("\nKiro answer:\n")

        result = client.call(
            "session/prompt",
            {
                "sessionId": session_id,
                "prompt": [
                    {
                        "type": "text",
                        "text": QUESTION,
                    }
                ],
            },
            timeout=120,
        )

        print(f"\n\nPrompt finished with stopReason={result['result']['stopReason']}")

        # tiny delay so any final stdout notifications flush
        time.sleep(0.5)

    finally:
        client.close()

if __name__ == "__main__":
    main()