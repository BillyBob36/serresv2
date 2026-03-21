"use client";

import { useState, useEffect, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "";

interface FreshnessData {
  rpg: {
    annee: number;
    imported_at: string | null;
    count: number;
    latest_available: number;
    up_to_date: boolean;
  };
  entreprises: {
    imported_at: string | null;
    count: number;
    up_to_date: boolean;
  };
  matching: {
    matched: number;
    haute: number;
    moyenne: number;
    basse: number;
    total: number;
    coverage_pct: number;
  };
  bdnb: {
    total: number;
    matched: number;
    with_siren: number;
    distance_m: number;
  };
}

interface UpdateStatus {
  running: boolean;
  action: string | null;
  last_log: string;
}

interface BatchData {
  id: number;
  nom: string;
  created_at: string;
  apis: {
    api_name: string;
    statut: string;
    nb_total: number;
    nb_enrichis: number;
    nb_erreurs: number;
    started_at: string | null;
    completed_at: string | null;
    data_count?: number;
  }[];
}

const API_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  api_gouv: { label: "API Gouv", icon: "\uD83C\uDFDB\uFE0F", color: "blue" },
  insee: { label: "INSEE Sirene", icon: "\uD83D\uDCCA", color: "indigo" },
  google_places: { label: "Google Places", icon: "\uD83D\uDCCD", color: "red" },
  bodacc: { label: "BODACC", icon: "\u2696\uFE0F", color: "amber" },
  pages_jaunes: { label: "Pages Jaunes", icon: "\uD83D\uDCD2", color: "yellow" },
};

