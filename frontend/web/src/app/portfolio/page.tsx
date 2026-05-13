"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { market as marketApi } from "@/lib/api";
import { useAuthStore, useProfileStore } from "@/lib/store";
import { PieChart, ArrowLeft, Loader2 } from "lucide-react";

type Scenario = "conservative" | "moderate" | "aggressive";

const SCENARIOS: { value: Scenario; label: string; emoji: string; desc: string }[] = [
  { value: "conservative", label: "Conservador", emoji: "🛡️", desc: "Estabilidad, dividendos, menor volatilidad" },
  { value: "moderate", label: "Moderado", emoji: "⚖️", desc: "Balance entre crecimiento y protección" },
  { value: "aggressive", label: "Agresivo", emoji: "🚀", desc: "Máximo crecimiento, alta volatilidad" },
];

export default function PortfolioPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { profile } = useProfileStore();
  const [selectedScenario, setSelectedScenario] = useState<Scenario>("moderate");
  const [capital, setCapital] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isAuthenticated) { router.push("/"); return null; }

  const handleSimulate = async () => {
    setLoading(true);
    setAnalysis("");
    try {
      const res = await marketApi.getPortfolio(
        selectedScenario,
        capital ? parseFloat(capital) : undefined
      );
      setAnalysis(res.data.analysis);
    } catch {
      setAnalysis("Error al generar la simulación. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1117] p-4">
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => router.push("/chat")}
          className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Volver al chat
        </button>

        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-brand-600/20 border border-brand-500/30 rounded-xl flex items-center justify-center">
            <PieChart className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Simulador de Portafolios</h1>
            <p className="text-gray-400 text-sm">Ejemplos educativos hipotéticos — no son recomendaciones</p>
          </div>
        </div>

        {profile && (
          <div className="bg-brand-500/10 border border-brand-500/30 rounded-xl p-4 mb-6 text-sm">
            <span className="text-brand-400 font-medium">Tu perfil: </span>
            <span className="text-gray-300">
              {profile.risk_tolerance === "conservative" ? "Conservador" : profile.risk_tolerance === "moderate" ? "Moderado" : "Agresivo"} —
              {profile.time_horizon_years} años horizonte
            </span>
          </div>
        )}

        <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-2xl p-6 mb-6">
          <h2 className="font-semibold text-white mb-4">Selecciona el tipo de portafolio</h2>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {SCENARIOS.map(({ value, label, emoji, desc }) => (
              <button
                key={value}
                onClick={() => setSelectedScenario(value)}
                className={`p-4 rounded-xl border text-center transition-all ${
                  selectedScenario === value
                    ? "border-brand-500 bg-brand-500/10"
                    : "border-[#2a2d3a] hover:border-gray-500"
                }`}
              >
                <div className="text-2xl mb-1">{emoji}</div>
                <div className={`font-semibold text-sm ${selectedScenario === value ? "text-white" : "text-gray-300"}`}>{label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
              </button>
            ))}
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Capital de referencia (opcional, USD)
            </label>
            <input
              type="number"
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
              className="w-full bg-[#0f1117] border border-[#2a2d3a] focus:border-brand-500 rounded-xl px-4 py-3 text-white placeholder-gray-500 outline-none transition-colors"
              placeholder="10000"
              min={0}
            />
          </div>

          <button
            onClick={handleSimulate}
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Analizando...
              </>
            ) : (
              "Simular portafolio educativo"
            )}
          </button>
        </div>

        {analysis && (
          <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-2xl p-6">
            <div className="prose-dark text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis}</ReactMarkdown>
            </div>
            <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
              <p className="text-yellow-400 text-xs">
                ⚠️ Este análisis es completamente educativo e hipotético. No constituye asesoramiento financiero ni recomendación de inversión.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
