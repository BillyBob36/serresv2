"use client";

import { useState } from "react";
import type { Serre, SerreMatch } from "@/lib/types";
import { CODE_CULTU_LABELS } from "@/lib/types";

interface FicheSerreProps {
  serre: Serre;
  onClose: () => void;
  onOpenEntreprise: (serre: Serre, match: SerreMatch) => void;
  excludedMatches: Record<string, boolean>;
}

type TabId = "parcelle" | "bdnb" | "prospects";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "parcelle", label: "Parcelle", icon: "\uD83C\uDF3E" },
  { id: "bdnb", label: "BDNB", icon: "\uD83C\uDFE0" },
  { id: "prospects", label: "Prospects", icon: "\uD83C\uDFE2" },
];

function Row({ label, value }: { label: string; value: any }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-50 text-xs">
      <span className="text-gray-500 shrink-0 mr-3">{label}</span>
      <span className="text-gray-900 text-right font-medium">{value}</span>
    </div>
  );
}

export default function FicheSerre({ serre: s, onClose, onOpenEntreprise, excludedMatches }: FicheSerreProps) {
  const [tab, setTab] = useState<TabId>("parcelle");

  const matches = s.top_matches || [];

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Panel gauche */}
      <div className="fixed top-0 left-0 h-full w-[30vw] min-w-[360px] max-w-[90vw] bg-white shadow-2xl z-50 flex flex-col border-r border-gray-200 animate-slide-in-left">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 bg-gray-50 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-gray-900">
                Serre #{s.id}
              </h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${s.code_cultu === "CSS" ? "bg-purple-100 text-purple-700" : s.code_cultu === "FLA" ? "bg-pink-100 text-pink-700" : "bg-green-100 text-green-700"}`}>
                  {CODE_CULTU_LABELS[s.code_cultu] || s.code_cultu}
                </span>
                {s.commune && <span className="text-xs text-gray-500">{s.commune}</span>}
                {s.departement && <span className="text-xs text-gray-400">({s.departement})</span>}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Parcelle {s.id_parcel}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none shrink-0 mt-0.5">&times;</button>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-2 mt-3">
            <a
              href={`/carte?lat=${s.centroid_lat}&lon=${s.centroid_lon}&zoom=17`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
              Voir sur carte
            </a>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-2 pt-1 bg-white shrink-0 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition ${tab === t.id ? "border-green-600 text-green-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "parcelle" && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Informations parcelle RPG</p>
              <Row label="ID Serre" value={s.id} />
              <Row label="ID Parcelle" value={s.id_parcel} />
              <Row label="Commune" value={s.commune} />
              <Row label="Code postal" value={s.code_postal} />
              <Row label="Departement" value={s.departement} />
              <Row label="Annee RPG" value={s.annee_rpg} />
              <Row label="Culture" value={CODE_CULTU_LABELS[s.code_cultu] || s.code_cultu} />
              <Row label="Code culture" value={s.code_cultu} />
              <Row label="Groupe" value={s.code_group} />

              <div className="h-3" />
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Surfaces</p>
              <Row label="Surface RPG" value={`${Number(s.surface_ha).toFixed(2)} ha (${Math.round(Number(s.surface_ha) * 10000).toLocaleString("fr-FR")} m\u00B2)`} />
              {s.surface_osm_m2 && (
                <Row label="Surface OSM (serre)" value={`${(Number(s.surface_osm_m2) / 10000).toFixed(2)} ha (${Math.round(Number(s.surface_osm_m2)).toLocaleString("fr-FR")} m\u00B2)`} />
              )}

              <div className="h-3" />
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Coordonnees</p>
              <Row label="Centroide RPG" value={`${Number(s.centroid_lat).toFixed(6)}, ${Number(s.centroid_lon).toFixed(6)}`} />
              {s.osm_centroid_lat && s.osm_centroid_lon && (
                <Row label="Centroide OSM" value={`${Number(s.osm_centroid_lat).toFixed(6)}, ${Number(s.osm_centroid_lon).toFixed(6)}`} />
              )}
            </div>
          )}

          {tab === "bdnb" && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Batiment BDNB</p>
              {s.bdnb_id ? (
                <>
                  <Row label="ID BDNB" value={s.bdnb_id} />
                  <Row label="Nature" value={s.bdnb_nature} />
                  <Row label="Surface BDNB" value={s.bdnb_surface_m2 ? `${Number(s.bdnb_surface_m2).toLocaleString("fr-FR")} m\u00B2` : null} />
                  <Row label="Hauteur moyenne" value={s.bdnb_hauteur_moy ? `${Number(s.bdnb_hauteur_moy).toFixed(1)} m` : null} />
                  <Row label="Hauteur max" value={s.bdnb_hauteur_max ? `${Number(s.bdnb_hauteur_max).toFixed(1)} m` : null} />
                  <Row label="Etat" value={s.bdnb_etat} />
                  <Row label="Parcelle cadastrale" value={s.bdnb_parcelle} />
                  <Row label="Distance RPG" value={s.bdnb_distance_m ? `${Number(s.bdnb_distance_m).toFixed(0)} m` : null} />

                  {(s.bdnb_prop_siren || s.bdnb_prop_nom) && (
                    <>
                      <div className="h-3" />
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Proprietaire BDNB</p>
                      <Row label="SIREN" value={s.bdnb_prop_siren} />
                      <Row label="Nom" value={s.bdnb_prop_nom} />
                      <Row label="Forme juridique" value={s.bdnb_prop_forme} />
                    </>
                  )}

                  {s.bdnb_adresse && (
                    <>
                      <div className="h-3" />
                      <Row label="Adresse BDNB" value={s.bdnb_adresse} />
                    </>
                  )}
                </>
              ) : (
                <p className="text-xs text-gray-400">Aucune donnee BDNB associee a cette serre</p>
              )}
            </div>
          )}

          {tab === "prospects" && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Entreprises associees ({matches.length})
              </p>
              {matches.length === 0 ? (
                <p className="text-xs text-gray-400">Aucune entreprise associee</p>
              ) : (
                <div className="space-y-2">
                  {matches.map((m, i) => {
                    const isExcluded = excludedMatches[`${s.id}_${m.siren}`];
                    return (
                      <div
                        key={m.siren}
                        className={`border rounded-lg p-3 cursor-pointer transition hover:shadow-md ${isExcluded ? "opacity-40 line-through border-gray-200" : "border-blue-200 hover:border-blue-400"}`}
                        onClick={() => !isExcluded && onOpenEntreprise(s, m)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm text-blue-700 truncate">{m.nom_entreprise || "\u2014"}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${m.confiance === "haute" ? "bg-green-100 text-green-700" : m.confiance === "moyenne" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-600"}`}>
                            {m.confiance}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500">
                          <span>SIREN {m.siren}</span>
                          <span>{Number(m.distance_km).toFixed(1)} km</span>
                          {m.commune_entreprise && <span>{m.commune_entreprise}</span>}
                        </div>
                        {m.dirigeant_nom && (
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            Dirigeant : {m.dirigeant_prenom} {m.dirigeant_nom}
                          </p>
                        )}
                        {isExcluded && <p className="text-[10px] text-red-400 mt-1">Exclu pour cette serre</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
