# gta6-mcp

A small [MCP](https://modelcontextprotocol.io) server that answers questions about **Grand Theft Auto VI** from live wiki APIs. It does not ship a copy of the articles.

It looks up cheat codes first, then Easter eggs and hidden secrets, then the rest of the game: story, characters, the Leonida map and locations, vehicles, weapons, missions, release and platform facts, and patches.

Cheat pages fill up with junk right after a launch. A code is marked **confirmed** only when the GTA Wiki cites a reliable source, or two independent sources agree. Every other code is **unverified**. Do not present an unverified code as real.

## Install in Claude Code

```bash
claude mcp add gta6 -- npx -y github:Blaze-sports-Intel/gta6-mcp
```

Node 18 or newer. The package builds from source on install. No API key.

Claude Desktop, if you are not using Claude Code:

```json
{
  "mcpServers": {
    "gta6": {
      "command": "npx",
      "args": ["-y", "github:Blaze-sports-Intel/gta6-mcp"]
    }
  }
}
```

## Tools

| Tool | What it returns |
| --- | --- |
| `search_gta6(query)` | Ranked GTA Wiki hits with snippets and URLs. Release, sales, and platform questions also search Wikipedia. |
| `get_page(title, section?)` | A short plain-text lead, or one section. `found: false` when the page is not there. |
| `list_cheats(platform?)` | Rows of code, effect, unlock, platform, source URL, and `confidence`. `platform` is `ps5`, `xbox`, or `pc`. |
| `easter_eggs(topic?)` | Easter eggs and secrets. If the dedicated GTA VI page does not exist yet, it says so and returns the closest section, usually Trivia. |

Every answer has a short summary, the source page URL, and a CC BY-SA attribution.

## Sources

- GTA Wiki, Fandom MediaWiki API: `https://gta.fandom.com/api.php`
- English Wikipedia API, for release, sales, and platform facts: `https://en.wikipedia.org/w/api.php`

Requests use `User-Agent: gta6-mcp/0.1 (+https://github.com/Blaze-sports-Intel/gta6-mcp)`, stay at about one request a second per host, and cache responses in memory for about an hour. Nothing behind a login or a paywall. No leaked builds. No API key.

X posts are not a source. A link to X inside a wiki article does not count as confirmation.

## License

The **code** in this repository is [MIT](LICENSE).

**Wiki text is not.** Text from the GTA Wiki on Fandom is CC BY-SA ([Fandom licensing](https://www.fandom.com/licensing)). Text from Wikipedia is [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Attribute the contributors and link the page the answer came from. This repo does not vendor articles. `test/fixtures/` holds short recorded API responses so tests can run offline, under the same licenses.

## Develop

```bash
npm test
npm run smoke
```

`npm test` replays fixtures. `npm run smoke` starts the stdio server and calls each tool against the live wikis.
