"use client";

import { useRouter } from "next/navigation";

export default function FeedError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  return (
    <div
      className="flex h-screen items-center justify-center"
      style={{ background: "var(--bg)" }}
    >
      <div className="text-center max-w-sm px-6">
        <div className="text-5xl mb-5">📺</div>
        <h2 className="font-bold text-lg mb-2" style={{ color: "var(--text)" }}>
          Error al cargar Videos
        </h2>
        <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
          El reproductor tuvo un problema. El resto de la app sigue funcionando
          normalmente.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-xl text-sm font-bold transition-opacity hover:opacity-80"
            style={{ background: "var(--accent)", color: "#000" }}
          >
            Reintentar
          </button>
          <button
            onClick={() => router.push("/chat")}
            className="px-4 py-2 rounded-xl text-sm font-bold transition-opacity hover:opacity-80"
            style={{ background: "var(--raised)", color: "var(--text)" }}
          >
            Ir al Chat
          </button>
        </div>
      </div>
    </div>
  );
}
