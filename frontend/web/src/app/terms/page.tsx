import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Términos de Uso — Nuvos AI",
  description: "Términos y condiciones de uso de la aplicación Nuvos AI.",
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#07080f] text-white">
      <div className="max-w-3xl mx-auto px-6 py-16">

        {/* Header */}
        <div className="mb-12">
          <p className="text-[#22c55e] text-sm font-semibold tracking-widest uppercase mb-3">Legal</p>
          <h1 className="text-4xl font-black tracking-tight mb-2">Términos de Uso</h1>
          <p className="text-white/40 text-sm">Aviso de Carácter Educativo y Aceptación de Términos de Uso</p>
          <p className="text-white/30 text-xs mt-1">Última actualización: 20 de junio de 2026</p>
        </div>

        {/* Intro banner */}
        <div className="mb-10 p-4 rounded-xl border border-[#22c55e]/20 bg-[#22c55e]/05 text-sm text-white/80">
          Documento presentado durante el registro inicial (onboarding) de la aplicación Nuvos AI.
          Al crear una cuenta o usar Nuvos AI, aceptas estos Términos de Uso en su totalidad.
          Si no estás de acuerdo, no uses la aplicación.
        </div>

        <div className="space-y-10 text-white/70 leading-relaxed">

          {/* ── Aviso de Carácter Educativo ── */}
          <section>
            <h2 className="text-white text-xl font-bold mb-3">1. Naturaleza del servicio</h2>
            <p className="text-sm">
              Nuvos AI es una herramienta tecnológica de carácter educativo e informativo orientada
              a la educación financiera y al análisis de mercados. Nuvos AI <strong className="text-white">no es</strong>{" "}
              una institución bancaria, casa de bolsa, asesor en inversiones, ni ninguna otra entidad
              regulada por la Comisión Nacional Bancaria y de Valores (CNBV), la Comisión Nacional
              para la Protección y Defensa de los Usuarios de Servicios Financieros (CONDUSEF), la
              U.S. Securities and Exchange Commission (SEC) ni cualquier otro regulador financiero en
              México, Estados Unidos o cualquier otro país.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">2. Ausencia de asesoría financiera personalizada</h2>
            <div className="p-4 bg-yellow-500/10 rounded-xl border border-yellow-500/20 text-sm mb-3">
              <strong className="text-yellow-400">Aviso importante:</strong> Ningún contenido generado
              dentro de la aplicación constituye una recomendación personalizada de inversión, una oferta,
              ni una invitación para comprar, vender o mantener algún instrumento financiero.
            </div>
            <p className="text-sm">
              Ningún contenido generado dentro de la aplicación —incluyendo, sin limitación, perfiles de
              riesgo, análisis de portafolios, comparativos con inversionistas reconocidos,
              alertas, calendarios de resultados financieros o recomendaciones de tipo de activo— constituye
              una recomendación personalizada de inversión, una oferta, ni una invitación para comprar,
              vender o mantener algún instrumento financiero. Todo el contenido es de naturaleza general y
              educativa, generado o asistido por modelos de inteligencia artificial, y no toma en cuenta la
              situación financiera particular, objetivos o necesidades específicas del usuario en el sentido
              regulatorio del término "asesoría personalizada".
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">3. Riesgos de invertir en los mercados financieros</h2>
            <p className="text-sm">
              Toda inversión en instrumentos financieros conlleva riesgo, incluyendo la posible pérdida
              total o parcial del capital invertido. El desempeño histórico de cualquier activo, estrategia
              o inversionista mencionado dentro de la aplicación no garantiza, asegura ni anticipa
              resultados futuros. El usuario reconoce que cualquier decisión de inversión que tome, dentro
              o fuera de la aplicación, es <strong className="text-white">responsabilidad exclusiva del usuario</strong>.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">4. Limitaciones de la inteligencia artificial</h2>
            <p className="text-sm">
              El contenido generado por inteligencia artificial dentro de Nuvos AI puede contener errores,
              imprecisiones, omisiones o información incompleta o desactualizada, derivados de limitaciones
              técnicas de los modelos utilizados o de la información de mercado disponible al momento de
              generarse. El usuario no debe interpretar dicho contenido como una afirmación de exactitud
              absoluta ni como sustituto del criterio propio o de la consulta con un profesional financiero
              certificado cuando lo considere necesario.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">5. Responsabilidad del usuario</h2>
            <p className="text-sm">
              El uso de la información y herramientas disponibles en Nuvos AI es completamente voluntario.
              El usuario es el único responsable de evaluar, decidir y ejecutar cualquier acción financiera,
              así como de las consecuencias económicas que de ello deriven. Nuvos AI, sus fundadores,
              colaboradores y la marca Nuvos AI no asumen responsabilidad alguna por pérdidas, daños o
              perjuicios de cualquier naturaleza relacionados con decisiones de inversión tomadas con base,
              total o parcial, en el contenido de la aplicación.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">6. Tratamiento de datos personales</h2>
            <p className="text-sm">
              Los datos personales y financieros proporcionados por el usuario serán tratados conforme a
              la Ley Federal de Protección de Datos Personales en Posesión de Particulares y demás
              disposiciones aplicables, según se describe a detalle en el{" "}
              <a href="/privacy" className="text-[#22c55e] underline hover:opacity-80">Aviso de Privacidad de Nuvos AI</a>,
              disponible de forma independiente dentro de la aplicación y en nuvosai.com.
            </p>
          </section>

          {/* ── Términos del Servicio ── */}
          <div className="border-t border-white/10 pt-10">
            <p className="text-[#22c55e] text-xs font-bold uppercase tracking-widest mb-6">Condiciones de uso del servicio</p>
          </div>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">7. Elegibilidad</h2>
            <ul className="list-disc list-inside space-y-2 text-sm">
              <li>Debes tener al menos 18 años para usar Nuvos AI</li>
              <li>Debes proporcionar información veraz al registrarte</li>
              <li>Solo puedes tener una cuenta por persona</li>
              <li>Eres responsable de mantener la seguridad de tu contraseña</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">8. Plan gratuito y Premium</h2>
            <div className="space-y-4 text-sm">
              <div>
                <h3 className="text-white/90 font-semibold mb-2">Plan Gratuito</h3>
                <p>Incluye acceso limitado a las funcionalidades de la app: 20 mensajes cada 24 horas y funciones básicas de portafolio.</p>
              </div>
              <div>
                <h3 className="text-white/90 font-semibold mb-2">Plan Premium</h3>
                <p>Suscripción de pago que desbloquea mensajes ilimitados, 5 mentores de inversión,
                stress test de portafolio, noticias ilimitadas, análisis avanzado de portafolio y más.</p>
              </div>
              <div>
                <h3 className="text-white/90 font-semibold mb-2">Facturación</h3>
                <ul className="list-disc list-inside space-y-1">
                  <li>Los pagos se procesan a través de Stripe de forma segura</li>
                  <li>Las suscripciones se renuevan automáticamente al final de cada período</li>
                  <li>Puedes cancelar en cualquier momento desde la configuración de tu cuenta</li>
                  <li>No ofrecemos reembolsos por períodos ya facturados salvo que la ley lo exija</li>
                  <li>Nos reservamos el derecho de modificar los precios con 30 días de aviso previo</li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">9. Uso aceptable</h2>
            <p className="text-sm mb-3">Al usar Nuvos AI, aceptas NO:</p>
            <ul className="list-disc list-inside space-y-2 text-sm">
              <li>Usar la app para actividades ilegales o fraudulentas</li>
              <li>Intentar hackear, hacer ingeniería inversa o explotar vulnerabilidades</li>
              <li>Automatizar solicitudes de forma que sobrecarguen nuestros servidores</li>
              <li>Compartir tu cuenta con otras personas</li>
              <li>Reproducir o distribuir el contenido generado por la IA sin autorización</li>
              <li>Usar la app para dar asesoramiento financiero a terceros</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">10. Propiedad intelectual</h2>
            <p className="text-sm">
              La app, su diseño, código, marca y contenido son propiedad de Nuvos AI. Los contenidos
              generados por la IA en respuesta a tus consultas son para tu uso personal educativo.
              No puedes reproducirlos comercialmente sin permiso escrito.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">11. Limitación de responsabilidad</h2>
            <p className="text-sm mb-3">En la máxima medida permitida por la ley aplicable:</p>
            <ul className="list-disc list-inside space-y-2 text-sm">
              <li>Nuvos AI no es responsable de pérdidas financieras derivadas del uso de la app</li>
              <li>No garantizamos que la información sea siempre precisa, completa o actualizada</li>
              <li>El servicio se ofrece "tal cual" sin garantías de ningún tipo</li>
              <li>Nuestra responsabilidad máxima se limita al importe pagado por tu suscripción en los últimos 12 meses</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">12. Eliminación de cuenta</h2>
            <p className="text-sm">
              Puedes eliminar tu cuenta en cualquier momento desde Perfil → Eliminar mi cuenta.
              Esto borrará permanentemente todos tus datos. También podemos suspender o eliminar
              cuentas que violen estos términos sin previo aviso.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">13. Modificaciones al servicio</h2>
            <p className="text-sm">
              Nos reservamos el derecho de modificar, suspender o discontinuar cualquier parte del
              servicio con o sin previo aviso. No seremos responsables por modificaciones, suspensión
              o discontinuación del servicio.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">14. Cambios a los términos</h2>
            <p className="text-sm">
              Podemos actualizar estos términos en cualquier momento. Te notificaremos de cambios
              significativos a través de la app. El uso continuado después de los cambios implica
              aceptación de los nuevos términos.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">15. Ley aplicable</h2>
            <p className="text-sm">
              Estos términos se rigen por las leyes aplicables en la jurisdicción del usuario.
              Para usuarios en México, aplican la Ley Federal de Protección al Consumidor y las leyes
              federales mexicanas vigentes. Para usuarios en otros países, aplican las leyes locales
              correspondientes en cuanto sean más protectoras para el consumidor.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">16. Contacto</h2>
            <p className="text-sm">
              Para preguntas sobre estos términos, contáctanos en:{" "}
              <span className="text-[#22c55e]">legal@nuvosai.app</span>
            </p>
          </section>

          {/* Acceptance block */}
          <div className="border border-white/15 rounded-2xl p-6 bg-white/[0.02] mt-4">
            <p className="text-xs font-bold uppercase tracking-widest text-[#22c55e] mb-3">Aceptación del usuario</p>
            <p className="text-sm text-white/80 leading-relaxed">
              <strong className="text-white">
                He leído y comprendido este aviso en su totalidad. Entiendo que Nuvos AI ofrece
                contenido educativo e informativo generado con apoyo de inteligencia artificial,
                que no constituye asesoría financiera personalizada ni recomendación de inversión,
                y que cualquier decisión financiera que tome es de mi exclusiva responsabilidad.
                Acepto los Términos y Condiciones y el Aviso de Privacidad de Nuvos AI.
              </strong>
            </p>
            <p className="text-xs text-white/30 mt-4">
              La aceptación se realiza de forma electrónica durante el proceso de registro
              (onboarding) de la aplicación, quedando registrada la fecha y datos de sesión del usuario.
            </p>
          </div>

        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-white/30 text-xs">
          <span>© 2026 Nuvos AI · Borrador sujeto a revisión por asesoría legal · nuvosai.com</span>
          <a href="/privacy" className="hover:text-white/60 transition-colors">Aviso de Privacidad →</a>
        </div>

      </div>
    </main>
  );
}
