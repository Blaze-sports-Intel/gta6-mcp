import type { ParsedPage, SearchHit, WikiClient } from "./client.js";
import { BOTH_LICENSES, FANDOM_LICENSE } from "./licenses.js";
import {
  clip,
  findSection,
  judgeCheatConfidence,
  judgeClaim,
  parseBullets,
  parseWikiTables,
  splitSections,
  wikiUrl,
  wikitextToPlain,
  type Confidence,
} from "./text.js";

const REFERENCE = /\b(release|released|sales|sold|copies|platform|platforms|playstation|ps5|xbox|pc|steam|metacritic|price|pre-?orders?|launch|online|multiplayer)\b/i;
const EGG_TITLES = ["Secrets and Easter Eggs in GTA VI", "Easter Eggs in GTA VI", "Secrets in GTA VI"];
const CHEAT_TITLE = "Cheats in GTA VI";

export type PlatformFilter = "any" | "ps5" | "xbox" | "pc";

export type CheatRow = {
  name: string;
  effect: string;
  unlock: string;
  code: string;
  platform: string;
  confidence: Confidence;
  basis: string;
  sourceUrl: string;
};

function scopeQuery(query: string): string {
  const trimmed = query.trim().slice(0, 180);
  if (/\b(gta\s*vi|gta\s*6|grand theft auto vi|leonida|lucia|jason duval)\b/i.test(trimmed)) return trimmed;
  return `${trimmed} GTA VI`;
}

function scoreTitle(title: string, words: string[]): number {
  const haystack = title.toLowerCase();
  const overlap = words.filter((word) => haystack.includes(word)).length;
  const coverage = words.length ? overlap / words.length : 0;
  let score = coverage * 10;
  if (/\b(gta vi|grand theft auto vi|gta 6)\b/.test(haystack)) score += 2;
  if (haystack.includes("/")) score -= 8;
  if (
    /\b(gta v|gta iv|gta iii|san andreas|vice city stories|liberty city stories|chinatown wars|gta advance|gta online|gta london)\b/.test(haystack)
    && !/\b(vi|6)\b/.test(haystack)
  ) {
    score -= 5;
  }
  return score;
}

export function rankHits(hits: SearchHit[], query: string): SearchHit[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && word !== "gta" && word !== "the" && word !== "and");
  return hits
    .map((hit, index) => ({ hit, index, score: scoreTitle(hit.title, words) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.hit);
}

export async function searchGta6(client: WikiClient, query: string) {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("query is empty");
  const fandom = await client.fandomSearch(scopeQuery(trimmed));
  const wikipedia = REFERENCE.test(trimmed) || fandom.length === 0
    ? await client.wikipediaSearch(`${trimmed} Grand Theft Auto VI`.slice(0, 200))
    : [];
  const ranked = rankHits([...fandom, ...wikipedia], trimmed).slice(0, 8);
  let lookups = 0;
  for (const hit of ranked) {
    if (hit.source !== "fandom" || hit.snippet || lookups >= 3) continue;
    lookups += 1;
    try {
      const lead = await client.fandomLead(hit.title);
      if (!lead.missing && lead.wikitext) hit.snippet = clip(wikitextToPlain(lead.wikitext), 280);
    } catch {
      // A snippet is optional. The title and URL still stand.
    }
  }
  const sources = new Set(ranked.map((hit) => hit.source));
  return {
    summary: ranked.length
      ? `${ranked.length} wiki hit${ranked.length === 1 ? "" : "s"} for "${trimmed}".`
      : `No wiki hits for "${trimmed}".`,
    query: trimmed,
    license: sources.has("wikipedia") ? BOTH_LICENSES : FANDOM_LICENSE,
    hits: ranked.map((hit) => ({
      title: hit.title,
      snippet: hit.snippet,
      url: hit.url,
      source: hit.source,
      license: hit.license,
    })),
  };
}

function sectionAnchor(url: string, heading: string | null): string {
  if (!heading) return url;
  return `${url.split("#")[0]}#${encodeURI(heading.replace(/ /g, "_"))}`;
}

function renderPage(page: ParsedPage, section?: string) {
  if (!section) {
    const lead = page.extract || wikitextToPlain(splitSections(page.wikitext)[0]?.body || page.wikitext);
    return {
      found: true,
      sectionFound: true,
      title: page.title,
      section: null,
      summary: clip(lead, 3500) || `The page "${page.title}" has no lead text.`,
      sourceUrl: page.url,
      license: page.license,
      source: page.source,
    };
  }
  if (!page.wikitext) {
    return {
      found: true,
      sectionFound: false,
      title: page.title,
      section,
      summary: page.extract
        ? clip(page.extract, 3500)
        : `No section text was available for "${section}" on ${page.title}.`,
      sourceUrl: page.url,
      license: page.license,
      source: page.source,
    };
  }
  const match = findSection(page.wikitext, section);
  if (!match?.heading) {
    const headings = splitSections(page.wikitext).flatMap((item) => item.heading ? [item.heading] : []);
    return {
      found: true,
      sectionFound: false,
      title: page.title,
      section,
      summary: `No section matching "${section}" on ${page.title}. Headings: ${headings.slice(0, 24).join(", ") || "none"}.`,
      sourceUrl: page.url,
      license: page.license,
      source: page.source,
      headings: headings.slice(0, 40),
    };
  }
  return {
    found: true,
    sectionFound: true,
    title: page.title,
    section: match.heading,
    summary: clip(wikitextToPlain(match.body), 4500) || `The section "${match.heading}" is empty.`,
    sourceUrl: sectionAnchor(page.url, match.heading),
    license: page.license,
    source: page.source,
  };
}

export async function getPage(client: WikiClient, title: string, section?: string) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("title is empty");
  const wanted = section?.trim() || undefined;
  const fandom = await client.fandomPage(trimmed);
  const wantsReference = REFERENCE.test(`${trimmed} ${wanted ?? ""}`);
  if (!fandom.missing) {
    const rendered = renderPage(fandom, wanted);
    if (rendered.sectionFound !== false || !wantsReference) return rendered;
  }
  if (fandom.missing || wantsReference) {
    const wikipedia = await client.wikipediaPage(trimmed, wanted ? "wikitext" : "intro");
    if (!wikipedia.missing) return renderPage(wikipedia, wanted);
  }
  if (!fandom.missing) return renderPage(fandom, wanted);
  return {
    found: false,
    sectionFound: false,
    title: trimmed,
    section: wanted ?? null,
    summary: `No GTA Wiki page and no Wikipedia page titled "${trimmed}". Nothing was filled in from memory.`,
    sourceUrl: wikiUrl("https://gta.fandom.com/wiki/", trimmed),
    wikipediaUrl: wikiUrl("https://en.wikipedia.org/wiki/", trimmed),
    license: FANDOM_LICENSE,
    source: null,
  };
}

