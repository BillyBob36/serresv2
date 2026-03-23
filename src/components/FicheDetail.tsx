"use client";

import { useState } from "react";

interface FicheDetailProps {
  data: any;
  serre: any;
  match: any;
  onClose: () => void;
  onEnrichir: () => void;
  enrichLoading: boolean;
  prospection: { statut: string; match_valide: string } | null;
  onUpdateProspection: (field: string, value: string) => void;
  notes: { id: number; note: string; created_at: string; username?: string }[];
  onAddNote: (text: string) => void;
}

type TabId = "identite" | "dirigeants" | "contact" | "finances" | "juridique" | "notes";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "identite", label: "Identite", icon: "\uD83C\uDFE2" },
  { id: "dirigeants", label: "Personnes", icon: "\uD83D\uDC65" },
  { id: "contact", label: "Contact", icon: "\uD83D\uDCDE" },
  { id: "finances", label: "Finances", icon: "\uD83D\uDCB0" },
  { id: "juridique", label: "Juridique", icon: "\u2696\uFE0F" },
  { id: "notes", label: "Notes", icon: "\uD83D\uDCDD" },
];

const STATUT_COLORS: Record<string, string> = {
  nouveau: "bg-gray-100 text-gray-600",
  a_contacter: "bg-blue-100 text-blue-700",
  appele: "bg-yellow-100 text-yellow-700",
  interesse: "bg-green-100 text-green-700",
  pas_interesse: "bg-red-100 text-red-700",
  injoignable: "bg-orange-100 text-orange-700",
  client: "bg-purple-100 text-purple-700",
};

