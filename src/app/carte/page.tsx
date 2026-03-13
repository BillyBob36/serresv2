"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { Serre } from "@/lib/types";
import { CODE_CULTU_LABELS } from "@/lib/types";

const API = process.env.NEXT_PUBLIC_API_URL || "";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OSM_MIN_ZOOM = 13;

// Leaflet dynamic import (avoid SSR)
let L: typeof import("leaflet") | null = null;
let osmtogeojson: ((data: unknown) => GeoJSON.FeatureCollection) | null = null;

const CODE_COLORS: Record<string, string> = {
  CSS: "#9333ea",
  FLA: "#ec4899",
  PEP: "#16a34a",
};

/** Calcul d'aire géodésique d'un polygone GeoJSON [lng, lat] en m² */
function geodesicArea(coords: number[][]): number {
  const toRad = Math.PI / 180;
  const R = 6371000;
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const k = (i + 2) % coords.length;
    area += (coords[k][0] - coords[i][0]) * toRad * Math.sin(coords[j][1] * toRad);
  }
  return Math.abs(area * R * R / 2);
}

function buildOverpassQuery(south: number, west: number, north: number, east: number): string {
  const bbox = `${south},${west},${north},${east}`;
  return `[out:json][timeout:60];
(
  way["building"="greenhouse"](${bbox});
  relation["building"="greenhouse"](${bbox});
  way["building"="glasshouse"](${bbox});
  relation["building"="glasshouse"](${bbox});
  way["landuse"="greenhouse_horticulture"](${bbox});
  relation["landuse"="greenhouse_horticulture"](${bbox});
  way["amenity"="greenhouse"](${bbox});
  relation["amenity"="greenhouse"](${bbox});
  way["landuse"="plant_nursery"](${bbox});
  relation["landuse"="plant_nursery"](${bbox});
  way["building:use"="greenhouse"](${bbox});
  relation["building:use"="greenhouse"](${bbox});
);
out body;
>;
out skel qt;`;
}

export default function CartePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">Chargement...</div>}>
      <CarteContent />
    </Suspense>
  );
}

