import type { Page } from 'playwright';

export interface GoogleResult {
  siren?: string;
  query: string;
  title: string;
  category: string;
  address: string;
  phone: string;
  website: string;
  email: string;
  latitude: string;
  longitude: string;
  rating: string;
  review_count: string;
  open_hours: string;
  status: string;
  price_level: string;
}

/**
 * Parse Google Maps results using the APP_INITIALIZATION_STATE JSON approach.
 * This is the most reliable method, used by gosom/google-maps-scraper.
 * Instead of fragile CSS selectors, we read Google's internal data structure.
 */
export async function parseSearchResults(page: Page, query: string): Promise<GoogleResult | null> {
  // Handle consent screen first — must wait for maps to fully load after
  await handleConsent(page);

  // If we just passed consent, wait for Google Maps URL
  if (!page.url().includes('google.com/maps')) {
    try {
      await page.waitForURL('**/maps/**', { timeout: 10000 });
      await page.waitForTimeout(2000);
    } catch {
      return null;
    }
  }

  // Wait for results to load
  try {
    await page.waitForSelector('div[role="feed"], h1.DUwDvf, a.hfpxzc', { timeout: 15000 });
  } catch {
    return null;
  }

  await page.waitForTimeout(2000);

  // Check if already on a detail page (single result)
  const hasDetail = await page.locator('h1.DUwDvf').isVisible({ timeout: 2000 }).catch(() => false);

  if (!hasDetail) {
    // Multiple results — click the first organic (non-sponsored) result
    const clicked = await clickFirstOrganic(page);
    if (!clicked) return null;
    await page.waitForTimeout(3000);
  }

  // Now extract data from APP_INITIALIZATION_STATE JSON
  return await extractFromAppState(page, query);
}

async function handleConsent(page: Page): Promise<void> {
  // Check if we're on consent page
  const url = page.url();
  if (!url.includes('consent.google') && !url.includes('consent')) return;

  // Strategy 1: getByRole (most reliable for Google consent)
  try {
    await page.getByRole('button', { name: /tout accepter|accept all/i }).click({ timeout: 5000 });
    await page.waitForTimeout(3000);
    return;
  } catch { /* ignore */ }

  // Strategy 2: form submit button
  try {
    const btn = page.locator('form[action*="consent"] button').first();
    await btn.click({ timeout: 3000 });
    await page.waitForTimeout(3000);
    return;
  } catch { /* ignore */ }
}

async function clickFirstOrganic(page: Page): Promise<boolean> {
  // Find the index of the first non-sponsored result
  const idx = await page.evaluate(`
    (() => {
      var links = document.querySelectorAll('a.hfpxzc');
      for (var i = 0; i < links.length; i++) {
        var link = links[i];
        var rect = link.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        var sponsored = false;
        var parent = link.parentElement;
        for (var j = 0; j < 5 && parent; j++) {
          var text = parent.textContent || '';
          if ((text.includes('Sponsorisé') || text.includes('Sponsored')) && text.length < 500) {
            sponsored = true;
            break;
          }
          parent = parent.parentElement;
        }
        if (!sponsored) return i;
      }
      // Fallback: first visible
      for (var k = 0; k < links.length; k++) {
        var r = links[k].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return k;
      }
      return -1;
    })()
  `) as number;

  if (idx < 0) return false;

  // Use Playwright's native click (reliable, triggers SPA navigation)
  await page.locator('a.hfpxzc').nth(idx).click();
  await page.waitForSelector('h1.DUwDvf', { timeout: 8000 }).catch(() => {});
  return true;
}

/**
 * Extract data from window.APP_INITIALIZATION_STATE JSON.
 * This contains ALL Google Maps data in a structured array.
 * Fallback to DOM selectors if JSON extraction fails.
 */