function Row({ label, value, className }: { label: string; value: any; className?: string }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className={`flex justify-between py-1.5 border-b border-gray-50 ${className || ""}`}>
      <span className="text-gray-500 text-xs shrink-0 mr-3">{label}</span>
      <span className="text-gray-900 text-xs text-right font-medium">{value}</span>
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${color}`}>
      {children}
    </span>
  );
}

function safeJsonArray(val: any): any[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

export default function FicheDetail({
  data,
  serre,
  match,
  onClose,
  onEnrichir,
  enrichLoading,
  prospection,
  onUpdateProspection,
  notes,
  onAddNote,
}: FicheDetailProps) {
  const [tab, setTab] = useState<TabId>("identite");
  const [noteText, setNoteText] = useState("");
  const e = data;

  const etatLabel = e?.etat_administratif === "A" ? "Active" : e?.etat_administratif === "C" ? "Cessee" : null;
  const etatColor = e?.etat_administratif === "A" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700";

  const googleStatusLabel: Record<string, string> = {
    OPERATIONAL: "En activite",
    CLOSED_TEMPORARILY: "Ferme temporairement",
    CLOSED_PERMANENTLY: "Ferme definitivement",
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-[35vw] min-w-[400px] max-w-[90vw] bg-white shadow-2xl z-50 flex flex-col border-l border-gray-200 animate-slide-in">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 bg-gray-50 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-gray-900 truncate" title={e?.nom_complet || match?.nom_entreprise || ""}>
                {e?.nom_complet || match?.nom_entreprise || "Entreprise"}
              </h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {etatLabel && <Badge color={etatColor}>{etatLabel}</Badge>}
                {e?.est_bio && <Badge color="bg-emerald-100 text-emerald-700">BIO</Badge>}
                {e?.bodacc_procedures && Array.isArray(e.bodacc_procedures) && e.bodacc_procedures.length > 0 && (
                  <Badge color="bg-red-100 text-red-700">Proc. collective</Badge>
                )}
                {e?.google_business_status && e.google_business_status !== "OPERATIONAL" && (
                  <Badge color="bg-amber-100 text-amber-700">{googleStatusLabel[e.google_business_status] || e.google_business_status}</Badge>
                )}
                {e?.est_rge && <Badge color="bg-teal-100 text-teal-700">RGE</Badge>}
                {e?.est_ess && <Badge color="bg-indigo-100 text-indigo-700">ESS</Badge>}
                {e?.est_societe_mission && <Badge color="bg-violet-100 text-violet-700">Mission</Badge>}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                SIREN {match?.siren || e?.siren}
                {e?.siret_siege && <> &middot; SIRET {e.siret_siege}</>}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none shrink-0 mt-0.5">&times;</button>
          </div>

          {/* Actions rapides */}
          <div className="flex items-center gap-2 mt-3">
            {!e ? (
              <button
                onClick={onEnrichir}
                disabled={enrichLoading}
                className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-medium hover:bg-orange-600 disabled:opacity-50"
              >
                {enrichLoading ? "Enrichissement..." : "Enrichir cette entreprise"}
              </button>
            ) : (
              <span className="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-medium border border-green-200">
                Enrichi le {e.enrichi_at ? new Date(e.enrichi_at).toLocaleDateString("fr-FR") : "—"}
              </span>
            )}
            <select
              value={prospection?.statut || "nouveau"}
              onChange={(ev) => onUpdateProspection("statut", ev.target.value)}
              className={`text-[11px] rounded-lg px-2 py-1.5 border-0 font-medium cursor-pointer ${STATUT_COLORS[prospection?.statut || "nouveau"] || "bg-gray-100 text-gray-600"}`}
            >
              <option value="nouveau">Nouveau</option>
              <option value="a_contacter">A contacter</option>
              <option value="appele">Appele</option>
              <option value="interesse">Interesse</option>
              <option value="pas_interesse">Pas interesse</option>
              <option value="injoignable">Injoignable</option>
              <option value="client">Client</option>
            </select>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 shrink-0 bg-white px-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition ${
                tab === t.id
                  ? "border-blue-500 text-blue-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <span className="mr-1">{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!e && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-4xl mb-3">{"\uD83D\uDD0D"}</p>
              <p className="text-sm">Cliquez sur &laquo; Enrichir &raquo; pour charger les donnees</p>
            </div>
          )}

          {e && tab === "identite" && (
            <div className="space-y-1">
              <Row label="Nom complet" value={e.nom_complet} />
              <Row label="Raison sociale" value={e.nom_raison_sociale} />
              {e.sigle && <Row label="Sigle" value={e.sigle} />}
              <Row label="SIREN" value={e.siren} />
              <Row label="SIRET siege" value={e.siret_siege} />
              <Row label="Forme juridique" value={e.forme_juridique} />
              <Row label="Date creation" value={e.date_creation ? new Date(e.date_creation).toLocaleDateString("fr-FR") : null} />
              {e.date_fermeture && (
                <Row label="Date fermeture" value={new Date(e.date_fermeture).toLocaleDateString("fr-FR")} className="bg-red-50" />
              )}
              <Row label="Etat" value={etatLabel} />
              <Row label="Categorie" value={e.categorie_entreprise || "—"} />
              <Row label="Nb etablissements" value={e.nombre_etablissements_ouverts ? `${e.nombre_etablissements_ouverts} ouvert(s) / ${e.nombre_etablissements} total` : e.nombre_etablissements} />
              <Row label="Employeur" value={e.caractere_employeur ? "Oui" : "Non"} />

              <div className="h-3" />
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Activite</p>
              <Row label="Code NAF" value={e.code_naf} />
              {e.activite_principale_naf25 && <Row label="NAF 2025" value={e.activite_principale_naf25} />}
              <Row label="Section" value={e.section_activite_principale} />
              <Row label="Effectifs" value={e.tranche_effectifs} />
              {e.annee_tranche_effectif && <Row label="Annee effectif" value={e.annee_tranche_effectif} />}
              {e.google_primary_type && <Row label="Type Google" value={e.google_primary_type} />}
              {e.google_types && <Row label="Categories Google" value={(Array.isArray(e.google_types) ? e.google_types : []).join(", ")} />}

              <div className="h-3" />
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Labels & complements</p>
              <Row label="Bio" value={e.est_bio ? "Oui" : "Non"} />
              <Row label="Entrepreneur individuel" value={e.est_entrepreneur_individuel ? "Oui" : "Non"} />
              <Row label="ESS" value={e.est_ess ? "Oui" : "Non"} />
              <Row label="RGE" value={e.est_rge ? "Oui" : "Non"} />
              <Row label="Societe a mission" value={e.est_societe_mission ? "Oui" : "Non"} />
              <Row label="Convention collective" value={e.convention_collective_renseignee ? "Oui" : "Non"} />
              {e.liste_idcc && (Array.isArray(e.liste_idcc) ? e.liste_idcc : []).length > 0 && (
                <Row label="Codes IDCC" value={(Array.isArray(e.liste_idcc) ? e.liste_idcc : []).join(", ")} />
              )}
            </div>
          )}

          {e && tab === "dirigeants" && (
            <div>
              {(() => {
                const dirsComplet = safeJsonArray(e.dirigeants_complet);
                const dirsSimplifie = safeJsonArray(e.dirigeants);
                const dirs = dirsComplet.length > 0 ? dirsComplet : dirsSimplifie;

                const personnesPhysiques = dirs.filter((d: any) => d.type_dirigeant !== "personne morale");
                const personnesMorales = dirs.filter((d: any) => d.type_dirigeant === "personne morale");

                if (dirs.length === 0) return <p className="text-xs text-gray-400">Aucune personne connue</p>;
                return (
                  <>
                    {personnesPhysiques.length > 0 && (
                      <>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Dirigeants & personnes physiques ({personnesPhysiques.length})</p>
                        <div className="space-y-2 mb-4">
                          {personnesPhysiques.map((d: any, i: number) => (
                            <div key={i} className="border border-gray-200 rounded-lg p-3">
                              <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm shrink-0">
                                  {(d.prenoms || d.prenom || "?").charAt(0)}{(d.nom || "?").charAt(0)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-gray-900">
                                    {`${d.prenoms || d.prenom || ""} ${d.nom || ""}`.trim() || "—"}
                                  </p>
                                  {d.qualite && <p className="text-xs text-blue-600 font-medium">{d.qualite}</p>}
                                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500 mt-1">
                                    {d.nationalite && <span>Nationalite: {d.nationalite}</span>}
                                    {d.date_de_naissance && <span>Ne(e): {d.date_de_naissance}</span>}
                                    {d.annee_de_naissance && !d.date_de_naissance && <span>Annee: {d.annee_de_naissance}</span>}
                                  </div>
                                  {/* Per-person contact info */}
                                  {(d.telephone || d.email) && (
                                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-gray-100">
                                      {d.telephone && (
                                        <a href={`tel:${d.telephone}`} className="text-[11px] text-blue-600 hover:underline flex items-center gap-1">
                                          <span className="text-gray-400">Tel:</span> {d.telephone}
                                        </a>
                                      )}
                                      {d.email && (
                                        <a href={`mailto:${d.email}`} className="text-[11px] text-blue-600 hover:underline flex items-center gap-1">
                                          <span className="text-gray-400">Email:</span> {d.email}
                                        </a>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {personnesMorales.length > 0 && (
                      <>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Personnes morales ({personnesMorales.length})</p>
                        <div className="space-y-2">
                          {personnesMorales.map((d: any, i: number) => (
                            <div key={i} className="border border-gray-200 rounded-lg p-3">
                              <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-sm shrink-0">{"\uD83C\uDFE2"}</div>
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-gray-900">{d.denomination || d.siren || "PM"}</p>
                                  {d.qualite && <p className="text-xs text-blue-600 font-medium">{d.qualite}</p>}
                                  {d.siren && <p className="text-[11px] text-gray-400">SIREN {d.siren}</p>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {e && tab === "contact" && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Contact</p>
              {(() => {
                // Cascade: company phone → dirigeant phone by hierarchy → employee phone
                const QUALITE_PRIORITY: Record<string, number> = {
                  "Gérant": 1, "Gerant": 1,
                  "Président": 2, "President": 2,
                  "Directeur général": 3, "Directeur general": 3,
                  "Associé": 4, "Associe": 4,
                  "Co-gérant": 5, "Co-gerant": 5,
                };
                const dirs = safeJsonArray(e.dirigeants_complet).length > 0
                  ? safeJsonArray(e.dirigeants_complet)
                  : safeJsonArray(e.dirigeants);
                const physiques = dirs
                  .filter((d: any) => d.type_dirigeant !== "personne morale")
                  .sort((a: any, b: any) => (QUALITE_PRIORITY[a.qualite] || 99) - (QUALITE_PRIORITY[b.qualite] || 99));

                // Find best phone: company first, then dirigeant cascade
                let bestPhone = e.telephone || null;
                let phoneOwner: string | null = null;

                if (!bestPhone) {
                  for (const d of physiques) {
                    if (d.telephone) {
                      bestPhone = d.telephone;
                      phoneOwner = `${d.prenoms || d.prenom || ""} ${d.nom || ""}`.trim();
                      break;
                    }
                  }
                }

                // Find best email: company first, then dirigeant cascade
                let bestEmail = e.email || null;
                let emailOwner: string | null = null;

                if (!bestEmail) {
                  for (const d of physiques) {
                    if (d.email) {
                      bestEmail = d.email;
                      emailOwner = `${d.prenoms || d.prenom || ""} ${d.nom || ""}`.trim();
                      break;
                    }
                  }
                }

                return (
                  <>
                    {bestPhone ? (
                      <Row
                        label="Telephone"
                        value={
                          <span>
                            <a href={`tel:${bestPhone}`} className="text-blue-600 hover:underline">{bestPhone}</a>
                            {phoneOwner && <span className="text-gray-400 text-[10px] ml-1">({phoneOwner})</span>}
                          </span>
                        }
                      />
                    ) : (
                      <Row label="Telephone" value={<span className="text-gray-300">—</span>} />
                    )}
                    {e.site_web ? (
                      <Row
                        label="Site web"
                        value={<a href={e.site_web} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate max-w-[200px] inline-block">{e.site_web.replace(/^https?:\/\//, "")}</a>}
                      />
                    ) : (
                      <Row label="Site web" value={<span className="text-gray-300">—</span>} />
                    )}
                    {bestEmail ? (
                      <Row
                        label="Email"
                        value={
                          <span>
                            <a href={`mailto:${bestEmail}`} className="text-blue-600 hover:underline">{bestEmail}</a>
                            {emailOwner && <span className="text-gray-400 text-[10px] ml-1">({emailOwner})</span>}
                          </span>
                        }
                      />
                    ) : (
                      <Row label="Email" value={<span className="text-gray-300">—</span>} />
                    )}
                  </>
                );
              })()}

              <div className="h-3" />
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Localisation siege</p>
              <Row label="Adresse" value={e.adresse_siege} />
              <Row label="Code postal" value={e.code_postal_siege} />
              <Row label="Commune" value={e.libelle_commune_siege} />
              {e.latitude_siege && e.longitude_siege && (
                <Row
                  label="GPS"
                  value={
                    <a
                      href={`https://www.google.com/maps?q=${e.latitude_siege},${e.longitude_siege}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {Number(e.latitude_siege).toFixed(4)}, {Number(e.longitude_siege).toFixed(4)}
                    </a>
                  }
                />
              )}
              {e.google_maps_uri && (
                <Row
                  label="Google Maps"
                  value={<a href={e.google_maps_uri} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Voir sur Maps</a>}
                />
              )}

              <div className="h-3" />
              {/* Tous les telephones PJ si multiples */}
              {e.pj_telephone && Array.isArray(e.pj_telephone) && e.pj_telephone.length > 1 && (
                <div className="mt-1">
                  <p className="text-[10px] text-gray-400">Autres tel PJ :</p>
                  {e.pj_telephone.slice(1).map((t: string, i: number) => (
                    <a key={i} href={`tel:${t}`} className="text-[11px] text-blue-600 hover:underline block">{t}</a>
                  ))}
                </div>
              )}

              <div className="h-3" />
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Sources enrichissement</p>
              <Row label="Sources" value={e.source} />
              {e.pj_match_confidence && <Row label="Confiance PJ" value={e.pj_match_confidence} />}
              {e.pj_source_personne && <Row label="Trouve via" value={e.pj_source_personne} />}

              <div className="h-3" />
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Avis & presence en ligne</p>
              <Row label="Statut" value={e.google_business_status ? (googleStatusLabel[e.google_business_status] || e.google_business_status) : null} />
              <Row label="Note" value={e.note_google ? `${e.note_google}/5 (${e.avis_count || 0} avis)${e.note_source === "pj" ? " - PJ" : " - Google"}` : null} />
              <Row label="Type" value={e.google_primary_type} />
              {e.pj_url && (
                <Row
                  label="Pages Jaunes"
                  value={<a href={e.pj_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Voir la fiche PJ</a>}
                />
              )}
              {e.pj_description && <Row label="Description PJ" value={e.pj_description} />}
              {e.pj_activite && <Row label="Activite PJ" value={e.pj_activite} />}
              {e.pj_multi_activite && Array.isArray(e.pj_multi_activite) && e.pj_multi_activite.length > 0 && (
                <Row label="Multi-activites" value={e.pj_multi_activite.join(", ")} />
              )}
              {e.horaires && (
                <div className="mt-2">
                  <p className="text-xs text-gray-500 mb-1">Horaires</p>
                  <div className="text-[11px] text-gray-700 space-y-0.5">
                    {e.horaires.split(" | ").map((h: string, i: number) => (
                      <p key={i}>{h}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {e && tab === "finances" && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Finances</p>

              {/* Derniers chiffres */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-[10px] text-blue-500 uppercase">Chiffre d&apos;affaires</p>
                  <p className="text-lg font-bold text-blue-700">
                    {e.chiffre_affaires ? `${Number(e.chiffre_affaires).toLocaleString("fr-FR")} \u20AC` : "—"}
                  </p>
                </div>
                <div className={`rounded-lg p-3 text-center ${e.resultat_net && Number(e.resultat_net) < 0 ? "bg-red-50" : "bg-green-50"}`}>
                  <p className={`text-[10px] uppercase ${e.resultat_net && Number(e.resultat_net) < 0 ? "text-red-500" : "text-green-500"}`}>Resultat net</p>
                  <p className={`text-lg font-bold ${e.resultat_net && Number(e.resultat_net) < 0 ? "text-red-700" : "text-green-700"}`}>
                    {e.resultat_net ? `${Number(e.resultat_net).toLocaleString("fr-FR")} \u20AC` : "—"}
                  </p>
                </div>
              </div>

              {/* Historique */}
              {e.finances_historique && typeof e.finances_historique === "object" && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Historique</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-1.5 text-gray-500 font-medium">Annee</th>
                        <th className="text-right py-1.5 text-gray-500 font-medium">CA</th>
                        <th className="text-right py-1.5 text-gray-500 font-medium">Resultat net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.keys(e.finances_historique)
                        .sort()
                        .reverse()
                        .map((annee: string) => {
                          const f = e.finances_historique[annee];
                          return (
                            <tr key={annee} className="border-b border-gray-50">
                              <td className="py-1.5 font-medium text-gray-700">{annee}</td>
                              <td className="py-1.5 text-right font-mono text-gray-600">
                                {f.ca != null ? `${Number(f.ca).toLocaleString("fr-FR")} \u20AC` : "—"}
                              </td>
                              <td className={`py-1.5 text-right font-mono ${f.resultat_net != null && Number(f.resultat_net) < 0 ? "text-red-600" : "text-gray-600"}`}>
                                {f.resultat_net != null ? `${Number(f.resultat_net).toLocaleString("fr-FR")} \u20AC` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Depots BODACC */}
              {e.bodacc_depots_comptes && Array.isArray(e.bodacc_depots_comptes) && e.bodacc_depots_comptes.length > 0 && (
                <div className="mt-4">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Depots de comptes (BODACC)</p>
                  <div className="space-y-1">
                    {e.bodacc_depots_comptes.slice(0, 5).map((d: any, i: number) => (
                      <div key={i} className="text-[11px] flex justify-between py-1 border-b border-gray-50">
                        <span className="text-gray-500">{d.date ? new Date(d.date).toLocaleDateString("fr-FR") : "—"}</span>
                        <span className="text-gray-700">{d.type_depot || d.type || "Depot"}</span>
                        {d.date_cloture && <span className="text-gray-400">Cloture: {d.date_cloture}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {e && tab === "juridique" && (
            <div>
              {/* Procedures collectives */}
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Procedures collectives (BODACC)</p>
              {e.bodacc_procedures && Array.isArray(e.bodacc_procedures) && e.bodacc_procedures.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {e.bodacc_procedures.map((p: any, i: number) => (
                    <div key={i} className="border border-red-200 bg-red-50 rounded-lg p-2.5 text-xs">
                      <div className="flex justify-between">
                        <span className="font-semibold text-red-700">{p.type || "Procedure"}</span>
                        <span className="text-red-500">{p.date ? new Date(p.date).toLocaleDateString("fr-FR") : ""}</span>
                      </div>
                      {p.tribunal && <p className="text-red-600 text-[11px] mt-0.5">{p.tribunal}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-green-600 mb-4">Aucune procedure collective</p>
              )}

              {/* Modifications */}
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Modifications recentes (BODACC)</p>
              {e.bodacc_derniere_modification && Array.isArray(e.bodacc_derniere_modification) && e.bodacc_derniere_modification.length > 0 ? (
                <div className="space-y-1">
                  {e.bodacc_derniere_modification.map((m: any, i: number) => (
                    <div key={i} className="text-[11px] flex justify-between py-1 border-b border-gray-50">
                      <span className="text-gray-500">{m.date ? new Date(m.date).toLocaleDateString("fr-FR") : "—"}</span>
                      <span className="text-gray-700">{m.type || "Modification"}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">Aucune modification recente</p>
              )}
            </div>
          )}

          {tab === "notes" && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Notes de prospection</p>
              <div className="space-y-2 max-h-[50vh] overflow-y-auto mb-3">
                {notes.length === 0 && <p className="text-xs text-gray-400">Aucune note</p>}
                {notes.map((n) => (
                  <div key={n.id} className="text-xs border-l-2 border-blue-200 pl-2 py-1">
                    <span className="text-gray-400">
                      {new Date(n.created_at).toLocaleDateString("fr-FR")}{" "}
                      {new Date(n.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {n.username && <span className="text-blue-500 ml-1">{n.username}</span>}
                    <p className="text-gray-700 mt-0.5">{n.note}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={noteText}
                  onChange={(ev) => setNoteText(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" && noteText.trim()) {
                      onAddNote(noteText.trim());
                      setNoteText("");
                    }
                  }}
                  placeholder="Ajouter une note..."
                  className="flex-1 text-xs px-2 py-1.5 border border-gray-300 rounded-lg text-gray-900 bg-white"
                />
                <button
                  onClick={() => {
                    if (noteText.trim()) {
                      onAddNote(noteText.trim());
                      setNoteText("");
                    }
                  }}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700"
                >
                  OK
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
