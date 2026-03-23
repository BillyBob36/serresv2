/**
 * Pages Jaunes HTML parser — extracts structured data from PJ search results and detail pages.
 * Selectors verified by live inspection of pagesjaunes.fr (March 2026).
 */

import type { Page } from "playwright";

// Verified selectors from live PJ pages
const S = {
  // Search result containers
  resultList: 'li[id^="bi-bloc-"], #listResults .bi-list > li',
  resultAd: '.ad-pill',

  // Detail page
  detailName: 'h1.noTrad',
  detailPhoneRevealBtn: 'a.hidden-phone, .fantomas a.btn_primary',
  detailPhoneNumber: 'span.coord-numero.noTrad, span.coord-numero-mobile a',
  detailEmail: 'a.btn_mail',  // opens contact form, not direct mailto
  detailWebsite: '.lvs-container a.pj-lb, .premiere-visibilite a.SITE_EXTERNE',
  detailAddress: '.address-container span.noTrad',
  detailHours: 'table.liste-horaires-principaux tr',
  detailDescription: '.zone-description',
  detailSiretDl: 'dl.info-etablissement',
  detailEntrepriseDl: 'dl.info-entreprise',
  detailActivities: '.coord-rubrique a.activite, a.activite.pj-link',

  // Cookie/consent banner
  cookieBanner: '#didomi-notice-agree-button, [id*="cookie"] button, .cookie-accept, #onetrust-accept-btn-handler',
};

export interface PjSearchResult {
  name: string;
  address: string | null;
  phone: string | null;
  category: string | null;
  detailUrl: string | null;
  website: string | null;
  rating: string | null;
  reviewCount: number | null;
  isAd: boolean;
}

export interface PjDetailResult {
  raison_social: string | null;
  telephone: string[];
  email: string | null;
  site_web: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  horaires: string | null;
  note: string | null;
  nb_avis: number | null;
  description: string | null;
  siret: string | null;
  naf: string | null;
  forme_juridique: string | null;
  activites: string[];
  url_fiche: string | null;
}

/**
 * Parse search results page using string-based evaluate (avoid tsx __name issue).
 * Updated March 2026: PJ uses li.bi cards, data-pjlb is JSON with base64 URL (ucod=b64u8).
 */
