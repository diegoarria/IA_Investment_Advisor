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
          <h1 className="text-4xl font-black tracking-tight mb-4">Términos de Uso</h1>
          <p className="text-white/40 text-sm">Última actualización: 1 de junio de 2025</p>
        </div>

        <div className="space-y-10 text-white/70 leading-relaxed">

          <section>
            <p className="p-4 bg-[#22c55e]/10 rounded-xl border border-[#22c55e]/20 text-sm text-white/80">
              Al crear una cuenta o usar Nuvos AI, aceptas estos Términos de Uso. Si no estás de
              acuerdo, no uses la aplicación.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">1. Descripción del servicio</h2>
            <p className="text-sm">
              Nuvos AI es una plataforma educativa de inversión personal que utiliza inteligencia
              artificial para enseñarte a pensar como un inversor profesional. El servicio incluye
              un chat con IA personalizado, simuladores de portafolio, simulador de decisiones,
              debates con IA, paper trading y herramientas de análisis educativo.
            </p>
            <p className="mt-3 p-4 bg-yellow-500/10 rounded-xl border border-yellow-500/20 text-sm">
              <strong className="text-yellow-400">Aviso importante:</strong> Nuvos AI es una herramienta
              educativa. El contenido generado por la app NO constituye asesoramiento financiero,
              de inversión, legal ni fiscal. No tomes decisiones de inversión basándote únicamente
              en la información de esta app. Consulta siempre a un asesor financiero certificado.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">2. Elegibilidad</h2>
            <ul className="list-disc list-inside space-y-2 text-sm">
              <li>Debes tener al menos 18 años para usar Nuvos AI</li>
              <li>Debes proporcionar información veraz al registrarte</li>
              <li>Solo puedes tener una cuenta por persona</li>
              <li>Eres responsable de mantener la seguridad de tu contraseña</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">3. Plan gratuito y Premium</h2>
            <div className="space-y-4 text-sm">
              <div>
                <h3 className="text-white/90 font-semibold mb-2">Plan Gratuito</h3>
                <p>Incluye acceso limitado a las funcionalidades de la app: 20 mensajes cada 24 horas,
                5 simulaciones de decisiones por día, 2 debates con IA por día y funciones básicas de portafolio.</p>
              </div>
              <div>
                <h3 className="text-white/90 font-semibold mb-2">Plan Premium</h3>
                <p>Suscripción de pago que desbloquea mensajes ilimitados, 5 mentores de inversión,
                stress test de portafolio, paper trading completo, noticias ilimitadas, 50 simulaciones
                y 20 debates por día.</p>
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
            <h2 className="text-white text-xl font-bold mb-3">4. Uso aceptable</h2>
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
            <h2 className="text-white text-xl font-bold mb-3">5. Propiedad intelectual</h2>
            <p className="text-sm">
              La app, su diseño, código, marca y contenido son propiedad de Nuvos AI. Los contenidos
              generados por la IA en respuesta a tus consultas son para tu uso personal educativo.
              No puedes reproducirlos comercialmente sin permiso escrito.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">6. Limitación de responsabilidad</h2>
            <p className="text-sm mb-3">
              En la máxima medida permitida por la ley aplicable:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm">
              <li>Nuvos AI no es responsable de pérdidas financieras derivadas del uso de la app</li>
              <li>No garantizamos que la información sea siempre precisa, completa o actualizada</li>
              <li>El servicio se ofrece "tal cual" sin garantías de ningún tipo</li>
              <li>Nuestra responsabilidad máxima se limita al importe pagado por tu suscripción en los últimos 12 meses</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">7. Eliminación de cuenta</h2>
            <p className="text-sm">
              Puedes eliminar tu cuenta en cualquier momento desde Perfil → Eliminar mi cuenta.
              Esto borrará permanentemente todos tus datos. También podemos suspender o eliminar
              cuentas que violen estos términos sin previo aviso.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">8. Modificaciones al servicio</h2>
            <p className="text-sm">
              Nos reservamos el derecho de modificar, suspender o discontinuar cualquier parte del
              servicio con o sin previo aviso. No seremos responsables por modificaciones, suspensión
              o discontinuación del servicio.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">9. Cambios a los términos</h2>
            <p className="text-sm">
              Podemos actualizar estos términos en cualquier momento. Te notificaremos de cambios
              significativos a través de la app. El uso continuado después de los cambios implica
              aceptación de los nuevos términos.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">10. Ley aplicable</h2>
            <p className="text-sm">
              Estos términos se rigen por las leyes aplicables en la jurisdicción del usuario.
              Para usuarios en la Unión Europea, aplican los derechos del consumidor establecidos
              por la legislación europea. Para usuarios en México, aplican las leyes federales mexicanas.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">11. Contacto</h2>
            <p className="text-sm">
              Para preguntas sobre estos términos, contáctanos en:<br />
              <span className="text-[#22c55e]">legal@nuvosai.app</span>
            </p>
          </section>

        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-white/30 text-sm">
          <span>© 2025 Nuvos AI. Todos los derechos reservados.</span>
          <a href="/privacy" className="hover:text-white/60 transition-colors">Política de privacidad →</a>
        </div>

      </div>
    </main>
  );
}
