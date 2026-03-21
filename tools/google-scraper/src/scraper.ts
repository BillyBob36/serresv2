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
}

interface ScrapeStats {
  completed: number;
  notFound: number;
  errors: number;
  emailsFound: number;
}

let consecutiveErrors = 0;
let degradedMode = false;

export async function scrapeGoogleMaps(
  queries: Query[],
  options: { extractEmails: boolean; concurrency: number; debug?: boolean; onProgress?: (stats: ScrapeStats) => void }
): Promise<ScrapeStats> {
  const stats: ScrapeStats = { completed: 0, notFound: 0, errors: 0, emailsFound: 0 };
  const requestQueue = await RequestQueue.open('google-maps-queue');

  // Add all queries to the queue
  for (const q of queries) {
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(q.text)}?hl=fr`;
    await requestQueue.addRequest({
      url: searchUrl,
      uniqueKey: `google-${q.index}`,
      userData: { query: q.text, index: q.index, siren: q.siren },
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

        // Random User-Agent
        const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
        await page.context().addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

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
      const { query, index, siren } = request.userData as { query: string; index: number; siren: string };
      log.info(`[${stats.completed + stats.notFound + stats.errors + 1}/${queries.length}] Scraping: ${query}`);

      // Parse results (cookie handling is inside parseSearchResults)
      const result = await parseSearchResults(page, query);

      if (!result || !result.title) {
        stats.notFound++;
        log.warning(`No result for: ${query}`);
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
      const { query, index, siren } = request.userData as { query: string; index: number; siren: string };
      log.error(`Failed after retries: ${query}`);
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
