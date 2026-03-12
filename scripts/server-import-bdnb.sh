#!/bin/bash
# =============================================================
# Import BDNB serres — tourne directement sur le serveur Coolify
#
# Usage (sur le serveur) :
#   bash /root/import-bdnb.sh              # France entiere
#   bash /root/import-bdnb.sh 84           # Un seul dept
#   bash /root/import-bdnb.sh 30 50        # Dept 30 a 50
#
# Pre-requis : Docker + unzip + acces internet
# Espace disque : ~500 Mo temporaire
# Duree estimee : ~2-4h pour la France entiere
# =============================================================

set -e

# Config
DB_HOST="10.0.0.4"
DB_PORT="5432"
DB_NAME="serresv2"
DB_USER="serres"
DB_PASS="SerresV2_2024"
BDNB_MILLESIME="2025-07-a"
BDNB_BASE="https://open-data.s3.fr-par.scw.cloud/bdnb_millesime_${BDNB_MILLESIME}"

# Departements
ALL_DEPTS="01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 21 22 23 24 25 26 27 28 29 2A 2B 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 67 68 69 70 71 72 73 74 75 76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91 92 93 94 95"

if [ -n "$1" ] && [ -z "$2" ]; then
  DEPTS="$1"
elif [ -n "$1" ] && [ -n "$2" ]; then
  DEPTS=""
  IN_RANGE=0
  for d in $ALL_DEPTS; do
    [ "$d" = "$1" ] && IN_RANGE=1
    [ $IN_RANGE -eq 1 ] && DEPTS="$DEPTS $d"
    [ "$d" = "$2" ] && break
  done
else
  DEPTS="$ALL_DEPTS"
fi

echo "================================================"
echo "  Import BDNB Serres - Serveur Coolify"
echo "================================================"
echo "Departements: $(echo $DEPTS | wc -w)"
echo ""

