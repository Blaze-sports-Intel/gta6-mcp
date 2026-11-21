import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WikiClient, type WikiClientOptions } from "../src/client.js";
import { USER_AGENT } from "../src/licenses.js";
import { cheatsFromWikitext, easterEggs, getPage, listCheats, searchGta6 } from "../src/tools.js";

const fixtureDir = new URL("./fixtures/", import.meta.url);

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, fixtureDir), "utf8")) as unknown;
}

function clientFor(routes: { when: (url: URL) => boolean; body: unknown }[]): WikiClient {
  const fetchImpl: WikiClientOptions["fetchImpl"] = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    expect(headers.get("User-Agent")).toBe(USER_AGENT);
    expect(headers.get("User-Agent")).not.toMatch(/austin|humphrey|@/i);
    const route = routes.find((item) => item.when(url));
    if (!route) {
      return new Response(JSON.stringify({ error: { info: `no fixture for ${url.pathname}?${url.searchParams.get("titles") ?? url.searchParams.get("srsearch") ?? url.search}` } }), { status: 404 });
    }
    return new Response(JSON.stringify(route.body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return new WikiClient({ fetchImpl, minIntervalMs: 0 });
}

function hasTitle(url: URL, title: string): boolean {
  return (url.searchParams.get("titles") ?? "").split("|").includes(title);
}

describe("search_gta6", () => {
  it("ranks the recorded Lucia search and fills a snippet from the lead", async () => {
    const client = clientFor([
      { when: (url) => url.searchParams.get("list") === "search" && (url.searchParams.get("srsearch") ?? "").includes("Lucia"), body: fixture("search-lucia.json") },
      { when: (url) => hasTitle(url, "Lucia Caminos") && url.searchParams.get("rvsection") === "0", body: fixture("lucia-lead.json") },
    ]);
    const result = await searchGta6(client, "Lucia Caminos");
    expect(result.hits[0]?.title).toBe("Lucia Caminos");
    expect(result.hits[0]?.url).toBe("https://gta.fandom.com/wiki/Lucia_Caminos");
    expect(result.hits[0]?.snippet.toLowerCase()).toContain("protagonist");
    expect(result.license).toMatch(/CC BY-SA/);
    expect(result.hits.some((hit) => /\bGTA V\b/.test(hit.title))).toBe(false);
  });
});

describe("get_page", () => {
  it("returns a plain-text Leonida summary from the recorded page", async () => {
    const client = clientFor([
      { when: (url) => url.host === "gta.fandom.com" && hasTitle(url, "State of Leonida"), body: fixture("leonida-lead.json") },
    ]);
    const result = await getPage(client, "State of Leonida");
    expect(result.found).toBe(true);
    expect(result.sourceUrl).toBe("https://gta.fandom.com/wiki/State_of_Leonida");
    expect(result.summary).toMatch(/State of Leonida/);
    expect(result.summary).toMatch(/United States/);
    expect(result.summary).toMatch(/Grand Theft Auto VI/);
    expect(result.summary).toMatch(/Only in Leonida/);
    expect(result.summary).not.toMatch(/\{\{|\]\]|State of Florida|Korean/);
    expect(result.license).toMatch(/CC BY-SA/);
  });

  it("reads the recorded Wikipedia intro for release and platform facts", () => {
    const page = fixture("wikipedia-intro.json") as { query: { pages: Record<string, { extract: string; fullurl: string }> } };
    const body = Object.values(page.query.pages)[0];
    expect(body?.fullurl).toBe("https://en.wikipedia.org/wiki/Grand_Theft_Auto_VI");
    expect(body?.extract).toMatch(/19 November 2026/);
    expect(body?.extract).toMatch(/PlayStation 5/);
    expect(body?.extract).toMatch(/Xbox Series X\/S/);
    expect(body?.extract).not.toMatch(/PC version/);
  });
});

describe("list_cheats", () => {
  it("parses the recorded cheats page and sets confidence", async () => {
    const client = clientFor([
      { when: (url) => hasTitle(url, "Cheats in GTA VI"), body: fixture("cheats.json") },
    ]);
    const result = await listCheats(client, "ps5");
    const cash = result.cheats.find((cheat) => cheat.name.includes("250,000"));
    expect(cash).toBeDefined();
    expect(cash?.code).toBe("Up, Right, Down, Left, Up, Left, Down, Right");
    expect(cash?.effect.toLowerCase()).toContain("250,000");
    expect(cash?.confidence).toBe("confirmed");
    expect(cash?.basis).toMatch(/gamespot\.com/i);
    expect(cash?.basis).toMatch(/Only one reliable source/);
    expect(cash?.sourceUrl).toBe("https://gta.fandom.com/wiki/Cheats_in_GTA_VI");
    expect(result.license).toMatch(/CC BY-SA/);
    expect(result.cheats.every((cheat) => cheat.confidence === "confirmed" || cheat.confidence === "unverified")).toBe(true);
    expect(result.activation.toLowerCase()).toMatch(/l1/);

    const unsourced = cheatsFromWikitext(`==Cheats==
{| class="wikitable"
!Cheat
!Effect
!Code
|-
| Free money
| Gives cash
| up up down down
|}`, "https://example.test/Cheats", "ps5");
    expect(unsourced.cheats[0]?.confidence).toBe("unverified");
    expect(unsourced.cheats[0]?.basis).toMatch(/Do not present it as real/);

    const twoSources = cheatsFromWikitext(`==Cheats==
{| class="wikitable"
!Cheat
!Effect
!Code
|-
| Free money
| Gives cash<ref>https://example.com/a</ref><ref>https://other.test/b</ref>
| up up down down
|}`, "https://example.test/Cheats");
    expect(twoSources.cheats[0]?.confidence).toBe("confirmed");
    expect(twoSources.cheats[0]?.basis).toMatch(/two independent sources/);

    const pc = await listCheats(client, "pc");
    expect(pc.cheats).toEqual([]);
    expect(pc.summary.toLowerCase()).toMatch(/pc/);
  });
});

describe("missing page", () => {
  it("does not invent a page when both wikis miss", async () => {
    const client = clientFor([
      { when: (url) => url.host === "gta.fandom.com" && hasTitle(url, "This Page Does Not Exist GTA6 MCP"), body: fixture("missing-revisions.json") },
      { when: (url) => url.host === "en.wikipedia.org" && hasTitle(url, "This Page Does Not Exist GTA6 MCP"), body: fixture("wikipedia-missing.json") },
    ]);
    const result = await getPage(client, "This Page Does Not Exist GTA6 MCP");
    expect(result.found).toBe(false);
    expect(result.summary).toMatch(/No GTA Wiki page/);
    expect(result.summary).not.toMatch(/Jason|Lucia|Leonida/);
    expect(result.sourceUrl).toBe("https://gta.fandom.com/wiki/This_Page_Does_Not_Exist_GTA6_MCP");
  });
});

describe("easter_eggs", () => {
  it("says the dedicated page is missing and keeps trivia unverified", async () => {
    const client = clientFor([
      { when: (url) => (url.searchParams.get("titles") ?? "").includes("Secrets and Easter Eggs in GTA VI"), body: fixture("fandom-egg-titles.json") },
      { when: (url) => url.searchParams.get("list") === "search", body: fixture("fandom-search-easter.json") },
      { when: (url) => url.searchParams.get("action") === "parse" && url.searchParams.get("prop") === "sections", body: fixture("gta6-sections.json") },
      { when: (url) => url.searchParams.get("action") === "parse" && url.searchParams.get("prop") === "wikitext", body: fixture("trivia.json") },
    ]);
    const result = await easterEggs(client, "Red Dead");
    expect(result.dedicatedPage).toBeNull();
    expect(result.summary).toMatch(/no page titled/);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.confidence === "unverified")).toBe(true);
    expect(result.items.some((item) => /red dead/i.test(item.detail))).toBe(true);
    expect(result.items.some((item) => /from the of the/i.test(item.detail))).toBe(false);
    expect(result.items.every((item) => !item.sourceUrl.includes("GTA_V"))).toBe(true);
    expect(result.license).toMatch(/CC BY-SA/);
    expect(result.sourceUrl).toMatch(/Grand_Theft_Auto_VI#Trivia/);
  });
});

describe("client cache", () => {
  it("reuses a cached response for the same URL", async () => {
    let calls = 0;
    const client = new WikiClient({
      minIntervalMs: 0,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(fixture("missing-revisions.json")), { status: 200 });
      },
    });
    await client.fandomPage("This Page Does Not Exist GTA6 MCP");
    await client.fandomPage("This Page Does Not Exist GTA6 MCP");
    expect(calls).toBe(1);
  });
});
