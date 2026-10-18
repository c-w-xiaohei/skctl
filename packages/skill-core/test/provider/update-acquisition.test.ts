import { expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceBindingView } from "../../src/source/types";
import { inspectRemoteRoots } from "../../src/source/snapshot";
import { createSourceOperation } from "../../src/source/network";
import type { RunGit } from "../../src/source/git";
import { openGitRef, openGitSource, resolveGitRef } from "../../src/source/git";
import { openGitHubSource } from "../../src/source/github";
import { createExecutableFixture } from "../executable-fixture";
import { networkFixture } from "./network-fixture";

const commit = "a".repeat(40),
  root = "b".repeat(40),
  blob = "c".repeat(40);
const binding: SourceBindingView = {
  id: "remote",
  kind: "git",
  origin: "https://example.invalid/repo.git",
  root: "",
  ref: "refs/heads/main",
  selectors: [],
  provenance: { level: "project" },
};
const encode = (value: string) => new TextEncoder().encode(value);

test("injected Git function executes one metadata batch for 120 roots without any real child", async () => {
  const paths = Array.from({ length: 120 }, (_, index) => `skill-${index}`);
  const commands: string[][] = [];
  const run: RunGit = async ({ cmd }) => {
    commands.push(cmd);
    let output = "";
    if (cmd.includes("rev-parse")) output = `${commit}\n${root}\n`;
    else if (cmd.includes("ls-tree"))
      output = paths
        .map(
          (path, index) =>
            `040000 tree ${index.toString(16).padStart(40, "0")}\t${path}\0` +
            `100644 blob ${blob}\t${path}/SKILL.md\0`,
        )
        .join("");
    return { status: 0, stdout: encode(output), stderr: encode("") };
  };
  const operation = createSourceOperation({ source: binding.id });
  try {
    const result = await inspectRemoteRoots(
      binding,
      { cwd: process.cwd() },
      paths.map((path) => ({ path, revision: commit })),
      operation,
      run,
    );
    expect(result.commit).toBe(commit);
    expect(result.roots).toHaveLength(120);
    expect(result.roots.every((entry) => entry.status === "present")).toBe(true);
    expect(result.previous.size).toBe(120);
    expect(commands.filter((cmd) => cmd.includes("fetch"))).toHaveLength(1);
    expect(commands.filter((cmd) => cmd.includes("ls-tree"))).toHaveLength(1);
    expect(
      commands.some(
        (cmd) => cmd.includes("ls-remote") || cmd.includes("--stdin") || cmd.includes("--batch"),
      ),
    ).toBe(false);
    expect(commands).toHaveLength(5);
  } finally {
    operation.dispose();
  }
});

