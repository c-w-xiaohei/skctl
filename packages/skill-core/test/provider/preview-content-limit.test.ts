import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { openGitHubSource } from "../../src/source/github";

test("bounded GitHub preview reads reject oversized metadata before requesting a blob and constrain cached bytes", async () => {
  const commit = "a".repeat(40),
    tree = "b".repeat(40);
  const text = "small\n";
  const blob = createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest("hex");
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url.pathname);
      if (url.pathname.includes("/commits/"))
        return Response.json({ sha: commit, commit: { tree: { sha: tree } } });
      if (url.pathname.includes("/blobs/"))
        return Response.json({
          sha: blob,
          encoding: "base64",
          content: Buffer.from(text).toString("base64"),
          size: Buffer.byteLength(text),
        });
      return Response.json({
        sha: tree,
        truncated: false,
        tree: [
          { path: "huge.txt", type: "blob", mode: "100644", sha: "c".repeat(40), size: 2_000_000 },
          {
            path: "small.txt",
            type: "blob",
            mode: "100644",
            sha: blob,
            size: Buffer.byteLength(text),
          },
        ],
      });
    },
  });
  const snapshot = await openGitHubSource(
    "preview",
    "https://github.com/acme/skills",
    commit,
    "",
    { source: "preview", origin: "git", stability: "immutable" },
    undefined,
    { baseUrl: server.url.toString() },
    undefined,
    undefined,
    true,
  );
  try {
    await expect(snapshot.read("huge.txt", undefined, 1_048_576)).rejects.toMatchObject({
      code: "TEXT_TOO_LARGE",
      byteLength: 2_000_000,
    });
    expect(requests.some((path) => path.includes("/blobs/"))).toBe(false);
    expect(new TextDecoder().decode((await snapshot.read("small.txt", undefined, 100)).bytes)).toBe(
      text,
    );
    const count = requests.length;
    await expect(snapshot.read("small.txt", undefined, 0)).rejects.toMatchObject({
      code: "TEXT_TOO_LARGE",
      byteLength: Buffer.byteLength(text),
    });
    expect(requests).toHaveLength(count);
  } finally {
    await snapshot.close();
    server.stop(true);
  }
});
