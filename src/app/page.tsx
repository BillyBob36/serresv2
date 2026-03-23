"use client";

import { useState, useEffect, useCallback } from "react";
import type { Serre, SerreMatch, SerresResponse, Stats } from "@/lib/types";
import { CODE_CULTU_LABELS } from "@/lib/types";
import FicheDetail from "@/components/FicheDetail";
import FicheSerre from "@/components/FicheSerre";

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
  const [surfaceUnit, setSurfaceUnit] = useState<"ha" | "m2">("ha");
  const [expandedSerres, setExpandedSerres] = useState<Set<number>>(new Set());
  const [statutFilter, setStatutFilter] = useState("");

  // Prospection state (keyed by serre_id)
  const [prospections, setProspections] = useState<Record<number, { statut: string; match_valide: string }>>({});
  const [notes, setNotes] = useState<Record<string, { id: number; note: string; created_at: string; username?: string }[]>>({});

  // View mode: realtime (enrichir on click) vs stored (from batch)
  const [viewMode, setViewMode] = useState<"realtime" | "stored">("stored");
  const [realtimeDisabledMsg, setRealtimeDisabledMsg] = useState(false);
  const [batchList, setBatchList] = useState<{ id: number; nom: string; created_at: string }[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);

  // Enrichissement cache (keyed by siren)
  const [enrichCache, setEnrichCache] = useState<Record<string, any>>({});
  const [enrichLoading, setEnrichLoading] = useState<string | null>(null);

  // Exclude matches state (keyed by "serreId_siren")
  const [excludedMatches, setExcludedMatches] = useState<Record<string, boolean>>({});

  // Fiche serre (left panel)
  const [ficheSerreOpen, setFicheSerreOpen] = useState<Serre | null>(null);

  // Fiche detail entreprise (right panel)
  const [ficheOpen, setFicheOpen] = useState<{ serre: Serre; match: SerreMatch } | null>(null);

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

  const fetchNotes = async (siren: string) => {
    if (!siren) return;
    try {
      const resp = await fetch(`${API}/api/prospection/notes?siren=${siren}`);
      const json = await resp.json();
      setNotes((prev) => ({ ...prev, [siren]: json.data || [] }));
    } catch (err) {
      console.error("Erreur notes:", err);
    }
  };

  const addNote = async (siren: string, text: string) => {
    if (!text.trim() || !siren) return;
    try {
      await fetch(`${API}/api/prospection/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siren, note: text.trim() }),
      });
      fetchNotes(siren);
    } catch (err) {
      console.error("Erreur ajout note:", err);
    }
  };

  const toggleExclude = async (serreId: number, siren: string, exclude: boolean) => {
    if (exclude && !confirm("Exclure ce prospect pour cette serre ?")) return;
    const key = `${serreId}_${siren}`;
    setExcludedMatches((prev) => ({ ...prev, [key]: exclude }));
    try {
      await fetch(`${API}/api/serres/exclude-match`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serre_id: serreId, siren, excluded: exclude }),
      });
    } catch (err) {
      console.error("Erreur toggle exclude:", err);
      setExcludedMatches((prev) => ({ ...prev, [key]: !exclude }));
    }
  };


  const [quotaMessage, setQuotaMessage] = useState<string | null>(null);

  // Charge les donnees enrichies depuis la BDD (cascade merge) pour un siren
  const loadEnrichData = async (siren: string, autoOpen?: { serre: Serre; match: SerreMatch }) => {
    if (enrichCache[siren]) {
      if (autoOpen) setFicheOpen(autoOpen);
      return;
    }
    setEnrichLoading(siren);
    try {
      const resp = await fetch(`${API}/api/enrichir/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sirens: [siren] }),
      });
      const json = await resp.json();
      if (json.data && json.data[siren]) {
        setEnrichCache((prev) => ({ ...prev, [siren]: json.data[siren] }));
      }
      if (autoOpen) setFicheOpen(autoOpen);
    } catch (err) {
      console.error("Erreur chargement donnees:", err);
    } finally {
      setEnrichLoading(null);
    }
  };

  // Fetch batch list for the dropdown
  const fetchBatchList = useCallback(async () => {
    try {
      const resp = await fetch(`${API}/api/batch`);
      if (!resp.ok) return;
      const json = await resp.json();
      const list = (json.data || []).filter((b: any) =>
        (b.apis || []).some((a: any) => a.statut === "done")
      );
      setBatchList(list);
      if (list.length > 0) {
        setSelectedBatchId((prev) => prev ?? list[0].id);
      }
    } catch (err) {
      console.error("Erreur fetch batches:", err);
    }
  }, []);

  // Fetch batch data when in stored mode
  const fetchBatchData = useCallback(async (batchId: number, sirens: string[]) => {
    if (sirens.length === 0) return;
    try {
      const resp = await fetch(`${API}/api/batch/${batchId}/data?sirens=${sirens.join(",")}`);
      if (!resp.ok) return;
      const json = await resp.json();
      if (json.data) {
        setEnrichCache((prev) => ({ ...prev, ...json.data }));
      }
    } catch (err) {
      console.error("Batch data fetch error:", err);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchStats();
    fetchBatchList();
  }, [fetchStats, fetchBatchList]);

  // Charger les prospections + enrichissements quand les données ou le mode changent
  useEffect(() => {
    if (data.length > 0) {
      fetchProspections(data.map((s) => s.id));
      // Initialiser excludedMatches depuis les top_matches
      const excluded: Record<string, boolean> = {};
      const allSirens: string[] = [];
      for (const s of data) {
        for (const m of s.top_matches || []) {
          if (m.excluded) {
            excluded[`${s.id}_${m.siren}`] = true;
          }
          if (m.siren) {
            allSirens.push(m.siren);
          }
        }
      }
      setExcludedMatches((prev) => ({ ...prev, ...excluded }));
      const uniqueSirens = [...new Set(allSirens)];

      if (uniqueSirens.length > 0) {
        if (viewMode === "stored" && selectedBatchId) {
          // Fetch from batch data tables (cascade merge)
          fetchBatchData(selectedBatchId, uniqueSirens);
        } else {
          // Fetch from cascade merge (realtime mode)
          fetch(`${API}/api/enrichir/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sirens: uniqueSirens }),
          })
            .then((r) => r.json())
            .then((json) => {
              if (json.data && Object.keys(json.data).length > 0) {
                setEnrichCache(json.data);
              }
            })
            .catch((err) => console.error("Batch enrich fetch error:", err));
        }
      }
    }
  }, [data, fetchProspections, viewMode, selectedBatchId, fetchBatchData]);

  // Reset enrichCache when switching mode or batch to force reload
  useEffect(() => {
    setEnrichCache({});
  }, [viewMode, selectedBatchId]);

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

  const toggleExpand = (serreId: number) => {
    setExpandedSerres((prev) => {
      const next = new Set(prev);
      if (next.has(serreId)) next.delete(serreId);
      else next.add(serreId);
      return next;
    });
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

      {/* Banniere quota API depasse */}
      {quotaMessage && (
        <div className="bg-amber-50 border-l-4 border-amber-500 px-6 py-3">
          <div className="max-w-[1600px] mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-amber-600 text-xl">&#9888;</span>
              <p className="text-amber-800 text-sm font-medium">{quotaMessage}</p>
            </div>
            <button
              onClick={() => setQuotaMessage(null)}
              className="text-amber-600 hover:text-amber-800 text-lg font-bold"
            >
              &times;
            </button>
          </div>
        </div>
      )}

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

        {/* Switch mode affichage */}
        <div className="flex items-center gap-4 mb-3 bg-white rounded-xl border border-gray-200 p-3">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => { setRealtimeDisabledMsg(true); setTimeout(() => setRealtimeDisabledMsg(false), 3000); }}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition text-gray-400 cursor-not-allowed"
            >
              Temps reel
            </button>
            <button
              onClick={() => { setViewMode("stored"); fetchBatchList(); }}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition bg-white text-gray-900 shadow-sm"
            >
              BDD Stockee
            </button>
          </div>
          {realtimeDisabledMsg && (
            <span className="text-[10px] text-orange-600 bg-orange-50 px-2 py-1 rounded animate-pulse">Mode Temps reel temporairement desactive</span>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Enrichissement :</label>
            <select
              value={selectedBatchId || ""}
              onChange={(e) => setSelectedBatchId(Number(e.target.value) || null)}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-900 bg-white"
            >
              {batchList.length === 0 && <option value="">Aucun disponible</option>}
              {batchList.map((b) => (
                <option key={b.id} value={b.id}>{b.nom}</option>
              ))}
            </select>
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
              className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-100 shadow-sm disabled:opacity-30"
            >
              Precedent
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-100 shadow-sm disabled:opacity-30"
            >
              Suivant
            </button>
          </div>
        </div>

        {/* Tableau compact */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-50 border-b border-gray-200">
                {/* En-tête global : Serre / Parcelles | Entreprise / Prospects */}
                <tr className="bg-gray-100 border-b border-gray-300">
                  <th colSpan={6} className="px-4 py-2 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Serre / Parcelles
                  </th>
                  <th colSpan={6} className="px-4 py-2 text-left text-xs font-bold text-blue-700 uppercase tracking-wider border-l-2 border-blue-300 bg-blue-50/60">
                    Entreprise / Prospects
                  </th>
                </tr>
                <tr>
                  <th className="px-2 py-3 text-center font-medium text-gray-600 w-14" title="ID Serre — cliquer pour ouvrir la fiche serre">
                    ID
                  </th>
                  <th onClick={() => handleSort("departement")} className="px-2 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none w-14" title="Departement">
                    Dept <SortIcon col="departement" />
                  </th>
                  <th onClick={() => handleSort("commune")} className="px-3 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none" title="Commune">
                    Commune <SortIcon col="commune" />
                  </th>
                  <th onClick={() => handleSort("code_cultu")} className="px-2 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none w-14" title="Type de culture">
                    Type <SortIcon col="code_cultu" />
                  </th>
                  <th onClick={() => handleSort("surface_ha")} className="px-3 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none" title="Surface parcelle RPG">
                    <span className="flex items-center gap-1">
                      Surface <SortIcon col="surface_ha" />
                      <button onClick={(ev) => { ev.stopPropagation(); setSurfaceUnit(surfaceUnit === "ha" ? "m2" : "ha"); }} className="ml-1 px-1 py-0.5 text-[10px] rounded bg-gray-200 hover:bg-blue-200 text-gray-600 hover:text-blue-700 font-mono">
                        {surfaceUnit === "ha" ? "HA" : "m\u00B2"}
                      </button>
                    </span>
                  </th>
                  <th className="px-1 py-3 text-center font-medium text-gray-500 w-10" title="Voir sur carte">
                    Carte
                  </th>
                  <th onClick={() => handleSort("nom_entreprise")} className="px-3 py-3 text-left font-medium text-gray-700 cursor-pointer hover:text-gray-900 select-none border-l-2 border-blue-300 bg-blue-50/40 min-w-[180px]" title="Entreprise">
                    Entreprise <SortIcon col="nom_entreprise" />
                  </th>
                  <th className="px-1 py-3 text-center font-medium text-gray-500 bg-blue-50/40 w-10" title="Google Maps">
                    Maps
                  </th>
                  <th className="px-3 py-3 text-left font-medium text-gray-500 bg-blue-50/40 whitespace-nowrap w-[120px]" title="Indicateurs rapides : etat, tel, web, bio, alertes">
                    Indicateurs
                  </th>
                  <th className="px-3 py-3 text-left font-medium text-gray-700 bg-blue-50/40 whitespace-nowrap">Statut</th>
                  <th className="px-1 py-3 text-center font-medium text-gray-700 bg-blue-50/40 whitespace-nowrap w-10" title="Exclure ce prospect pour cette serre"></th>
                  <th className="px-3 py-3 text-center font-medium text-gray-700 bg-blue-50/40 whitespace-nowrap w-14" title="Ouvrir la fiche detail">Fiche</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={99} className="px-4 py-8 text-center text-gray-400">Chargement...</td></tr>
                ) : data.length === 0 ? (
                  <tr><td colSpan={99} className="px-4 py-8 text-center text-gray-400">Aucun resultat</td></tr>
                ) : (
                  data.flatMap((s) => {
                    const matches: SerreMatch[] = s.top_matches?.length > 0
                      ? s.top_matches
                      : s.nom_entreprise
                        ? [{ siren: s.siren || "", siret: s.siret || null, nom_entreprise: s.nom_entreprise, dirigeant_prenom: s.dirigeant_prenom || null, dirigeant_nom: s.dirigeant_nom || null, commune_entreprise: s.adresse_entreprise || null, distance_km: Number(s.distance_km) || 0, rang: 1, confiance: s.match_confiance || null } as SerreMatch]
                        : [];
                    const isExpanded = expandedSerres.has(s.id);
                    const hasMultiple = matches.length > 1;
                    const visibleMatches = hasMultiple && !isExpanded ? [matches[0]] : matches;
                    const rowSpan = visibleMatches.length || 1;

                    const leftCells = (rs: number) => (
                      <>
                        <td rowSpan={rs} className="px-2 py-2 text-center align-middle">
                          <button
                            onClick={() => setFicheSerreOpen(s)}
                            className="text-xs font-mono text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                            title="Ouvrir la fiche serre"
                          >
                            {s.id}
                          </button>
                        </td>
                        <td rowSpan={rs} className="px-2 py-2 font-medium text-gray-900 text-center align-middle text-xs">{s.departement || "\u2014"}</td>
                        <td rowSpan={rs} className="px-3 py-2 text-gray-700 align-middle text-xs">
                          <span className="truncate max-w-[120px] block">{s.commune || "\u2014"}</span>
                        </td>
                        <td rowSpan={rs} className="px-2 py-2 text-center align-middle">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${s.code_cultu === "CSS" ? "bg-purple-100 text-purple-700" : s.code_cultu === "FLA" ? "bg-pink-100 text-pink-700" : "bg-green-100 text-green-700"}`} title={CODE_CULTU_LABELS[s.code_cultu] || s.code_cultu}>{s.code_cultu}</span>
                        </td>
                        <td rowSpan={rs} className="px-3 py-2 text-xs text-gray-700 font-mono align-middle whitespace-nowrap">
                          {surfaceUnit === "ha" ? `${Number(s.surface_ha).toFixed(2)} ha` : `${Math.round(Number(s.surface_ha) * 10000).toLocaleString("fr-FR")} m\u00B2`}
                          {s.surface_osm_m2 && (
                            <span className="text-emerald-600 ml-1" title={`Surface serre OSM: ${surfaceUnit === "ha" ? `${(Number(s.surface_osm_m2) / 10000).toFixed(2)} ha` : `${Math.round(Number(s.surface_osm_m2)).toLocaleString("fr-FR")} m\u00B2`}`}>
                              ({surfaceUnit === "ha" ? `${(Number(s.surface_osm_m2) / 10000).toFixed(2)}` : Math.round(Number(s.surface_osm_m2)).toLocaleString("fr-FR")})
                            </span>
                          )}
                        </td>
                        {/* Colonne Carte */}
                        <td rowSpan={rs} className="px-1 py-2 text-center align-middle">
                          <a href={`/carte?lat=${s.centroid_lat}&lon=${s.centroid_lon}&zoom=17`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center w-6 h-6 rounded bg-green-50 hover:bg-green-100 text-green-600 transition" title="Voir sur carte">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
                          </a>
                        </td>
                      </>
                    );

                    const rightCells = (m: SerreMatch | null, isFirst: boolean, isExpandedRow: boolean) => {
                      const en = m?.siren ? enrichCache[m.siren] : null;
                      const isExcluded = m ? excludedMatches[`${s.id}_${m.siren}`] : false;
                      const statutColors: Record<string, string> = { nouveau: "bg-gray-100 text-gray-600", a_contacter: "bg-blue-100 text-blue-700", appele: "bg-yellow-100 text-yellow-700", interesse: "bg-green-100 text-green-700", pas_interesse: "bg-red-100 text-red-700", injoignable: "bg-orange-100 text-orange-700", client: "bg-purple-100 text-purple-700" };
                      const rowClass = isExcluded ? "line-through opacity-40" : "";
                      const borderLClass = isExpandedRow ? "border-l-2 border-gray-200" : "border-l-2 border-blue-300";
                      return (
                        <>
                          {/* Entreprise */}
                          <td className={`px-3 py-2 ${borderLClass} bg-blue-50/10 ${rowClass}`}>
                            {m ? (
                              <div className="flex items-center gap-1.5 text-xs">
                                <span className="font-semibold text-blue-700 truncate max-w-[160px]" title={m.nom_entreprise || ""}>{m.nom_entreprise || "\u2014"}</span>
                                <span className="text-gray-400 whitespace-nowrap text-[10px]">({Number(m.distance_km).toFixed(1)}km)</span>
                                {isFirst && hasMultiple && (
                                  <button onClick={() => toggleExpand(s.id)} className="ml-auto flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-[10px] font-bold hover:bg-blue-600 transition shadow-sm">
                                    {isExpanded ? "\u25B2" : `+${matches.length - 1}`}
                                  </button>
                                )}
                              </div>
                            ) : <span className="text-gray-300 text-xs">{"\u2014"}</span>}
                          </td>
                          {/* Google Maps */}
                          <td className={`px-1 py-2 text-center bg-blue-50/10 ${rowClass}`}>
                            {en?.google_maps_uri ? (
                              <a href={en.google_maps_uri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center w-6 h-6 rounded bg-red-50 hover:bg-red-100 text-red-500 transition" title="Voir sur Google Maps">
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                              </a>
                            ) : <span className="text-gray-200 text-[10px]">{"\u2014"}</span>}
                          </td>
                          {/* Indicateurs compacts */}
                          <td className={`px-2 py-2 bg-blue-50/10 ${rowClass}`}>
                            {m?.siren ? (
                              <div className="flex items-center gap-1 flex-wrap">
                                {en ? (
                                  <>
                                    <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] ${en.etat_administratif === "A" ? "bg-green-100 text-green-700" : en.etat_administratif === "C" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-400"}`} title={en.etat_administratif === "A" ? "Active" : en.etat_administratif === "C" ? "Cessee" : "?"}>
                                      {en.etat_administratif === "A" ? "\u2713" : en.etat_administratif === "C" ? "\u2717" : "?"}
                                    </span>
                                    <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] ${en.telephone ? "bg-blue-100 text-blue-700" : "bg-gray-50 text-gray-300"}`} title={en.telephone || "Pas de telephone"}>
                                      {"\uD83D\uDCDE"}
                                    </span>
                                    <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] ${en.site_web ? "bg-blue-100 text-blue-700" : "bg-gray-50 text-gray-300"}`} title={en.site_web || "Pas de site web"}>
                                      {"\uD83C\uDF10"}
                                    </span>
                                    {en.est_bio && (
                                      <span className="px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold" title="Certifie Bio">BIO</span>
                                    )}
                                    {en.bodacc_procedures && Array.isArray(en.bodacc_procedures) && en.bodacc_procedures.length > 0 && (
                                      <span className="px-1 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold" title="Procedure collective en cours">{"\u26A0"}</span>
                                    )}
                                    {en.nombre_etablissements_ouverts && en.nombre_etablissements_ouverts > 1 && (
                                      <span className="px-1 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px]" title={`${en.nombre_etablissements_ouverts} etablissements ouverts`}>
                                        {"\uD83C\uDFE2"}{en.nombre_etablissements_ouverts}
                                      </span>
                                    )}
                                  </>
                                ) : viewMode === "realtime" ? (
                                  <button
                                    onClick={() => loadEnrichData(m.siren, { serre: s, match: m })}
                                    disabled={enrichLoading === m.siren}
                                    className="px-2 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700 hover:bg-orange-200"
                                  >
                                    {enrichLoading === m.siren ? "..." : "Enrichir"}
                                  </button>
                                ) : (
                                  <span className="text-gray-300 text-[10px]">{"\u2014"}</span>
                                )}
                              </div>
                            ) : <span className="text-gray-200 text-[10px]">{"\u2014"}</span>}
                          </td>
                          {/* Statut */}
                          <td className="px-2 py-2 bg-blue-50/10">
                            <select
                              value={prospections[s.id]?.statut || "nouveau"}
                              onChange={(ev) => updateProspection(s.id, "statut", ev.target.value)}
                              className={`text-[11px] rounded px-1.5 py-1 border-0 font-medium cursor-pointer ${statutColors[prospections[s.id]?.statut || "nouveau"] || "bg-gray-100 text-gray-600"}`}
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
                          {/* Exclude toggle */}
                          <td className="px-1 py-2 text-center bg-blue-50/10">
                            {m?.siren ? (
                              <button
                                onClick={() => toggleExclude(s.id, m.siren, !isExcluded)}
                                className={`w-5 h-5 rounded text-[10px] transition ${isExcluded ? "bg-green-100 text-green-600 hover:bg-green-200" : "bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600"}`}
                                title={isExcluded ? "Reactiver ce prospect" : "Exclure ce prospect pour cette serre"}
                              >
                                {isExcluded ? "\u21A9" : "\u2717"}
                              </button>
                            ) : null}
                          </td>
                          {/* Fiche detail button */}
                          <td className="px-2 py-2 text-center bg-blue-50/10">
                            {m?.siren ? (
                              <button
                                onClick={() => {
                                  setFicheOpen({ serre: s, match: m });
                                  loadEnrichData(m.siren);
                                  fetchNotes(m.siren);
                                }}
                                className="px-2 py-1 rounded text-[10px] font-medium bg-gray-100 hover:bg-blue-100 text-gray-600 hover:text-blue-700 transition"
                                title="Ouvrir la fiche detail"
                              >
                                {"\u25B6"}
                              </button>
                            ) : null}
                          </td>
                        </>
                      );
                    };


                    if (visibleMatches.length === 0) {
                      return [
                        <tr key={s.id} className="border-b border-gray-100 hover:bg-blue-50/30 transition">
                          {leftCells(1)}
                          {rightCells(null, true, false)}
                        </tr>
                      ];
                    }

                    const expandedMulti = isExpanded && hasMultiple;

                    const rows = visibleMatches.map((m, idx) => {
                      const isFirstRow = idx === 0;
                      const isLastRow = idx === visibleMatches.length - 1;
                      // Bordures bleues top (premier) / bottom (dernier) quand déplié, sinon gris normal
                      const topBorder = expandedMulti && isFirstRow ? "border-t-2 border-t-blue-400" : "border-t border-t-gray-100";
                      const bottomBorder = expandedMulti && isLastRow ? "border-b-2 border-b-blue-400" : "border-b border-b-gray-100";
                      // Lignes internes entre prospects identiques (gris normal)
                      const internalBorder = expandedMulti && !isLastRow ? "border-b border-b-gray-200" : "";

                      return (
                        <tr key={`${s.id}_${idx}`} className={`hover:bg-blue-50/30 transition ${topBorder} ${internalBorder || bottomBorder}`}>
                          {isFirstRow && leftCells(rowSpan)}
                          {rightCells(m, isFirstRow, expandedMulti)}
                        </tr>
                      );
                    });


                    return rows;
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination bas */}
        <div className="flex justify-center gap-2 mt-4 mb-8">
          <button onClick={() => setPage(1)} disabled={page <= 1} className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-100 shadow-sm disabled:opacity-30 disabled:hover:bg-white">Debut</button>
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-100 shadow-sm disabled:opacity-30 disabled:hover:bg-white">Precedent</button>
          <span className="px-4 py-1.5 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg">Page {page} / {totalPages}</span>
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-100 shadow-sm disabled:opacity-30 disabled:hover:bg-white">Suivant</button>
          <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-100 shadow-sm disabled:opacity-30 disabled:hover:bg-white">Fin</button>
        </div>
      </div>

      {/* Fiche serre slide-over (gauche) */}
      {ficheSerreOpen && (
        <FicheSerre
          serre={ficheSerreOpen}
          onClose={() => setFicheSerreOpen(null)}
          onOpenEntreprise={(serre, match) => {
            setFicheSerreOpen(null);
            setFicheOpen({ serre, match });
            if (match.siren) loadEnrichData(match.siren);
            fetchNotes(match.siren);
          }}
          excludedMatches={excludedMatches}
        />
      )}

      {/* Fiche entreprise slide-over (droite) */}
      {ficheOpen && (
        <FicheDetail
          data={ficheOpen.match?.siren ? enrichCache[ficheOpen.match.siren] : null}
          serre={ficheOpen.serre}
          match={ficheOpen.match}
          onClose={() => setFicheOpen(null)}
          onEnrichir={() => {
            if (ficheOpen.match?.siren) {
              // Force reload from cascade
              setEnrichCache((prev) => { const c = { ...prev }; delete c[ficheOpen.match.siren]; return c; });
              loadEnrichData(ficheOpen.match.siren);
            }
          }}
          enrichLoading={enrichLoading === ficheOpen.match?.siren}
          prospection={prospections[ficheOpen.serre.id] || null}
          onUpdateProspection={(field, value) => updateProspection(ficheOpen.serre.id, field, value)}
          notes={ficheOpen.match?.siren ? (notes[ficheOpen.match.siren] || []) : []}
          onAddNote={(text) => ficheOpen.match?.siren && addNote(ficheOpen.match.siren, text)}
        />
      )}
    </div>
  );
}
