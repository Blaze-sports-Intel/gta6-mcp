import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

type ToolCall = {
  name: "search_gta6" | "get_page" | "list_cheats" | "easter_eggs";
  arguments: Record<string, string>;
};

const calls: ToolCall[] = [
  { name: "search_gta6", arguments: { query: "Lucia Caminos" } },
  { name: "get_page", arguments: { title: "State of Leonida" } },
  { name: "get_page", arguments: { title: "Grand Theft Auto VI", section: "Online" } },
  { name: "list_cheats", arguments: { platform: "ps5" } },
  { name: "easter_eggs", arguments: { topic: "Red Dead" } },
];

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(here, "index.js")],
    stderr: "inherit",
  });
  const client = new Client({ name: "gta6-mcp-smoke", version: "0.1.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    console.log(`tools: ${listed.tools.map((tool) => tool.name).join(", ")}`);
    for (const call of calls) {
      console.log(`\n===== ${call.name} ${JSON.stringify(call.arguments)} =====\n`);
      const result = await client.callTool({ name: call.name, arguments: call.arguments });
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .map((item) => (item.type === "text" ? item.text : ""))
        .join("\n");
      console.log(text.length > 7000 ? `${text.slice(0, 7000)}\n…[truncated]` : text);
      if (result.isError) {
        console.error(`tool ${call.name} returned an error`);
        process.exitCode = 1;
      }
    }
  } finally {
    await client.close();
  }
}

const timeout = setTimeout(() => {
  console.error("smoke timed out");
  process.exit(1);
}, 90_000);

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    clearTimeout(timeout);
  });
