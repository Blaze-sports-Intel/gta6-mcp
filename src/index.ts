#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WikiClient } from "./client.js";
import { easterEggs, getPage, listCheats, searchGta6 } from "./tools.js";

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

export function createServer(client = new WikiClient()): McpServer {
  const server = new McpServer({ name: "gta6-mcp", version: "0.1.0" });

  server.registerTool(
    "search_gta6",
    {
      title: "Search GTA VI",
      description: "Search the GTA Wiki for a Grand Theft Auto VI page. Release, sales, and platform questions also search Wikipedia. Returns ranked hits with snippets, source URLs, and CC BY-SA attribution.",
      inputSchema: {
        query: z.string().min(1).describe("What to look up, for example Lucia Caminos or Leonida."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query }) => {
      try {
        return textResult(await searchGta6(client, query));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_page",
    {
      title: "Read a GTA VI wiki page",
      description: "Fetch a short plain-text summary of one GTA Wiki page, or one section. Uses Wikipedia when the page is missing or the section is a release, sales, or platform fact. Always includes the source URL and CC BY-SA attribution. Returns found:false instead of inventing a page.",
      inputSchema: {
        title: z.string().min(1).describe("Wiki page title, for example State of Leonida or Grand Theft Auto VI."),
        section: z.string().optional().describe("Optional heading, for example Story or Online."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ title, section }) => {
      try {
        return textResult(await getPage(client, title, section));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_cheats",
    {
      title: "List GTA VI cheats",
      description: "Parse Cheats in GTA VI into rows of code, effect, unlock, platform, source URL, and confidence. confidence is confirmed only when the wiki cites a reliable source or two independent sources agree. Never present an unverified code as real. platform may be ps5, xbox, or pc.",
      inputSchema: {
        platform: z.string().optional().describe("Optional: ps5, xbox, or pc."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ platform }) => {
      try {
        return textResult(await listCheats(client, platform));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "easter_eggs",
    {
      title: "GTA VI Easter eggs and secrets",
      description: "Read Easter eggs and secrets from the GTA Wiki. If the dedicated GTA VI secrets page does not exist, say so and return the closest sourced section, usually Trivia. Filter with topic. Unverified items are not confirmed secrets.",
      inputSchema: {
        topic: z.string().optional().describe("Optional filter, for example Red Dead or Vice City."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ topic }) => {
      try {
        return textResult(await easterEggs(client, topic));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
