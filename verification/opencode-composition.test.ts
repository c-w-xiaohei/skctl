import { expect, test } from "bun:test";
import { createOpencodeClient } from "@opencode-ai/sdk/client";
import { createOpencodeServer } from "@opencode-ai/sdk/server";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const workspace = resolve(import.meta.dir, "..");

async function command(argv: readonly string[], cwd: string, env: Record<string, string>) {
  const child = Bun.spawn([...argv], { cwd, env, stdout: "pipe", stderr: "pipe" });
  const result = await Promise.race([
    Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]),
    Bun.sleep(60_000).then(() => undefined),
  ]);
  if (!result) {
    child.kill("SIGKILL");
    await child.exited;
    throw new Error(`Command timed out: ${argv.join(" ")}`);
  }
  const [exit, stdout, stderr] = result;
  if (exit !== 0) throw new Error(`Command failed (${exit}): ${argv.join(" ")}\n${stderr}`);
  return stdout;
}

type ChatRequest = { messages?: Array<{ role?: string; content?: unknown }> };

function completion(delta: object, finishReason: "stop" | "tool_calls" = "stop") {
  const choices = [
    { delta: { role: "assistant", ...delta } },
    { delta: {}, finish_reason: finishReason },
  ];
  const events = choices.map((choice) => ({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [{ index: 0, ...choice }],
  }));
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

function createLlmServer(browseCommand: string, loadCommand: string, project: string) {
  const requests: ChatRequest[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions")
        return new Response(null, { status: 404 });

      const body = (await request.json()) as ChatRequest;
      if (
        body.messages?.some(
          ({ content }) =>
            typeof content === "string" &&
            content.includes("Generate a title for this conversation"),
        )
      )
        return completion({ content: "E2E" });

      requests.push(body);
      if (requests.length <= 2) {
        return completion(
          {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: {
                  name: "bash",
                  arguments: JSON.stringify({
                    command: requests.length === 1 ? browseCommand : loadCommand,
                    workdir: project,
                  }),
                },
              },
            ],
          },
          "tool_calls",
        );
      }
      if (requests.length === 3) return completion({ content: "loaded" });
      return new Response("Unexpected model request", { status: 500 });
    },
  });
  return { requests, server, url: `http://127.0.0.1:${server.port}/v1` };
}

