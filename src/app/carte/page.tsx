"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Serre } from "@/lib/types";
import { CODE_CULTU_LABELS } from "@/lib/types";

const API = process.env.NEXT_PUBLIC_API_URL || "";

// Leaflet dynamic import (avoid SSR)
let L: typeof import("leaflet") | null = null;

const CODE_COLORS: Record<string, string> = {
  CSS: "#9333ea",
  FLA: "#ec4899",
  PEP: "#16a34a",
};

export default function CartePage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const [dept, setDept] = useState("");
  const [codeCultu, setCodeCultu] = useState("");

  const loadMap = useCallback(async () => {
    if (!mapRef.current) return;

    // Dynamic import Leaflet
    if (!L) {
      L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
    }

    // Créer la carte si elle n'existe pas
    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current).setView([46.5, 2.5], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 18,
      }).addTo(mapInstance.current);
      markersLayer.current = L.layerGroup().addTo(mapInstance.current);
    }
  }, []);

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
        const marker = L!.circleMarker(
          [Number(s.centroid_lat), Number(s.centroid_lon)],
          {
            radius: Math.max(4, Math.min(12, Number(s.surface_ha) * 5)),
            fillColor: color,
            color: color,
            weight: 1,
            opacity: 0.8,
            fillOpacity: 0.5,
          }
        );

        const popup = `
          <div style="font-size:13px;line-height:1.5">
            <strong>${s.commune || "Commune inconnue"}</strong> (${s.departement})<br/>
            <span style="color:${color};font-weight:bold">${s.code_cultu}</span> — ${CODE_CULTU_LABELS[s.code_cultu] || ""}<br/>
            Surface : <strong>${Number(s.surface_ha).toFixed(2)} ha</strong><br/>
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
    // cleanup
    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mapInstance.current) {
      loadSerres();
    }
  }, [dept, codeCultu, loadSerres]);

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
                : `${count.toLocaleString("fr-FR")} serres (200 affichees max)`}
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

      {/* Légende */}
      <div className="absolute top-24 right-8 z-[1000] bg-white rounded-lg shadow-lg p-3 border border-gray-200">
        <p className="text-xs font-medium text-gray-500 mb-2">Legende</p>
        {Object.entries(CODE_COLORS).map(([code, color]) => (
          <div key={code} className="flex items-center gap-2 mb-1">
            <span
              className="w-3 h-3 rounded-full inline-block"
              style={{ backgroundColor: color }}
            />
            <span className="text-xs text-gray-700">
              {code} — {CODE_CULTU_LABELS[code]}
            </span>
          </div>
        ))}
      </div>

      {/* Carte */}
      <div
        ref={mapRef}
        className="w-full"
        style={{ height: "calc(100vh - 73px)" }}
      />
    </div>
  );
}