# Creer la table si necessaire
docker run --rm --network bridge \
  -e PGPASSWORD="$DB_PASS" \
  postgres:17-alpine \
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
CREATE TABLE IF NOT EXISTS bdnb_serres (
  batiment_groupe_id TEXT PRIMARY KEY,
  code_departement TEXT NOT NULL,
  commune TEXT,
  code_commune_insee TEXT,
  centroid_lat DOUBLE PRECISION,
  centroid_lon DOUBLE PRECISION,
  surface_m2 DOUBLE PRECISION,
  nature TEXT,
  usage_1 TEXT,
  usage_2 TEXT,
  etat TEXT,
  hauteur_moy REAL,
  hauteur_max REAL,
  altitude_sol REAL,
  parcelle_id TEXT,
  proprietaire_siren TEXT,
  proprietaire_denomination TEXT,
  proprietaire_forme_juridique TEXT,
  adresse TEXT,
  serre_rpg_id INTEGER,
  distance_rpg_m DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bdnb_serres_dept ON bdnb_serres(code_departement);
CREATE INDEX IF NOT EXISTS idx_bdnb_serres_coords ON bdnb_serres(centroid_lat, centroid_lon);
CREATE INDEX IF NOT EXISTS idx_bdnb_serres_siren ON bdnb_serres(proprietaire_siren) WHERE proprietaire_siren IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bdnb_serres_rpg ON bdnb_serres(serre_rpg_id) WHERE serre_rpg_id IS NOT NULL;
" 2>&1 | tail -1

echo "Table bdnb_serres OK"

TOTAL_SERRES=0
TOTAL_SIREN=0
COUNT=0
NB_DEPTS=$(echo $DEPTS | wc -w)

WORK_DIR="/tmp/bdnb_import"
mkdir -p "$WORK_DIR"

# Ecrire le script Python sur le disque (evite les problemes d'echappement heredoc)
cat > "${WORK_DIR}/process.py" << 'PYEND'
import csv, math, os, sys, re

def lambert93_to_wgs84(x, y):
    n = 0.7256077650
    C = 11754255.426
    xs = 700000
    ys = 12655612.0499
    e = 0.0818191910428
    lon0 = 0.0523598775598
    dx = x - xs
    dy = ys - y
    R = math.sqrt(dx*dx + dy*dy)
    gamma = math.atan2(dx, dy)
    latIso = -math.log(R / C) / n
    lon = gamma / n + lon0
    lat = 2 * math.atan(math.exp(latIso)) - math.pi / 2
    for _ in range(10):
        eSin = e * math.sin(lat)
        lat = 2 * math.atan(math.exp(latIso) * ((1+eSin)/(1-eSin))**(e/2)) - math.pi / 2
    return round(lat * 180 / math.pi, 6), round(lon * 180 / math.pi, 6)

def clean(s):
    s = s.strip().strip('"')
    s = s.replace('[ "', '').replace('" ]', '').replace('""', '')
    s = s.replace('[', '').replace(']', '').replace('"', '')
    return s.strip().strip(',').strip()

def centroid_from_wkt(wkt):
    coords = re.findall(r'([\d.]+)\s+([\d.]+)', wkt)
    if not coords:
        return None, None
    xs = [float(c[0]) for c in coords]
    ys = [float(c[1]) for c in coords]
    return sum(xs)/len(xs), sum(ys)/len(ys)

def safe_float(v):
    try:
        return float(v)
    except (ValueError, TypeError):
        return None

dept = os.environ['DEPT']

# Load bdtopo (serres)
serres = {}
with open('/data/bdtopo.csv') as f:
    reader = csv.reader(f, delimiter=';')
    for row in reader:
        if len(row) < 2:
            continue
        bid = clean(row[0])
        serres[bid] = {
            'id': bid, 'dept': dept,
            'nature': clean(row[2]) if len(row) > 2 else '',
            'usage_1': clean(row[3]) if len(row) > 3 else '',
            'usage_2': clean(row[4]) if len(row) > 4 else '',
            'etat': clean(row[5]) if len(row) > 5 else '',
            'h_moy': row[6].strip() if len(row) > 6 and row[6].strip() else None,
            'h_max': row[7].strip() if len(row) > 7 and row[7].strip() else None,
            'alt': row[8].strip() if len(row) > 8 and row[8].strip() else None,
            'lat': None, 'lon': None, 'surface': None,
            'commune': None, 'code_commune': None,
            'parcelle': None, 'siren': None, 'denom': None, 'forme': None, 'adresse': None
        }

print(f'  Serres chargees: {len(serres)}')

# Load geometrie
with open('/data/geom.csv') as f:
    reader = csv.reader(f, delimiter=';')
    for row in reader:
        if len(row) < 2:
            continue
        bid = clean(row[1])
        if bid in serres:
            wkt = row[0]
            x, y = centroid_from_wkt(wkt)
            if x and y:
                lat, lon = lambert93_to_wgs84(x, y)
                serres[bid]['lat'] = lat
                serres[bid]['lon'] = lon
            serres[bid]['surface'] = row[3].strip() if len(row) > 3 and row[3].strip() else None
            serres[bid]['commune'] = clean(row[6]) if len(row) > 6 else None
            serres[bid]['code_commune'] = clean(row[5]) if len(row) > 5 else None

# Load parcelles
with open('/data/parcelles.csv') as f:
    reader = csv.reader(f, delimiter=';')
    for row in reader:
        if len(row) < 2:
            continue
        bid = clean(row[0])
        if bid in serres:
            serres[bid]['parcelle'] = clean(row[1])

# Load proprietaires relation
personne_to_bat = {}
with open('/data/rel_prop.csv') as f:
    reader = csv.reader(f, delimiter=';')
    for row in reader:
        if len(row) < 2:
            continue
        bid = clean(row[0])
        pid = clean(row[1])
        if bid in serres:
            personne_to_bat[pid] = bid

# Load proprietaires details
with open('/data/proprio.csv') as f:
    reader = csv.reader(f, delimiter=';')
    for row in reader:
        if len(row) < 2:
            continue
        pid = clean(row[0])
        if pid in personne_to_bat:
            bid = personne_to_bat[pid]
            if bid in serres:
                serres[bid]['siren'] = clean(row[1]) if len(row) > 1 and clean(row[1]) else None
                serres[bid]['forme'] = clean(row[3]) if len(row) > 3 and clean(row[3]) else None
                serres[bid]['denom'] = clean(row[4]) if len(row) > 4 and clean(row[4]) else None

# Load adresses
with open('/data/adresses.csv') as f:
    reader = csv.reader(f, delimiter=';')
    for row in reader:
        if len(row) < 4:
            continue
        bid = clean(row[0])
        if bid in serres:
            serres[bid]['adresse'] = clean(row[3])

# Insert into PostgreSQL
import psycopg2
conn = psycopg2.connect(
    host=os.environ['DB_HOST'], port=os.environ['DB_PORT'],
    dbname=os.environ['DB_NAME'], user=os.environ['DB_USER'],
    password=os.environ['PGPASSWORD']
)
cur = conn.cursor()

inserted = 0
with_siren = 0
for s in serres.values():
    if not s['lat'] or not s['lon']:
        continue
    cur.execute(
        'INSERT INTO bdnb_serres ('
        '  batiment_groupe_id, code_departement, commune, code_commune_insee,'
        '  centroid_lat, centroid_lon, surface_m2, nature, usage_1, usage_2,'
        '  etat, hauteur_moy, hauteur_max, altitude_sol, parcelle_id,'
        '  proprietaire_siren, proprietaire_denomination, proprietaire_forme_juridique,'
        '  adresse'
        ') VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)'
        ' ON CONFLICT (batiment_groupe_id) DO UPDATE SET'
        '  commune=EXCLUDED.commune, centroid_lat=EXCLUDED.centroid_lat,'
        '  centroid_lon=EXCLUDED.centroid_lon, surface_m2=EXCLUDED.surface_m2,'
        '  nature=EXCLUDED.nature, proprietaire_siren=EXCLUDED.proprietaire_siren,'
        '  proprietaire_denomination=EXCLUDED.proprietaire_denomination,'
        '  adresse=EXCLUDED.adresse',
        (
            s['id'], s['dept'], s['commune'], s['code_commune'],
            s['lat'], s['lon'], safe_float(s['surface']),
            s['nature'], s['usage_1'], s['usage_2'],
            s['etat'],
            safe_float(s['h_moy']),
            safe_float(s['h_max']),
            safe_float(s['alt']),
            s['parcelle'], s['siren'], s['denom'], s['forme'], s['adresse']
        )
    )
    inserted += 1
    if s['siren']:
        with_siren += 1

conn.commit()
cur.close()
conn.close()

print(f'  Inserees: {inserted} ({with_siren} avec SIREN)')
PYEND

echo "Script Python ecrit dans ${WORK_DIR}/process.py"

for DEPT in $DEPTS; do
  COUNT=$((COUNT + 1))
  echo ""
  echo "=== Dept $DEPT [$COUNT/$NB_DEPTS] ==="

  ZIP_URL="${BDNB_BASE}/millesime_${BDNB_MILLESIME}_dep${DEPT}/open_data_millesime_${BDNB_MILLESIME}_dep${DEPT}_csv.zip"
  ZIP_FILE="${WORK_DIR}/dep${DEPT}.zip"

  # 1. Telecharger
  echo "  Telechargement..."
  if ! curl -sS -f -o "$ZIP_FILE" "$ZIP_URL" 2>/dev/null; then
    echo "  SKIP - Erreur telechargement (HTTP error)"
    rm -f "$ZIP_FILE"
    continue
  fi
  SIZE_MB=$(du -m "$ZIP_FILE" | cut -f1)
  echo "  ${SIZE_MB} Mo telecharges"

  # 2. Extraire les serres (batiments tagges "Serre" dans bdtopo_bat)
  echo "  Extraction des serres..."

  # IDs des batiments-serres
  unzip -p "$ZIP_FILE" csv/batiment_groupe_bdtopo_bat.csv 2>/dev/null \
    | awk -F';' 'NR>1 && /Serre/' \
    | cut -d';' -f1 \
    | tr -d '"' \
    | sort -u > "${WORK_DIR}/serre_ids.txt"

  NB_SERRES=$(wc -l < "${WORK_DIR}/serre_ids.txt")
  echo "  ${NB_SERRES} batiments-serres trouves"

  if [ "$NB_SERRES" -eq 0 ]; then
    rm -f "$ZIP_FILE"
    echo "  Aucune serre, skip"
    continue
  fi

  # 3. Extraire les donnees de chaque serre
  echo "  Lecture bdtopo_bat..."
  unzip -p "$ZIP_FILE" csv/batiment_groupe_bdtopo_bat.csv 2>/dev/null \
    | awk -F';' 'NR>1 && /Serre/' \
    > "${WORK_DIR}/bdtopo.csv"

  echo "  Lecture batiment_groupe..."
  unzip -p "$ZIP_FILE" csv/batiment_groupe.csv 2>/dev/null \
    | grep -F -f "${WORK_DIR}/serre_ids.txt" \
    > "${WORK_DIR}/geom.csv"

  echo "  Lecture parcelles..."
  unzip -p "$ZIP_FILE" csv/rel_batiment_groupe_parcelle.csv 2>/dev/null \
    | grep -F -f "${WORK_DIR}/serre_ids.txt" \
    > "${WORK_DIR}/parcelles.csv"

  echo "  Lecture proprietaires..."
  unzip -p "$ZIP_FILE" csv/rel_batiment_groupe_proprietaire.csv 2>/dev/null \
    | grep -F -f "${WORK_DIR}/serre_ids.txt" \
    > "${WORK_DIR}/rel_prop.csv"

  # Extraire les personne_ids des proprietaires de serres
  if [ -s "${WORK_DIR}/rel_prop.csv" ]; then
    cut -d';' -f2 "${WORK_DIR}/rel_prop.csv" | tr -d '"' | sort -u > "${WORK_DIR}/personne_ids.txt"
  else
    > "${WORK_DIR}/personne_ids.txt"
  fi

  # Proprietaires (details)
  if [ -s "${WORK_DIR}/personne_ids.txt" ]; then
    unzip -p "$ZIP_FILE" csv/proprietaire.csv 2>/dev/null \
      | grep -F -f "${WORK_DIR}/personne_ids.txt" \
      > "${WORK_DIR}/proprio.csv"
  else
    > "${WORK_DIR}/proprio.csv"
  fi

  # Adresses
  echo "  Lecture adresses..."
  unzip -p "$ZIP_FILE" csv/batiment_groupe_adresse.csv 2>/dev/null \
    | grep -F -f "${WORK_DIR}/serre_ids.txt" \
    > "${WORK_DIR}/adresses.csv"

  # 4. Lancer le script Python dans un container
  echo "  Insertion en BDD..."

  docker run --rm --network bridge \
    -v "${WORK_DIR}:/data" \
    -e DB_HOST="$DB_HOST" \
    -e DB_PORT="$DB_PORT" \
    -e DB_NAME="$DB_NAME" \
    -e DB_USER="$DB_USER" \
    -e PGPASSWORD="$DB_PASS" \
    -e DEPT="$DEPT" \
    python:3.12-slim bash -c 'pip install -q psycopg2-binary 2>/dev/null && python3 /data/process.py'

  DEPT_SERRES=$(docker run --rm --network bridge \
    -e PGPASSWORD="$DB_PASS" \
    postgres:17-alpine \
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
    "SELECT COUNT(*) FROM bdnb_serres WHERE code_departement = '$DEPT'")
  DEPT_SERRES=$(echo $DEPT_SERRES | tr -d ' ')
  TOTAL_SERRES=$((TOTAL_SERRES + DEPT_SERRES))

  echo "  OK dept $DEPT : $DEPT_SERRES serres en BDD"

  # 5. Supprimer le ZIP et les fichiers temporaires
  rm -f "$ZIP_FILE"
  rm -f ${WORK_DIR}/*.csv ${WORK_DIR}/*.txt
  echo "  Nettoyage OK"
done

# Matching BDNB <-> RPG
echo ""
echo "=== Matching BDNB <-> serres RPG ==="
docker run --rm --network bridge \
  -e PGPASSWORD="$DB_PASS" \
  postgres:17-alpine \
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
UPDATE bdnb_serres b
SET serre_rpg_id = sub.serre_id,
    distance_rpg_m = sub.dist_m
FROM (
  SELECT DISTINCT ON (b2.batiment_groupe_id)
    b2.batiment_groupe_id,
    s.id as serre_id,
    (6371000 * acos(
      LEAST(1.0,
        cos(radians(b2.centroid_lat)) * cos(radians(s.centroid_lat)) *
        cos(radians(s.centroid_lon) - radians(b2.centroid_lon)) +
        sin(radians(b2.centroid_lat)) * sin(radians(s.centroid_lat))
      )
    )) as dist_m
  FROM bdnb_serres b2
  CROSS JOIN LATERAL (
    SELECT id, centroid_lat, centroid_lon
    FROM serres s
    WHERE s.departement = b2.code_departement
      AND ABS(s.centroid_lat - b2.centroid_lat) < 0.003
      AND ABS(s.centroid_lon - b2.centroid_lon) < 0.003
    ORDER BY (
      (s.centroid_lat - b2.centroid_lat) * (s.centroid_lat - b2.centroid_lat) +
      (s.centroid_lon - b2.centroid_lon) * (s.centroid_lon - b2.centroid_lon)
    )
    LIMIT 1
  ) s
  WHERE b2.serre_rpg_id IS NULL
) sub
WHERE b.batiment_groupe_id = sub.batiment_groupe_id
  AND sub.dist_m < 200;
"

# Stats finales
echo ""
echo "================================================"
echo "  RESUME FINAL"
echo "================================================"
docker run --rm --network bridge \
  -e PGPASSWORD="$DB_PASS" \
  postgres:17-alpine \
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
SELECT
  COUNT(*) as total_bdnb,
  COUNT(serre_rpg_id) as matchees_rpg,
  COUNT(*) FILTER (WHERE proprietaire_siren IS NOT NULL) as avec_siren,
  COUNT(*) FILTER (WHERE proprietaire_siren IS NOT NULL AND serre_rpg_id IS NOT NULL) as siren_et_match
FROM bdnb_serres;
"

echo ""
echo "Top 10 departements:"
docker run --rm --network bridge \
  -e PGPASSWORD="$DB_PASS" \
  postgres:17-alpine \
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
SELECT code_departement as dept, COUNT(*) as nb_serres
FROM bdnb_serres
GROUP BY code_departement
ORDER BY nb_serres DESC
LIMIT 10;
"

echo ""
echo "Termine !"
