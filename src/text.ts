export type Citation = {
  url: string;
  host: string;
  domain: string;
  reliable: boolean;
  aboutCheats: boolean;
};

export type Confidence = "confirmed" | "unverified";

export type TableData = {
  headers: string[];
  rows: string[][];
};

const RELIABLE_HOSTS = [
  "rockstargames.com",
  "take2games.com",
  "gamespot.com",
  "ign.com",
  "polygon.com",
  "eurogamer.net",
  "pcgamer.com",
  "thegamer.com",
  "gamesradar.com",
  "vg247.com",
  "videogameschronicle.com",
  "pushsquare.com",
  "purexbox.com",
  "theverge.com",
  "bbc.co.uk",
  "bbc.com",
  "reuters.com",
  "apnews.com",
  "nytimes.com",
  "washingtonpost.com",
  "theguardian.com",
  "forbes.com",
  "bloomberg.com",
];

const WIKI_HOSTS = ["fandom.com", "wikia.com", "wikipedia.org", "wikimedia.org"];

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code)) return full;
      try {
        return String.fromCodePoint(code);
      } catch {
        return full;
      }
    }
    return NAMED_ENTITIES[body] ?? full;
  });
}

function replaceBalanced(
  input: string,
  open: string,
  close: string,
  replace: (inner: string) => string,
): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    if (!input.startsWith(open, i)) {
      out += input[i];
      continue;
    }
    let depth = 1;
    let j = i + open.length;
    while (j < input.length && depth > 0) {
      if (input.startsWith(open, j)) {
        depth++;
        j += open.length;
        continue;
      }
      if (input.startsWith(close, j)) {
        depth--;
        j += close.length;
        if (depth === 0) break;
        continue;
      }
      j++;
    }
    if (depth !== 0) {
      out += input.slice(i);
      break;
    }
    const inner = input.slice(i + open.length, j - close.length);
    out += replace(inner);
    i = j - 1;
  }
  return out;
}