async function startOpenCode(
  project: string,
  env: Record<string, string>,
  config: Parameters<typeof createOpencodeServer>[0],
) {
  const previous = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    const server = await createOpencodeServer(config);
    return {
      client: createOpencodeClient({ baseUrl: server.url, directory: project, throwOnError: true }),
      close: server.close,
    };
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("packaged adapter composes with OpenCode 1.18.4 deterministically", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "skill-cli-opencode-real-"));
  let host: Awaited<ReturnType<typeof startOpenCode>> | undefined;
  let llm: ReturnType<typeof createLlmServer> | undefined;
  let sessionID: string | undefined;
  const errors: unknown[] = [];
  try {
    const release = (await Bun.file(join(workspace, "dist/release-metadata.json")).json()) as {
      native: { path: string };
    };
    const native = resolve(workspace, "dist", release.native.path);
    expect((await fs.stat(native)).isFile()).toBe(true);

    const pluginDir = join(root, "plugin");
    await fs.mkdir(pluginDir);
    await command(
      ["tar", "-xzf", join(workspace, "dist/opencode-adapter.tgz"), "-C", pluginDir],
      root,
      process.env as Record<string, string>,
    );
    const pluginEntry = join(pluginDir, "package/dist/index.js");
    expect((await fs.stat(pluginEntry)).isFile()).toBe(true);

    const isolatedEnv = {
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "xdg-config"),
      XDG_STATE_HOME: join(root, "xdg-state"),
      SKILL_CLI_STATE_DIR: join(root, "state"),
      OPENCODE_CONFIG_DIR: join(root, "opencode-config"),
      OPENCODE_DB: join(root, "opencode.db"),
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    };
    const baseEnv = { ...process.env, ...isolatedEnv } as Record<string, string>;
    const candidate = await fs.realpath(join(workspace, "node_modules/.bin/opencode"));
    expect((await command([candidate, "--version"], root, baseEnv)).trim()).toBe("1.18.4");

    const bin = join(root, "bin");
    const audit = join(root, "audit");
    const project = join(root, "project");
    const selector = "engineering:review";
    const token = crypto.randomUUID();
    const browseCommand = "skill-cli agent browse engineering";
    const loadCommand = `skill-cli agent load ${selector}`;
    await Promise.all([
      fs.mkdir(bin),
      fs.mkdir(audit),
      fs.mkdir(join(project, "source/review"), { recursive: true }),
    ]);
    await fs.writeFile(
      join(project, "source/review/SKILL.md"),
      `---\nname: review\ndescription: Load the managed instruction.\n---\n${token}\n`,
    );

    const skillCli = join(bin, "skill-cli");
    const opencode = join(bin, "opencode");
    await Promise.all([
      fs.writeFile(
        skillCli,
        `#!/bin/sh\nprintf '%s\\000' "$PWD" "$@" > "$AUDIT_DIR/$$"\nexec '${native.replaceAll("'", "'\\''")}' "$@"\n`,
      ),
      fs.writeFile(
        opencode,
        `#!/bin/sh\nif [ "$1" = "--version" ]; then printf '1.18.4\\n'; exit 0; fi\nexec '${candidate.replaceAll("'", "'\\''")}' "$@"\n`,
      ),
    ]);
    await Promise.all([fs.chmod(skillCli, 0o700), fs.chmod(opencode, 0o700)]);
    const envOverrides = {
      ...isolatedEnv,
      PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      AUDIT_DIR: audit,
    };
    const env = { ...process.env, ...envOverrides } as Record<string, string>;

    const inProject = ["--project", project];
    for (const args of [
      ["init", project, "--host", "project"],
      [...inProject, "source", "register", "local", "local", "./source"],
      [...inProject, "source", "discover", "local"],
      [...inProject, "install", "local", "review"],
      [...inProject, "collection", "member", "add", "engineering", "review", "local", "review"],
      [...inProject, "use", "set", "engineering"],
      [...inProject, "managed", "set"],
    ])
      await command([skillCli, ...args], project, env);

    llm = createLlmServer(browseCommand, loadCommand, project);
    host = await startOpenCode(project, envOverrides, {
      hostname: "127.0.0.1",
      port: 0,
      timeout: 15_000,
      config: {
        plugin: [pluginEntry],
        model: "test/test-model",
        small_model: "test/test-model",
        enabled_providers: ["test"],
        permission: { bash: "allow" },
        provider: {
          test: {
            id: "test",
            name: "Test",
            npm: "@ai-sdk/openai-compatible",
            models: {
              "test-model": {
                id: "test-model",
                name: "Test Model",
                tool_call: true,
                limit: { context: 100_000, output: 10_000 },
              },
            },
            options: { apiKey: "test-key", baseURL: llm.url },
          },
        },
      },
    });
    const session = await host.client.session.create({ query: { directory: project } });
    sessionID = session.data.id;
    const response = await host.client.session.prompt({
      path: { id: sessionID },
      query: { directory: project },
      body: {
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        tools: { bash: true },
        parts: [{ type: "text", text: "Use the managed review Skill." }],
      },
    });

    expect(
      response.data.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(""),
    ).toBe("loaded");
    expect(llm.requests).toHaveLength(3);
    const systemPrompts = llm.requests[0]?.messages
      ?.filter(({ role, content }) => role === "system" && typeof content === "string")
      .map(({ content }) => content);
    expect(systemPrompts).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"kind":"collection"'),
        expect.stringContaining('"id":"engineering"'),
        expect.stringContaining("skill-cli agent browse <collection-id>"),
        expect.stringContaining("skill-cli agent load <selector>"),
      ]),
    );
    expect(systemPrompts?.join("\n")).not.toContain(`"selector":"${selector}"`);
    const browseOutput = llm.requests[1]?.messages?.find(({ role }) => role === "tool")?.content;
    expect(browseOutput).toEqual(expect.stringContaining(`"selector":"${selector}"`));
    const loadOutput = llm.requests[2]?.messages
      ?.filter(({ role }) => role === "tool")
      .at(-1)?.content;
    expect(loadOutput).toEqual(expect.stringContaining(token));

    const records = await Promise.all(
      (await fs.readdir(audit)).map((file) => fs.readFile(join(audit, file), "utf8")),
    );
    expect(records).toEqual(
      expect.arrayContaining([
        [project, "agent", "browse", ""].join("\0"),
        [project, "agent", "browse", "engineering", ""].join("\0"),
        [project, "agent", "load", selector, ""].join("\0"),
      ]),
    );
  } catch (error) {
    errors.push(error);
  } finally {
    for (const cleanup of [
      () =>
        sessionID && host ? host.client.session.delete({ path: { id: sessionID } }) : undefined,
      () => host?.close(),
      () => llm?.server.stop(true),
      () => fs.rm(root, { recursive: true, force: true }),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length) throw new AggregateError(errors);
}, 180_000);
