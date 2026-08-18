import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { detectFrontendProject } from "../index.js";

const REPO_ROOT = dirname(fileURLToPath(new URL("../index.js", import.meta.url)));

function makeProject(files) {
  const dir = mkdtempSync(join(tmpdir(), "looba-detect-"));
  for (const [name, contents] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Regression: the remote-transport bug.
//
// index.js runs over stdio locally (npx) but is also exposed remotely at
// mcp.looba.dev through supergateway. Remotely the filesystem belongs to the
// SERVER, not to the user's project, so any disk-based answer is meaningless.
// The old code returned a confident "not a frontend project" in that case,
// which silently switched Looba off for every remote user.
// ---------------------------------------------------------------------------

test("a directory the server cannot see is indeterminate, never a negative", () => {
  const result = detectFrontendProject({
    directory: "/Users/someone/projects/their-react-app",
  });

  assert.equal(result.status, "indeterminate");
  assert.equal(result.reason, "directory-not-found");
  assert.notEqual(result.status, "not-frontend");
});

test("scanning the server's own install directory is indeterminate", () => {
  const result = detectFrontendProject({ directory: REPO_ROOT });

  assert.equal(result.status, "indeterminate");
  assert.equal(result.reason, "server-directory");
});

test("no directory and no packageJson never yields a confident negative from the server root", () => {
  // Mirrors a remote call with no arguments: cwd is the server's own dir.
  const result = detectFrontendProject({});
  assert.notEqual(result.status, "not-frontend");
});

// ---------------------------------------------------------------------------
// The fix: client-supplied package.json makes detection transport-agnostic.
// ---------------------------------------------------------------------------

test("detects React from a client-supplied package.json string", () => {
  const result = detectFrontendProject({
    packageJson: JSON.stringify({ dependencies: { react: "^18.2.0" } }),
  });

  assert.equal(result.status, "detected");
  assert.equal(result.source, "client-package-json");
  assert.ok(result.frameworks.includes("React"));
});

test("accepts a client-supplied package.json object as well as a string", () => {
  const result = detectFrontendProject({
    packageJson: { dependencies: { vue: "^3.4.0" } },
  });

  assert.equal(result.status, "detected");
  assert.ok(result.frameworks.includes("Vue"));
});

test("reads the CSS approach from client-supplied dependencies", () => {
  const result = detectFrontendProject({
    packageJson: {
      dependencies: { next: "^14.0.0" },
      devDependencies: { tailwindcss: "^3.4.0" },
    },
  });

  assert.equal(result.status, "detected");
  assert.ok(result.frameworks.includes("Next.js"));
  assert.equal(result.cssApproach, "Tailwind CSS");
});

test("client-supplied package.json never touches the filesystem", () => {
  // A directory that does not exist must not matter when data is supplied.
  const result = detectFrontendProject({
    directory: "/definitely/not/a/real/path",
    packageJson: { dependencies: { svelte: "^4.0.0" } },
  });

  assert.equal(result.status, "detected");
  assert.equal(result.source, "client-package-json");
});

test("malformed client package.json is indeterminate, not a negative", () => {
  const result = detectFrontendProject({ packageJson: "{ not valid json" });

  assert.equal(result.status, "indeterminate");
  assert.equal(result.reason, "invalid-package-json");
});

test("a client package.json with no frontend deps is a real negative", () => {
  const result = detectFrontendProject({
    packageJson: { dependencies: { express: "^4.19.0" } },
  });

  assert.equal(result.status, "not-frontend");
});

// ---------------------------------------------------------------------------
// Local stdio behaviour must keep working: real disk scans still detect.
// ---------------------------------------------------------------------------

test("still detects a real frontend project on disk", (t) => {
  const dir = makeProject({
    "package.json": JSON.stringify({ dependencies: { react: "^18.2.0" } }),
    "vite.config.js": "export default {}",
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = detectFrontendProject({ directory: dir });

  assert.equal(result.status, "detected");
  assert.equal(result.source, "filesystem");
  assert.ok(result.frameworks.includes("React"));
});

test("still reports a real negative for a non-frontend project on disk", (t) => {
  const dir = makeProject({
    "package.json": JSON.stringify({ dependencies: { express: "^4.19.0" } }),
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = detectFrontendProject({ directory: dir });

  assert.equal(result.status, "not-frontend");
  assert.equal(result.source, "filesystem");
});

test("detects framework files inside src/ on disk", (t) => {
  const dir = makeProject({
    "package.json": JSON.stringify({ dependencies: {} }),
    "tailwind.config.js": "module.exports = {}",
    "src/App.jsx": "export default function App() { return null; }",
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = detectFrontendProject({ directory: dir });

  assert.equal(result.status, "detected");
  assert.ok(result.signals.some((s) => s.includes("tailwind.config.js")));
  assert.ok(result.signals.some((s) => s.includes("App.jsx")));
});

// ---------------------------------------------------------------------------
// Importing the module must not start the MCP server.
// ---------------------------------------------------------------------------

test("importing index.js does not start the stdio server", () => {
  // If main() had run on import, the test process would be wired to a
  // transport and this suite would hang rather than reach this assertion.
  assert.equal(typeof detectFrontendProject, "function");
});
