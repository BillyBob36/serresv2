import { PlaywrightCrawler, RequestQueue } from 'crawlee';
import { parseSearchResults, extractEmailsFromWebsite, type GoogleResult } from './parser.js';
import { appendRow, saveCheckpoint } from './output.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
];

interface Query {
  index: number;
  text: string;
  siren: string;
  variants: string[];
}

interface ScrapeStats {
  completed: number;
  notFound: number;
  errors: number;
  emailsFound: number;
  foundViaFallback: number;
}

let consecutiveErrors = 0;
let degradedMode = false;

export async function scrapeGoogleMaps(
  queries: Query[],
  options: { extractEmails: boolean; concurrency: number; debug?: boolean; onProgress?: (stats: ScrapeStats) => void }
): Promise<ScrapeStats> {
  const stats: ScrapeStats = { completed: 0, notFound: 0, errors: 0, emailsFound: 0, foundViaFallback: 0 };
  const requestQueue = await RequestQueue.open('google-maps-queue');

  // Track which SIRENs already found a result (skip remaining variants)
  const foundSirens = new Set<string>();

  // Add all primary queries to the queue
  for (const q of queries) {
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(q.text)}?hl=fr`;
    await requestQueue.addRequest({
      url: searchUrl,
      uniqueKey: `google-${q.index}-v0`,
      userData: {
        query: q.text,
        index: q.index,
        siren: q.siren,
        variantIdx: 0,
        variants: q.variants,
      },
    });
  }

  const crawler = new PlaywrightCrawler({
    requestQueue,
    headless: true,
    maxConcurrency: options.concurrency,
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 90,
    maxRequestRetries: 2,
    sessionPoolOptions: {
      maxPoolSize: 10,
      sessionOptions: { maxUsageCount: 30 },
    },
    browserPoolOptions: {
      maxOpenPagesPerBrowser: 1,
      retireBrowserAfterPageCount: 50,
    },
    launchContext: {
      launchOptions: {
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      },
    },
    preNavigationHooks: [
      async ({ page }) => {
        // Random delay 3-6s (or 8-12s in degraded mode)
        const baseDelay = degradedMode ? 8000 : 3000;
        const extraDelay = degradedMode ? 4000 : 3000;
        await page.waitForTimeout(baseDelay + Math.random() * extraDelay);

        // Random viewport
        await page.setViewportSize({
          width: 1280 + Math.floor(Math.random() * 200),
          height: 800 + Math.floor(Math.random() * 200),
        });

        // Anti-detection
        await page.context().addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        // Pre-set Google consent cookies to bypass consent screen
        await page.context().addCookies([
          { name: 'SOCS', value: 'CAISHAgBEhJnd3NfMjAyNTAzMjItMF9SQzIaAmZyIAEaBgiA_vG8Bg', domain: '.google.com', path: '/' },
          { name: 'CONSENT', value: 'PENDING+987', domain: '.google.com', path: '/' },
        ]);

        // Block heavy resources (keep stylesheets — Google Maps needs them for layout)
        await page.route('**/*', (route) => {
          const type = route.request().resourceType();
          const url = route.request().url();
          if (['image', 'media', 'font'].includes(type) ||
              url.includes('analytics') || url.includes('tracking') ||
              url.includes('doubleclick') || url.includes('googlesyndication')) {
            route.abort();
          } else {
            route.continue();
          }
        });
      },
    ],
    requestHandler: async ({ page, request, log }) => {
      const { query, index, siren, variantIdx, variants } = request.userData as {
        query: string; index: number; siren: string; variantIdx: number; variants: string[];
      };

      // Skip if this SIREN was already found via an earlier variant
      if (siren && foundSirens.has(siren)) {
        log.info(`[skip] SIREN ${siren} already found, skipping variant #${variantIdx}`);
        return;
      }

      const totalDone = stats.completed + stats.notFound + stats.errors;
      log.info(`[${totalDone + 1}/${queries.length}] Scraping: ${query}${variantIdx > 0 ? ` (variante #${variantIdx + 1})` : ''}`);

      // Parse results
      const result = await parseSearchResults(page, query);

      if (!result || !result.title) {
        // Not found — try next name variant if available
        if (variants && variantIdx < variants.length) {
          const nextVariant = variants[variantIdx];
          const nextUrl = `https://www.google.com/maps/search/${encodeURIComponent(nextVariant)}?hl=fr`;
          log.info(`  → Pas trouvé avec "${query}", essai variante #${variantIdx + 2}: "${nextVariant}"`);
          await requestQueue.addRequest({
            url: nextUrl,
            uniqueKey: `google-${index}-v${variantIdx + 1}`,
            userData: {
              query: nextVariant,
              index,
              siren,
              variantIdx: variantIdx + 1,
              variants,
            },
          });
          return; // Don't count as notFound yet
        }

        stats.notFound++;
        log.warning(`No result for: ${query} (${variants.length > 0 ? `tried ${variantIdx + 1} variants` : 'no variants'})`);
        consecutiveErrors = 0;
        saveCheckpoint(index);
        options.onProgress?.(stats);
        return;
      }

      // Extract emails from website if enabled
      if (options.extractEmails && result.website) {
        try {
          let websiteUrl = result.website;
          if (!websiteUrl.startsWith('http')) websiteUrl = 'https://' + websiteUrl;
          const emails = await extractEmailsFromWebsite(page, websiteUrl);
          result.email = emails.join('; ');
          if (emails.length > 0) stats.emailsFound += emails.length;
        } catch { /* ignore email extraction errors */ }
      }

      // Mark SIREN as found
      if (siren) foundSirens.add(siren);

      // Track fallback success
      if (variantIdx > 0) {
        stats.foundViaFallback++;
        log.info(`  ✓ Trouvé via variante #${variantIdx + 1} pour SIREN ${siren}`);
      }

      // Add siren to result and write to CSV
      (result as any).siren = siren;
      appendRow(result as unknown as Record<string, string>);
      stats.completed++;
      consecutiveErrors = 0;

      // Checkpoint every 20 results
      if ((stats.completed + stats.notFound) % 20 === 0) {
        saveCheckpoint(index);
      }

      options.onProgress?.(stats);
    },
    failedRequestHandler: async ({ request, log }) => {
      const { query, index, siren, variantIdx, variants } = request.userData as {
        query: string; index: number; siren: string; variantIdx: number; variants: string[];
      };
      log.error(`Failed after retries: ${query}`);

      // Try next variant on failure too
      if (variants && variantIdx < variants.length && siren && !foundSirens.has(siren)) {
        const nextVariant = variants[variantIdx];
        const nextUrl = `https://www.google.com/maps/search/${encodeURIComponent(nextVariant)}?hl=fr`;
        log.info(`  → Echec, essai variante #${variantIdx + 2}: "${nextVariant}"`);
        await requestQueue.addRequest({
          url: nextUrl,
          uniqueKey: `google-${index}-v${variantIdx + 1}`,
          userData: { query: nextVariant, index, siren, variantIdx: variantIdx + 1, variants },
        });
        return;
      }

      stats.errors++;
      consecutiveErrors++;

      // Degrade to single-tab mode after 3 consecutive errors
      if (consecutiveErrors >= 3 && !degradedMode) {
        degradedMode = true;
        log.warning('Switching to degraded mode (longer delays)');
        crawler.autoscaledPool?.desiredConcurrency && (crawler.autoscaledPool.desiredConcurrency = 1);
      }

      saveCheckpoint(index);
      options.onProgress?.(stats);
    },
  });

  await crawler.run();
  return stats;
}
