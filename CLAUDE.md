# SerresV2 - Plateforme de prospection serres agricoles

## Architecture
- **Frontend**: Next.js 14 (App Router) deploy sur Coolify (Hetzner 65.21.146.193)
- **BDD**: PostgreSQL sur le meme serveur (port 5433, user serres, db serresv2)
- **Coolify**: App UUID `vkwgcwc4ggco0sc8ko8wsw4k`, deploy via artisan tinker
- **Azure**: Resource group `rg-serres-scrapers`, VMs D4s_v5 France Central

## Tables principales
- `serres` / `serre_matches` : parcelles agricoles et matches entreprises
- `data_api_gouv` : donnees entreprises (nom, adresse, dirigeants, finances)
- `data_insee` : periodes historiques, NAF
- `data_google_places` : telephone, site_web, email, avis Google
- `data_pages_jaunes` : telephone[], site_web, description, SIRET, NAF, activite
- `data_bodacc` : annonces legales
- `enrichissement_batch_api` : stats enrichissement par API

## Enrichissement cascade (priorite)
Contact : PJ > Google > API Gouv > INSEE > BODACC
Le merge se fait dans `/api/batch/[id]/data/route.ts` et `/api/enrichir/batch/route.ts`

## Scraper PJ (Pages Jaunes) - Optimise

### Fichiers
- `scripts/export-pj-queries.ts` : export CSV par nom entreprise
- `scripts/export-pj-dirigeants.ts` : export CSV par nom dirigeant (pour SIRENs non trouves)
- `tools/pj-scraper/src/scraper.ts` : PlaywrightCrawler avec fallback chain
- `tools/pj-scraper/src/parser.ts` : parsing HTML (selecteurs mars 2026)
- `tools/pj-scraper/src/output.ts` : CSV output + checkpoint
- `scripts/import-pj-csv.ts` : import en BDD avec UPSERT

### Strategie de recherche (3 niveaux de fallback)
1. **Nom principal** (nom_complet ou dirigeant) + ville
2. **Noms alternatifs** (nom_raison_sociale, sigle, stripped forme juridique, noms historiques INSEE)
3. **Noms de dirigeants** (personnes physiques depuis dirigeants_complet)

### Strip forme juridique
Retire EARL, SCEA, GAEC, SARL, SAS, etc. du debut/fin
PUIS retire les mots de liaison: DES, DE, DU, DE LA, DE L', D', L'
Exemple: "EARL DES PEPINIERES GRANGE" -> "PEPINIERES GRANGE"

### Selecteurs HTML PJ (mars 2026)
- Cartes resultats: `li.bi` (id: `bi-XXXXX` ou `epj-XXXXX`)
- Nom: `a.bi-denomination` contient `h3.truncate-2-lines`
- URL detail: `data-pjlb` JSON avec `ucod:"b64u8"` = URL base64
  - `JSON.parse(data-pjlb).url` -> `atob()` -> `/pros/XXXXX`
  - Fallback: `href` si != `#`
- Detail: `h1.noTrad`, `span.coord-numero.noTrad`, `.address-container span.noTrad`
- Bouton tel: `a.hidden-phone` (click pour reveler)
- Cookie: `#didomi-notice-agree-button`

### Anti-detection PJ
- 3 tabs concurrent (degrade a 1 si bloque)
- Delays 4-6s (degrade a 8-12s)
- Rotation User-Agent
- Block images/fonts/analytics
- Cloudflare Turnstile: Playwright headless passe sans proxy depuis Azure

### Proxy
- Bright Data residential FR (si necessaire): `brd-customer-hl_712ffaf7-zone-residential_proxy1-country-fr:4ooef63xtd2i@brd.superproxy.io:33335`
- Mars 2026: compte suspendu, Playwright passe sans proxy depuis Azure

### Deploy multi-VM
1. Export CSV: `npx tsx scripts/export-pj-dirigeants.ts 1`
2. Split: `split -l CHUNK_SIZE` en N fichiers
3. Creer VMs: `az vm create --name pj-dir-N --size Standard_D4s_v5 --location francecentral`
4. Setup: Node 20 + `npx playwright install-deps chromium` + `npx playwright install chromium`
5. Upload scraper tar + CSV chunk
6. Lancer: `NO_PROXY=1 nohup npx tsx src/index.ts --input prospects.csv --output results.csv &`
7. Monitoring: `grep "Progress:" ~/pj.log | tail -1`
8. Recuperer resultats: `scp azureuser@IP:~/results.csv .`
9. Merge + import: `npx tsx scripts/import-pj-csv.ts 1 merged.csv`
10. Supprimer VMs: `az vm delete -g rg-serres-scrapers -n pj-dir-N --yes`

### Performance
- ~8 prospects/min/VM avec 3 tabs
- 13K prospects / 6 VMs = ~4-5h
- Taux de reussite: ~50-60% pour noms de dirigeants

## Scraper Google Places

### Fichiers
- `scripts/export-google-queries.ts` : genere variantes de noms
- `tools/google-scraper/` : scraper Playwright Google Maps
- `scripts/import-google-csv.ts` : import resultats

### Strategie
- Multi-name variants: nom_complet, nom_raison_sociale, stripped, sigle, historique
- Strip forme juridique + mots de liaison (DES/DE/DU...)
- Recherche "nom ville" sur Google Maps
- SIREN propage depuis l'export

### Performance precedente
- 8,775 resultats sur 16,738 (53%)
- 1,611 emails extraits
- 3 VMs D4s_v5

## Commandes utiles
```bash
# Deploy Coolify
ssh root@65.21.146.193 'docker exec coolify php artisan tinker --execute="queue_application_deployment(\App\Models\Application::where(\"uuid\",\"vkwgcwc4ggco0sc8ko8wsw4k\")->first(),\"main\"); echo \"ok\";"'

# Check enrichissement stats
ssh root@65.21.146.193 "docker exec -i serresv2-postgres psql -U serres -d serresv2 -c 'SELECT * FROM enrichissement_batch_api WHERE batch_id=1;'"

# Check data for a SIREN
ssh root@65.21.146.193 "docker exec -i serresv2-postgres psql -U serres -d serresv2 -c \"SELECT 'google',telephone,site_web,email FROM data_google_places WHERE siren='XXXXX' UNION ALL SELECT 'pj',telephone::text,site_web,NULL FROM data_pages_jaunes WHERE siren='XXXXX';\""
```
