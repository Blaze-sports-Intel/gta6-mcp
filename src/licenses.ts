export const REPO_URL = "https://github.com/Blaze-sports-Intel/gta6-mcp";

export const USER_AGENT = `gta6-mcp/0.1 (+${REPO_URL})`;

export const FANDOM_LICENSE =
  "Text from the GTA Wiki on Fandom is CC BY-SA. Attribute the GTA Wiki contributors and link the source page. https://www.fandom.com/licensing";

export const WIKIPEDIA_LICENSE =
  "Text from Wikipedia is CC BY-SA 4.0. Attribute Wikipedia contributors and link the source page. https://creativecommons.org/licenses/by-sa/4.0/";

export const BOTH_LICENSES = `${FANDOM_LICENSE} ${WIKIPEDIA_LICENSE}`;

export function licenseFor(source: "fandom" | "wikipedia"): string {
  return source === "wikipedia" ? WIKIPEDIA_LICENSE : FANDOM_LICENSE;
}