export function normalizePlatform(input?: string): PlatformFilter {
  if (!input?.trim()) return "any";
  const value = input.toLowerCase();
  if (/(pc|steam|epic|keyboard)/.test(value)) return "pc";
  if (/xbox|series x|series s/.test(value)) return "xbox";
  if (/ps5|playstation|ps 5/.test(value)) return "ps5";
  return "any";
}

type ColumnRole = "name" | "effect" | "unlock" | "code" | "ignore" | { platform: "ps5" | "xbox" | "pc" };

function classifyHeader(header: string): ColumnRole {
  const value = header.toLowerCase();
  if (/unlock|requirement/.test(value)) return "unlock";
  if (/effect|result|description/.test(value)) return "effect";
  if (/playstation|\bps5\b|\bps 5\b|\bps2\b|\bps 2\b/.test(value)) return { platform: "ps5" };
  if (/xbox/.test(value)) return { platform: "xbox" };
  if (/\bpc\b|keyboard|computer/.test(value)) return { platform: "pc" };
  if (/code|input|button|sequence/.test(value)) return "code";
  if (/cheat|name|title/.test(value)) return "name";
  return "ignore";
}

function defaultRoles(count: number): ColumnRole[] {
  if (count >= 4) return ["name", "effect", "unlock", "code"];
  if (count === 3) return ["name", "effect", "code"];
  if (count === 2) return ["effect", "code"];
  return ["code"];
}

function activationLine(plain: string): string {
  const sentences = plain.split(/(?<=[.!?])\s+/);
  const buttons = sentences.find((sentence) => /L1|R1|d-pad/i.test(sentence));
  if (buttons) return clip(buttons, 400);
  const hit = sentences.find((sentence) => /activating a cheat|in-game phone/i.test(sentence));
  return hit ? clip(hit, 400) : "";
}

