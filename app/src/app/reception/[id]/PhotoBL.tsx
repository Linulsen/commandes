"use client";

import { useRef, useState, type ReactNode } from "react";
import { qte } from "@/lib/format";
import type { LectureBL } from "@/lib/lecture-bl";

type Photo = { url: string; type: "image/jpeg"; data: string };

const COTE_MAX = 1600;
const PAGES_MAX = 6;

/** Réduit la photo (les téléphones font 4000 px) et la rend en JPEG base64. */
async function preparer(fichier: File): Promise<Photo> {
  const url = URL.createObjectURL(fichier);
  const img = await new Promise<HTMLImageElement>((ok, ko) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => ko(new Error("Image illisible"));
    i.src = url;
  });
  const echelle = Math.min(1, COTE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * echelle);
  canvas.height = Math.round(img.naturalHeight * echelle);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { url, type: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}

export type QuantiteLue = { produitId: number; colis: number };

/**
 * « Photographier le bon » : une ou plusieurs pages, lues par Claude. Les
 * quantités reconnues sont reportées dans la réception (pas validée) ; ce
 * panneau dit ce qui diffère de la commande et ce qui n'a pas été reconnu.
 */
export default function PhotoBL({
  receptionId,
  nomDe,
  commandes,
  onAppliquer,
}: {
  receptionId: number;
  nomDe: (pid: number) => string;
  /** Produits commandés : id → colis commandés. */
  commandes: Map<number, number>;
  onAppliquer: (quantites: QuantiteLue[]) => void;
}) {
  const champ = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [lecture, setLecture] = useState<LectureBL | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const ajouter = async (fichiers: FileList | null) => {
    if (!fichiers?.length) return;
    setErreur(null);
    try {
      const nouvelles = await Promise.all([...fichiers].map(preparer));
      setPhotos((p) => [...p, ...nouvelles].slice(0, PAGES_MAX));
      setOuvert(true);
    } catch {
      setErreur("Une photo n’a pas pu être ouverte.");
    }
    if (champ.current) champ.current.value = "";
  };

  const lire = async () => {
    setEnCours(true);
    setErreur(null);
    const r = await fetch(`/api/receptions/${receptionId}/photo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: photos.map(({ type, data }) => ({ type, data })) }),
    }).catch(() => null);
    const corps = await r?.json().catch(() => null);
    setEnCours(false);
    if (!r?.ok || !corps) {
      setErreur(corps?.erreur ?? "Lecture impossible (réseau ?)");
      return;
    }
    const res = corps as LectureBL;
    setLecture(res);
    if (!res.lisible) return;
    const parProduit = new Map<number, number>();
    for (const l of res.lignes) {
      if (l.produit_id !== null)
        parProduit.set(l.produit_id, (parProduit.get(l.produit_id) ?? 0) + l.colis);
    }
    onAppliquer([...parProduit].map(([produitId, colis]) => ({ produitId, colis })));
    for (const p of photos) URL.revokeObjectURL(p.url);
    setPhotos([]);
  };

  const fermer = () => {
    for (const p of photos) URL.revokeObjectURL(p.url);
    setPhotos([]);
    setLecture(null);
    setErreur(null);
    setOuvert(false);
  };

  const input = (
    <input
      ref={champ}
      type="file"
      accept="image/*"
      multiple
      hidden
      onChange={(e) => void ajouter(e.target.files)}
    />
  );

  if (!ouvert) {
    return (
      <>
        {input}
        <button
          onClick={() => champ.current?.click()}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-rouge-700 bg-white px-4 font-titre text-sm font-semibold text-rouge-700"
        >
          <span aria-hidden="true">📷</span> Photographier le bon de livraison
        </button>
        {erreur ? <p className="text-sm font-semibold text-rouge-700">{erreur}</p> : null}
      </>
    );
  }

  // Résultat de la lecture.
  if (lecture) {
    const lu = new Map<number, number>();
    for (const l of lecture.lignes)
      if (l.produit_id !== null) lu.set(l.produit_id, (lu.get(l.produit_id) ?? 0) + l.colis);
    const ecarts = [...lu].filter(([pid, c]) => commandes.has(pid) && commandes.get(pid) !== c);
    const horsCommande = [...lu].filter(([pid]) => !commandes.has(pid));
    const absents = [...commandes.keys()].filter((pid) => !lu.has(pid));
    const inconnues = lecture.lignes.filter((l) => l.produit_id === null);
    const remarques = lecture.lignes.filter((l) => l.produit_id !== null && l.remarque);

    return (
      <div className="space-y-3 rounded-2xl border border-neutre-100 bg-white p-4 shadow-sm">
        {!lecture.lisible ? (
          <p className="text-sm font-semibold text-rouge-700">
            Le bon n’a pas pu être lu (photo floue, coupée ou mal éclairée). Reprenez la photo
            bien à plat, tout le document dans le cadre.
          </p>
        ) : (
          <>
            <p className="text-sm font-semibold text-vert-800">
              Bon lu{lecture.numero ? ` n° ${lecture.numero}` : ""} : {lu.size} produit
              {lu.size > 1 ? "s" : ""} reporté{lu.size > 1 ? "s" : ""} ci-dessous. Vérifiez, puis
              validez.
            </p>
            <Bloc titre="Écarts avec la commande" vide="Aucun : tout correspond.">
              {ecarts.map(([pid, c]) => (
                <li key={pid}>
                  {nomDe(pid)} : commandé {qte(commandes.get(pid)!)}, sur le bon{" "}
                  <strong>{qte(c)}</strong>
                </li>
              ))}
            </Bloc>
            {absents.length ? (
              <Bloc titre="Commandés mais absents du bon (laissés décochés)">
                {absents.map((pid) => (
                  <li key={pid}>{nomDe(pid)}</li>
                ))}
              </Bloc>
            ) : null}
            {horsCommande.length ? (
              <Bloc titre="Livrés sans être commandés (ajoutés)">
                {horsCommande.map(([pid, c]) => (
                  <li key={pid}>
                    {nomDe(pid)} : {qte(c)} colis
                  </li>
                ))}
              </Bloc>
            ) : null}
            {inconnues.length ? (
              <Bloc titre="Lignes du bon non reconnues (à ajouter à la main si besoin)">
                {inconnues.map((l, i) => (
                  <li key={i}>
                    {l.libelle_bon} : {qte(l.colis)}
                    {l.remarque ? <span className="text-neutre-500"> · {l.remarque}</span> : null}
                  </li>
                ))}
              </Bloc>
            ) : null}
            {remarques.length || lecture.commentaire ? (
              <Bloc titre="Remarques">
                {remarques.map((l, i) => (
                  <li key={i}>
                    {nomDe(l.produit_id!)} : {l.remarque}
                  </li>
                ))}
                {lecture.commentaire ? <li>{lecture.commentaire}</li> : null}
              </Bloc>
            ) : null}
          </>
        )}
        <button
          onClick={fermer}
          className="min-h-11 w-full rounded-xl border border-neutre-200 px-4 text-sm font-semibold text-neutre-700"
        >
          Fermer
        </button>
      </div>
    );
  }

  // Photos prises, pas encore lues.
  return (
    <div className="space-y-3 rounded-2xl border border-neutre-100 bg-white p-4 shadow-sm">
      {input}
      <p className="text-sm font-semibold">
        {photos.length} page{photos.length > 1 ? "s" : ""} du bon
      </p>
      <div className="flex gap-2 overflow-x-auto">
        {photos.map((p, i) => (
          <div key={p.url} className="relative shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={`Page ${i + 1}`} className="h-24 w-auto rounded-lg border" />
            {!enCours ? (
              <button
                onClick={() => {
                  URL.revokeObjectURL(p.url);
                  setPhotos((ps) => ps.filter((q) => q !== p));
                }}
                aria-label={`Retirer la page ${i + 1}`}
                className="absolute -right-1 -top-1 h-7 w-7 rounded-full bg-neutre-900 text-sm text-white"
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {erreur ? <p className="text-sm font-semibold text-rouge-700">{erreur}</p> : null}
      {enCours ? (
        <p className="text-sm text-neutre-500">Lecture du bon… (jusqu’à une minute)</p>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => champ.current?.click()}
            disabled={photos.length >= PAGES_MAX}
            className="min-h-12 flex-1 rounded-xl border border-neutre-200 px-3 text-sm font-semibold text-neutre-700 disabled:opacity-35"
          >
            + Page
          </button>
          <button
            onClick={fermer}
            className="min-h-12 rounded-xl border border-neutre-200 px-3 text-sm font-semibold text-neutre-700"
          >
            Annuler
          </button>
          <button
            onClick={lire}
            disabled={photos.length === 0}
            className="min-h-12 flex-1 rounded-xl bg-rouge-700 px-3 font-titre text-sm font-semibold text-white disabled:opacity-35"
          >
            Lire le bon
          </button>
        </div>
      )}
    </div>
  );
}

function Bloc({
  titre,
  vide,
  children,
}: {
  titre: string;
  vide?: string;
  children: ReactNode;
}) {
  const liste = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutre-500">{titre}</p>
      {liste.length ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{children}</ul>
      ) : (
        <p className="mt-1 text-sm text-neutre-500">{vide}</p>
      )}
    </div>
  );
}