function CarteContent() {
  const searchParams = useSearchParams();
  const initLat = searchParams.get("lat") ? Number(searchParams.get("lat")) : null;
  const initLon = searchParams.get("lon") ? Number(searchParams.get("lon")) : null;
  const initZoom = searchParams.get("zoom") ? Number(searchParams.get("zoom")) : null;

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);
  const osmLayer = useRef<L.LayerGroup | null>(null);
  const targetMarker = useRef<L.Marker | null>(null);
  const [loading, setLoading] = useState(true);
  const [osmLoading, setOsmLoading] = useState(false);
  const [count, setCount] = useState(0);
  const [osmCount, setOsmCount] = useState(0);
  const [dept, setDept] = useState("");
  const [codeCultu, setCodeCultu] = useState("");
  const [zoomLevel, setZoomLevel] = useState(6);
  const [showRpg, setShowRpg] = useState(true);
  const [showOsm, setShowOsm] = useState(true);
  const lastOsmBbox = useRef("");

  const loadMap = useCallback(async () => {
    if (!mapRef.current) return;

    if (!L) {
      L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
    }
    if (!osmtogeojson) {
      const mod = await import("osmtogeojson");
      osmtogeojson = mod.default || mod;
    }

    if (!mapInstance.current) {
      const startLat = initLat ?? 46.5;
      const startLon = initLon ?? 2.5;
      const startZoom = initZoom ?? 6;
      mapInstance.current = L.map(mapRef.current).setView([startLat, startLon], startZoom);

      // Marqueur cible si ouvert depuis le tableau
      if (initLat && initLon) {
        const icon = L.divIcon({
          className: "",
          html: '<div style="width:18px;height:18px;border:3px solid #dc2626;border-radius:50%;background:rgba(220,38,38,0.2);"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        targetMarker.current = L.marker([initLat, initLon], { icon })
          .addTo(mapInstance.current)
          .bindPopup('<strong style="color:#dc2626">Serre ciblée</strong>')
          .openPopup();
      }
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      }).addTo(mapInstance.current);
      markersLayer.current = L.layerGroup().addTo(mapInstance.current);
      osmLayer.current = L.layerGroup().addTo(mapInstance.current);

      mapInstance.current.on("zoomend", () => {
        setZoomLevel(mapInstance.current!.getZoom());
      });
      mapInstance.current.on("moveend", () => {
        if (mapInstance.current!.getZoom() >= OSM_MIN_ZOOM) {
          loadOsmPolygons();
        }
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOsmPolygons = useCallback(async () => {
    if (!L || !osmLayer.current || !mapInstance.current || !osmtogeojson) return;
    if (mapInstance.current.getZoom() < OSM_MIN_ZOOM) return;

    const bounds = mapInstance.current.getBounds();
    const bboxKey = `${bounds.getSouth().toFixed(2)},${bounds.getWest().toFixed(2)},${bounds.getNorth().toFixed(2)},${bounds.getEast().toFixed(2)}`;
    if (bboxKey === lastOsmBbox.current) return;
    lastOsmBbox.current = bboxKey;

    setOsmLoading(true);

    try {
      const query = buildOverpassQuery(
        bounds.getSouth(), bounds.getWest(),
        bounds.getNorth(), bounds.getEast()
      );

      const resp = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);
      const json = await resp.json();
      const geojson = osmtogeojson!(json);

      let polyCount = 0;

      // Clear ancien contenu juste avant d'ajouter le nouveau (swap atomique = pas de scintillement)
      osmLayer.current!.clearLayers();

      L!.geoJSON(geojson, {
        style: (feature) => {
          const tags = feature?.properties || {};
          const isLanduse = !!(tags.landuse && !tags.building);
          if (isLanduse) {
            return { color: "#f59e0b", weight: 2, dashArray: "6 4", fillColor: "#fbbf24", fillOpacity: 0.15 };
          }
          return { color: "#059669", weight: 2, fillColor: "#10b981", fillOpacity: 0.35 };
        },
        onEachFeature: (feature, layer) => {
          if (!feature.geometry || feature.geometry.type === "Point") return;

          let areaM2 = 0;
          if (feature.geometry.type === "Polygon" && feature.geometry.coordinates[0]) {
            areaM2 = geodesicArea(feature.geometry.coordinates[0] as number[][]);
          } else if (feature.geometry.type === "MultiPolygon") {
            for (const poly of feature.geometry.coordinates) {
              areaM2 += geodesicArea((poly as number[][][])[0]);
            }
          }

          const tags = feature.properties || {};
          const isLanduse = !!(tags.landuse && !tags.building);

          // Skip les zones landuse > 5ha (pas des serres)
          if (isLanduse && areaM2 > 50000) return;

          polyCount++;

          const buildingType = tags.building || tags.landuse || "serre";
          const name = tags.name || "";
          const label = isLanduse ? "Zone" : "Serre OSM";
          const labelColor = isLanduse ? "#d97706" : "#059669";

          const surfaceStr = areaM2 >= 10000
            ? `${(areaM2 / 10000).toFixed(2)} ha (${Math.round(areaM2).toLocaleString("fr-FR")} m²)`
            : `${Math.round(areaM2).toLocaleString("fr-FR")} m²`;

          const popup = `
            <div style="font-size:13px;line-height:1.6">
              <strong style="color:${labelColor}">⌂ ${label}</strong>${name ? ` — ${name}` : ""}<br/>
              Type : ${buildingType}<br/>
              <strong>Surface : ${surfaceStr}</strong><br/>
              <span style="font-size:11px;color:#888">ID OSM : ${tags.id || feature.id || ""}</span>
            </div>
          `;
          layer.bindPopup(popup);
        },
      }).addTo(osmLayer.current!);

      setOsmCount(polyCount);
    } catch (err) {
      console.error("Erreur Overpass:", err);
    } finally {
      setOsmLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSerres = useCallback(async () => {
    if (!L || !markersLayer.current) return;

    setLoading(true);
    markersLayer.current.clearLayers();

    const params = new URLSearchParams();
    params.set("per_page", "200");
    if (dept) params.set("departement", dept);
    if (codeCultu) params.set("code_cultu", codeCultu);

    try {
      const resp = await fetch(`${API}/api/serres?${params}`);
      const json = await resp.json();
      setCount(json.total);

      for (const s of json.data as Serre[]) {
        const color = CODE_COLORS[s.code_cultu] || "#6b7280";
        // Utiliser centroïde OSM si disponible, sinon centroïde RPG parcelle
        const markerLat = s.osm_centroid_lat ? Number(s.osm_centroid_lat) : Number(s.centroid_lat);
        const markerLon = s.osm_centroid_lon ? Number(s.osm_centroid_lon) : Number(s.centroid_lon);
        const marker = L!.circleMarker(
          [markerLat, markerLon],
          {
            radius: Math.max(4, Math.min(12, Number(s.surface_ha) * 5)),
            fillColor: color,
            color: color,
            weight: 1,
            opacity: 0.8,
            fillOpacity: 0.5,
          }
        );

        const osmSurface = s.surface_osm_m2
          ? `Surf. serre OSM : <strong>${Math.round(Number(s.surface_osm_m2)).toLocaleString("fr-FR")} m²</strong><br/>`
          : "";

        const popup = `
          <div style="font-size:13px;line-height:1.5">
            <strong>${s.commune || "Commune inconnue"}</strong> (${s.departement})<br/>
            <span style="color:${color};font-weight:bold">${s.code_cultu}</span> — ${CODE_CULTU_LABELS[s.code_cultu] || ""}<br/>
            Surf. parcelle : <strong>${Number(s.surface_ha).toFixed(2)} ha</strong><br/>
            ${osmSurface}
            ${s.nom_entreprise ? `Entreprise : <strong>${s.nom_entreprise}</strong><br/>` : ""}
            ${s.dirigeant_prenom || s.dirigeant_nom ? `Dirigeant : ${s.dirigeant_prenom || ""} ${s.dirigeant_nom || ""}<br/>` : ""}
            ${s.match_confiance ? `Confiance : ${s.match_confiance} (${Number(s.distance_km).toFixed(1)} km)<br/>` : ""}
            <a href="https://www.google.com/maps?q=${s.centroid_lat},${s.centroid_lon}" target="_blank" style="color:#2563eb">Google Maps</a>
          </div>
        `;

        marker.bindPopup(popup);
        markersLayer.current!.addLayer(marker);
      }
    } catch (err) {
      console.error("Erreur chargement serres:", err);
    } finally {
      setLoading(false);
    }
  }, [dept, codeCultu]);

  useEffect(() => {
    loadMap().then(loadSerres);
    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mapInstance.current) loadSerres();
  }, [dept, codeCultu, loadSerres]);

  useEffect(() => {
    if (!markersLayer.current || !mapInstance.current) return;
    if (showRpg) markersLayer.current.addTo(mapInstance.current);
    else markersLayer.current.remove();
  }, [showRpg]);

  useEffect(() => {
    if (!osmLayer.current || !mapInstance.current) return;
    if (showOsm) osmLayer.current.addTo(mapInstance.current);
    else osmLayer.current.remove();
  }, [showOsm]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Carte des Serres
            </h1>
            <p className="text-sm text-gray-500">
              {loading
                ? "Chargement..."
                : `${count.toLocaleString("fr-FR")} serres RPG (200 max)`}
              {osmLoading && " | Chargement polygones OSM..."}
              {!osmLoading && osmCount > 0 && ` | ${osmCount} polygones OSM`}
            </p>
          </div>
          <div className="flex gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Dept</label>
              <input
                type="text"
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                placeholder="ex: 84"
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-20 text-gray-900 placeholder:text-gray-400 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select
                value={codeCultu}
                onChange={(e) => setCodeCultu(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white"
              >
                <option value="">Tous</option>
                <option value="CSS">CSS - Serre hors sol</option>
                <option value="FLA">FLA - Fleurs</option>
                <option value="PEP">PEP - Pepinieres</option>
              </select>
            </div>
            <a
              href="/"
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition text-sm font-medium"
            >
              Vue Tableau
            </a>
            <a
              href="/parametres"
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
              title="Parametres"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </a>
          </div>
        </div>
      </header>

      {/* Légende + contrôles couches */}
      <div className="absolute top-24 right-8 z-[1000] bg-white rounded-lg shadow-lg p-3 border border-gray-200">
        <p className="text-xs font-medium text-gray-500 mb-2">Couches</p>
        <label className="flex items-center gap-2 mb-1 cursor-pointer">
          <input type="checkbox" checked={showRpg} onChange={() => setShowRpg(!showRpg)} className="rounded" />
          <span className="text-xs text-gray-700 font-medium">Points RPG</span>
        </label>
        {Object.entries(CODE_COLORS).map(([code, color]) => (
          <div key={code} className="flex items-center gap-2 mb-1 ml-4">
            <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: color }} />
            <span className="text-xs text-gray-600">{code} — {CODE_CULTU_LABELS[code]}</span>
          </div>
        ))}
        <label className="flex items-center gap-2 mt-2 mb-1 cursor-pointer">
          <input type="checkbox" checked={showOsm} onChange={() => setShowOsm(!showOsm)} className="rounded" />
          <span className="text-xs text-gray-700 font-medium">Polygones OSM</span>
        </label>
        <div className="flex items-center gap-2 ml-4">
          <span className="w-3 h-3 rounded inline-block" style={{ backgroundColor: "#10b981", opacity: 0.6 }} />
          <span className="text-xs text-gray-600">Serres (contours)</span>
        </div>
      </div>

      {/* Message zoom insuffisant */}
      {zoomLevel < OSM_MIN_ZOOM && showOsm && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[1000] bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 shadow-lg">
          <p className="text-xs text-amber-700 font-medium">
            Zoomez au niveau {OSM_MIN_ZOOM}+ pour voir les contours OSM des serres (zoom actuel : {zoomLevel})
          </p>
        </div>
      )}

      {/* Carte */}
      <div
        ref={mapRef}
        className="w-full"
        style={{ height: "calc(100vh - 73px)" }}
      />
    </div>
  );
}