export default function Parametres() {
  const [activeTab, setActiveTab] = useState<"donnees" | "enrichissement">("donnees");
  const [freshness, setFreshness] = useState<FreshnessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // BDNB distance state
  const [bdnbDistance, setBdnbDistance] = useState(200);
  const [bdnbRematching, setBdnbRematching] = useState(false);
  const [bdnbResult, setBdnbResult] = useState<string | null>(null);

  // Batch enrichissement state
  const [batches, setBatches] = useState<BatchData[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<BatchData | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [creatingBatch, setCreatingBatch] = useState(false);

  // CSV upload state
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{ source: string; inserted: number; skipped: number; errors: number } | null>(null);

  const fetchFreshness = useCallback(async () => {
    try {
      const resp = await fetch(`${API}/api/settings/freshness`);
      if (!resp.ok) throw new Error("Erreur API");
      const data = await resp.json();
      setFreshness(data);
      if (data.bdnb) {
        setBdnbDistance(data.bdnb.distance_m);
      }
    } catch {
      setError("Impossible de charger les informations");
    } finally {
      setLoading(false);
    }
  }, []);

  const checkUpdateStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${API}/api/settings/update/status`);
      const data: UpdateStatus = await resp.json();
      setUpdateStatus(data);
      if (!data.running && updating) {
        setUpdating(null);
        fetchFreshness();
      }
    } catch {
      // Silencieux
    }
  }, [updating, fetchFreshness]);

  const fetchBatches = useCallback(async () => {
    try {
      const resp = await fetch(`${API}/api/batch`);
      const json = await resp.json();
      setBatches(json.data || []);
    } catch (err) {
      console.error("Erreur batches:", err);
    }
  }, []);

  const fetchBatchDetail = useCallback(async (id: number, silent = false) => {
    if (!silent) setBatchLoading(true);
    try {
      const resp = await fetch(`${API}/api/batch/${id}`);
      if (!resp.ok) return;
      const json = await resp.json();
      setSelectedBatch(json.data || null);
    } catch (err) {
      console.error("Erreur batch detail:", err);
    } finally {
      if (!silent) setBatchLoading(false);
    }
  }, []);

  const createBatch = async () => {
    setCreatingBatch(true);
    setError(null);
    try {
      const resp = await fetch(`${API}/api/batch`, { method: "POST" });
      const json = await resp.json();
      if (!resp.ok) { setError(json.error || "Erreur"); return; }
      await fetchBatches();
      setSelectedBatch(null);
      fetchBatchDetail(json.data.id);
    } catch { setError("Erreur reseau"); }
    finally { setCreatingBatch(false); }
  };

  const triggerEnrich = async (batchId: number, apiName: string) => {
    setError(null);
    try {
      const resp = await fetch(`${API}/api/batch/${batchId}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_name: apiName }),
      });
      const json = await resp.json();
      if (!resp.ok) { setError(json.error || "Erreur"); return; }
      // Start polling (silent)
      setTimeout(() => fetchBatchDetail(batchId, true), 2000);
    } catch { setError("Erreur reseau"); }
  };

  const deleteBatch = async (batchId: number) => {
    if (!confirm("Supprimer cet enrichissement et toutes ses donnees ?")) return;
    try {
      await fetch(`${API}/api/batch/${batchId}`, { method: "DELETE" });
      setSelectedBatch(null);
      fetchBatches();
    } catch { setError("Erreur reseau"); }
  };

  const uploadCSV = async (batchId: number, source: "google_places" | "pages_jaunes", file: File) => {
    setUploading(source);
    setUploadResult(null);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("source", source);
      const resp = await fetch(`${API}/api/batch/${batchId}/upload`, {
        method: "POST",
        body: formData,
      });
      const json = await resp.json();
      if (!resp.ok) { setError(json.error || "Erreur upload"); return; }
      setUploadResult({ source, inserted: json.inserted, skipped: json.skipped, errors: json.errors });
      fetchBatchDetail(batchId, true);
    } catch { setError("Erreur reseau lors de l'upload"); }
    finally { setUploading(null); }
  };

  const exportQueries = async (batchId: number, type: "google" | "pj") => {
    try {
      const resp = await fetch(`${API}/api/batch/${batchId}/export-queries?type=${type}`);
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({}));
        setError(json.error || "Erreur export");
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = type === "google" ? `queries_google_batch_${batchId}.txt` : `prospects_pj_batch_${batchId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { setError("Erreur reseau"); }
  };

  useEffect(() => {
    fetchFreshness();
    fetchBatches();
  }, [fetchFreshness, fetchBatches]);

  // Poll batch detail when a batch has running APIs
  useEffect(() => {
    if (!selectedBatch) return;
    const hasRunning = selectedBatch.apis?.some((a) => a.statut === "running");
    if (!hasRunning) return;
    const interval = setInterval(() => fetchBatchDetail(selectedBatch.id, true), 5000);
    return () => clearInterval(interval);
  }, [selectedBatch, fetchBatchDetail]);

  useEffect(() => {
    if (!updating) return;
    const interval = setInterval(checkUpdateStatus, 3000);
    return () => clearInterval(interval);
  }, [updating, checkUpdateStatus]);

  const startUpdate = async (action: string) => {
    setError(null);
    try {
      const resp = await fetch(`${API}/api/settings/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || "Erreur lors du lancement");
        return;
      }
      setUpdating(action);
    } catch {
      setError("Erreur réseau");
    }
  };

  const applyBdnbDistance = async () => {
    setBdnbRematching(true);
    setBdnbResult(null);
    setError(null);
    try {
      const resp = await fetch(`${API}/api/settings/bdnb-distance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distance_m: bdnbDistance }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || "Erreur re-matching");
        return;
      }
      setBdnbResult(
        `${data.matched} serres matchees (sur ${data.total_bdnb} batiments BDNB)`
      );
      fetchFreshness();
    } catch {
      setError("Erreur réseau");
    } finally {
      setBdnbRematching(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Jamais";
    const d = new Date(dateStr);
    return d.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const daysSince = (dateStr: string | null) => {
    if (!dateStr) return null;
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Parametres</h1>
            <p className="text-sm text-gray-500">
              Fraicheur des donnees et mises a jour
            </p>
          </div>
          <a
            href="/"
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition text-sm font-medium"
          >
            Retour au tableau
          </a>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab("donnees")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === "donnees" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            Donnees & MAJ
          </button>
          <button
            onClick={() => { setActiveTab("enrichissement"); fetchBatches(); }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === "enrichissement" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            Enrichissement Total
          </button>
        </div>

        {/* ============ TAB: Enrichissement Total ============ */}
        {activeTab === "enrichissement" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Enrichissements</h2>
                <p className="text-xs text-gray-400">Creer un enrichissement total pour enrichir tous les prospects par API</p>
              </div>
              <button
                onClick={createBatch}
                disabled={creatingBatch}
                className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium disabled:opacity-40"
              >
                {creatingBatch ? "Creation..." : "+ Nouvel enrichissement"}
              </button>
            </div>

            <div className="grid md:grid-cols-3 gap-4 mb-6">
              {batches.map((b) => (
                <button
                  key={b.id}
                  onClick={() => fetchBatchDetail(b.id)}
                  className={`text-left bg-white rounded-xl border p-4 hover:shadow-md transition ${
                    selectedBatch?.id === b.id ? "border-blue-500 ring-2 ring-blue-200" : "border-gray-200"
                  }`}
                >
                  <p className="text-sm font-semibold text-gray-900">{b.nom}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(b.created_at)}</p>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {(b.apis || []).map((a) => {
                      const color = a.statut === "done" ? "bg-green-100 text-green-700" : a.statut === "running" ? "bg-blue-100 text-blue-700" : a.statut === "error" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500";
                      return (
                        <span key={a.api_name} className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${color}`}>
                          {API_LABELS[a.api_name]?.icon} {a.statut === "done" ? a.nb_enrichis : a.statut}
                        </span>
                      );
                    })}
                  </div>
                </button>
              ))}
              {batches.length === 0 && (
                <p className="text-sm text-gray-400 col-span-3 text-center py-8">Aucun enrichissement. Cliquez sur "+ Nouvel enrichissement" pour commencer.</p>
              )}
            </div>

            {/* Batch detail */}
            {selectedBatch && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{selectedBatch.nom}</h3>
                    <p className="text-xs text-gray-400">{formatDate(selectedBatch.created_at)}</p>
                  </div>
                  <button
                    onClick={() => deleteBatch(selectedBatch.id)}
                    className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                  >
                    Supprimer
                  </button>
                </div>

                <div className={`flex items-center gap-2 mb-4 transition-opacity ${batchLoading ? 'opacity-100' : 'opacity-0'}`}>
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-blue-600">Chargement...</span>
                </div>

                {/* Upload result banner */}
                {uploadResult && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                    <span className="font-medium">Import {uploadResult.source === "google_places" ? "Google" : "PJ"} termine :</span>{" "}
                    {uploadResult.inserted} importes, {uploadResult.skipped} ignores, {uploadResult.errors} erreurs
                  </div>
                )}

                <div className="space-y-3">
                  {(selectedBatch.apis || []).map((api) => {
                    const info = API_LABELS[api.api_name] || { label: api.api_name, icon: "", color: "gray" };
                    const isRunning = api.statut === "running";
                    const isDone = api.statut === "done";
                    const isError = api.statut === "error";
                    const pct = api.nb_total > 0 ? Math.round((api.nb_enrichis / api.nb_total) * 100) : 0;
                    const hasExternalScraper = api.api_name === "google_places" || api.api_name === "pages_jaunes";

                    return (
                      <div key={api.api_name} className="border border-gray-100 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-lg">{info.icon}</span>
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{info.label}</p>
                              {isDone && (
                                <p className="text-[11px] text-green-600">
                                  {api.nb_enrichis} enrichis / {api.nb_total} total
                                  {api.nb_erreurs > 0 && <span className="text-red-500 ml-1">({api.nb_erreurs} erreurs)</span>}
                                </p>
                              )}
                              {isRunning && (
                                <div className="flex items-center gap-2">
                                  <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-[11px] text-blue-600">{api.nb_enrichis}/{api.nb_total} ({pct}%)</span>
                                </div>
                              )}
                              {isError && <p className="text-[11px] text-red-500">Erreur</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {/* Export + Upload buttons for Google Places and Pages Jaunes */}
                            {hasExternalScraper && (
                              <>
                                <button
                                  onClick={() => exportQueries(
                                    selectedBatch.id,
                                    api.api_name === "google_places" ? "google" : "pj"
                                  )}
                                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200 transition"
                                  title={api.api_name === "google_places" ? "Exporter queries.txt pour gosom" : "Exporter prospects.csv pour PJ scraper"}
                                >
                                  Export
                                </button>
                                <label
                                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition ${
                                    uploading === api.api_name
                                      ? "bg-purple-50 text-purple-400 cursor-not-allowed"
                                      : "bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200"
                                  }`}
                                  title={api.api_name === "google_places" ? "Importer CSV gosom" : "Importer CSV PJ scraper"}
                                >
                                  {uploading === api.api_name ? (
                                    <span className="flex items-center gap-1">
                                      <span className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                                      Import...
                                    </span>
                                  ) : "Upload CSV"}
                                  <input
                                    type="file"
                                    accept=".csv"
                                    className="hidden"
                                    disabled={uploading === api.api_name}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        uploadCSV(selectedBatch.id, api.api_name as "google_places" | "pages_jaunes", file);
                                      }
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                              </>
                            )}
                            <button
                              onClick={() => triggerEnrich(selectedBatch.id, api.api_name)}
                              disabled={isRunning}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                                isDone
                                  ? "bg-green-50 text-green-700 hover:bg-green-100 border border-green-200"
                                  : isRunning
                                    ? "bg-blue-50 text-blue-400 cursor-not-allowed"
                                    : "bg-blue-600 text-white hover:bg-blue-700"
                              }`}
                            >
                              {isRunning ? (
                                <span className="flex items-center gap-1.5">
                                  <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                  En cours...
                                </span>
                              ) : isDone ? "Re-enrichir" : "Enrichir"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============ TAB: Donnees & MAJ ============ */}
        {activeTab === "donnees" && (<>

        {/* Indicateur MAJ en cours */}
        {updating && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <div>
                <p className="text-sm font-medium text-blue-700">
                  Mise a jour en cours : {updating}
                </p>
                {updateStatus?.last_log && (
                  <pre className="text-xs text-blue-500 mt-1 whitespace-pre-wrap max-h-20 overflow-y-auto">
                    {updateStatus.last_log}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {/* Carte RPG */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  RPG (Parcelles)
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Registre Parcellaire Graphique
                </p>
              </div>
              {freshness?.rpg.up_to_date ? (
                <span className="px-2.5 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                  A jour
                </span>
              ) : (
                <span className="px-2.5 py-1 bg-orange-100 text-orange-700 text-xs font-medium rounded-full">
                  MAJ dispo
                </span>
              )}
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Annee RPG</span>
                <span className="font-medium text-gray-900">
                  {freshness?.rpg.annee || "\u2014"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Derniere dispo</span>
                <span className="font-medium text-gray-900">
                  {freshness?.rpg.latest_available}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Nb parcelles</span>
                <span className="font-medium text-gray-900">
                  {freshness?.rpg.count.toLocaleString("fr-FR") || "0"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Importe le</span>
                <span className="text-gray-700">
                  {formatDate(freshness?.rpg.imported_at ?? null)}
                </span>
              </div>
              {freshness?.rpg.imported_at && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Age</span>
                  <span className="text-gray-700">
                    {daysSince(freshness.rpg.imported_at)} jours
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={() => startUpdate("rpg")}
              disabled={!!updating}
              className="mt-5 w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {updating === "rpg" ? "En cours..." : "Mettre a jour le RPG"}
            </button>
          </div>

          {/* Carte Entreprises */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Entreprises
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  API Recherche Entreprises
                </p>
              </div>
              {freshness?.entreprises.up_to_date ? (
                <span className="px-2.5 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                  A jour
                </span>
              ) : (
                <span className="px-2.5 py-1 bg-orange-100 text-orange-700 text-xs font-medium rounded-full">
                  MAJ dispo
                </span>
              )}
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Nb entreprises</span>
                <span className="font-medium text-gray-900">
                  {freshness?.entreprises.count.toLocaleString("fr-FR") || "0"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Importe le</span>
                <span className="text-gray-700">
                  {formatDate(freshness?.entreprises.imported_at ?? null)}
                </span>
              </div>
              {freshness?.entreprises.imported_at && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Age</span>
                  <span className="text-gray-700">
                    {daysSince(freshness.entreprises.imported_at)} jours
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Seuil MAJ</span>
                <span className="text-gray-700">30 jours</span>
              </div>
            </div>

            <button
              onClick={() => startUpdate("entreprises")}
              disabled={!!updating}
              className="mt-5 w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {updating === "entreprises"
                ? "En cours..."
                : "Mettre a jour les entreprises"}
            </button>
          </div>

          {/* Carte Matching */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Matching
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Association serre / entreprise
                </p>
              </div>
              <span className="px-2.5 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">
                {freshness?.matching.coverage_pct ?? 0}% couvert
              </span>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Serres matchees</span>
                <span className="font-medium text-gray-900">
                  {freshness?.matching.matched.toLocaleString("fr-FR") || "0"}{" "}
                  / {freshness?.matching.total.toLocaleString("fr-FR") || "0"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Confiance haute</span>
                <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">
                  {freshness?.matching.haute.toLocaleString("fr-FR") || "0"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Confiance moyenne</span>
                <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs font-medium rounded">
                  {freshness?.matching.moyenne.toLocaleString("fr-FR") || "0"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Confiance basse</span>
                <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded">
                  {freshness?.matching.basse.toLocaleString("fr-FR") || "0"}
                </span>
              </div>
            </div>

            <button
              onClick={() => startUpdate("match")}
              disabled={!!updating}
              className="mt-5 w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {updating === "match"
                ? "En cours..."
                : "Relancer le matching"}
            </button>
          </div>

          {/* Carte BDNB */}
          <div className="bg-white rounded-xl border border-indigo-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-indigo-900">
                  BDNB (IGN)
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Base de Donnees Nationale des Batiments
                </p>
              </div>
              <span className="px-2.5 py-1 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full">
                {freshness?.bdnb?.total?.toLocaleString("fr-FR") || "0"} batiments
              </span>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Batiments serres</span>
                <span className="font-medium text-gray-900">
                  {freshness?.bdnb?.total?.toLocaleString("fr-FR") || "0"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Matches avec RPG</span>
                <span className="font-medium text-indigo-700">
                  {freshness?.bdnb?.matched?.toLocaleString("fr-FR") || "0"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Avec SIREN proprio</span>
                <span className="font-medium text-gray-900">
                  {freshness?.bdnb?.with_siren?.toLocaleString("fr-FR") || "0"}
                </span>
              </div>

              {/* Distance slider */}
              <div className="pt-3 border-t border-gray-100">
                <label className="block text-xs text-gray-500 mb-2">
                  Rayon de match BDNB → RPG
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={50}
                    max={2000}
                    step={50}
                    value={bdnbDistance}
                    onChange={(e) => setBdnbDistance(Number(e.target.value))}
                    className="flex-1 accent-indigo-600"
                    disabled={bdnbRematching}
                  />
                  <span className="text-sm font-mono font-medium text-indigo-700 w-16 text-right">
                    {bdnbDistance}m
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>50m</span>
                  <span>2000m</span>
                </div>
              </div>

              {bdnbResult && (
                <div className="p-2 bg-indigo-50 rounded-lg text-xs text-indigo-700 font-medium">
                  {bdnbResult}
                </div>
              )}
            </div>

            <button
              onClick={applyBdnbDistance}
              disabled={bdnbRematching || bdnbDistance === (freshness?.bdnb?.distance_m ?? 200)}
              className="mt-5 w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {bdnbRematching && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              {bdnbRematching
                ? "Re-matching en cours..."
                : bdnbDistance === (freshness?.bdnb?.distance_m ?? 200)
                  ? `Distance actuelle : ${bdnbDistance}m`
                  : `Appliquer ${bdnbDistance}m (actuel: ${freshness?.bdnb?.distance_m ?? 200}m)`}
            </button>
          </div>
        </div>

        {/* Bouton global */}
        <div className="mt-8 flex justify-center">
          <button
            onClick={() => startUpdate("all")}
            disabled={!!updating}
            className="px-8 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {updating === "all"
              ? "Pipeline complet en cours..."
              : "Tout mettre a jour (RPG + Entreprises + Matching)"}
          </button>
        </div>

        </>)}
      </div>
    </div>
  );
}
