import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { discoverSource, withPreparedSkills } from "../../src/source/service";
import { runProcess } from "../../src/runtime/process";
import { networkFixture } from "./network-fixture";

test("real HTTP packs contain only required objects and separate processes reuse every acquired byte", async () => {
  const fixture = await networkFixture();
  const saved = process.env.SKCTL_SOURCE_CACHE_DIR;
  process.env.SKCTL_SOURCE_CACHE_DIR = join(fixture.root, "cache");
  const binding = {
    id: "one",
    kind: "git" as const,
    origin: fixture.targetUrl,
    root: "",
    ref: "main",
    selectors: [],
    provenance: { level: "project" as const },
  };
  try {
    const discovery = await discoverSource({ binding });
    expect(discovery.candidates.map((item) => item.path)).toEqual([""]);
    expect(fixture.transfers).toHaveLength(2);
    const objects = fixture.transfers.flatMap((transfer) => transfer.objects);
    expect(objects.filter((line) => line.endsWith(" blob"))).toEqual([
      `${fixture.selectedBlob} blob`,
    ]);
    expect(objects.some((line) => line.startsWith(fixture.historicalBlob))).toBe(false);
    const count = fixture.transfers.length,
      requests = fixture.direct;
    const source = resolve("packages/skill-core/src/source/service/index.ts");
    const script = `import {discoverSource} from ${JSON.stringify(source)};await discoverSource({binding:${JSON.stringify({ ...binding, id: "another" })}});`;
    expect((await runProcess({ cmd: [process.execPath, "-e", script] })).status).toBe(0);
    expect(fixture.transfers).toHaveLength(count);
    expect(fixture.direct).toBe(requests);
    expect(fixture.transfers.every((transfer) => transfer.bytes > 0)).toBe(true);
    // A second Source view into the same origin fetches only its marker.
    await discoverSource({ binding: { ...binding, id: "nested", root: "unrelated" } });
    expect(
      fixture.transfers
        .slice(count)
        .flatMap((transfer) => transfer.objects)
        .every((line) => line.endsWith(" blob")),
    ).toBe(true);
    expect(
      fixture.transfers
        .flatMap((transfer) => transfer.objects)
        .some((line) => line.startsWith(fixture.unrelatedBlob)),
    ).toBe(false);
    await withPreparedSkills(
      { binding: { ...binding, root: "unrelated" } },
      [""],
      discovery.version!.commit,
      async () => {},
    );
    const fetched = fixture.transfers.flatMap((transfer) => transfer.objects);
    expect(fetched.filter((line) => line.startsWith(fixture.selectedBlob))).toHaveLength(1);
    expect(fetched.filter((line) => line.startsWith(fixture.unrelatedBlob))).toHaveLength(1);
    // An expired ref still reuses the metadata and objects when the ref did not move.
    const key = new Bun.CryptoHasher("sha256").update(binding.origin).digest("hex");
    const path = join(process.env.SKCTL_SOURCE_CACHE_DIR!, "origins", key, "cache.json");
    const index = JSON.parse(await readFile(path, "utf8"));
    index.refs.main.observedAt -= 31_000;
    await writeFile(path, JSON.stringify(index));
    const before = fixture.transfers.length;
    await discoverSource({ binding });
    expect(fixture.transfers).toHaveLength(before);
  } finally {
    if (saved === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
    else process.env.SKCTL_SOURCE_CACHE_DIR = saved;
    await fixture.close();
  }
});
