import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Aviso de Privacidad — Nuvos AI",
  description: "Cómo Nuvos AI recopila, usa y protege tu información personal.",
};

export default function PrivacyPage() {
  return (
    <main className="h-screen overflow-y-auto bg-[#07080f] text-white">
      <div className="max-w-3xl mx-auto px-6 py-16">

        {/* Header */}
        <div className="mb-12">
          <p className="text-[#22c55e] text-sm font-semibold tracking-widest uppercase mb-3">Legal</p>
          <h1 className="text-4xl font-black tracking-tight mb-2">Aviso de Privacidad</h1>
          <p className="text-white/40 text-sm">Nuvos AI · Aviso Integral</p>
          <p className="text-white/30 text-xs mt-1">Última actualización: 22 de septiembre de 2026</p>
        </div>

        <div className="mb-10 p-4 rounded-xl border border-[#22c55e]/20 bg-[#22c55e]/05 text-sm text-white/80">
          Este Aviso de Privacidad explica cómo Nuvos AI recopila, utiliza, almacena, protege y, cuando
          corresponde, comparte información relacionada con sus usuarios. ¿Buscas una versión corta?
          Consulta el{" "}
          <a href="/privacy-simple" className="text-[#22c55e] underline hover:opacity-80">Aviso de
          Privacidad Simplificado</a>.
        </div>

        <div className="space-y-10 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-white text-xl font-bold mb-3">1. Responsable</h2>
            <p className="text-sm">
              <strong className="text-white">Responsable del tratamiento:</strong> [NOMBRE LEGAL COMPLETO]<br />
              <strong className="text-white">Domicilio:</strong> [DOMICILIO LEGAL]<br />
              <strong className="text-white">Correo de privacidad:</strong> legal@nuvosai.com
            </p>
            <p className="text-sm mt-3">
              Nuvos AI podrá utilizar proveedores tecnológicos para prestar determinados servicios, pero
              dichos proveedores tratarán información conforme a las funciones que desempeñen y a los
              acuerdos correspondientes.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">2. Qué datos recopilamos</h2>
            <p className="text-sm mb-3">Dependiendo de las funciones que utilices, podemos tratar:</p>
            <div className="space-y-4">
              <div>
                <h3 className="text-white/90 font-semibold mb-1">Datos de cuenta</h3>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Correo electrónico y nombre</li>
                  <li>Contraseña o credenciales administradas mediante proveedores de autenticación</li>
                  <li>Identificadores de usuario, preferencias y configuración de cuenta</li>
                </ul>
              </div>
              <div>
                <h3 className="text-white/90 font-semibold mb-1">Datos proporcionados voluntariamente</h3>
                <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
                  <li>Fecha de nacimiento, país y ciudad</li>
                  <li>Ocupación e ingresos aproximados</li>
                  <li>Experiencia financiera y conocimientos de inversión</li>
                  <li>Objetivos financieros, horizonte temporal y preferencias</li>
                  <li>Respuestas a cuestionarios (tolerancia al riesgo, onboarding)</li>
                  <li>Fotografía de perfil (opcional)</li>
                  <li>Información contenida en conversaciones con Arthur</li>
                  <li>Documentos que decidas subir</li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">3. Información financiera y patrimonial</h2>
            <p className="text-sm mb-2">
              Dependiendo de las funciones que utilices, Nuvos puede procesar información relacionada con:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>portafolios</li>
              <li>instrumentos</li>
              <li>posiciones</li>
              <li>cantidades y precios</li>
              <li>operaciones</li>
              <li>saldos</li>
              <li>transacciones</li>
              <li>metas patrimoniales</li>
              <li>información financiera que proporciones directamente</li>
              <li>información obtenida mediante integraciones autorizadas</li>
            </ul>
            <p className="text-sm">
              Cuando la legislación aplicable requiera consentimiento expreso para el tratamiento de datos
              financieros o patrimoniales, Nuvos implementará el mecanismo de consentimiento correspondiente.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">4. Conexión con brokers y cuentas financieras</h2>
            <p className="text-sm mb-3">
              La conexión de cuentas externas es opcional. Nuvos utiliza proveedores especializados para
              esta conexión — <strong className="text-white">Plaid</strong> para brokers y cuentas de
              inversión, y <strong className="text-white">Belvo</strong> para bancos e instituciones
              financieras en Latinoamérica.
            </p>
            <div className="p-4 bg-yellow-500/10 rounded-xl border border-yellow-500/20 text-sm mb-3">
              <strong className="text-yellow-400">Nuvos no solicita ni almacena las contraseñas o
              credenciales de acceso</strong> al broker o banco que sean gestionadas directamente por
              dichos proveedores.
            </div>
            <p className="text-sm mb-2">
              Sin embargo, Nuvos puede recibir determinados datos autorizados por el usuario, dependiendo
              de la integración:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>posiciones</li>
              <li>saldos</li>
              <li>transacciones</li>
              <li>instrumentos</li>
              <li>información de cuenta</li>
              <li>identificadores</li>
            </ul>
            <p className="text-sm">
              Nuvos <strong className="text-white">no obtiene mediante esta conexión acceso para retirar,
              transferir, depositar, comprar, vender o disponer</strong> de los fondos o valores del usuario.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">5. Datos recopilados automáticamente</h2>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>Dirección IP</li>
              <li>Tipo de dispositivo y sistema operativo</li>
              <li>Versión de la aplicación</li>
              <li>Identificadores técnicos e información de sesión</li>
              <li>Registros de errores y eventos técnicos</li>
              <li>Token de notificaciones push</li>
              <li>Información de uso y seguridad</li>
              <li>Datos necesarios para prevenir fraude y abuso</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">6. Información de uso</h2>
            <p className="text-sm mb-2">Podemos registrar:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>funcionalidades utilizadas</li>
              <li>lecciones completadas y progreso educativo</li>
              <li>uso de Arthur</li>
              <li>portafolios y watchlists</li>
              <li>alertas configuradas</li>
              <li>preferencias</li>
              <li>participación en promociones</li>
              <li>información técnica necesaria para operar y mejorar la Plataforma</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">7. Conversaciones con Arthur</h2>
            <p className="text-sm mb-3">
              Cuando utilizas Arthur, el contenido que introduces puede ser procesado por proveedores de
              modelos de inteligencia artificial utilizados por Nuvos — incluyendo{" "}
              <strong className="text-white">Anthropic</strong> y <strong className="text-white">OpenAI</strong>.
              Cuando usas funciones de voz o búsqueda en tiempo real, tu contenido también puede procesarse
              mediante <strong className="text-white">ElevenLabs</strong> y{" "}
              <strong className="text-white">Perplexity</strong>, respectivamente.
            </p>
            <p className="text-sm mb-2">Las conversaciones pueden utilizarse para:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>generar respuestas</li>
              <li>mantener el contexto de una conversación</li>
              <li>proporcionar funcionalidades personalizadas</li>
              <li>mejorar el Servicio cuando corresponda</li>
              <li>detectar errores</li>
              <li>prevenir abuso</li>
              <li>cumplir obligaciones legales</li>
            </ul>
            <p className="text-sm">
              El usuario debe evitar introducir información que no sea necesaria para utilizar la función
              correspondiente.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">8. Finalidades primarias</h2>
            <p className="text-sm mb-2">Nuvos puede tratar datos personales para:</p>
            <ol className="list-decimal list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>Crear y autenticar cuentas</li>
              <li>Proporcionar el Servicio</li>
              <li>Operar Arthur</li>
              <li>Personalizar funcionalidades educativas</li>
              <li>Analizar información proporcionada por el usuario</li>
              <li>Mostrar y analizar portafolios</li>
              <li>Sincronizar información entre dispositivos</li>
              <li>Generar reportes</li>
              <li>Proporcionar alertas solicitadas</li>
              <li>Procesar pagos y administrar suscripciones</li>
              <li>Proporcionar soporte</li>
              <li>Prevenir fraude y mantener seguridad</li>
              <li>Detectar errores</li>
              <li>Cumplir obligaciones legales</li>
            </ol>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">9. Finalidades secundarias</h2>
            <p className="text-sm mb-2">Cuando corresponda, Nuvos podrá utilizar información para:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>análisis estadístico y agregado</li>
              <li>investigación y desarrollo</li>
              <li>mejora del producto</li>
              <li>desarrollo de nuevas funcionalidades</li>
              <li>generación de métricas y pruebas</li>
              <li>mejora de modelos y sistemas</li>
              <li>comunicaciones relacionadas con Nuvos</li>
            </ul>
            <p className="text-sm">
              Cuando una finalidad requiera consentimiento, Nuvos proporcionará los mecanismos
              correspondientes.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">10. No vendemos tus datos</h2>
            <p className="text-sm p-4 bg-white/5 rounded-xl border border-white/10">
              <strong className="text-white">Nuvos AI no vende datos personales de sus usuarios.</strong>{" "}
              Nuvos no comercializa bases de datos de usuarios ni utiliza información individual de
              portafolios o patrimonio para venderla a terceros.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">11. Proveedores tecnológicos</h2>
            <p className="text-sm mb-4">
              Nuvos puede utilizar proveedores externos para operar el Servicio. La lista podrá cambiar
              conforme evolucione Nuvos.
            </p>
            <div className="space-y-3 text-sm">
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Supabase</p>
                <p>Autenticación, base de datos y servicios relacionados.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Railway</p>
                <p>Infraestructura y alojamiento de nuestros servidores backend.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Stripe</p>
                <p>Procesamiento de pagos cuando corresponda. Nuvos AI nunca almacena datos completos de tarjetas.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Plaid</p>
                <p>Conexión autorizada con brokers y cuentas de inversión.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Belvo</p>
                <p>Conexión autorizada con bancos e instituciones financieras en Latinoamérica.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Anthropic</p>
                <p>Servicios de inteligencia artificial que impulsan a Arthur.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">OpenAI</p>
                <p>Servicios de inteligencia artificial cuando sean utilizados.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Perplexity</p>
                <p>Búsqueda o recuperación de información en tiempo real cuando sea utilizada.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">ElevenLabs</p>
                <p>Servicios de voz cuando sean utilizados.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Fiscal.ai</p>
                <p>Datos financieros y de mercado cuando sean utilizados.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Resend</p>
                <p>Comunicaciones electrónicas y correos transaccionales.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Twilio</p>
                <p>Mensajería (incluyendo WhatsApp) cuando esa función esté disponible.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Vapi</p>
                <p>Llamadas de voz con Arthur cuando esa función esté disponible.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">12. Transferencias y tratamiento internacional</h2>
            <p className="text-sm">
              Algunos proveedores pueden procesar información desde países distintos al país de residencia
              del usuario. Nuvos implementará las medidas requeridas por la legislación aplicable para
              dichos tratamientos.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">13. Seguridad</h2>
            <p className="text-sm mb-2">
              Nuvos implementa medidas razonables para proteger la información bajo su control, incluyendo,
              según corresponda:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>cifrado en tránsito</li>
              <li>mecanismos de autenticación</li>
              <li>controles de acceso</li>
              <li>protección de infraestructura</li>
              <li>monitoreo y registros técnicos</li>
              <li>controles contra accesos no autorizados</li>
              <li>medidas contra fraude y abuso</li>
            </ul>
            <p className="text-sm">Ningún sistema conectado a Internet puede garantizar seguridad absoluta.</p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">14. Conservación</h2>
            <p className="text-sm mb-2">Conservaremos información mientras sea necesaria para:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>proporcionar el Servicio</li>
              <li>cumplir obligaciones legales, fiscales o contables</li>
              <li>resolver disputas</li>
              <li>prevenir fraude</li>
              <li>proteger la seguridad</li>
              <li>cumplir otras obligaciones legítimas</li>
            </ul>
            <p className="text-sm">
              Cuando la información deje de ser necesaria, será eliminada, anonimizada o sometida al
              tratamiento correspondiente conforme a la legislación aplicable.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">15. Eliminación de cuenta</h2>
            <p className="text-sm">
              El usuario puede solicitar la eliminación de su cuenta desde Perfil → Eliminar mi cuenta.
              La eliminación no necesariamente implica la eliminación inmediata de toda información cuando
              exista una obligación legal de conservarla. Cuando legalmente corresponda, los datos serán
              eliminados o anonimizados una vez concluido el periodo de conservación aplicable.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">16. Derechos del titular</h2>
            <p className="text-sm mb-3">
              Dependiendo de la legislación aplicable, puedes ejercer derechos relacionados con tus datos
              personales, incluyendo:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm">
              <li><strong className="text-white/90">Acceso:</strong> conocer qué datos personales tratamos</li>
              <li><strong className="text-white/90">Rectificación:</strong> corregir información incorrecta</li>
              <li><strong className="text-white/90">Cancelación:</strong> solicitar la eliminación cuando legalmente proceda</li>
              <li><strong className="text-white/90">Oposición:</strong> oponerte a determinados tratamientos</li>
            </ul>
            <p className="text-sm mt-3">
              También podrás ejercer otros derechos reconocidos por la legislación aplicable.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">17. Solicitudes de derechos</h2>
            <p className="text-sm">
              Puedes enviar una solicitud a <span className="text-[#22c55e]">legal@nuvosai.com</span>. La
              solicitud deberá contener la información necesaria para identificarte y procesar
              adecuadamente tu petición. Cuando corresponda, podremos solicitar documentación para
              verificar identidad o representación. Las solicitudes serán atendidas dentro de los plazos
              establecidos por la legislación aplicable.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">18. Revocación del consentimiento</h2>
            <p className="text-sm">
              Cuando un tratamiento dependa del consentimiento, puedes solicitar su revocación a{" "}
              <span className="text-[#22c55e]">legal@nuvosai.com</span>. La revocación no tendrá efectos
              retroactivos y no impedirá tratamientos que deban continuar por obligación legal o
              contractual.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">19. Limitación de uso y divulgación</h2>
            <p className="text-sm">
              Puedes solicitar mecanismos para limitar determinados usos o divulgaciones cuando corresponda
              legalmente. Determinadas preferencias podrán gestionarse directamente desde la aplicación.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">20. Cookies y tecnologías similares</h2>
            <p className="text-sm mb-2">
              Nuvos puede utilizar cookies, almacenamiento local, identificadores de dispositivo y
              tecnologías similares para:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>autenticación</li>
              <li>mantenimiento de sesión</li>
              <li>seguridad</li>
              <li>preferencias</li>
              <li>funcionamiento</li>
              <li>análisis</li>
              <li>prevención de fraude</li>
              <li>mejora de la experiencia</li>
            </ul>
            <p className="text-sm">
              Cuando legalmente corresponda, se solicitará el consentimiento correspondiente.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">21. Menores</h2>
            <p className="text-sm">
              Nuvos AI está dirigido a personas de 18 años o más. No buscamos recopilar intencionalmente
              datos de menores. Si identificamos que hemos recopilado información de un menor en
              circunstancias en las que legalmente no debimos hacerlo, adoptaremos medidas razonables para
              eliminarla.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">22. Cambios al Aviso</h2>
            <p className="text-sm">
              Nuvos podrá modificar este Aviso para reflejar cambios en legislación, funcionalidades,
              proveedores, tecnologías, prácticas de tratamiento o estructura de Nuvos. La versión vigente
              estará disponible dentro de Nuvos y en nuvosai.com. Los cambios materiales podrán comunicarse
              mediante medios razonables.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">23. Contacto</h2>
            <p className="text-sm">
              Correo de privacidad: <span className="text-[#22c55e]">legal@nuvosai.com</span><br />
              Sitio: <span className="text-white">nuvosai.com</span>
            </p>
          </section>

        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-white/30 text-sm">
          <span>© 2026 Nuvos AI. Todos los derechos reservados.</span>
          <div className="flex items-center gap-4 text-xs sm:text-sm">
            <a href="/terms" className="hover:text-white/60 transition-colors">Términos de uso →</a>
            <a href="/privacy-simple" className="hover:text-white/60 transition-colors">Versión simplificada →</a>
            <a href="/ai-policy" className="hover:text-white/60 transition-colors">Política de IA →</a>
          </div>
        </div>

      </div>
    </main>
  );
}
