import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidad — Nuvos AI",
  description: "Cómo Nuvos AI recopila, usa y protege tu información personal.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#07080f] text-white">
      <div className="max-w-3xl mx-auto px-6 py-16">

        {/* Header */}
        <div className="mb-12">
          <p className="text-[#22c55e] text-sm font-semibold tracking-widest uppercase mb-3">Legal</p>
          <h1 className="text-4xl font-black tracking-tight mb-4">Política de Privacidad</h1>
          <p className="text-white/40 text-sm">Última actualización: 1 de junio de 2025</p>
        </div>

        <div className="space-y-10 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-white text-xl font-bold mb-3">1. Quiénes somos</h2>
            <p>
              Nuvos AI es una aplicación educativa de inversión personal operada por Diego Arria
              ("nosotros", "nuestro"). Nuestro sitio web es <span className="text-white">nuvosai.app</span>.
              Esta política explica qué datos recopilamos cuando usas la app Nuvos AI, cómo los usamos
              y qué derechos tienes sobre ellos.
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
                  <li>Perfil de riesgo inversor y respuestas al cuestionario</li>
                  <li>Posiciones de portafolio y operaciones en papel</li>
                  <li>Foto de perfil (opcional)</li>
                  <li>Mensajes enviados al chat con la IA</li>
                </ul>
              </div>
              <div>
                <h3 className="text-white/90 font-semibold mb-1">Datos que recopilamos automáticamente</h3>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Token de notificaciones push (para alertas de mercado)</li>
                  <li>Actividad dentro de la app (lecciones, escenarios de inversión)</li>
                  <li>Información del dispositivo necesaria para el funcionamiento de la app</li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">3. Cómo usamos tus datos</h2>
            <ul className="list-disc list-inside space-y-2 text-sm">
              <li>Personalizar las respuestas de la IA según tu perfil de inversión</li>
              <li>Calcular y mostrar tu puntuación de madurez inversora</li>
              <li>Sincronizar tu portafolio y estado entre dispositivos</li>
              <li>Enviarte notificaciones push relevantes (si las activas)</li>
              <li>Procesar pagos de suscripción Premium</li>
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
                <p className="font-semibold text-white/90">Anthropic (Claude AI)</p>
                <p>Procesa tus mensajes de chat para generar respuestas educativas. Los mensajes se envían de forma segura. Consulta la política de Anthropic en <span className="text-[#22c55e]">anthropic.com/privacy</span>.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Supabase</p>
                <p>Aloja nuestra base de datos y gestiona la autenticación. Tus datos se almacenan de forma cifrada. Consulta <span className="text-[#22c55e]">supabase.com/privacy</span>.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Stripe</p>
                <p>Procesa los pagos de suscripción Premium. Nuvos AI nunca almacena datos de tarjetas. Consulta <span className="text-[#22c55e]">stripe.com/privacy</span>.</p>
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
            <p className="mt-3 text-sm">Para ejercer estos derechos, contáctanos en <span className="text-[#22c55e]">privacy@nuvosai.app</span>.</p>
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
              <span className="text-[#22c55e]">privacy@nuvosai.app</span>
            </p>
          </section>

        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-white/30 text-sm">
          <span>© 2025 Nuvos AI. Todos los derechos reservados.</span>
          <a href="/terms" className="hover:text-white/60 transition-colors">Términos de uso →</a>
        </div>

      </div>
    </main>
  );
}
