const expect = require("expect.js");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

async function loadModule(filePath) {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ga-test-"));
  const tmpFile = path.join(tmpDir, "ga.mjs");
  await fs.promises.copyFile(filePath, tmpFile);
  const namespace = await import(pathToFileURL(tmpFile).href);
  return { namespace, tmpDir };
}

describe("cid", function () {
  let cid;

  let tmpDir;

  before(async function () {
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      const { webcrypto } = require("node:crypto");
      globalThis.crypto = webcrypto;
    }

    const { namespace, tmpDir: dir } = await loadModule(
      path.resolve(__dirname, "../api/ga.js")
    );
    tmpDir = dir;
    cid = namespace.cid;
  });

  after(async function () {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("produces a deterministic hash for the same visitor", async function () {
    const hashA = await cid("198.51.100.10", "Agent A");
    const hashB = await cid("198.51.100.10", "Agent A");
    expect(hashA).to.be(hashB);
    expect(hashA).to.be.a("string");
    expect(hashA).to.have.length(64);
  });

  it("produces distinct values for different visitor data", async function () {
    const firstVisitor = await cid("198.51.100.11", "Agent A");
    const secondVisitor = await cid("203.0.113.4", "Agent B");
    expect(firstVisitor).to.not.be(secondVisitor);
  });

  it("falls back to deterministic hashes without an IP", async function () {
    const hashWithFallbackOnly = await cid("", "Agent A");
    const hashWithDifferentFallback = await cid("", "Agent B");
    expect(hashWithFallbackOnly).to.not.be(hashWithDifferentFallback);
  });
});
