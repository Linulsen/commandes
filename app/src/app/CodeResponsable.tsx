"use client";

import { useState, type FormEvent } from "react";

/**
 * Demande du code responsable. Ouvre la session responsable (15 minutes sur
 * cet appareil) puis appelle `onOk`.
 */
export default function CodeResponsable({
  message,
  onOk,
}: {
  message: string;
  onOk: () => void;
}) {
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const valider = async (e: FormEvent) => {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    const r = await fetch("/api/responsable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }).catch(() => null);
    setEnvoi(false);
    if (r?.ok) {
      setCode("");
      onOk();
      return;
    }
    const corps = (await r?.json().catch(() => null)) as { erreur?: string } | null;
    setErreur(corps?.erreur ?? "Pas de réseau : réessayez.");
  };

  return (
    <form
      onSubmit={valider}
      className="mb-3 rounded-2xl border border-neutre-100 bg-white p-4 shadow-sm"
    >
      <p className="flex items-center gap-1.5 font-titre text-base font-semibold">
        <span aria-hidden="true">🔒</span> Code responsable
      </p>
      <p className="mt-1 text-sm text-neutre-500">{message}</p>
      <div className="mt-3 flex gap-2">
        <input
          type="password"
          inputMode="text"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label="Code responsable"
          className="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-neutre-200 bg-white px-3 text-base outline-none focus:border-rouge-700"
        />
        <button
          type="submit"
          disabled={!code || envoi}
          className="min-h-12 shrink-0 rounded-xl bg-rouge-700 px-4 font-titre text-sm font-semibold text-white disabled:bg-neutre-200 disabled:text-neutre-500"
        >
          {envoi ? "…" : "Valider"}
        </button>
      </div>
      {erreur ? <p className="mt-2 text-sm text-rouge-700">{erreur}</p> : null}
    </form>
  );
}