export function cheatsFromWikitext(wikitext: string, sourceUrl: string, platform?: string) {
  const sections = splitSections(wikitext);
  const lead = sections[0]?.body ?? "";
  const cheatSection = sections.find((section) => section.heading?.toLowerCase() === "cheats")
    ?? sections.find((section) => parseWikiTables(section.body).some((table) => table.rows.length));
  const activationSection = sections.find((section) => /activat/i.test(section.heading ?? ""));
  const context = [lead, activationSection?.body ?? "", cheatSection?.body ?? ""].join("\n");
  const activation = activationLine(wikitextToPlain(context));
  const tables = parseWikiTables(cheatSection?.body || wikitext);
  const table = tables.find((item) => item.rows.length) ?? null;
  const filter = normalizePlatform(platform);
  if (!table) {
    return { activation, filter, hasPlatformColumns: false, cheats: [] as CheatRow[] };
  }
  const roles = table.headers.length ? table.headers.map(classifyHeader) : defaultRoles(table.rows[0]?.length ?? 0);
  const hasPlatformColumns = roles.some((role) => typeof role === "object");
  const cheats: CheatRow[] = [];
  for (const cells of table.rows) {
    let name = "";
    let effect = "";
    let unlock = "";
    let code = "";
    const byPlatform: Partial<Record<"ps5" | "xbox" | "pc", string>> = {};
    const used = table.headers.length ? roles : defaultRoles(cells.length);
    cells.forEach((cell, index) => {
      const role = used[index] ?? "ignore";
      const plain = wikitextToPlain(cell);
      if (role === "name") name = plain;
      else if (role === "effect") effect = plain;
      else if (role === "unlock") unlock = plain;
      else if (role === "code") code = plain;
      else if (typeof role === "object") byPlatform[role.platform] = plain;
    });
    if (hasPlatformColumns) {
      const wanted = filter === "any" ? (["ps5", "xbox", "pc"] as const) : ([filter] as const);
      for (const key of wanted) {
        const platformCode = byPlatform[key]?.trim();
        if (!platformCode || platformCode === "-" || /^n\/?a$/i.test(platformCode)) continue;
        const judged = judgeCheatConfidence(cells.join("\n"), context);
        cheats.push({
          name: name || effect || "Cheat",
          effect,
          unlock,
          code: platformCode,
          platform: key,
          confidence: judged.confidence,
          basis: judged.basis,
          sourceUrl,
        });
      }
      continue;
    }
    if (!code && !name) continue;
    if (filter === "pc") continue;
    const judged = judgeCheatConfidence(cells.join("\n"), context);
    cheats.push({
      name: name || "Cheat",
      effect,
      unlock,
      code,
      platform: filter === "any" ? "controller" : filter,
      confidence: judged.confidence,
      basis: judged.basis,
      sourceUrl,
    });
  }
  return { activation, filter, hasPlatformColumns, cheats };
}

export async function listCheats(client: WikiClient, platform?: string) {
  const page = await client.fandomPage(CHEAT_TITLE);
  const sourceUrl = page.url || wikiUrl("https://gta.fandom.com/wiki/", CHEAT_TITLE);
  if (page.missing || !page.wikitext) {
    return {
      summary: "The GTA Wiki has no page titled \"Cheats in GTA VI\". No codes are listed, and none should be invented.",
      sourceUrl,
      license: FANDOM_LICENSE,
      activation: "",
      inputNote: "",
      platform: normalizePlatform(platform),
      confirmed: 0,
      unverified: 0,
      cheats: [] as CheatRow[],
    };
  }
  const parsed = cheatsFromWikitext(page.wikitext, sourceUrl, platform);
  const confirmed = parsed.cheats.filter((cheat) => cheat.confidence === "confirmed").length;
  const unverified = parsed.cheats.length - confirmed;
  const inputNote = parsed.hasPlatformColumns
    ? ""
    : parsed.filter === "pc"
      ? "The wiki prints controller directions and describes PlayStation shoulder buttons (L1 + R1). It has no PC keyboard column. No code is returned for PC."
      : parsed.filter === "xbox"
        ? "The wiki prints one set of D-pad directions and names PlayStation buttons (hold L1 + R1) in the activation line. It does not print a separate Xbox code, and this server does not translate L1/R1 into LB/RB."
        : "The wiki describes activation as holding L1 + R1, then entering the D-pad directions. Codes are copied as printed.";
  let summary: string;
  if (parsed.filter === "pc" && !parsed.hasPlatformColumns) {
    summary = "The GTA Wiki cheats page does not list PC keyboard codes. Nothing here is a PC cheat.";
  } else if (!parsed.cheats.length) {
    summary = "The cheats page did not contain a parseable cheat table.";
  } else {
    summary = `${parsed.cheats.length} cheat${parsed.cheats.length === 1 ? "" : "s"} from the GTA Wiki. ${confirmed} confirmed, ${unverified} unverified. A code is confirmed only when that page cites a reliable source or two independent sources agree. Do not present an unverified code as real.`;
  }
  return {
    summary,
    sourceUrl,
    license: FANDOM_LICENSE,
    activation: parsed.activation,
    inputNote,
    platform: parsed.filter,
    confirmed,
    unverified,
    cheats: parsed.cheats,
  };
}

