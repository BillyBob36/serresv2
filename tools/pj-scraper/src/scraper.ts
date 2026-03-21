/**
 * PlaywrightCrawler-based Pages Jaunes scraper.
 * 3 concurrent tabs, 4-6s delay, session rotation, anti-detection measures.
 * Auto-degrades to 1 tab + 10s delay if blocked.
 *
 * Each prospect is searched by "nom + ville" on PJ (not by keyword).
 * SIREN is propagated from input → output (no fuzzy matching needed).
 */

import { PlaywrightCrawler, RequestQueue } from "crawlee";
import { parseSearchResults, parseDetailPage, SELECTORS, type PjSearchResult, type PjDetailResult } from "./parser.js";

// User-Agent pool (recent Chrome on Windows/Mac)
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomDelay(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

export interface ScrapeResult {
  siren: string;
  companyName: string;
  city: string;
  matchConfidence: "high" | "medium" | "low" | "not_found";
  detail: PjDetailResult | null;
  /** If result came from a dirigeant name search, the name of that person */
  sourcePersonne: string | null;
}

interface Prospect {
  siren: string;
  nom: string;
  nomsAlternatifs: string[];
  commune: string;
  departement: string;
  dirigeants: string[];
}

/** Normalize string for comparison */
function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

/** Dice coefficient similarity */
function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s: string) => {
    const set: string[] = [];
    for (let i = 0; i < s.length - 1; i++) set.push(s.slice(i, i + 2));
    return set;
  };
  const aBi = bigrams(a);
  const bBi = bigrams(b);
  let matches = 0;
  const bCopy = [...bBi];
  for (const bi of aBi) {
    const idx = bCopy.indexOf(bi);
    if (idx >= 0) { matches++; bCopy.splice(idx, 1); }
  }
  return (2 * matches) / (aBi.length + bBi.length);
}

/** Compute match confidence between PJ result and prospect */
function computeMatchConfidence(
  pjName: string,
  pjAddress: string | null,
  prospect: Prospect
): "high" | "medium" | "low" {
  const normPj = normalize(pjName);
  const normProspect = normalize(prospect.nom);

  if (normPj === normProspect) return "high";

  const sim = diceSimilarity(normPj, normProspect);
  if (sim > 0.7) return "high";
  if (sim > 0.5) return "medium";

  // Check city match + partial name
  if (pjAddress) {
    const normAddr = normalize(pjAddress);
    const normCity = normalize(prospect.commune);
    if (normAddr.includes(normCity) && sim > 0.35) return "medium";
  }

  return "low";
}

// Concurrency state — degrades on repeated blocks
let currentMaxConcurrency = 3;
let currentDelayMin = 4000;
let currentDelayMax = 6000;
let consecutiveBlocks = 0;

function degradeConcurrency() {
  consecutiveBlocks++;
  if (consecutiveBlocks >= 3) {
    currentMaxConcurrency = 1;
    currentDelayMin = 8000;
    currentDelayMax = 12000;
    console.warn(`[PJ] Degraded to 1 tab, delay 8-12s after ${consecutiveBlocks} consecutive blocks`);
  }
}

function resetBlocks() {
  if (consecutiveBlocks > 0) {
    consecutiveBlocks = 0;
  }
}

/**
 * Main scraper function — processes all prospects using PlaywrightCrawler.
 * SIREN is propagated: input CSV has siren → search → output CSV has siren.
 */
