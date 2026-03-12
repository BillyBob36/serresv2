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

export default function Parametres() {
  const [freshness, setFreshness] = useState<FreshnessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // BDNB distance state
  const [bdnbDistance, setBdnbDistance] = useState(200);
  const [bdnbRematching, setBdnbRematching] = useState(false);
  const [bdnbResult, setBdnbResult] = useState<string | null>(null);

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

  useEffect(() => {
    fetchFreshness();
  }, [fetchFreshness]);

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
      </div>
    </div>
  );
}
