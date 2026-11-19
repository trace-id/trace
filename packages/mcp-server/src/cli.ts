#!/usr/bin/env node
import { TraceApi } from './api.js';
import { createMcpServer, serveStdio } from './server.js';

const endpoint = process.env.TRACE_ENDPOINT;
const secretKey = process.env.TRACE_SECRET_KEY;
if (!endpoint || !secretKey?.startsWith('sk_')) {
  process.stderr.write('trace-mcp: set TRACE_ENDPOINT (https://id.example.com) and TRACE_SECRET_KEY (sk_...)\n');
  process.exit(1);
}

const server = createMcpServer({
  api: new TraceApi({ endpoint, secretKey }),
  allowDelete: process.env.TRACE_ALLOW_DELETE === 'true',
});
serveStdio(server, process.stdin, process.stdout);
process.stderr.write(`trace-mcp ready (${server.tools().join(', ')})\n`);