export async function runScraper(
  prospects: Prospect[],
  startIndex: number,
  onResult: (index: number, result: ScrapeResult) => void,
  onProgress: (completed: number, total: number, notFound: number, errors: number) => void
): Promise<void> {
  let completed = startIndex;
  let notFound = 0;
  let errors = 0;

  const queue = await RequestQueue.open(`pj-scraper-${Date.now()}`);

  // Add all prospect search URLs to queue
  for (let i = startIndex; i < prospects.length; i++) {
    const p = prospects[i];
    const encodedName = encodeURIComponent(p.nom);
    const encodedCity = encodeURIComponent(p.commune);
    await queue.addRequest({
      url: `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${encodedName}&ou=${encodedCity}`,
      label: "search",
      userData: { prospectIndex: i, prospect: p },
    });
  }

  const crawler = new PlaywrightCrawler({
    requestQueue: queue,
    headless: true,
    maxConcurrency: currentMaxConcurrency,
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 90,
    maxRequestRetries: 2,
    sessionPoolOptions: {
      maxPoolSize: 10,
      sessionOptions: { maxUsageCount: 50 },
    },
    browserPoolOptions: {
      maxOpenPagesPerBrowser: 1,
      retireBrowserAfterPageCount: 100,
    },
    launchContext: {
      launchOptions: {
        headless: true,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-dev-shm-usage",
          "--no-sandbox",
          "--disable-gpu",
        ],
      },
    },

    preNavigationHooks: [
      async ({ page }) => {
        // Random delay before navigation
        const delay = randomDelay(currentDelayMin, currentDelayMax);
        await page.waitForTimeout(delay);

        // Random viewport
        await page.setViewportSize({
          width: 1280 + Math.floor(Math.random() * 200),
          height: 800 + Math.floor(Math.random() * 200),
        });

        // Anti-detection
        await page.context().addInitScript(`
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
        `);

        // Block heavy resources (keep stylesheets for layout)
        await page.route("**/*", (route) => {
          const type = route.request().resourceType();
          const url = route.request().url();
          if (
            ["image", "media", "font"].includes(type) ||
            url.includes("analytics") ||
            url.includes("tracking") ||
            url.includes("doubleclick") ||
            url.includes("googlesyndication") ||
            url.includes("facebook.net")
          ) {
            route.abort();
          } else {
            route.continue();
          }
        });
      },
    ],

    async requestHandler({ page, request, log }) {
      const { prospectIndex, prospect, matchConfidence: prevMatchConfidence, sourcePersonne } = request.userData as any;

      // Try to close cookie banner
      try {
        const cookieBtn = page.locator(SELECTORS.cookieBanner).first();
        if (await cookieBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await cookieBtn.click();
          await page.waitForTimeout(1000);
        }
      } catch { /* ignore */ }

      // Check for CAPTCHA / blocks
      const bodyText = await page.textContent("body").catch(() => "") || "";
      if (
        bodyText.includes("captcha") ||
        bodyText.includes("CAPTCHA") ||
        bodyText.includes("Veuillez confirmer") ||
        bodyText.includes("robot")
      ) {
        log.warning(`CAPTCHA/block detected for ${prospect.nom}, pausing 120s...`);
        degradeConcurrency();
        await page.waitForTimeout(120000);
        throw new Error("CAPTCHA detected — will retry");
      }

      if (request.label === "search" || request.label === "search_altname" || request.label === "search_dirigeant") {
        const isDirigeantSearch = request.label === "search_dirigeant";
        const isAltNameSearch = request.label === "search_altname";
        const altNameIdx = (request.userData as any).altNameIdx || 0;

        // Wait for results to load
        try {
          await page.waitForSelector(
            'li[id^="bi-bloc-"], #listResults, .bi-list, .no-results',
            { timeout: 10000 }
          );
        } catch {
          // No results container found
        }

        await page.waitForTimeout(1000);

        // Check for "no results" message
        const noResults = await page.evaluate(`
          (() => {
            const body = document.body?.textContent || '';
            return body.includes('aucun résultat') || body.includes('Aucun professionnel') || body.includes('0 résultat');
          })()
        `);

        // Helper: enqueue next fallback level (alt names → dirigeants → give up)
        async function enqueueFallback(reason: string): Promise<boolean> {
          // Level 1: try alternative names (nom_raison_sociale, sigle, historical...)
          if (!isDirigeantSearch && !isAltNameSearch && prospect.nomsAlternatifs && prospect.nomsAlternatifs.length > 0) {
            log.info(`${reason} "${prospect.nom}", trying ${prospect.nomsAlternatifs.length} alt name(s)...`);
            for (let ai = 0; ai < prospect.nomsAlternatifs.length; ai++) {
              const altName = prospect.nomsAlternatifs[ai];
              const encodedName = encodeURIComponent(altName);
              const encodedCity = encodeURIComponent(prospect.commune);
              await queue.addRequest({
                url: `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${encodedName}&ou=${encodedCity}`,
                label: "search_altname",
                uniqueKey: `alt-${prospect.siren}-${ai}`,
                userData: { prospectIndex, prospect, altNameIdx: ai },
              });
            }
            return true;
          }
          // Level 1b: if current alt name failed, try remaining alt names
          if (isAltNameSearch && altNameIdx + 1 < (prospect.nomsAlternatifs?.length || 0)) {
            // Already queued all alt names at once — they'll be processed naturally
            return true; // let the other alt name requests run
          }
          // Level 2: try dirigeant names
          if (!isDirigeantSearch && prospect.dirigeants && prospect.dirigeants.length > 0) {
            log.info(`${reason}, trying ${prospect.dirigeants.length} dirigeant(s)...`);
            for (const dirName of prospect.dirigeants) {
              const encodedName = encodeURIComponent(dirName);
              const encodedCity = encodeURIComponent(prospect.commune);
              await queue.addRequest({
                url: `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${encodedName}&ou=${encodedCity}`,
                label: "search_dirigeant",
                uniqueKey: `dir-${prospect.siren}-${dirName}`,
                userData: { prospectIndex, prospect, sourcePersonne: dirName },
              });
            }
            return true;
          }
          return false; // no more fallbacks
        }

        if (noResults) {
          const hadFallback = await enqueueFallback("No results for");
          if (hadFallback) { resetBlocks(); return; }

          notFound++;
          completed++;
          onResult(prospectIndex, {
            siren: prospect.siren,
            companyName: prospect.nom,
            city: prospect.commune,
            matchConfidence: "not_found",
            detail: null,
            sourcePersonne: null,
          });
          resetBlocks();
          return;
        }

        // Parse search results
        const results = await parseSearchResults(page);

        if (results.length === 0) {
          const hadFallback = await enqueueFallback("Empty results for");
          if (hadFallback) { resetBlocks(); return; }

          notFound++;
          completed++;
          onResult(prospectIndex, {
            siren: prospect.siren,
            companyName: prospect.nom,
            city: prospect.commune,
            matchConfidence: "not_found",
            detail: null,
            sourcePersonne: null,
          });
          resetBlocks();
          return;
        }

        // Find best matching result (skip ads)
        let bestResult: PjSearchResult | null = null;
        let bestConfidence: "high" | "medium" | "low" = "low";

        for (const r of results) {
          if (r.isAd) continue;
          if (isDirigeantSearch) {
            // For dirigeant search, take first non-ad result as medium match
            bestResult = r;
            bestConfidence = "medium";
            break;
          }
          const conf = computeMatchConfidence(r.name, r.address, prospect);
          if (conf === "high") {
            bestResult = r;
            bestConfidence = conf;
            break;
          }
          if (conf === "medium" && bestConfidence === "low") {
            bestResult = r;
            bestConfidence = conf;
          }
          if (!bestResult) {
            bestResult = r;
            bestConfidence = conf;
          }
        }

        // If we have a good match with a valid detail URL, navigate there for full data
        const hasValidDetailUrl = bestResult?.detailUrl &&
          bestResult.detailUrl.startsWith("https://www.pagesjaunes.fr/pros/");
        if (bestResult && hasValidDetailUrl && bestConfidence !== "low") {
          await queue.addRequest({
            url: bestResult.detailUrl!,
            label: "detail",
            userData: {
              prospectIndex,
              prospect,
              searchResult: bestResult,
              matchConfidence: bestConfidence,
              sourcePersonne: sourcePersonne || null,
            },
          });
        } else if (bestResult && bestConfidence !== "low") {
          // Use search result data directly
          completed++;
          onResult(prospectIndex, {
            siren: prospect.siren,
            companyName: prospect.nom,
            city: prospect.commune,
            matchConfidence: bestConfidence,
            sourcePersonne: sourcePersonne || null,
            detail: {
              raison_social: bestResult.name,
              telephone: bestResult.phone ? [bestResult.phone] : [],
              email: null,
              site_web: bestResult.website,
              adresse: bestResult.address,
              code_postal: null,
              ville: prospect.commune,
              horaires: null,
              note: bestResult.rating,
              nb_avis: bestResult.reviewCount,
              description: null,
              siret: null,
              naf: null,
              forme_juridique: null,
              activites: bestResult.category ? [bestResult.category] : [],
              url_fiche: bestResult.detailUrl,
            },
          });
          resetBlocks();
        } else {
          // No good match — try alt names then dirigeant fallback
          const hadFallback = await enqueueFallback(`No good match for "${prospect.nom}"`);
          if (hadFallback) {
            resetBlocks();
          } else {
            notFound++;
            completed++;
            onResult(prospectIndex, {
              siren: prospect.siren,
              companyName: prospect.nom,
              city: prospect.commune,
              matchConfidence: "not_found",
              detail: null,
              sourcePersonne: null,
            });
            resetBlocks();
          }
        }
      } else if (request.label === "detail") {
        // Parse detail page (includes phone reveal click)
        const detail = await parseDetailPage(page, request.loadedUrl || request.url);
        const matchConfidence = prevMatchConfidence || "medium";

        completed++;
        onResult(prospectIndex, {
          siren: prospect.siren,
          companyName: prospect.nom,
          city: prospect.commune,
          matchConfidence,
          detail,
          sourcePersonne: sourcePersonne || null,
        });
        resetBlocks();
      }

      // Report progress
      if (completed % 10 === 0) {
        onProgress(completed, prospects.length, notFound, errors);
      }
    },

    async failedRequestHandler({ request, log }) {
      const { prospectIndex, prospect } = request.userData as any;
      log.error(`Failed: ${prospect?.nom} (${request.url})`);
      errors++;
      completed++;

      if (prospect) {
        onResult(prospectIndex, {
          siren: prospect.siren,
          companyName: prospect.nom,
          city: prospect.commune,
          matchConfidence: "not_found",
          detail: null,
          sourcePersonne: null,
        });
      }
    },
  });

  console.log(
    `[PJ] Starting crawler: ${prospects.length - startIndex} prospects, ` +
    `${currentMaxConcurrency} concurrent tabs, ${currentDelayMin}-${currentDelayMax}ms delay`
  );
  await crawler.run();

  // Final progress report
  onProgress(completed, prospects.length, notFound, errors);
  console.log(`[PJ] Crawler finished. Completed: ${completed}, NotFound: ${notFound}, Errors: ${errors}`);
}