function replaceTemplates(input: string): string {
  return replaceBalanced(input, "{{", "}}", (inner) => {
    const processed = replaceTemplates(inner);
    const parts = processed.split("|");
    const rawName = (parts[0] ?? "").trim();
    const name = rawName.toLowerCase();
    if (name === "'" || name === "’" || name === "`") return "'";
    if (name === "vi") return "Grand Theft Auto VI";
    if (name === "ndash" || name === "endash") return "–";
    if (name === "mdash") return "—";
    if (name === "nbsp") return " ";
    if (name === "quote" || name === "cquote") {
      return parts[1] ? ` ${parts[1].trim()} ` : "";
    }
    if (name === "wp" || name === "w") {
      const positional = parts.slice(1).map((part) => part.trim()).filter((part) => part && !part.includes("="));
      return positional.length ? ` ${positional[positional.length - 1]} ` : "";
    }
    // Titled link templates such as {{Red Dead|Red Dead Universes|Redemption Universe}}.
    if (/^[A-Z][\w.' ]+$/.test(rawName) && rawName.includes(" ") && !/^(infobox|navbox|about|for|cite|multiple image)\b/i.test(rawName)) {
      const positional = parts.slice(1).map((part) => part.trim()).filter((part) => part && !part.includes("="));
      return ` ${positional.at(-1) || rawName} `;
    }
    return "";
  });
}

function replaceLinks(input: string): string {
  return replaceBalanced(input, "[[", "]]", (inner) => {
    const processed = replaceLinks(inner);
    if (/^(file|image|category):/i.test(processed.trim())) return "";
    const parts = processed.split("|");
    return (parts[parts.length - 1] ?? "").trim();
  });
}

export function wikitextToPlain(input: string): string {
  let text = input.replace(/\r/g, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<ref\b[^>]*\/>/gi, "");
  text = text.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "");
  text = replaceTemplates(text);
  text = replaceLinks(text);
  text = text.replace(/\[(https?:\/\/[^\]\s]+)\s+([^\]]+)\]/g, "$2");
  text = text.replace(/\[https?:\/\/[^\]\s]+\]/g, "");
  text = text.replace(/'''|''/g, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/\[\[|\]\]/g, "");
  text = text.replace(/^=+\s*(.*?)\s*=+$/gm, "$1");
  text = text.replace(/^\*+\s*/gm, "");
  text = text.replace(/^#+\s*/gm, "");
  text = text.replace(/^[:;]+\s*/gm, "");
  text = decodeEntities(text);
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");
  return text.trim();
}

export type WikiSection = {
  heading: string | null;
  level: number;
  body: string;
};

export function splitSections(wikitext: string): WikiSection[] {
  const sections: { heading: string | null; level: number; lines: string[] }[] = [
    { heading: null, level: 0, lines: [] },
  ];
  const heading = /^(={2,6})\s*(.*?)\s*\1\s*$/;
  for (const line of wikitext.split("\n")) {
    const match = line.match(heading);
    if (match) {
      sections.push({ heading: decodeEntities(match[2] ?? "").trim(), level: match[1]?.length ?? 2, lines: [] });
    } else {
      sections[sections.length - 1]?.lines.push(line);
    }
  }
  return sections.map((section) => ({
    heading: section.heading,
    level: section.level,
    body: section.lines.join("\n"),
  }));
}

export function findSection(wikitext: string, query: string): WikiSection | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const sections = splitSections(wikitext).filter((section) => section.heading);
  const exact = sections.find((section) => section.heading?.toLowerCase() === needle);
  if (exact) return exact;
  const partial = sections.filter((section) => section.heading?.toLowerCase().includes(needle));
  return partial.length === 1 ? partial[0] ?? null : partial[0] ?? null;
}

export function parseBullets(wikitext: string): string[] {
  const items: string[] = [];
  let current: string[] | null = null;
  for (const line of wikitext.split("\n")) {
    if (/^\*[^*]/.test(line) || line.trim() === "*") {
      if (current && current.join("").trim()) items.push(current.join("\n"));
      current = [line.replace(/^\*\s*/, "")];
      continue;
    }
    if (/^\*+/.test(line) && current) {
      current.push(line.replace(/^\*+\s*/, ""));
      continue;
    }
    if (current && line.trim() && !line.startsWith("=") && !line.startsWith("{|") && !line.startsWith("|}")) {
      current.push(line);
    }
  }
  if (current && current.join("").trim()) items.push(current.join("\n"));
  return items;
}

function findTableEnd(wikitext: string, start: number): number {
  let depth = 0;
  for (let i = start; i < wikitext.length; i++) {
    if (wikitext.startsWith("{|", i)) {
      depth++;
      i++;
      continue;
    }
    if (wikitext.startsWith("|}", i)) {
      depth--;
      if (depth === 0) return i + 2;
      i++;
    }
  }
  return wikitext.length;
}

function splitCells(line: string, separator: "||" | "!!"): string[] {
  return line.split(separator).map((cell) => cell.trim()).filter((cell, index, all) => cell.length > 0 || all.length > 1);
}

export function parseWikiTables(wikitext: string): TableData[] {
  const tables: TableData[] = [];
  let cursor = 0;
  while (cursor < wikitext.length) {
    const start = wikitext.indexOf("{|", cursor);
    if (start < 0) break;
    const end = findTableEnd(wikitext, start);
    const body = wikitext.slice(start, end);
    cursor = end;
    const rawRows: { header: boolean; cells: string[] }[] = [];
    let cells: string[] = [];
    let header = false;
    let open = false;
    const push = () => {
      if (open && cells.some((cell) => cell.trim())) rawRows.push({ header, cells });
      cells = [];
      header = false;
      open = false;
    };
    for (const line of body.split("\n")) {
      if (line.startsWith("{|") || line.startsWith("|}") || line.startsWith("|+")) continue;
      if (line.startsWith("|-")) {
        push();
        open = true;
        header = false;
        continue;
      }
      if (line.startsWith("!")) {
        if (!open) {
          open = true;
          header = true;
        }
        const chunk = line.slice(1).trim();
        cells.push(...splitCells(chunk, line.includes("!!") ? "!!" : "||"));
        continue;
      }
      if (line.startsWith("|")) {
        if (!open) open = true;
        const chunk = line.slice(1).trim();
        cells.push(...splitCells(chunk, "||"));
      }
    }
    push();
    const headerRow = rawRows.find((row) => row.header);
    const headers = (headerRow?.cells ?? []).map((cell) => wikitextToPlain(cell));
    const rows = rawRows
      .filter((row) => !row.header)
      .map((row) => row.cells)
      .filter((row) => row.some((cell) => cell.trim()));
    if (rows.length) tables.push({ headers, rows });
  }
  return tables;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

function domainOf(host: string): string {
  return host.replace(/^www\./, "");
}

function isReliable(host: string): boolean {
  const domain = domainOf(host);
  return RELIABLE_HOSTS.some((item) => domain === item || domain.endsWith(`.${item}`));
}

export function isWikiHost(host: string): boolean {
  const domain = domainOf(host);
  return WIKI_HOSTS.some((item) => domain === item || domain.endsWith(`.${item}`));
}

export function extractCitations(wikitext: string): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  const pattern = /https?:\/\/[^\s\]|}<]+/gi;
  for (const match of wikitext.matchAll(pattern)) {
    const raw = match[0].replace(/[),.;]+$/g, "");
    if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(raw)) continue;
    const host = hostOf(raw);
    if (!host || seen.has(raw)) continue;
    seen.add(raw);
    const around = wikitext.slice(Math.max(0, (match.index ?? 0) - 80), (match.index ?? 0) + raw.length + 120);
    citations.push({
      url: raw,
      host,
      domain: domainOf(host),
      reliable: isReliable(host),
      aboutCheats: /cheat/i.test(`${raw} ${around}`),
    });
  }
  return citations;
}

function describeCitation(citation: Citation): string {
  return `${citation.domain} (${citation.url})`;
}

export function judgeCheatConfidence(rowWikitext: string, pageContext: string): { confidence: Confidence; basis: string } {
  const row = extractCitations(rowWikitext);
  const page = extractCitations(pageContext);
  const rowReliable = row.filter((citation) => citation.reliable);
  if (rowReliable[0]) {
    return {
      confidence: "confirmed",
      basis: `Confirmed: this row cites a reliable source, ${describeCitation(rowReliable[0])}.`,
    };
  }
  const rowIndependent = uniqueDomains(row.filter((citation) => !isWikiHost(citation.host)));
  if (rowIndependent.length >= 2) {
    return {
      confidence: "confirmed",
      basis: `Confirmed: this row cites two independent sources (${rowIndependent.join(", ")}).`,
    };
  }
  const pageCheatSources = page.filter((citation) => citation.reliable && citation.aboutCheats);
  if (pageCheatSources[0]) {
    const domains = uniqueDomains(page.filter((citation) => citation.reliable));
    const single = domains.length < 2 ? " Only one reliable source is cited, and it is not attached to this individual row." : "";
    return {
      confidence: "confirmed",
      basis: `Confirmed: the cheats page cites a reliable source, ${describeCitation(pageCheatSources[0])}.${single} Do not add codes that are not in this list.`,
    };
  }
  const pageIndependent = uniqueDomains(page.filter((citation) => !isWikiHost(citation.host) && citation.aboutCheats));
  if (pageIndependent.length >= 2) {
    return {
      confidence: "confirmed",
      basis: `Confirmed: the cheats page cites two independent sources (${pageIndependent.join(", ")}).`,
    };
  }
  if (row.length === 0 && page.length === 0) {
    return {
      confidence: "unverified",
      basis: "Unverified: the wiki does not cite a source for this code. Do not present it as real.",
    };
  }
  return {
    confidence: "unverified",
    basis: "Unverified: the wiki does not cite a reliable source for this code, and two independent sources do not agree. Do not present it as real.",
  };
}

export function judgeClaim(wikitext: string): { confidence: Confidence; basis: string } {
  const citations = extractCitations(wikitext);
  const reliable = citations.filter((citation) => citation.reliable);
  if (reliable[0]) {
    return {
      confidence: "confirmed",
      basis: `Confirmed: this item cites ${reliable[0].domain} (${reliable[0].url}).`,
    };
  }
  const independent = uniqueDomains(citations.filter((citation) => !isWikiHost(citation.host)));
  if (independent.length >= 2) {
    return {
      confidence: "confirmed",
      basis: `Confirmed: this item cites two independent sources (${independent.join(", ")}).`,
    };
  }
  return {
    confidence: "unverified",
    basis: "Unverified: this item does not cite a reliable source or two independent sources. Do not present it as a confirmed secret.",
  };
}

function uniqueDomains(citations: Citation[]): string[] {
  return [...new Set(citations.map((citation) => citation.domain))];
}

export function clip(input: string, max: number): string {
  const clean = input.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function wikiUrl(base: string, title: string): string {
  return `${base}${encodeURI(title.replace(/ /g, "_"))}`;
}