function otherGameTitle(title: string): boolean {
  if (/\b(gta vi|grand theft auto vi|gta 6|leonida)\b/i.test(title)) return false;
  return /\b(gta v|gta iv|gta iii|san andreas|vice city stories|liberty city stories|chinatown wars|gta advance|gta online|1997)\b/i.test(title)
    || /^secrets and easter eggs in /i.test(title);
}

function isDedicatedEggTitle(title: string): boolean {
  return /easter|secret/i.test(title) && !otherGameTitle(title) && /\b(vi|6|leonida)\b/i.test(title);
}

export function eggItemsFromWikitext(wikitext: string, sourceUrl: string, section: string, kind: "easter-egg" | "trivia") {
  return parseBullets(wikitext).flatMap((bullet) => {
    const detail = wikitextToPlain(bullet);
    if (detail.length < 40) return [];
    const judged = judgeClaim(bullet);
    return [{
      title: clip(detail, 110),
      detail: clip(detail, 600),
      section,
      kind,
      confidence: judged.confidence,
      basis: judged.basis,
      sourceUrl,
    }];
  });
}

export async function easterEggs(client: WikiClient, topic?: string) {
  const candidates = await client.fandomPages(EGG_TITLES);
  const dedicated = candidates.find((page) => !page.missing && page.wikitext);
  let sourceUrl = wikiUrl("https://gta.fandom.com/wiki/", "Grand_Theft_Auto_VI");
  let sourceTitle = "Grand Theft Auto VI";
  let kind: "easter-egg" | "trivia" = "trivia";
  let wikitext = "";
  let sectionName = "Trivia";

  if (dedicated) {
    sourceUrl = dedicated.url;
    sourceTitle = dedicated.title;
    kind = "easter-egg";
    sectionName = dedicated.title;
    wikitext = dedicated.wikitext;
  } else {
    const hits = await client.fandomSearch('easter egg OR secrets "Grand Theft Auto VI"');
    const match = hits.find((hit) => isDedicatedEggTitle(hit.title));
    if (match) {
      const page = await client.fandomPage(match.title);
      if (!page.missing && page.wikitext) {
        sourceUrl = page.url;
        sourceTitle = page.title;
        kind = "easter-egg";
        sectionName = page.title;
        wikitext = page.wikitext;
      }
    }
  }

  if (!wikitext) {
    const sections = await client.fandomSections("Grand Theft Auto VI");
    const trivia = sections.find((section) => /^(trivia|easter eggs|secrets)\b/i.test(section.line))
      ?? sections.find((section) => /trivia|easter|secret/i.test(section.line));
    if (trivia) {
      wikitext = await client.fandomSectionWikitext("Grand Theft Auto VI", trivia.index);
      sectionName = trivia.line.replace(/<[^>]+>/g, "");
      sourceUrl = sectionAnchor("https://gta.fandom.com/wiki/Grand_Theft_Auto_VI", sectionName);
      sourceTitle = "Grand Theft Auto VI";
      kind = /easter|secret/i.test(sectionName) ? "easter-egg" : "trivia";
    }
  }

  const items = eggItemsFromWikitext(wikitext, sourceUrl, sectionName, kind).filter((item) => {
    if (!topic?.trim()) return true;
    const tokens = topic.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
    const haystack = `${item.title} ${item.detail} ${item.section}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  }).slice(0, 8);

  const dedicatedFound = Boolean(dedicated) || kind === "easter-egg";
  let summary = dedicatedFound
    ? `Easter eggs and secrets from "${sourceTitle}".`
    : "The GTA Wiki has no page titled \"Secrets and Easter Eggs in GTA VI\" or \"Easter Eggs in GTA VI\". The items below are the closest material, usually the Trivia section of Grand Theft Auto VI. They are not confirmed Easter eggs unless confidence is confirmed.";
  if (topic?.trim() && items.length === 0) {
    summary += ` Nothing matched "${topic.trim()}".`;
  } else if (topic?.trim()) {
    summary += ` Filtered to "${topic.trim()}".`;
  }
  if (!dedicatedFound) {
    summary += " Do not present an unverified item as a real secret.";
  }

  return {
    summary,
    sourceUrl,
    license: FANDOM_LICENSE,
    dedicatedPage: dedicatedFound ? sourceTitle : null,
    topic: topic?.trim() || null,
    items,
  };
}
