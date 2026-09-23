import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Inteligencia Artificial y Arthur — Nuvos AI",
  description: "Cómo funciona Arthur, el asistente de inteligencia artificial de Nuvos AI, y cuáles son sus límites.",
};

export default function AiPolicyPage() {
  return (
    <main className="h-screen overflow-y-auto bg-[#07080f] text-white">
      <div className="max-w-3xl mx-auto px-6 py-16">

        {/* Header */}
        <div className="mb-12">
          <p className="text-[#22c55e] text-sm font-semibold tracking-widest uppercase mb-3">Legal</p>
          <h1 className="text-4xl font-black tracking-tight mb-2">Política de Inteligencia Artificial y Arthur</h1>
          <p className="text-white/40 text-sm">Nuvos AI</p>
          <p className="text-white/30 text-xs mt-1">Última actualización: 22 de septiembre de 2026</p>
        </div>

        <div className="mb-10 p-4 rounded-xl border border-[#22c55e]/20 bg-[#22c55e]/05 text-sm text-white/80">
          Esta Política explica cómo funciona Arthur, el asistente de inteligencia artificial de Nuvos AI,
          y cuáles son sus limitaciones.
        </div>

        <div className="space-y-10 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-white text-xl font-bold mb-3">1. ¿Qué es Arthur?</h2>
            <p className="text-sm">
              Arthur es un sistema de inteligencia artificial diseñado para ayudar al usuario a comprender
              información financiera, mercados, empresas, inversiones y asignación de capital. Arthur está
              diseñado como una <strong className="text-white">herramienta educativa y de análisis</strong>,
              no como un sustituto del criterio del usuario.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">2. ¿Qué puede hacer Arthur?</h2>
            <p className="text-sm mb-2">Dependiendo de las funcionalidades disponibles, Arthur puede:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>explicar conceptos financieros</li>
              <li>analizar empresas y estados financieros</li>
              <li>interpretar métricas</li>
              <li>comparar empresas</li>
              <li>analizar portafolios</li>
              <li>explicar riesgos</li>
              <li>construir escenarios</li>
              <li>realizar cálculos</li>
              <li>explicar metodologías de valoración</li>
              <li>analizar documentos</li>
              <li>buscar y resumir información</li>
              <li>identificar factores relevantes</li>
              <li>hacer preguntas al usuario</li>
              <li>ayudar al usuario a estructurar su pensamiento</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">3. Arthur no toma decisiones por el usuario</h2>
            <div className="p-4 bg-yellow-500/10 rounded-xl border border-yellow-500/20 text-sm mb-3">
              <strong className="text-yellow-400">Aviso importante:</strong> Arthur está diseñado para
              ayudar al usuario a decidir mejor, no para decidir por él.
            </div>
            <p className="text-sm mb-2">Arthur no tiene autoridad para:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>comprar o vender valores</li>
              <li>ejecutar órdenes</li>
              <li>transferir dinero</li>
              <li>administrar portafolios</li>
              <li>retirar fondos</li>
              <li>controlar cuentas financieras</li>
              <li>tomar decisiones financieras en nombre del usuario</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">4. Personalización</h2>
            <p className="text-sm mb-3">
              Arthur puede utilizar información proporcionada por el usuario —como experiencia, objetivos,
              horizonte temporal, situación financiera, conocimientos, preferencias, portafolio o
              tolerancia al riesgo— para adaptar sus explicaciones y ofrecer una experiencia educativa más
              relevante.
            </p>
            <p className="text-sm p-4 bg-white/5 rounded-xl border border-white/10">
              <strong className="text-white">La personalización no constituye, por sí misma, asesoría de
              inversión personalizada.</strong>
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">5. Arthur no es un asesor financiero</h2>
            <p className="text-sm mb-3">Arthur no actúa como:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>asesor en inversiones</li>
              <li>fiduciario</li>
              <li>administrador de portafolios</li>
              <li>broker</li>
              <li>gestor de inversiones</li>
              <li>contador</li>
              <li>abogado</li>
              <li>asesor fiscal</li>
              <li>ni cualquier otro profesional financiero</li>
            </ul>
            <p className="text-sm">
              Cuando una decisión requiera asesoría profesional, el usuario debe consultar a un profesional
              independiente.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">6. Cómo presenta Arthur la información</h2>
            <p className="text-sm mb-3">Arthur está diseñado para priorizar:</p>
            <p className="text-sm p-4 bg-white/5 rounded-xl border border-white/10 mb-3 text-center font-semibold text-white/90">
              Información → contexto → análisis → escenarios → riesgos → decisión del usuario
            </p>
            <p className="text-sm">
              Cuando sea apropiado, Arthur puede presentar diferentes alternativas y explicar sus posibles
              implicaciones. La existencia de varias alternativas no significa que Arthur considere una de
              ellas adecuada para el usuario.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">7. Sobre "recomendaciones"</h2>
            <p className="text-sm mb-3">
              Arthur puede utilizar expresiones como "una posibilidad", "un escenario", "un factor a
              considerar", "podría ser relevante", "históricamente", "si ocurriera X" o "puedes analizar".
              Estas expresiones tienen finalidad educativa y no deben interpretarse automáticamente como
              recomendaciones personalizadas.
            </p>
            <p className="text-sm">
              Nuvos no pretende que Arthur indique al usuario qué valor debe comprar, vender o mantener.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">8. Información de terceros</h2>
            <p className="text-sm mb-3">
              Arthur puede utilizar información procedente de documentos corporativos, reportes
              financieros, sitios web, fuentes públicas, proveedores de datos, servicios de búsqueda,
              información proporcionada por el usuario y otras fuentes disponibles. La disponibilidad de
              una fuente no significa que Nuvos garantice su exactitud.
            </p>
            <p className="text-sm">
              Cuando una decisión sea relevante, el usuario debe revisar las fuentes originales.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">9. Fuentes y fecha de información</h2>
            <p className="text-sm mb-3">
              Cuando una funcionalidad lo permita, Nuvos podrá mostrar fuente, fecha, documento, enlace,
              periodo financiero o contexto utilizado. La información financiera puede cambiar después de
              haber sido obtenida.
            </p>
            <p className="text-sm">
              Por ello, una respuesta de Arthur representa la información disponible al momento de generar
              dicha respuesta y no necesariamente la información más reciente posteriormente disponible.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">10. Errores de inteligencia artificial</h2>
            <p className="text-sm mb-3">Arthur puede equivocarse. Puede:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>interpretar incorrectamente una pregunta</li>
              <li>confundir empresas</li>
              <li>interpretar incorrectamente un documento</li>
              <li>realizar cálculos incorrectos</li>
              <li>utilizar información desactualizada</li>
              <li>omitir información</li>
              <li>generar una fuente incorrecta</li>
              <li>producir una conclusión incorrecta</li>
              <li>presentar información incierta como si fuera cierta</li>
            </ul>
            <p className="text-sm">El usuario debe verificar información importante antes de actuar.</p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">11. No existe garantía de resultados</h2>
            <p className="text-sm mb-2">Nuvos no garantiza que el uso de Arthur produzca:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>ganancias</li>
              <li>rendimientos</li>
              <li>mejores inversiones</li>
              <li>menor riesgo</li>
              <li>mejores decisiones</li>
              <li>preservación de capital</li>
              <li>ningún resultado financiero específico</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">12. Análisis de portafolio</h2>
            <p className="text-sm mb-3">
              Arthur puede analizar información de portafolios proporcionada por el usuario, incluyendo
              concentración, exposición, volatilidad, diversificación, escenarios, correlaciones,
              rendimiento histórico, métricas financieras y otras características.
            </p>
            <p className="text-sm">
              Estos análisis son herramientas educativas y no constituyen una determinación profesional de
              idoneidad de una inversión.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">13. Perfil y tolerancia al riesgo</h2>
            <p className="text-sm">
              Nuvos puede solicitar información relacionada con experiencia, objetivos, horizonte y
              tolerancia al riesgo, y utilizarla para personalizar explicaciones educativas. El resultado
              de un cuestionario no constituye una recomendación de inversión ni garantiza que una
              inversión sea adecuada o inadecuada para el usuario.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">14. Alertas</h2>
            <p className="text-sm">
              Las alertas de Nuvos tienen finalidad informativa. Una alerta puede informar sobre movimientos
              de precio, resultados financieros, eventos, noticias, cambios de determinadas métricas u
              otros acontecimientos. Una alerta no significa que el usuario deba realizar una operación.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">15. Oportunidades para analizar</h2>
            <p className="text-sm mb-2">
              Cuando Nuvos identifique empresas, activos, eventos o situaciones que puedan resultar
              interesantes para análisis adicional, la funcionalidad tiene como objetivo presentar
              información que el usuario pueda investigar. El término "oportunidad" no significa que Nuvos
              garantice:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>que el activo esté subvaluado</li>
              <li>que vaya a aumentar</li>
              <li>que sea adecuado para el usuario</li>
              <li>que vaya a generar ganancias</li>
              <li>que el usuario deba comprarlo</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">16. Stress tests y escenarios</h2>
            <p className="text-sm">
              Los stress tests muestran escenarios hipotéticos o históricos. Un escenario no representa una
              predicción. Los resultados dependen de los supuestos, datos y metodología utilizados, y los
              eventos reales pueden ser significativamente diferentes.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">17. Documentos cargados por el usuario</h2>
            <p className="text-sm">
              Cuando el usuario cargue un documento para análisis, declara que tiene derecho a utilizarlo
              para dicha finalidad. Arthur podrá procesar el documento mediante los proveedores
              tecnológicos necesarios para proporcionar la funcionalidad. El usuario debe evitar cargar
              información confidencial de terceros cuando no tenga autorización.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">18. Privacidad de las conversaciones</h2>
            <p className="text-sm">
              Las conversaciones con Arthur pueden contener información personal o financiera. Su
              tratamiento se encuentra sujeto al{" "}
              <a href="/privacy" className="text-[#22c55e] underline hover:opacity-80">Aviso de Privacidad
              de Nuvos AI</a>. El usuario debe evitar proporcionar información innecesaria o altamente
              confidencial.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">19. Proveedores de inteligencia artificial</h2>
            <p className="text-sm">
              Nuvos puede utilizar diferentes proveedores de modelos de inteligencia artificial, incluyendo
              Anthropic y OpenAI. Estos proveedores pueden cambiar conforme evolucione la tecnología y el
              Servicio, sujeto a los acuerdos, controles y configuraciones aplicables.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">20. Evolución de Arthur</h2>
            <p className="text-sm">
              Arthur puede cambiar con el tiempo debido a nuevas versiones de modelos, nuevas fuentes,
              cambios de proveedores, actualizaciones de datos, mejoras del producto, correcciones de
              errores y nuevas funcionalidades. Por ello, respuestas obtenidas en diferentes momentos
              pueden variar.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">21. Responsabilidad del usuario</h2>
            <p className="text-sm mb-2">
              El usuario es responsable de verificar la información y tomar sus propias decisiones. Antes
              de tomar una decisión financiera importante, el usuario debe considerar:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-sm">
              <li>revisar las fuentes originales</li>
              <li>verificar los datos</li>
              <li>considerar los riesgos</li>
              <li>evaluar su propia situación</li>
              <li>consultar a un profesional cuando corresponda</li>
            </ol>
          </section>

          {/* Acceptance block */}
          <div className="border border-white/15 rounded-2xl p-6 bg-white/[0.02] mt-4">
            <p className="text-xs font-bold uppercase tracking-widest text-[#22c55e] mb-3">Reconocimiento</p>
            <p className="text-sm text-white/80 leading-relaxed mb-3">Al utilizar Arthur, reconoces que:</p>
            <ul className="text-sm text-white/70 space-y-1.5">
              <li>☐ Arthur utiliza inteligencia artificial.</li>
              <li>☐ Arthur puede cometer errores.</li>
              <li>☐ Arthur no garantiza que sus respuestas sean correctas.</li>
              <li>☐ Arthur no custodia tu dinero.</li>
              <li>☐ Arthur no ejecuta operaciones.</li>
              <li>☐ Arthur no toma decisiones financieras por ti.</li>
              <li>☐ La información proporcionada tiene finalidad educativa e informativa.</li>
              <li>☐ Tú eres responsable de tus decisiones financieras.</li>
            </ul>
          </div>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">22. Contacto</h2>
            <p className="text-sm">
              Para preguntas sobre Arthur, inteligencia artificial o el funcionamiento de Nuvos:{" "}
              <span className="text-[#22c55e]">legal@nuvosai.com</span>
            </p>
          </section>

        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-white/30 text-xs">
          <span>© 2026 Nuvos AI. Todos los derechos reservados.</span>
          <div className="flex items-center gap-4">
            <a href="/terms" className="hover:text-white/60 transition-colors">Términos de uso →</a>
            <a href="/privacy" className="hover:text-white/60 transition-colors">Aviso de Privacidad →</a>
          </div>
        </div>

      </div>
    </main>
  );
}
