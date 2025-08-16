// Minimal LSP server used by the client tests. It speaks the base protocol over
// stdio: responds to initialize and shutdown, and publishes one diagnostic per
// opened document. Run it with node, no build step.

let buffer = Buffer.alloc(0);

function send(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function handle(message) {
  if (message.id === undefined) {
    // Notification: the client finishing its handshake or opening a document.
    if (
      message.method === "textDocument/didOpen" ||
      message.method === "textDocument/didChange"
    ) {
      const doc = message.params?.textDocument;
      const uri = doc?.uri;
      const text =
        message.method === "textDocument/didOpen"
          ? doc?.text
          : message.params?.contentChanges?.[0]?.text;
      const clean = typeof text === "string" && !text.includes("BAD");
      send({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: {
          uri,
          diagnostics: clean
            ? []
            : [
                {
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 1 },
                  },
                  severity: 1,
                  source: "fake-lsp",
                  message: "fake diagnostic for " + uri,
                },
              ],
        },
      });
    }
    if (message.method === "exit") {
      process.exit(0);
    }
    return;
  }

  switch (message.method) {
    case "initialize":
      respond(message.id, {
        capabilities: { textDocumentSync: 1 },
        serverInfo: { name: "fake-lsp", version: "1.0.0" },
      });
      break;
    case "shutdown":
      respond(message.id, null);
      break;
    case "textDocument/hover":
      respond(message.id, { contents: "fake hover" });
      break;
    case "test/slow":
      // Never answers, so the client timeout path can be exercised.
      break;
    default:
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Unknown method ${message.method}` },
      });
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const body = buffer.subarray(start, start + length).toString("utf8");
    buffer = buffer.subarray(start + length);
    try {
      handle(JSON.parse(body));
    } catch {
      // Ignore a malformed frame; the client tests never send one on purpose.
    }
  }
});

if (process.argv.includes("--die-on-start")) {
  process.exit(3);
}