async function extractFromAppState(page: Page, query: string): Promise<GoogleResult | null> {
  // Try to read APP_INITIALIZATION_STATE (gosom approach)
  const jsonData = await page.evaluate(`
    (() => {
      try {
        const state = window.APP_INITIALIZATION_STATE;
        if (!state) return null;

        // The data is at index 3, 5, or 6 — try each
        for (const idx of [3, 5, 6]) {
          if (state[idx] && typeof state[idx] === 'string') {
            // Strip the ")]}'" security prefix
            let raw = state[idx];
            if (raw.startsWith(")]}'")) raw = raw.substring(4);
            if (raw.startsWith("\\n")) raw = raw.substring(2);
            raw = raw.trim();
            try {
              const parsed = JSON.parse(raw);
              // Find the data array — it's deeply nested
              // Navigate to the place data array
              if (parsed && Array.isArray(parsed)) {
                // Try to find the array with title at [11]
                const findData = (arr) => {
                  if (!Array.isArray(arr)) return null;
                  // Check if this looks like the place data (has title at [11])
                  if (arr[11] && typeof arr[11] === 'string' && arr[11].length > 0) {
                    return arr;
                  }
                  // Recurse into sub-arrays
                  for (const item of arr) {
                    if (Array.isArray(item)) {
                      const found = findData(item);
                      if (found) return found;
                    }
                  }
                  return null;
                };
                const darray = findData(parsed);
                if (darray) {
                  return {
                    title: darray[11] || '',
                    category: Array.isArray(darray[13]) ? darray[13].join(', ') : (darray[13] || ''),
                    address: darray[18] || '',
                    website: (darray[7] && darray[7][0]) || '',
                    phone: (darray[178] && darray[178][0] && darray[178][0][0]) || '',
                    rating: (darray[4] && darray[4][7]) != null ? String(darray[4][7]) : '',
                    review_count: (darray[4] && darray[4][8]) != null ? String(darray[4][8]) : '',
                    lat: (darray[9] && darray[9][2]) != null ? String(darray[9][2]) : '',
                    lng: (darray[9] && darray[9][3]) != null ? String(darray[9][3]) : '',
                    status: darray[34] && darray[34][4] && darray[34][4][0] ? 'CLOSED_PERMANENTLY' : 'OPERATIONAL',
                    hours: '',
                    price_level: '',
                  };
                }
              }
            } catch (e) { /* parse error, try next index */ }
          }
        }
        return null;
      } catch (e) {
        return null;
      }
    })()
  `) as any;

  if (jsonData && jsonData.title) {
    // Successfully extracted from JSON!
    const result: GoogleResult = {
      query,
      title: jsonData.title,
      category: jsonData.category,
      address: jsonData.address,
      phone: jsonData.phone,
      website: jsonData.website,
      email: '',
      latitude: jsonData.lat,
      longitude: jsonData.lng,
      rating: jsonData.rating,
      review_count: jsonData.review_count,
      open_hours: jsonData.hours,
      status: jsonData.status,
      price_level: jsonData.price_level,
    };
    return result;
  }

  // Fallback: DOM-based extraction if JSON approach fails
  return await extractFromDOM(page, query);
}

/**
 * Fallback DOM extraction using proven selectors from crawlee blog & gosom.
 */
