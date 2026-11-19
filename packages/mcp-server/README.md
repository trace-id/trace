# @trace-id/mcp

Model Context Protocol server for Trace. Lets an AI assistant look up events, explain why a user was flagged and
investigate devices with your secret key.

```sh
claude mcp add trace -e TRACE_ENDPOINT=https://id.example.com -e TRACE_SECRET_KEY=sk_... -- npx -y @trace-id/mcp
```

Or in an `mcpServers` config (Claude Desktop, Cursor):

```json
{ "mcpServers": { "trace": { "command": "npx", "args": ["-y", "@trace-id/mcp"], "env": { "TRACE_ENDPOINT": "https://id.example.com", "TRACE_SECRET_KEY": "sk_..." } } } }
```

Tools: `explain_event`, `get_event`, `get_visitor`, `get_device`, `list_signals` (all read-only), and `delete_visitor`
only with `TRACE_ALLOW_DELETE=true` (destructive, requires `confirm: true`).

Use a dedicated secret key for the assistant so it can be revoked on its own. Library use: `createMcpServer({ api })`
from this package, with `serveStdio` or your own transport.