test("metadata acquisition errors propagate and cannot turn into removed paths", async () => {
  const run: RunGit = async ({ cmd }) => ({
    status: cmd.includes("fetch") ? 1 : 0,
    stdout: encode(""),
    stderr: encode("authentication failed"),
  });
  const operation = createSourceOperation({ source: binding.id });
  try {
    await expect(
      inspectRemoteRoots(
        binding,
        { cwd: process.cwd() },
        [{ path: "root", revision: commit }],
        operation,
        run,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_AUTH_FAILED" });
  } finally {
    operation.dispose();
  }
});

test("malformed identities and unsupported Git filtering fail closed", async () => {
  for (const failure of ["malformed", "duplicate", "commit-mismatch", "filter-ignored"] as const) {
    const commands: string[][] = [];
    const run: RunGit = async ({ cmd }) => {
      commands.push(cmd);
      let output = "";
      if (cmd.includes("rev-parse"))
        output =
          failure === "commit-mismatch" ? `${"d".repeat(40)}\n${root}\n` : `${commit}\n${root}\n`;
      else if (cmd.includes("ls-tree")) {
        const entry = `100644 blob ${blob}\tSKILL.md\0`;
        output =
          failure === "duplicate"
            ? entry + entry
            : failure === "malformed"
              ? `100644 blob ${blob}\t../escape\0`
              : entry;
      } else if (cmd.some((arg) => arg.startsWith("--batch-check="))) output = `${blob} blob\n`;
      return {
        status: 0,
        stdout: encode(output),
        stderr: encode(""),
      };
    };
    const operation = createSourceOperation({ source: binding.id });
    try {
      await expect(
        openGitSource(
          binding.id,
          binding.origin,
          commit,
          "",
          { source: binding.id, origin: "git", stability: "immutable" },
          undefined,
          operation,
          run,
        ),
      ).rejects.toMatchObject({
        code: failure === "filter-ignored" ? "PROVIDER_UNAVAILABLE" : "PROVIDER_INTEGRITY_FAILED",
      });
      if (failure === "duplicate")
        expect(commands.some((cmd) => cmd.includes("ls-tree"))).toBe(true);
      if (failure === "filter-ignored")
        expect(commands.some((cmd) => cmd.some((arg) => arg.startsWith("--batch-check=")))).toBe(
          true,
        );
    } finally {
      operation.dispose();
    }
  }
});

test("short Git refs reject branch/tag ambiguity before fetch and preserve peeled tag resolution", async () => {
  const ambiguousCommands: string[][] = [];
  const ambiguous: RunGit = async ({ cmd }) => {
    ambiguousCommands.push(cmd);
    return {
      status: 0,
      stdout: encode(`${commit}\trefs/heads/release\n${root}\trefs/tags/release\n`),
      stderr: encode(""),
    };
  };
  const operation = createSourceOperation({ source: binding.id });
  try {
    await expect(
      resolveGitRef(binding.origin, "release", undefined, undefined, operation, ambiguous),
    ).rejects.toMatchObject({ code: "PINNED_COMMIT_UNAVAILABLE" });
    expect(ambiguousCommands).toHaveLength(1);
    expect(ambiguousCommands[0]).toContain("ls-remote");
    await expect(
      openGitRef(
        binding.id,
        binding.origin,
        "release",
        "",
        { source: binding.id, origin: "git", stability: "immutable" },
        operation,
        ambiguous,
      ),
    ).rejects.toMatchObject({ code: "PINNED_COMMIT_UNAVAILABLE" });
    expect(ambiguousCommands.filter((cmd) => cmd.includes("fetch"))).toHaveLength(0);
    expect(ambiguousCommands.filter((cmd) => cmd.includes("ls-remote"))).toHaveLength(2);

    const peeled = "d".repeat(40);
    const tagCommands: string[][] = [];
    const tagRun: RunGit = async ({ cmd }) => ({
      status: (tagCommands.push(cmd), 0),
      stdout: encode(
        cmd.includes("ls-remote")
          ? `${root}\trefs/tags/release\n${peeled}\trefs/tags/release^{}\n`
          : cmd.includes("rev-parse")
            ? `${peeled}\n${"e".repeat(40)}\n`
            : "",
      ),
      stderr: encode(""),
    });
    const resolved = await resolveGitRef(
      binding.origin,
      "refs/tags/release",
      undefined,
      undefined,
      operation,
      tagRun,
    );
    expect(resolved).toBe(peeled);
    const snapshot = await openGitRef(
      binding.id,
      binding.origin,
      "refs/tags/release",
      "",
      { source: binding.id, origin: "git", stability: "immutable" },
      operation,
      tagRun,
    );
    expect(snapshot.commit).toBe(peeled);
    await snapshot.close();
    expect(
      tagCommands.some((cmd) => cmd.includes("fetch") && cmd.at(-1) === "refs/tags/release"),
    ).toBe(true);
  } finally {
    operation.dispose();
  }
});

test("GitHub update metadata inspects 120 Roots using one complete recursive tree response", async () => {
  const paths = Array.from({ length: 120 }, (_, index) => `skill-${index}`);
  const requests: string[] = [];
  const directories = paths.map((path, index) => ({
    path,
    mode: "040000",
    type: "tree",
    sha: index.toString(16).padStart(40, "0"),
  }));
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url.pathname + url.search);
      if (url.pathname.includes("/commits/"))
        return Response.json({ sha: commit, commit: { tree: { sha: root } } });
      const id = url.pathname.split("/").at(-1);
      const marker = { path: "SKILL.md", mode: "100644", type: "blob", sha: blob, size: 20 };
      if (url.searchParams.get("recursive") === "1")
        return Response.json({
          sha: root,
          truncated: false,
          tree: directories.flatMap((entry) => [
            entry,
            { ...marker, path: `${entry.path}/SKILL.md` },
          ]),
        });
      return Response.json({ sha: id, tree: id === root ? directories : [marker] });
    },
  });
  const snapshot = await openGitHubSource(
    "remote",
    "https://github.com/acme/skills",
    commit,
    "",
    { source: "remote", origin: "git", stability: "immutable" },
    undefined,
    { baseUrl: server.url.toString() },
    undefined,
    undefined,
    true,
  );
  try {
    const roots = await snapshot.inspectRoots(paths);
    expect(roots.every((entry) => entry.status === "present")).toBe(true);
    expect(requests.filter((path) => path.includes("/trees/"))).toHaveLength(1);
    expect(requests.some((path) => path.includes("/blobs/"))).toBe(false);
  } finally {
    await snapshot.close();
    server.stop(true);
  }
});

