"use client";

import { useState, useEffect, useCallback } from "react";
import type { Serre, SerresResponse, Stats } from "@/lib/types";
import { CODE_CULTU_LABELS } from "@/lib/types";

const API = process.env.NEXT_PUBLIC_API_URL || "";

export default function Home() {
  const [data, setData] = useState<Serre[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filtres
  const [departement, setDepartement] = useState("");
  const [codeCultu, setCodeCultu] = useState("");
  const [surfaceMin, setSurfaceMin] = useState("");
  const [surfaceMax, setSurfaceMax] = useState("");
  const [avecEntreprise, setAvecEntreprise] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("surface_ha");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [showBdnb, setShowBdnb] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("per_page", "50");
    params.set("sort_by", sortBy);
    params.set("sort_order", sortOrder);
    if (departement) params.set("departement", departement);
    if (codeCultu) params.set("code_cultu", codeCultu);
    if (surfaceMin) params.set("surface_min", surfaceMin);
    if (surfaceMax) params.set("surface_max", surfaceMax);
    if (avecEntreprise) params.set("avec_entreprise", "true");
    if (search) params.set("search", search);

    try {
      const resp = await fetch(`${API}/api/serres?${params}`);
      const json: SerresResponse = await resp.json();
      setData(json.data);
      setTotal(json.total);
      setTotalPages(json.total_pages);
    } catch (err) {
      console.error("Erreur:", err);
    } finally {
      setLoading(false);
    }
  }, [
    page,
    departement,
    codeCultu,
    surfaceMin,
    surfaceMax,
    avecEntreprise,
    search,
    sortBy,
    sortOrder,
  ]);

  const fetchStats = useCallback(async () => {
    try {
      const resp = await fetch(`${API}/api/stats`);
      const json = await resp.json();
      setStats(json);
    } catch (err) {
      console.error("Erreur stats:", err);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortOrder("asc");
    }
    setPage(1);
  };

  const resetFilters = () => {
    setDepartement("");
    setCodeCultu("");
    setSurfaceMin("");
    setSurfaceMax("");
    setAvecEntreprise(false);
    setSearch("");
    setPage(1);
  };

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (departement) params.set("departement", departement);
    if (codeCultu) params.set("code_cultu", codeCultu);
    if (avecEntreprise) params.set("avec_entreprise", "true");
    window.open(`${API}/api/export?${params}`, "_blank");
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return <span className="text-gray-300 ml-1">{"\u21C5"}</span>;
    return (
      <span className="text-blue-500 ml-1">
        {sortOrder === "asc" ? "\u2191" : "\u2193"}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Serres France
            </h1>
            <p className="text-sm text-gray-500">
              Parcelles agricoles sous serre — Registre Parcellaire Graphique{" "}
              {new Date().getFullYear()}
            </p>
          </div>
          <div className="flex gap-3">
            <a
              href="/carte"
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-medium"
            >
              Vue Carte
            </a>
            <button
              onClick={exportCsv}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
            >
              Export CSV
            </button>
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

      <div className="max-w-[1600px] mx-auto px-6 py-6">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl p-4 border border-gray-200">
              <p className="text-sm text-gray-500">Total serres</p>
              <p className="text-2xl font-bold text-gray-900">
                {Number(stats.total_serres).toLocaleString("fr-FR")}
              </p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200">
              <p className="text-sm text-gray-500">Avec entreprise</p>
              <p className="text-2xl font-bold text-green-600">
                {Number(stats.total_matchees).toLocaleString("fr-FR")}
              </p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200">
              <p className="text-sm text-gray-500">Departements</p>
              <p className="text-2xl font-bold text-gray-900">
                {stats.departements}
              </p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200">
              <p className="text-sm text-gray-500">Surface totale</p>
              <p className="text-2xl font-bold text-gray-900">
                {Number(stats.surface_totale_ha).toLocaleString("fr-FR")} ha
              </p>
            </div>
          </div>
        )}

        {/* Filtres */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Recherche
              </label>
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Commune, entreprise, dirigeant..."
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64 text-gray-900 placeholder:text-gray-400 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Departement
              </label>
              <input
                type="text"
                value={departement}
                onChange={(e) => {
                  setDepartement(e.target.value);
                  setPage(1);
                }}
                placeholder="ex: 84"
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-20 text-gray-900 placeholder:text-gray-400 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Type culture
              </label>
              <select
                value={codeCultu}
                onChange={(e) => {
                  setCodeCultu(e.target.value);
                  setPage(1);
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white"
              >
                <option value="">Tous</option>
                <option value="CSS">CSS - Serre hors sol</option>
                <option value="FLA">FLA - Fleurs/aromatiques</option>
                <option value="PEP">PEP - Pepinieres</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Surface min (ha)
              </label>
              <input
                type="number"
                step="0.01"
                value={surfaceMin}
                onChange={(e) => {
                  setSurfaceMin(e.target.value);
                  setPage(1);
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-24 text-gray-900 placeholder:text-gray-400 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Surface max (ha)
              </label>
              <input
                type="number"
                step="0.01"
                value={surfaceMax}
                onChange={(e) => {
                  setSurfaceMax(e.target.value);
                  setPage(1);
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-24 text-gray-900 placeholder:text-gray-400 bg-white"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={avecEntreprise}
                onChange={(e) => {
                  setAvecEntreprise(e.target.checked);
                  setPage(1);
                }}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700">Avec entreprise</span>
            </label>
            <button
              onClick={resetFilters}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Compteur résultats */}
        <div className="flex justify-between items-center mb-3">
          <p className="text-sm text-gray-500">
            {total.toLocaleString("fr-FR")} resultat(s) — page {page}/
            {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="px-3 py-1 text-sm border rounded-lg disabled:opacity-30"
            >
              Precedent
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 text-sm border rounded-lg disabled:opacity-30"
            >
              Suivant
            </button>
          </div>
        </div>

        {/* Tableau */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {[
                    { key: "departement", label: "Dept" },
                    { key: "commune", label: "Commune" },
                    { key: "code_cultu", label: "Type" },
                    { key: "surface_ha", label: "Surface (ha)" },
                    { key: "nom_entreprise", label: "Entreprise" },
                    { key: "dirigeant_nom", label: "Dirigeant" },
                  ].map(({ key, label }) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none"
                    >
                      {label}
                      <SortIcon col={key} />
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Confiance
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Coords
                  </th>
                  {/* BDNB - colonnes rétractables */}
                  <th
                    onClick={() => setShowBdnb(!showBdnb)}
                    className="px-3 py-3 text-left font-medium text-indigo-600 cursor-pointer hover:text-indigo-800 select-none border-l border-gray-200 bg-indigo-50/50 whitespace-nowrap"
                    title={showBdnb ? "Replier les colonnes BDNB" : "Deployer les colonnes BDNB"}
                  >
                    {showBdnb ? "\u25BC" : "\u25B6"} BDNB
                  </th>
                  {showBdnb && (
                    <>
                      <th className="px-3 py-3 text-left font-medium text-indigo-500 text-xs bg-indigo-50/30 whitespace-nowrap">Proprio BDNB</th>
                      <th className="px-3 py-3 text-left font-medium text-indigo-500 text-xs bg-indigo-50/30 whitespace-nowrap">SIREN proprio</th>
                      <th className="px-3 py-3 text-left font-medium text-indigo-500 text-xs bg-indigo-50/30 whitespace-nowrap">Surface (m2)</th>
                      <th className="px-3 py-3 text-left font-medium text-indigo-500 text-xs bg-indigo-50/30 whitespace-nowrap">Hauteur</th>
                      <th className="px-3 py-3 text-left font-medium text-indigo-500 text-xs bg-indigo-50/30 whitespace-nowrap">Parcelle cad.</th>
                      <th className="px-3 py-3 text-left font-medium text-indigo-500 text-xs bg-indigo-50/30 whitespace-nowrap">Adresse</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={showBdnb ? 15 : 9} className="px-4 py-8 text-center text-gray-400">
                      Chargement...
                    </td>
                  </tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={showBdnb ? 15 : 9} className="px-4 py-8 text-center text-gray-400">
                      Aucun resultat
                    </td>
                  </tr>
                ) : (
                  data.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-gray-100 hover:bg-blue-50/30 transition"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {s.departement || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {s.commune || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            s.code_cultu === "CSS"
                              ? "bg-purple-100 text-purple-700"
                              : s.code_cultu === "FLA"
                                ? "bg-pink-100 text-pink-700"
                                : "bg-green-100 text-green-700"
                          }`}
                          title={CODE_CULTU_LABELS[s.code_cultu] || s.code_cultu}
                        >
                          {s.code_cultu}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 font-mono">
                        {Number(s.surface_ha).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {s.nom_entreprise ? (
                          <span className="font-medium">{s.nom_entreprise}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {s.dirigeant_prenom || s.dirigeant_nom ? (
                          <span>
                            {s.dirigeant_prenom} {s.dirigeant_nom}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {s.match_confiance ? (
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                              s.match_confiance === "haute"
                                ? "bg-green-100 text-green-700"
                                : s.match_confiance === "moyenne"
                                  ? "bg-yellow-100 text-yellow-700"
                                  : "bg-red-100 text-red-700"
                            }`}
                          >
                            {s.match_confiance}
                            {s.distance_km
                              ? ` (${Number(s.distance_km).toFixed(1)}km)`
                              : ""}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                        <a
                          href={`https://www.google.com/maps?q=${s.centroid_lat},${s.centroid_lon}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-blue-500"
                          title="Voir sur Google Maps"
                        >
                          {Number(s.centroid_lat).toFixed(4)},{" "}
                          {Number(s.centroid_lon).toFixed(4)}
                        </a>
                      </td>
                      {/* BDNB - cellule résumé (toujours visible) */}
                      <td className="px-3 py-3 border-l border-gray-200">
                        {s.bdnb_id ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700" title={`BDNB: ${s.bdnb_nature || "Serre"} - ${s.bdnb_distance_m ? Math.round(Number(s.bdnb_distance_m)) + "m" : ""}`}>
                            IGN {s.bdnb_prop_siren ? "+" : ""}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      {/* BDNB - colonnes déployées */}
                      {showBdnb && (
                        <>
                          <td className="px-3 py-3 text-xs text-gray-600 bg-indigo-50/10">
                            {s.bdnb_prop_nom ? (
                              <span className="font-medium">{s.bdnb_prop_nom}</span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                            {s.bdnb_prop_forme && (
                              <span className="text-gray-400 ml-1">({s.bdnb_prop_forme})</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-xs font-mono text-gray-600 bg-indigo-50/10">
                            {s.bdnb_prop_siren || <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-xs text-gray-600 font-mono bg-indigo-50/10">
                            {s.bdnb_surface_m2 ? Number(s.bdnb_surface_m2).toLocaleString("fr-FR") : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-xs text-gray-600 bg-indigo-50/10">
                            {s.bdnb_hauteur_moy ? `${s.bdnb_hauteur_moy}m (max ${s.bdnb_hauteur_max}m)` : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-xs font-mono text-gray-600 bg-indigo-50/10">
                            {s.bdnb_parcelle || <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-xs text-gray-600 bg-indigo-50/10 max-w-[200px] truncate">
                            {s.bdnb_adresse || <span className="text-gray-300">—</span>}
                          </td>
                        </>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination bas */}
        <div className="flex justify-center gap-2 mt-4 mb-8">
          <button
            onClick={() => setPage(1)}
            disabled={page <= 1}
            className="px-3 py-1 text-sm border rounded-lg disabled:opacity-30"
          >
            Debut
          </button>
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="px-3 py-1 text-sm border rounded-lg disabled:opacity-30"
          >
            Precedent
          </button>
          <span className="px-3 py-1 text-sm text-gray-500">
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1 text-sm border rounded-lg disabled:opacity-30"
          >
            Suivant
          </button>
          <button
            onClick={() => setPage(totalPages)}
            disabled={page >= totalPages}
            className="px-3 py-1 text-sm border rounded-lg disabled:opacity-30"
          >
            Fin
          </button>
        </div>
      </div>
    </div>
  );
}
