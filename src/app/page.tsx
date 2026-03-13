"use client";

import { useState, useEffect, useCallback } from "react";
import type { Serre, SerreMatch, SerresResponse, Stats } from "@/lib/types";
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
  const [showEnrich, setShowEnrich] = useState(false);
  const [surfaceUnit, setSurfaceUnit] = useState<"ha" | "m2">("ha");
  const [statutFilter, setStatutFilter] = useState("");

  // Prospection state (keyed by serre_id)
  const [prospections, setProspections] = useState<Record<number, { statut: string; match_valide: string }>>({});
  const [notes, setNotes] = useState<Record<number, { id: number; note: string; created_at: string; username?: string }[]>>({});
  const [openNotes, setOpenNotes] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");

  // Enrichissement cache (keyed by siren)
  const [enrichCache, setEnrichCache] = useState<Record<string, any>>({});
  const [enrichLoading, setEnrichLoading] = useState<string | null>(null);

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
    if (statutFilter) params.set("statut", statutFilter);

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
    statutFilter,
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

  // Charger les prospections pour la page courante
  const fetchProspections = useCallback(async (serreIds: number[]) => {
    if (serreIds.length === 0) return;
    try {
      const resp = await fetch(`${API}/api/prospection?serre_ids=${serreIds.join(",")}`);
      const json = await resp.json();
      const map: Record<number, { statut: string; match_valide: string }> = {};
      for (const p of json.data || []) {
        map[p.serre_id] = { statut: p.statut, match_valide: p.match_valide };
      }
      setProspections(map);
    } catch (err) {
      console.error("Erreur prospections:", err);
    }
  }, []);

  const updateProspection = async (serreId: number, field: string, value: string) => {
    setProspections((prev) => ({
      ...prev,
      [serreId]: { ...prev[serreId], [field]: value },
    }));
    try {
      await fetch(`${API}/api/prospection`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serre_id: serreId, [field]: value }),
      });
    } catch (err) {
      console.error("Erreur update prospection:", err);
    }
  };

  const fetchNotes = async (serreId: number) => {
    try {
      const resp = await fetch(`${API}/api/prospection/notes?serre_id=${serreId}`);
      const json = await resp.json();
      setNotes((prev) => ({ ...prev, [serreId]: json.data || [] }));
    } catch (err) {
      console.error("Erreur notes:", err);
    }
  };

  const addNote = async (serreId: number) => {
    if (!noteText.trim()) return;
    try {
      await fetch(`${API}/api/prospection/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serre_id: serreId, note: noteText.trim() }),
      });
      setNoteText("");
      fetchNotes(serreId);
    } catch (err) {
      console.error("Erreur ajout note:", err);
    }
  };

  const enrichir = async (siren: string, nom: string, lat: number, lon: number) => {
    if (enrichCache[siren]) return;
    setEnrichLoading(siren);
    try {
      const resp = await fetch(`${API}/api/enrichir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siren, nom_entreprise: nom, lat, lon }),
      });
      const json = await resp.json();
      if (json.data) {
        setEnrichCache((prev) => ({ ...prev, [siren]: json.data }));
      }
    } catch (err) {
      console.error("Erreur enrichissement:", err);
    } finally {
      setEnrichLoading(null);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Charger les prospections quand les données changent
  useEffect(() => {
    if (data.length > 0) {
      fetchProspections(data.map((s) => s.id));
    }
  }, [data, fetchProspections]);

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
    setStatutFilter("");
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
            <div>
              <label className="block text-xs text-gray-500 mb-1">Statut</label>
              <select
                value={statutFilter}
                onChange={(e) => { setStatutFilter(e.target.value); setPage(1); }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white"
              >
                <option value="">Tous</option>
                <option value="nouveau">Nouveau</option>
                <option value="a_contacter">A contacter</option>
                <option value="appele">Appele</option>
                <option value="interesse">Interesse</option>
                <option value="pas_interesse">Pas interesse</option>
                <option value="injoignable">Injoignable</option>
                <option value="client">Client</option>
              </select>
            </div>
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
                    { key: "departement", label: "Dept", tooltip: "Numéro du département français où se trouve la serre (ex: 84 = Vaucluse)." },
                    { key: "commune", label: "Commune", tooltip: "Nom de la ville ou du village où est localisée la serre." },
                    { key: "code_cultu", label: "Type", tooltip: "Type de culture pratiquée sous serre : CSS = hors sol, FLA = fleurs, PEP = pépinières." },
                  ].map(({ key, label, tooltip }) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none"
                      title={tooltip}
                    >
                      {label}
                      <SortIcon col={key} />
                    </th>
                  ))}
                  <th
                    onClick={() => handleSort("nom_entreprise")}
                    className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none min-w-[280px]"
                    title="Entreprises candidates (top 3 les plus proches) avec leur dirigeant"
                  >
                    Prospects <SortIcon col="nom_entreprise" />
                  </th>
                  <th className="px-3 py-3 text-left font-medium text-gray-600 whitespace-nowrap" title="Statut de prospection">Statut</th>
                  <th className="px-3 py-3 text-left font-medium text-gray-600 whitespace-nowrap" title="Validation : le prospect correspond-il à la parcelle ?">Match</th>
                  <th className="px-3 py-3 text-left font-medium text-gray-600 whitespace-nowrap" title="Notes et journal d'appels">Notes</th>
                  {/* Colonne Surface parcelle avec toggle HA/m² */}
                  <th
                    onClick={() => handleSort("surface_ha")}
                    className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none"
                    title="Superficie de la parcelle agricole (RPG) déclarée par l'exploitant. Cliquez sur HA / m² pour changer l'unité."
                  >
                    <span className="flex items-center gap-1">
                      Surf. parcelle
                      <SortIcon col="surface_ha" />
                      <button
                        onClick={(e) => { e.stopPropagation(); setSurfaceUnit(surfaceUnit === "ha" ? "m2" : "ha"); }}
                        className="ml-1 px-1.5 py-0.5 text-xs rounded bg-gray-200 hover:bg-blue-200 text-gray-600 hover:text-blue-700 font-mono"
                        title="Basculer entre hectares et mètres carrés"
                      >
                        {surfaceUnit === "ha" ? "HA" : "m²"}
                      </button>
                    </span>
                  </th>
                  {/* Colonne Surface serre (OSM) */}
                  <th
                    className="px-4 py-3 text-left font-medium text-gray-600"
                    title="Surface réelle de la serre détectée via OpenStreetMap (contours du bâtiment). Calculée automatiquement à partir des polygones cartographiques."
                  >
                    <span className="flex items-center gap-1">
                      Surf. serre
                      <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded bg-emerald-100 text-emerald-700 font-medium">OSM</span>
                    </span>
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium text-gray-600"
                    title="Niveau de confiance du rapprochement entre la parcelle RPG et l'entreprise trouvée. Haute = très fiable, Moyenne = probable, Basse = à vérifier. La distance en km indique l'écart entre la serre et le siège de l'entreprise."
                  >
                    Confiance
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium text-gray-600"
                    title="Coordonnées GPS du centre de la parcelle (latitude, longitude). Cliquez pour ouvrir dans Google Maps."
                  >
                    Coords
                  </th>
                  {/* BDNB - colonnes rétractables */}
                  <th
                    onClick={() => setShowBdnb(!showBdnb)}
                    className="px-3 py-3 text-left font-medium text-indigo-600 cursor-pointer hover:text-indigo-800 select-none border-l border-gray-200 bg-indigo-50/50 whitespace-nowrap"
                    title="Base de Données Nationale des Bâtiments (IGN) — données officielles sur les bâtiments physiques. Cliquez pour afficher ou masquer les détails."
                  >
                    {showBdnb ? "\u25BC" : "\u25B6"} BDNB
                  </th>
                  {showBdnb && (
                    <>
                      <th className="px-3 py-3 text-left font-medium text-indigo-500 text-xs bg-indigo-50/30 whitespace-nowrap" title="Surface couverte par le bâtiment-serre selon le cadastre IGN, exprimée en mètres carrés.">Surface (m²)</th>
                      <th className="px-3 py-3 text-left font-medium text-indigo-500 text-xs bg-indigo-50/30 whitespace-nowrap" title="Hauteur moyenne et hauteur maximale du bâtiment-serre en mètres, mesurées par l'IGN.">Hauteur</th>
                      <th className="px-3 py-3 text-left font-medium text-indigo-500 text-xs bg-indigo-50/30 whitespace-nowrap" title="Identifiant de la parcelle cadastrale sur laquelle est construite la serre (référence du cadastre français).">Parcelle cad.</th>
                      <th className="px-3 py-3 text-left font-medium text-indigo-500 text-xs bg-indigo-50/30 whitespace-nowrap" title="Adresse postale du bâtiment-serre selon la Base Adresse Nationale (BAN).">Adresse</th>
                    </>
                  )}
                  {/* Enrichissement - colonnes rétractables */}
                  <th
                    onClick={() => setShowEnrich(!showEnrich)}
                    className="px-3 py-3 text-left font-medium text-orange-600 cursor-pointer hover:text-orange-800 select-none border-l border-gray-200 bg-orange-50/50 whitespace-nowrap"
                    title="Données d'enrichissement (Pappers + Google Places). Cliquez pour afficher ou masquer."
                  >
                    {showEnrich ? "\u25BC" : "\u25B6"} Enrichissement
                  </th>
                  {showEnrich && (
                    <>
                      <th className="px-3 py-3 text-left font-medium text-orange-500 text-xs bg-orange-50/30 whitespace-nowrap">Forme jur.</th>
                      <th className="px-3 py-3 text-left font-medium text-orange-500 text-xs bg-orange-50/30 whitespace-nowrap">NAF</th>
                      <th className="px-3 py-3 text-left font-medium text-orange-500 text-xs bg-orange-50/30 whitespace-nowrap">Effectifs</th>
                      <th className="px-3 py-3 text-left font-medium text-orange-500 text-xs bg-orange-50/30 whitespace-nowrap">CA</th>
                      <th className="px-3 py-3 text-left font-medium text-orange-500 text-xs bg-orange-50/30 whitespace-nowrap">Telephone</th>
                      <th className="px-3 py-3 text-left font-medium text-orange-500 text-xs bg-orange-50/30 whitespace-nowrap">Site web</th>
                      <th className="px-3 py-3 text-left font-medium text-orange-500 text-xs bg-orange-50/30 whitespace-nowrap">Note Google</th>
                      <th className="px-3 py-3 text-left font-medium text-orange-500 text-xs bg-orange-50/30 whitespace-nowrap">Dirigeants</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={99} className="px-4 py-8 text-center text-gray-400">
                      Chargement...
                    </td>
                  </tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={99} className="px-4 py-8 text-center text-gray-400">
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
                      {/* Colonne Prospects unifiée */}
                      <td className="px-4 py-3 text-gray-700">
                        {s.top_matches && s.top_matches.length > 0 ? (
                          <div className="space-y-1">
                            {/* #1 toujours visible */}
                            {(() => { const m = s.top_matches[0]; return (
                              <div className="flex items-center gap-2 text-xs">
                                <span className="font-semibold text-blue-700 truncate max-w-[160px]" title={m.nom_entreprise || ""}>{m.nom_entreprise || "—"}</span>
                                <span className="text-gray-400">—</span>
                                <span className="text-gray-600 truncate max-w-[120px]">{m.dirigeant_prenom} {m.dirigeant_nom}</span>
                                <span className="text-gray-400 whitespace-nowrap">({Number(m.distance_km).toFixed(1)}km)</span>
                                <button
                                  onClick={() => enrichir(m.siren, m.nom_entreprise || "", Number(s.centroid_lat), Number(s.centroid_lon))}
                                  disabled={!!enrichCache[m.siren] || enrichLoading === m.siren}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${enrichCache[m.siren] ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700 hover:bg-orange-200"}`}
                                  title={enrichCache[m.siren] ? "Enrichi" : "Enrichir via Pappers + Google"}
                                >
                                  {enrichLoading === m.siren ? "..." : enrichCache[m.siren] ? "Enrichi" : "Enrichir"}
                                </button>
                              </div>
                            ); })()}
                            {/* #2, #3 expandable */}
                            {s.top_matches.length > 1 && (
                              <details className="group">
                                <summary className="cursor-pointer list-none text-[10px] text-blue-500 hover:text-blue-700">
                                  + {s.top_matches.length - 1} autre(s)
                                </summary>
                                <div className="mt-1 space-y-1 border-l-2 border-blue-200 pl-2">
                                  {s.top_matches.slice(1).map((m: SerreMatch, idx: number) => (
                                    <div key={idx} className="flex items-center gap-2 text-[11px] text-gray-500">
                                      <span className="font-medium truncate max-w-[140px]" title={m.nom_entreprise || ""}>{m.nom_entreprise}</span>
                                      <span className="text-gray-300">—</span>
                                      <span className="truncate max-w-[100px]">{m.dirigeant_prenom} {m.dirigeant_nom}</span>
                                      <span className="text-gray-400 whitespace-nowrap">({Number(m.distance_km).toFixed(1)}km)</span>
                                      <button
                                        onClick={() => enrichir(m.siren, m.nom_entreprise || "", Number(s.centroid_lat), Number(s.centroid_lon))}
                                        disabled={!!enrichCache[m.siren] || enrichLoading === m.siren}
                                        className={`px-1 py-0.5 rounded text-[9px] font-medium ${enrichCache[m.siren] ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700 hover:bg-orange-200"}`}
                                      >
                                        {enrichLoading === m.siren ? "..." : enrichCache[m.siren] ? "Enrichi" : "Enrichir"}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}
                          </div>
                        ) : s.nom_entreprise ? (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-semibold">{s.nom_entreprise}</span>
                            <span className="text-gray-400">—</span>
                            <span className="text-gray-600">{s.dirigeant_prenom} {s.dirigeant_nom}</span>
                          </div>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      {/* Colonne Statut */}
                      <td className="px-3 py-3">
                        <select
                          value={prospections[s.id]?.statut || "nouveau"}
                          onChange={(e) => updateProspection(s.id, "statut", e.target.value)}
                          className={`text-[11px] rounded px-1.5 py-1 border-0 font-medium cursor-pointer ${
                            { nouveau: "bg-gray-100 text-gray-600", a_contacter: "bg-blue-100 text-blue-700", appele: "bg-yellow-100 text-yellow-700", interesse: "bg-green-100 text-green-700", pas_interesse: "bg-red-100 text-red-700", injoignable: "bg-orange-100 text-orange-700", client: "bg-purple-100 text-purple-700" }[prospections[s.id]?.statut || "nouveau"] || "bg-gray-100 text-gray-600"
                          }`}
                        >
                          <option value="nouveau">Nouveau</option>
                          <option value="a_contacter">A contacter</option>
                          <option value="appele">Appele</option>
                          <option value="interesse">Interesse</option>
                          <option value="pas_interesse">Pas interesse</option>
                          <option value="injoignable">Injoignable</option>
                          <option value="client">Client</option>
                        </select>
                      </td>
                      {/* Colonne Match validation */}
                      <td className="px-3 py-3">
                        <div className="flex gap-1">
                          {[
                            { val: "confirme", icon: "\u2705", title: "Bon match" },
                            { val: "mauvais_match", icon: "\u274C", title: "Mauvais match" },
                            { val: "incertain", icon: "\u2753", title: "Incertain" },
                          ].map(({ val, icon, title }) => (
                            <button
                              key={val}
                              onClick={() => updateProspection(s.id, "match_valide", val)}
                              className={`w-6 h-6 rounded text-xs ${(prospections[s.id]?.match_valide || "incertain") === val ? "ring-2 ring-blue-400 bg-blue-50" : "opacity-40 hover:opacity-100"}`}
                              title={title}
                            >
                              {icon}
                            </button>
                          ))}
                        </div>
                      </td>
                      {/* Colonne Notes */}
                      <td className="px-3 py-3 relative">
                        <button
                          onClick={() => { if (openNotes === s.id) { setOpenNotes(null); } else { setOpenNotes(s.id); fetchNotes(s.id); setNoteText(""); } }}
                          className={`text-xs px-2 py-1 rounded ${openNotes === s.id ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                          title="Journal de notes"
                        >
                          {notes[s.id]?.length ? `\uD83D\uDCDD ${notes[s.id].length}` : "\uD83D\uDCDD"}
                        </button>
                        {openNotes === s.id && (
                          <div className="absolute z-50 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl p-3 w-72 right-0">
                            <div className="max-h-40 overflow-y-auto space-y-2 mb-2">
                              {(notes[s.id] || []).length === 0 && <p className="text-xs text-gray-400">Aucune note</p>}
                              {(notes[s.id] || []).map((n) => (
                                <div key={n.id} className="text-xs border-b border-gray-100 pb-1">
                                  <span className="text-gray-400">{new Date(n.created_at).toLocaleDateString("fr-FR")} {new Date(n.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                                  {n.username && <span className="text-blue-500 ml-1">{n.username}</span>}
                                  <p className="text-gray-700 mt-0.5">{n.note}</p>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-1">
                              <input
                                type="text"
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") addNote(s.id); }}
                                placeholder="Ajouter une note..."
                                className="flex-1 text-xs px-2 py-1 border border-gray-300 rounded text-gray-900 bg-white"
                              />
                              <button onClick={() => addNote(s.id)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">OK</button>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 font-mono">
                        {surfaceUnit === "ha"
                          ? `${Number(s.surface_ha).toFixed(2)} ha`
                          : `${Math.round(Number(s.surface_ha) * 10000).toLocaleString("fr-FR")} m²`}
                      </td>
                      <td className="px-4 py-3 text-gray-700 font-mono">
                        {s.surface_osm_m2 ? (
                          <span className="text-emerald-700 font-medium">
                            {surfaceUnit === "ha"
                              ? `${(Number(s.surface_osm_m2) / 10000).toFixed(2)} ha`
                              : `${Math.round(Number(s.surface_osm_m2)).toLocaleString("fr-FR")} m²`}
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
                        <span className="flex items-center gap-1">
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
                          <a
                            href={`/carte?lat=${s.centroid_lat}&lon=${s.centroid_lon}&zoom=17`}
                            className="inline-flex items-center justify-center w-6 h-6 rounded bg-green-100 hover:bg-green-200 text-green-700 transition"
                            title="Voir sur notre carte"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                            </svg>
                          </a>
                        </span>
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
                          <td className="px-3 py-3 text-xs text-gray-600 font-mono bg-indigo-50/10">
                            {s.bdnb_surface_m2 ? `${Number(s.bdnb_surface_m2).toLocaleString("fr-FR")} m²` : <span className="text-gray-300">—</span>}
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
                      {/* Enrichissement - cellule résumé */}
                      {(() => {
                        const siren = s.top_matches?.[0]?.siren || s.siren;
                        const e = siren ? enrichCache[siren] : null;
                        return (
                          <>
                            <td className="px-3 py-3 border-l border-gray-200">
                              {e ? (
                                <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700" title={`${e.source} — ${e.forme_juridique || ""}`}>
                                  Enrichi
                                </span>
                              ) : (
                                <span className="text-gray-300 text-xs">—</span>
                              )}
                            </td>
                            {showEnrich && (
                              <>
                                <td className="px-3 py-3 text-xs text-gray-600 bg-orange-50/10">
                                  {e?.forme_juridique || <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-3 py-3 text-xs text-gray-600 bg-orange-50/10" title={e?.libelle_naf || ""}>
                                  {e?.code_naf || <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-3 py-3 text-xs text-gray-600 bg-orange-50/10">
                                  {e?.tranche_effectifs || <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-3 py-3 text-xs text-gray-600 font-mono bg-orange-50/10">
                                  {e?.chiffre_affaires ? `${Number(e.chiffre_affaires).toLocaleString("fr-FR")} \u20AC` : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-3 py-3 text-xs text-gray-600 bg-orange-50/10">
                                  {e?.telephone ? (
                                    <a href={`tel:${e.telephone}`} className="text-blue-600 hover:underline">{e.telephone}</a>
                                  ) : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-3 py-3 text-xs text-gray-600 bg-orange-50/10 max-w-[150px] truncate">
                                  {e?.site_web ? (
                                    <a href={e.site_web} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{e.site_web.replace(/^https?:\/\//, "")}</a>
                                  ) : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-3 py-3 text-xs text-gray-600 bg-orange-50/10">
                                  {e?.note_google ? (
                                    <span>{e.note_google}/5 <span className="text-gray-400">({e.avis_count})</span></span>
                                  ) : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-3 py-3 text-xs text-gray-600 bg-orange-50/10 max-w-[200px]">
                                  {e?.dirigeants && Array.isArray(e.dirigeants) ? (
                                    <div className="space-y-0.5">
                                      {(e.dirigeants as any[]).slice(0, 3).map((d: any, i: number) => (
                                        <div key={i} className="truncate">{d.prenom} {d.nom} <span className="text-gray-400">({d.qualite})</span></div>
                                      ))}
                                    </div>
                                  ) : <span className="text-gray-300">—</span>}
                                </td>
                              </>
                            )}
                          </>
                        );
                      })()}
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