test("recursive GitHub metadata failures reject instead of observing empty Roots", async () => {
  for (const [status, truncated] of [
    [200, true],
    [401, false],
  ] as const) {
    const pinned = commit;
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname.includes("/commits/"))
          return Response.json({ sha: pinned, commit: { tree: { sha: root } } });
        return status === 401
          ? Response.json({ message: "bad credentials" }, { status })
          : Response.json({ sha: root, truncated, tree: [] });
      },
    });
    const snapshot = await openGitHubSource(
      "remote",
      "https://github.com/acme/skills",
      pinned,
      "",
      { source: "remote", origin: "git", stability: "immutable" },
      undefined,
      { baseUrl: server.url.toString(), rawBaseUrl: server.url.toString() },
      "http://127.0.0.1:1/remote.git",
      undefined,
      true,
    );
    try {
      await expect(snapshot.inspectRoots(["root"])).rejects.toMatchObject({
        code: status === 401 ? "PROVIDER_AUTH_FAILED" : "PROVIDER_UNAVAILABLE",
      });
    } finally {
      await snapshot.close();
      server.stop(true);
    }
  }
});

test("GitHub recursive API failure falls back to one batched Git acquisition for shared blobs", async () => {
  const fixture = await networkFixture();
  const shim = await createExecutableFixture();
  const previous = process.env.PATH;
  const trace = join(shim, "git-commands");
  let server: ReturnType<typeof Bun.serve> | undefined;
  let snapshot: Awaited<ReturnType<typeof openGitHubSource>> | undefined;
  try {
    await mkdir(join(shim, "bin"));
    await writeFile(
      join(shim, "bin", "git"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> '${trace}'\nexec /usr/bin/git "$@"\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${shim}/bin:${previous ?? ""}`;
    server = Bun.serve({
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname.includes("/commits/")
          ? Response.json({ sha: fixture.commit, commit: { tree: { sha: root } } })
          : Response.json({ message: "unavailable" }, { status: 503 }),
    });
    snapshot = await openGitHubSource(
      "remote",
      "https://github.com/acme/skills",
      fixture.commit,
      "",
      { source: "remote", origin: "git", stability: "immutable" },
      undefined,
      { baseUrl: server.url.toString(), rawBaseUrl: server.url.toString() },
      fixture.targetUrl,
      undefined,
      true,
    );
    const roots = await snapshot.inspectRoots([""]);
    expect(roots[0]?.status).toBe("present");
    const contents = await snapshot.readMany(["SKILL.md", "copy.md"]);
    expect(contents).toHaveLength(2);
    expect(contents[0]?.bytes).toEqual(contents[1]?.bytes);
    const commands = await readFile(trace, "utf8");
    expect(
      commands.split("\n").filter((line) => line.includes(" fetch ") && line.includes("--stdin")),
    ).toHaveLength(1);
    expect(
      commands.split("\n").filter((line) => /cat-file --batch(?:\s|$)/u.test(line)),
    ).toHaveLength(1);
  } finally {
    await snapshot?.close();
    server?.stop(true);
    process.env.PATH = previous;
    await fixture.close();
    await rm(shim, { recursive: true, force: true });
  }
});
