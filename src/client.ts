import { FANDOM_LICENSE, USER_AGENT, licenseFor } from "./licenses.js";
import { decodeEntities, wikiUrl } from "./text.js";

const FANDOM_API = "https://gta.fandom.com/api.php";
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const ALLOWED_HOSTS = new Set(["gta.fandom.com", "en.wikipedia.org"]);

export type SourceName = "fandom" | "wikipedia";

export type ParsedPage = {
  source: SourceName;
  title: string;
  url: string;
  missing: boolean;
  wikitext: string;
  extract: string;
  license: string;
};

export type SearchHit = {
  source: SourceName;
  title: string;
  snippet: string;
  url: string;
  license: string;
};

export type SectionInfo = {
  index: string;
  line: string;
};

type CacheEntry = { expires: number; value: unknown };

type RawPage = {
  title?: string;
  missing?: string;
  fullurl?: string;
  canonicalurl?: string;
  extract?: string;
  revisions?: { slots?: { main?: { "*"?: string } } }[];
};

export type WikiClientOptions = {
  fetchImpl?: typeof fetch;
  minIntervalMs?: number;
  ttlMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export function apiUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function stripSnippet(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

export function parseQueryPages(json: unknown, source: SourceName): ParsedPage[] {
  if (!json || typeof json !== "object" || !("query" in json)) {
    throw new Error("Unexpected wiki response");
  }
  const pages = (json as { query?: { pages?: Record<string, RawPage> } }).query?.pages ?? {};
  return Object.values(pages).map((page) => parseRawPage(page, source));
}

export function parseQueryPage(json: unknown, source: SourceName): ParsedPage {
  const pages = parseQueryPages(json, source);
  const page = pages[0];
  if (!page) throw new Error("Wiki response had no pages");
  return page;
}

function parseRawPage(page: RawPage, source: SourceName): ParsedPage {
  const title = page.title ?? "";
  const missing = Object.prototype.hasOwnProperty.call(page, "missing");
  const base = source === "fandom" ? "https://gta.fandom.com/wiki/" : "https://en.wikipedia.org/wiki/";
  return {
    source,
    title,
    url: page.fullurl || page.canonicalurl || wikiUrl(base, title),
    missing,
    wikitext: page.revisions?.[0]?.slots?.main?.["*"] ?? "",
    extract: typeof page.extract === "string" ? page.extract : "",
    license: licenseFor(source),
  };
}

export function parseSearch(json: unknown, source: SourceName): SearchHit[] {
  const rows = (json as { query?: { search?: { title?: string; snippet?: string }[] } }).query?.search ?? [];
  const base = source === "fandom" ? "https://gta.fandom.com/wiki/" : "https://en.wikipedia.org/wiki/";
  return rows
    .filter((row) => row.title)
    .map((row) => ({
      source,
      title: row.title ?? "",
      snippet: stripSnippet(row.snippet ?? ""),
      url: wikiUrl(base, row.title ?? ""),
      license: licenseFor(source),
    }));
}

export function parseSectionList(json: unknown): SectionInfo[] {
  const sections = (json as { parse?: { sections?: { index?: string | number; line?: string }[] } }).parse?.sections ?? [];
  return sections.map((section) => ({
    index: String(section.index ?? ""),
    line: decodeEntities(section.line ?? ""),
  }));
}

export function parseSectionWikitext(json: unknown): string {
  const wikitext = (json as { parse?: { wikitext?: { "*"?: string } } }).parse?.wikitext?.["*"];
  if (typeof wikitext !== "string") throw new Error("Wiki section response had no wikitext");
  return wikitext;
}

export class WikiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly minIntervalMs: number;
  private readonly ttlMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly nextAt = new Map<string, number>();

  constructor(options: WikiClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.minIntervalMs = options.minIntervalMs ?? 1100;
    this.ttlMs = options.ttlMs ?? 60 * 60 * 1000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async fandomSearch(query: string): Promise<SearchHit[]> {
    const json = await this.getJson(apiUrl(FANDOM_API, {
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: "8",
      srnamespace: "0",
      srprop: "snippet|titlesnippet|size|wordcount",
      format: "json",
    }));
    return parseSearch(json, "fandom");
  }

  async wikipediaSearch(query: string): Promise<SearchHit[]> {
    const json = await this.getJson(apiUrl(WIKIPEDIA_API, {
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: "5",
      srnamespace: "0",
      srprop: "snippet|titlesnippet|size",
      format: "json",
    }));
    return parseSearch(json, "wikipedia");
  }

  async fandomPage(title: string): Promise<ParsedPage> {
    return this.revisionPage(FANDOM_API, "fandom", title);
  }

  async fandomLead(title: string): Promise<ParsedPage> {
    return this.revisionPage(FANDOM_API, "fandom", title, "0");
  }

  async fandomPages(titles: string[]): Promise<ParsedPage[]> {
    const json = await this.getJson(apiUrl(FANDOM_API, {
      action: "query",
      prop: "revisions|info",
      rvprop: "content",
      rvslots: "main",
      inprop: "url",
      redirects: "1",
      titles: titles.join("|"),
      format: "json",
    }));
    return parseQueryPages(json, "fandom");
  }

  async wikipediaPage(title: string, mode: "intro" | "wikitext"): Promise<ParsedPage> {
    if (mode === "wikitext") return this.revisionPage(WIKIPEDIA_API, "wikipedia", title);
    const json = await this.getJson(apiUrl(WIKIPEDIA_API, {
      action: "query",
      prop: "extracts|info",
      explaintext: "1",
      exintro: "1",
      exsectionformat: "plain",
      inprop: "url",
      redirects: "1",
      titles: title,
      format: "json",
    }));
    return parseQueryPage(json, "wikipedia");
  }

  async fandomSections(title: string): Promise<SectionInfo[]> {
    const json = await this.getJson(apiUrl(FANDOM_API, {
      action: "parse",
      page: title,
      prop: "sections",
      format: "json",
    }));
    return parseSectionList(json);
  }

  async fandomSectionWikitext(title: string, index: string): Promise<string> {
    const json = await this.getJson(apiUrl(FANDOM_API, {
      action: "parse",
      page: title,
      prop: "wikitext",
      section: index,
      format: "json",
    }));
    return parseSectionWikitext(json);
  }

  private async revisionPage(base: string, source: SourceName, title: string, section?: string): Promise<ParsedPage> {
    const params: Record<string, string> = {
      action: "query",
      prop: "revisions|info",
      rvprop: "content",
      rvslots: "main",
      inprop: "url",
      redirects: "1",
      titles: title,
      format: "json",
    };
    if (section !== undefined) params.rvsection = section;
    return parseQueryPage(await this.getJson(apiUrl(base, params)), source);
  }

  async getJson(url: string): Promise<unknown> {
    const host = new URL(url).host;
    if (!ALLOWED_HOSTS.has(host)) throw new Error(`Refusing to request ${host}`);
    const cached = this.cache.get(url);
    if (cached && cached.expires > Date.now()) return cached.value;
    await this.pace(host);
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${host}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 2_000_000) throw new Error(`Response from ${host} was too large`);
    const json = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (json && typeof json === "object" && json !== null && "error" in json) {
      const info = (json as { error?: { info?: string } }).error?.info ?? "wiki API error";
      throw new Error(info);
    }
    this.cache.set(url, { expires: Date.now() + this.ttlMs, value: json });
    return json;
  }

  private pace(host: string): Promise<void> {
    const previous = this.chains.get(host) ?? Promise.resolve();
    const run = previous.then(async () => {
      const wait = Math.max(0, (this.nextAt.get(host) ?? 0) - Date.now());
      if (wait > 0) await this.sleep(wait);
      this.nextAt.set(host, Date.now() + this.minIntervalMs);
    });
    this.chains.set(host, run.then(() => undefined, () => undefined));
    return run;
  }
}

export { FANDOM_LICENSE };
