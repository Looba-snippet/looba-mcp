// Cloudflare Worker entrypoint.
//
// The npm/PyPI package speaks MCP over stdio (see index.js). This file exposes
// the exact same seven tools over Streamable HTTP, statelessly, with no Durable
// Object. It replaces the supergateway + systemd + nginx stack that serves
// mcp.looba.dev today: a Worker cannot spawn a child process, so bridging a
// stdio server was never an option here.
//
// Tools are I/O bound — each one is a fetch to looba.dev plus some string
// formatting — so this fits comfortably inside the Workers Free CPU budget.

import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "./index.js";
// Bundled by wrangler/esbuild, which resolves JSON imports natively. Node
// never loads this file, so the lack of an import attribute is fine here.
// index.js cannot read package.json itself once bundled: there is no
// import.meta.url to resolve it from.
import pkg from "./package.json";

const handler = createMcpHandler(() => createServer({ version: pkg.version }), {
  // The existing deployment serves MCP at the ROOT path (supergateway was run
  // with --streamableHttpPath /), and the README documents
  // https://mcp.looba.dev with no path. The handler defaults to "/mcp", so
  // this must stay "/" or every existing client breaks.
  route: "/",
});

export default {
  fetch(request, env, ctx) {
    return handler(request, env, ctx);
  },
};