export async function parseSearchResults(page: Page): Promise<PjSearchResult[]> {
  const results: PjSearchResult[] = await page.evaluate(`
    (() => {
      const results = [];
      // Updated selectors: PJ uses li.bi (bi-generic or bi-proconnu), id starts with bi- or epj-
      const cards = document.querySelectorAll('li.bi, li[id^="bi-bloc-"], li[id^="bi-"], li[id^="epj-"]');
      const seen = new Set();

      for (const card of cards) {
        // Skip ads
        if (card.querySelector('.ad-pill, .pub-container')) continue;
        // Deduplicate by card id
        if (card.id && seen.has(card.id)) continue;
        if (card.id) seen.add(card.id);

        // Name — a.bi-denomination contains an h3
        const nameEl = card.querySelector('a.bi-denomination, a.denomination-links');
        const name = nameEl?.textContent?.trim();
        if (!name) continue;

        // Detail URL — data-pjlb is JSON (NOT base64-wrapped JSON)
        // The url inside may be base64-encoded (ucod=b64u8) or a direct path
        let detailUrl = null;
        if (nameEl) {
          const pjlb = nameEl.getAttribute('data-pjlb');
          if (pjlb) {
            try {
              // data-pjlb is already JSON like {"url":"L3Byb3Mv...","ucod":"b64u8"}
              const parsed = JSON.parse(pjlb);
              if (parsed.url) {
                if (parsed.ucod === 'b64u8') {
                  // URL is base64-encoded
                  detailUrl = atob(parsed.url);
                } else {
                  detailUrl = parsed.url;
                }
              }
            } catch {
              // Fallback: maybe data-pjlb itself is base64 (old format)
              try {
                const decoded = JSON.parse(atob(pjlb));
                if (decoded.url) detailUrl = decoded.url;
              } catch {}
            }
          }
          // Fallback to href if not # or empty
          if (!detailUrl) {
            const href = nameEl.getAttribute('href') || '';
            if (href && href !== '#' && href !== '') detailUrl = href;
          }
          if (detailUrl && !detailUrl.startsWith('http')) {
            detailUrl = 'https://www.pagesjaunes.fr' + detailUrl;
          }
        }

        // Address — multiple possible selectors
        const addrEl = card.querySelector('.bi-address a, a.adresse.pj-link, a.adresse, .bi-address, .bi-adresse');
        let address = addrEl?.textContent?.trim() || null;
        // Clean up "Voir le plan" suffix
        if (address) address = address.replace(/\\s*Voir le plan\\s*/i, '').trim();

        // Phone — directly visible as strong.num on search results
        const phoneEl = card.querySelector('strong.num, .number-contact strong.num, .bi-phone strong');
        let phone = phoneEl?.textContent?.trim()?.replace(/\\s+/g, '') || null;
        if (phone && phone.length < 10) phone = null;

        // Category
        const catEl = card.querySelector('.bi-activity-unit, a.activites.pj-link, a.activites, .bi-activite');
        const category = catEl?.textContent?.trim() || null;

        // Website
        const siteEl = card.querySelector('a.track-visit-website, li.bi-site-internet a, a.pj-link[href*="website"]');
        const website = siteEl?.getAttribute('href') || null;

        // Rating
        const ratingEl = card.querySelector('.bi-note h4, .score, .note-moyenne');
        const rating = ratingEl?.textContent?.trim() || null;

        // Review count
        const reviewEl = card.querySelector('.bi-rating, .nb-reviews, .nb-avis');
        const reviewText = reviewEl?.textContent?.trim() || '';
        const reviewMatch = reviewText.match(/(\\d+)/);

        results.push({
          name,
          address,
          phone,
          category,
          detailUrl,
          website,
          rating,
          reviewCount: reviewMatch ? parseInt(reviewMatch[1], 10) : null,
          isAd: false,
        });
      }

      return results;
    })()
  `) as PjSearchResult[];

  return results;
}

/**
 * Parse detail page — clicks phone reveal button, then extracts all fields.
 * Selectors verified on live PJ detail pages (March 2026).
 */