async function extractFromDOM(page: Page, query: string): Promise<GoogleResult | null> {
  const result: GoogleResult = {
    query, title: '', category: '', address: '', phone: '',
    website: '', email: '', latitude: '', longitude: '',
    rating: '', review_count: '', open_hours: '', status: '', price_level: ''
  };

  // Title
  result.title = await getText(page, 'h1.DUwDvf');
  if (!result.title) return null;

  // Category — button with jsaction="category"
  result.category = await getText(page, 'button[jsaction*="category"]');

  // Rating — span with aria-hidden inside F7nice
  const ratingRaw = await getText(page, 'div.F7nice span[aria-hidden="true"]');
  result.rating = ratingRaw.replace(',', '.');

  // Review count — extract from parenthesized text in rating area
  const ratingAreaText = await getText(page, 'div.F7nice');
  const reviewMatch = ratingAreaText.match(/\(([\d\s.,]+)\)/);
  if (reviewMatch) {
    result.review_count = reviewMatch[1].replace(/[\s.]/g, '').replace(',', '');
  }

  // Address, Phone, Website via data-item-id (most reliable approach)
  const infoData = await page.evaluate(`
    (() => {
      const data = { address: '', phone: '', website: '', hours_summary: '' };
      const items = document.querySelectorAll('button[data-item-id], a[data-item-id]');
      for (const item of items) {
        const id = item.getAttribute('data-item-id') || '';
        const textEl = item.querySelector('.Io6YTe, .fontBodyMedium, .rogA2c');
        const text = (textEl ? textEl.textContent : item.textContent || '').trim();

        if (id.includes('address') || id.includes('oloc')) {
          if (!data.address) data.address = text;
        } else if (id.includes('phone')) {
          if (!data.phone) data.phone = text;
        } else if (id.startsWith('authority')) {
          if (!data.website) data.website = item.href || text;
        } else if (id.includes('oh')) {
          if (!data.hours_summary) data.hours_summary = text;
        }
      }
      return data;
    })()
  `) as any;

  if (infoData) {
    result.address = infoData.address || '';
    result.phone = infoData.phone || '';
    result.website = infoData.website || '';
    result.open_hours = infoData.hours_summary || '';
  }

  // Try to expand hours by clicking the OH button
  if (!result.open_hours || result.open_hours.length < 20) {
    try {
      const ohBtn = page.locator('button[data-item-id*="oh"]').first();
      if (await ohBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await ohBtn.click();
        await page.waitForTimeout(1500);

        const hoursText = await page.evaluate(`
          (() => {
            const table = document.querySelector('table.eK4R0e, table.y0skZc, table.WgFkxc');
            if (!table) return '';
            const rows = table.querySelectorAll('tr');
            const hours = [];
            for (const row of rows) {
              const cells = row.querySelectorAll('td');
              if (cells.length >= 2) {
                hours.push(cells[0].textContent.trim() + ': ' + cells[1].textContent.trim());
              }
            }
            return hours.join(' | ');
          })()
        `) as string;

        if (hoursText) result.open_hours = hoursText;
      }
    } catch { /* ignore */ }
  }

  // Coordinates from URL
  const coords = extractCoordsFromUrl(page.url());
  result.latitude = coords.lat;
  result.longitude = coords.lng;

  // Status
  const statusText = await getText(page, 'span.ZDu9vd span');
  if (statusText.toLowerCase().includes('définitiv') || statusText.toLowerCase().includes('permanent')) {
    result.status = 'CLOSED_PERMANENTLY';
  } else {
    result.status = 'OPERATIONAL';
  }

  return result;
}

async function getText(page: Page, selector: string): Promise<string> {
  try {
    return ((await page.locator(selector).first().textContent({ timeout: 2000 })) ?? '').trim();
  } catch {
    return '';
  }
}

export function extractCoordsFromUrl(url: string): { lat: string; lng: string } {
  const match = url.match(/@(-?[\d.]+),(-?[\d.]+)/);
  return match ? { lat: match[1], lng: match[2] } : { lat: '', lng: '' };
}

export async function extractEmailsFromWebsite(page: Page, websiteUrl: string): Promise<string[]> {
  if (!websiteUrl || websiteUrl.length < 5) return [];
  try {
    const newPage = await page.context().newPage();
    await newPage.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await newPage.waitForTimeout(2000);

    const emails: string[] = await newPage.evaluate(`
      (() => {
        const text = document.body?.innerText ?? '';
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/g;
        const found = new Set();
        (text.match(emailRegex) || []).forEach(e => found.add(e.toLowerCase()));
        document.querySelectorAll('a[href^="mailto:"]').forEach(link => {
          const href = link.href.replace('mailto:', '').split('?')[0];
          if (href.includes('@')) found.add(href.toLowerCase());
        });
        return [...found].filter(e =>
          !e.includes('example.com') && !e.includes('domain.com') &&
          !e.endsWith('.png') && !e.endsWith('.jpg') && e.length < 80
        );
      })()
    `);

    await newPage.close();
    return emails;
  } catch {
    return [];
  }
}
