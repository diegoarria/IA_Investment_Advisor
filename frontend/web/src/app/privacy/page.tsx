import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidad — Nuvos AI",
  description: "Cómo Nuvos AI recopila, usa y protege tu información personal.",
};

export default function PrivacyPage() {
  return (
    <main className="h-screen overflow-y-auto bg-[#07080f] text-white">
      <div className="max-w-3xl mx-auto px-6 py-16">

        {/* Header */}
        <div className="mb-12">
          <p className="text-[#22c55e] text-sm font-semibold tracking-widest uppercase mb-3">Legal</p>
          <h1 className="text-4xl font-black tracking-tight mb-4">Política de Privacidad</h1>
          <p className="text-white/40 text-sm">Última actualización: 16 de julio de 2026</p>
        </div>

        <div className="space-y-10 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-white text-xl font-bold mb-3">1. Quiénes somos</h2>
            <p className="text-sm">
              Nuvos AI es una <strong className="text-white">plataforma educativa de inversión</strong> operada
              por Diego Arria ("nosotros", "nuestro"), disponible en <span className="text-white">nuvosai.com</span> y
              como app móvil. Esta política explica qué datos recopilamos cuando usas Nuvos AI, cómo los usamos
              y qué derechos tienes sobre ellos. Nuvos AI no es un banco, casa de bolsa ni asesor de inversiones
              — es una herramienta educativa e informativa.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">2. Datos que recopilamos</h2>
            <div className="space-y-4">
              <div>
                <h3 className="text-white/90 font-semibold mb-1">Datos que tú nos proporcionas</h3>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Dirección de email y contraseña (para tu cuenta)</li>
                  <li>Nombre, fecha de nacimiento e ingresos mensuales</li>
                  <li>Perfil de riesgo inversor y respuestas al cuestionario de onboarding</li>
                  <li>Posiciones de portafolio, operaciones de paper trading y metas financieras</li>
                  <li>Foto de perfil (opcional)</li>
                  <li>Mensajes enviados al chat con el mentor IA</li>
                  <li>Estados de cuenta o documentos que subas para análisis (opcional)</li>
                  <li>Si conectas una cuenta de broker (Interactive Brokers, Schwab, Robinhood, etc.), las credenciales las gestiona Plaid de forma segura — Nuvos AI nunca ve ni almacena tu usuario/contraseña del broker, solo recibe tus posiciones</li>
                </ul>
              </div>
              <div>
                <h3 className="text-white/90 font-semibold mb-1">Datos que recopilamos automáticamente</h3>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Token de notificaciones push (para alertas de mercado y portafolio)</li>
                  <li>Actividad dentro de la app (lecciones completadas, racha de aprendizaje, uso de funciones)</li>
                  <li>Información del dispositivo necesaria para el funcionamiento de la app</li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">3. Cómo usamos tus datos</h2>
            <ul className="list-disc list-inside space-y-2 text-sm">
              <li>Personalizar las respuestas del mentor IA según tu perfil de inversión</li>
              <li>Calcular y mostrar tu puntuación de madurez inversora</li>
              <li>Sincronizar tu portafolio y estado entre dispositivos (web y móvil)</li>
              <li>Enviarte notificaciones push relevantes (movimientos de precio, earnings, resumen semanal)</li>
              <li>Procesar pagos de suscripción Premium, Plan Dúo y productos de pago único</li>
              <li>Generar reportes y análisis que solicitas (reporte anual, Deep Research, análisis de portafolio)</li>
              <li>Mejorar la experiencia de la app y detectar errores</li>
              <li>Cumplir con obligaciones legales</li>
            </ul>
            <p className="mt-4 text-sm p-4 bg-white/5 rounded-xl border border-white/10">
              <strong className="text-white">Importante:</strong> Nuvos AI es una herramienta educativa.
              Nunca vendemos tu información personal a terceros ni la usamos para publicidad.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">4. Terceros que procesan tus datos</h2>
            <div className="space-y-3 text-sm">
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Anthropic (Claude) y OpenAI</p>
                <p>Procesan tus mensajes de chat para generar respuestas educativas del mentor IA. Consulta <span className="text-[#22c55e]">anthropic.com/privacy</span> y <span className="text-[#22c55e]">openai.com/privacy</span>.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Perplexity</p>
                <p>Provee búsqueda web en tiempo real usada en notificaciones y en los reportes de Deep Research. Consulta <span className="text-[#22c55e]">perplexity.ai/privacy</span>.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">ElevenLabs</p>
                <p>Genera las respuestas de voz del mentor IA cuando usas esa función. Consulta <span className="text-[#22c55e]">elevenlabs.io/privacy</span>.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Plaid</p>
                <p>Gestiona de forma segura la conexión con tu cuenta de broker (solo si eliges vincularla). Nuvos AI nunca almacena tus credenciales del broker. Consulta <span className="text-[#22c55e]">plaid.com/legal/#end-user-privacy-policy</span>.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Fiscal.ai</p>
                <p>Provee datos financieros y de mercado (precios, estados financieros de empresas) que usamos para el análisis y las alertas.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Stripe</p>
                <p>Procesa los pagos de suscripción y productos de pago único. Nuvos AI nunca almacena datos de tarjetas. Consulta <span className="text-[#22c55e]">stripe.com/privacy</span>.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Resend</p>
                <p>Envía los emails transaccionales de la app (bienvenida, cartas mensuales, avisos de cuenta).</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Supabase</p>
                <p>Aloja nuestra base de datos y gestiona la autenticación. Tus datos se almacenan de forma cifrada. Consulta <span className="text-[#22c55e]">supabase.com/privacy</span>.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Railway</p>
                <p>Aloja nuestros servidores backend en infraestructura segura en la nube.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">5. Retención de datos</h2>
            <p className="text-sm">
              Conservamos tus datos mientras tu cuenta esté activa. Si eliminas tu cuenta desde la app
              (Perfil → Eliminar mi cuenta), borramos permanentemente todos tus datos personales,
              historial de chats, portafolio y cancelamos tu suscripción activa. Este proceso es
              irreversible y se completa en un plazo de 30 días.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">6. Tus derechos</h2>
            <p className="text-sm mb-3">Dependiendo de tu jurisdicción, puedes tener los siguientes derechos:</p>
            <ul className="list-disc list-inside space-y-2 text-sm">
              <li><strong className="text-white/90">Acceso:</strong> Solicitar una copia de los datos que tenemos sobre ti</li>
              <li><strong className="text-white/90">Rectificación:</strong> Corregir datos incorrectos desde la app (Perfil → Editar perfil)</li>
              <li><strong className="text-white/90">Eliminación:</strong> Borrar tu cuenta y todos tus datos desde la app</li>
              <li><strong className="text-white/90">Portabilidad:</strong> Solicitar tus datos en formato legible</li>
              <li><strong className="text-white/90">Oposición:</strong> Oponerte a ciertos usos de tus datos</li>
            </ul>
            <p className="mt-3 text-sm">Para ejercer estos derechos, contáctanos en <span className="text-[#22c55e]">legal@nuvosai.com</span>.</p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">7. Seguridad</h2>
            <p className="text-sm">
              Usamos cifrado en tránsito (HTTPS/TLS) y en reposo para proteger tus datos.
              El acceso a la información está restringido al personal autorizado. Ningún sistema
              es completamente seguro, pero tomamos medidas razonables para proteger tu información.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">8. Menores de edad</h2>
            <p className="text-sm">
              Nuvos AI no está dirigida a menores de 18 años. Si descubrimos que hemos recopilado
              datos de un menor sin el consentimiento parental adecuado, los eliminaremos de
              inmediato.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">9. Cambios a esta política</h2>
            <p className="text-sm">
              Podemos actualizar esta política ocasionalmente. Te notificaremos de cambios
              significativos mediante una notificación en la app o un email. El uso continuado
              de la app después de los cambios implica aceptación.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">10. Contacto</h2>
            <p className="text-sm">
              Si tienes preguntas sobre esta política o quieres ejercer tus derechos, escríbenos a:<br />
              <span className="text-[#22c55e]">legal@nuvosai.com</span>
            </p>
          </section>

        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-white/30 text-sm">
          <span>© 2026 Nuvos AI. Todos los derechos reservados.</span>
          <a href="/terms" className="hover:text-white/60 transition-colors">Términos de uso →</a>
        </div>

      </div>
    </main>
  );
}