export async function parseDetailPage(page: Page, url: string): Promise<PjDetailResult> {
  // Click "Afficher le numero" button to reveal phone
  try {
    const phoneBtn = page.locator('a.hidden-phone, .fantomas a.btn_primary').first();
    if (await phoneBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await phoneBtn.click();
      await page.waitForTimeout(2000); // wait for AJAX phone reveal
    }
  } catch { /* ignore */ }

  // Click "Voir plus de coordonnees" if present
  try {
    const moreBtn = page.locator('.more-coord button').first();
    if (await moreBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await moreBtn.click();
      await page.waitForTimeout(1000);
    }
  } catch { /* ignore */ }

  const escapedUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const result: PjDetailResult = await page.evaluate(`
    (() => {
      const pageUrl = "${escapedUrl}";

      // Name
      const nameEl = document.querySelector('h1.noTrad');
      const raison_social = nameEl?.textContent?.trim() || null;

      // Phone — after reveal click, number appears in span.coord-numero
      const phones = [];
      document.querySelectorAll('span.coord-numero.noTrad, span.coord-numero-mobile a').forEach(el => {
        let t = el.textContent?.trim()?.replace(/\\s+/g, '');
        if (!t) {
          // Try href for mobile tel: links
          const href = el.getAttribute('href') || '';
          if (href.startsWith('tel:')) t = href.replace('tel:', '').replace(/\\s+/g, '');
        }
        if (t && t.length >= 10 && !phones.includes(t)) phones.push(t);
      });

      // Also check strong.num fallback
      if (phones.length === 0) {
        document.querySelectorAll('strong.num').forEach(el => {
          const t = el.textContent?.trim()?.replace(/\\s+/g, '');
          if (t && t.length >= 10 && !phones.includes(t)) phones.push(t);
        });
      }

      // Address — single string in span.noTrad inside .address-container
      const addrEl = document.querySelector('.address-container span.noTrad');
      const fullAddress = addrEl?.textContent?.trim() || null;

      // Parse code postal and ville from address string (e.g. "7 rue Breafort 56870 Baden")
      let code_postal = null;
      let ville = null;
      if (fullAddress) {
        const cpMatch = fullAddress.match(/(\\d{5})\\s+(.+)$/);
        if (cpMatch) {
          code_postal = cpMatch[1];
          ville = cpMatch[2].trim();
        }
      }

      // Website
      let site_web = null;
      const siteEl = document.querySelector('.lvs-container a.pj-lb, .premiere-visibilite a.SITE_EXTERNE');
      if (siteEl) {
        const href = siteEl.getAttribute('href') || '';
        if (href.includes('redirect')) {
          try {
            const u = new URL(href);
            site_web = u.searchParams.get('url') || href;
          } catch { site_web = href; }
        } else if (href.startsWith('http')) {
          site_web = href;
        } else {
          // Sometimes text content has the URL
          site_web = siteEl.textContent?.trim() || null;
        }
      }

      // Email — PJ uses a contact form button, not direct mailto
      let email = null;
      const mailtoEl = document.querySelector('a[href^="mailto:"]');
      if (mailtoEl) {
        email = mailtoEl.getAttribute('href').replace('mailto:', '').split('?')[0];
      }

      // Hours — from table.liste-horaires-principaux
      const hoursLines = [];
      document.querySelectorAll('table.liste-horaires-principaux tr').forEach(row => {
        const cells = row.querySelectorAll('td, th');
        if (cells.length >= 2) {
          const day = cells[0].textContent?.trim();
          const time = cells[1].textContent?.trim()?.replace(/\\s+/g, ' ');
          if (day && time) hoursLines.push(day + ' ' + time);
        } else {
          const t = row.textContent?.trim()?.replace(/\\s+/g, ' ');
          if (t) hoursLines.push(t);
        }
      });

      // Description
      const descEl = document.querySelector('.zone-description');
      const description = descEl?.textContent?.trim() || null;

      // SIRET and NAF from dl.info-etablissement
      let siret = null;
      let naf = null;
      const etablDl = document.querySelector('dl.info-etablissement');
      if (etablDl) {
        const dts = etablDl.querySelectorAll('dt');
        const dds = etablDl.querySelectorAll('dd');
        for (let i = 0; i < dts.length; i++) {
          const label = dts[i].textContent?.trim()?.toUpperCase() || '';
          const value = dds[i]?.textContent?.trim() || '';
          if (label.includes('SIRET')) siret = value.replace(/\\s/g, '');
          if (label.includes('NAF')) naf = value.replace(/\\s/g, '');
        }
      }

      // Forme juridique from dl.info-entreprise
      let forme_juridique = null;
      const entrDl = document.querySelector('dl.info-entreprise');
      if (entrDl) {
        const dts = entrDl.querySelectorAll('dt');
        const dds = entrDl.querySelectorAll('dd');
        for (let i = 0; i < dts.length; i++) {
          const label = dts[i].textContent?.trim()?.toUpperCase() || '';
          const value = dds[i]?.textContent?.trim() || '';
          if (label.includes('FORME')) forme_juridique = value;
        }
      }

      // Activities
      const activities = [];
      document.querySelectorAll('.coord-rubrique a.activite, a.activite.pj-link').forEach(el => {
        const t = el.textContent?.trim();
        if (t && !activities.includes(t)) activities.push(t);
      });

      // Rating
      const ratingEl = document.querySelector('.bi-note h4, .score, .note-moyenne');
      const note = ratingEl?.textContent?.trim() || null;

      const reviewEl = document.querySelector('.bi-rating, .nb-reviews, .nb-avis');
      const reviewText = reviewEl?.textContent?.trim() || '';
      const reviewMatch = reviewText.match(/(\\d+)/);
      const nb_avis = reviewMatch ? parseInt(reviewMatch[1], 10) : null;

      return {
        raison_social,
        telephone: phones,
        email,
        site_web,
        adresse: fullAddress,
        code_postal,
        ville,
        horaires: hoursLines.length > 0 ? hoursLines.join(' | ') : null,
        note,
        nb_avis,
        description,
        siret,
        naf,
        forme_juridique,
        activites: activities,
        url_fiche: pageUrl,
      };
    })()
  `) as PjDetailResult;

  return result;
}

export { S as SELECTORS };
