import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Términos de Uso — Nuvos AI",
  description: "Términos y condiciones de uso de la aplicación Nuvos AI.",
};

export default function TermsPage() {
  return (
    <main className="h-screen overflow-y-auto bg-[#07080f] text-white">
      <div className="max-w-3xl mx-auto px-6 py-16">

        {/* Header */}
        <div className="mb-12">
          <p className="text-[#22c55e] text-sm font-semibold tracking-widest uppercase mb-3">Legal</p>
          <h1 className="text-4xl font-black tracking-tight mb-2">Términos de Uso</h1>
          <p className="text-white/40 text-sm">Nuvos AI · Versión 1.0</p>
          <p className="text-white/30 text-xs mt-1">Última actualización: 22 de septiembre de 2026</p>
        </div>

        {/* Intro banner */}
        <div className="mb-10 p-4 rounded-xl border border-[#22c55e]/20 bg-[#22c55e]/05 text-sm text-white/80">
          Estos Términos de Uso ("Términos") regulan el acceso y uso de Nuvos AI ("Nuvos", "la Plataforma",
          "el Servicio" o "nosotros"), incluyendo el sitio web, aplicaciones móviles, herramientas,
          funcionalidades, contenido y servicios relacionados. Al crear una cuenta, seleccionar la casilla
          de aceptación o utilizar Nuvos AI, declaras que has leído, comprendido y aceptado estos Términos y
          el <a href="/privacy" className="text-[#22c55e] underline hover:opacity-80">Aviso de Privacidad</a> correspondiente.
          Si no estás de acuerdo, no debes crear una cuenta ni utilizar Nuvos AI.
        </div>

        <div className="space-y-10 text-white/70 leading-relaxed">

          <section>
            <p className="text-xs text-white/40">
              <strong className="text-white/60">Responsable / proveedor del Servicio:</strong>{" "}
              [NOMBRE LEGAL COMPLETO DE LA ENTIDAD]
              &nbsp;·&nbsp;<strong className="text-white/60">Contacto:</strong> legal@nuvosai.com
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">1. Naturaleza de Nuvos AI</h2>
            <p className="text-sm mb-3">
              Nuvos AI es una plataforma tecnológica de carácter <strong className="text-white">educativo
              e informativo</strong> que utiliza software, datos financieros, herramientas analíticas y
              tecnologías de inteligencia artificial para ayudar a los usuarios a comprender información
              relacionada con inversiones, mercados, empresas, portafolios, finanzas y asignación de
              capital. El objetivo de Nuvos es ayudar al usuario a comprender mejor la información y
              tomar sus propias decisiones — Nuvos AI no toma decisiones financieras por cuenta del usuario.
            </p>
            <p className="text-sm mb-2">Nuvos AI no constituye:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>un banco</li>
              <li>una casa de bolsa</li>
              <li>un intermediario del mercado de valores</li>
              <li>una institución de crédito</li>
              <li>una sociedad de inversión</li>
              <li>un asesor en inversiones</li>
              <li>un administrador o gestor de portafolios</li>
              <li>un custodio de dinero o valores</li>
              <li>una institución financiera</li>
              <li>un fiduciario</li>
              <li>un broker</li>
              <li>ni una entidad autorizada para administrar, custodiar o disponer de fondos o valores de terceros</li>
            </ul>
            <p className="text-sm mt-3">
              El hecho de que Nuvos AI proporcione información, análisis, herramientas de valoración o
              funcionalidades relacionadas con inversiones no significa que Nuvos AI preste servicios
              financieros regulados.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">2. Nuvos AI no administra ni custodia tu dinero</h2>
            <div className="p-4 bg-yellow-500/10 rounded-xl border border-yellow-500/20 text-sm mb-3">
              <strong className="text-yellow-400">Aviso importante:</strong> Nuvos AI no recibe, mantiene,
              custodia, administra ni controla el dinero, valores, instrumentos financieros u otros activos
              pertenecientes a sus usuarios.
            </div>
            <p className="text-sm mb-2">Nuvos AI no tiene facultades para:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>retirar dinero</li>
              <li>transferir dinero</li>
              <li>depositar dinero</li>
              <li>comprar valores</li>
              <li>vender valores</li>
              <li>ejecutar órdenes</li>
              <li>administrar cuentas de inversión</li>
              <li>administrar cuentas bancarias</li>
              <li>disponer de valores</li>
              <li>mantener valores en custodia</li>
              <li>girar instrucciones a un broker o institución financiera por cuenta del usuario</li>
              <li>decidir cuándo, cuánto o qué debe comprar o vender el usuario</li>
            </ul>
            <p className="text-sm mt-3">
              La relación financiera del usuario con su banco, broker, casa de bolsa, plataforma de
              inversión o institución financiera permanece exclusivamente entre el usuario y dicha
              institución.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">3. Conexión con brokers y cuentas financieras externas</h2>
            <p className="text-sm mb-3">
              Nuvos puede ofrecer herramientas que permitan al usuario conectar determinadas cuentas
              externas mediante proveedores tecnológicos especializados, como <strong className="text-white">Plaid</strong>{" "}
              (brokers y cuentas de inversión) o <strong className="text-white">Belvo</strong> (bancos e
              instituciones financieras en Latinoamérica). La conexión de una cuenta externa es{" "}
              <strong className="text-white">opcional</strong>.
            </p>
            <p className="text-sm mb-3">
              Cuando la conexión se realiza mediante uno de estos proveedores, las credenciales de acceso
              del usuario son gestionadas por el proveedor correspondiente conforme a sus propios términos
              y políticas. Nuvos AI <strong className="text-white">no solicita ni almacena las contraseñas,
              códigos de autenticación, claves privadas ni credenciales de acceso al broker o institución
              financiera</strong> cuando dichas credenciales sean gestionadas directamente por el proveedor
              de conexión.
            </p>
            <p className="text-sm mb-2">
              Sin embargo, una integración autorizada puede proporcionar a Nuvos determinados datos
              financieros que el usuario haya autorizado compartir, dependiendo de la institución, el
              proveedor y los permisos otorgados:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>posiciones</li>
              <li>instrumentos financieros</li>
              <li>saldos</li>
              <li>transacciones</li>
              <li>información de cuenta</li>
              <li>identificadores relacionados con la cuenta</li>
              <li>otra información necesaria para proporcionar la funcionalidad solicitada</li>
            </ul>
            <p className="text-sm mb-3">
              Por tanto, Nuvos puede procesar determinados datos financieros o patrimoniales proporcionados
              mediante una conexión autorizada, pero <strong className="text-white">no obtiene por dicha
              conexión facultades para disponer del dinero o valores del usuario</strong>.
            </p>
            <p className="text-sm mb-2">La conexión de una cuenta externa no permite a Nuvos:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>retirar fondos</li>
              <li>transferir fondos</li>
              <li>depositar fondos</li>
              <li>comprar valores</li>
              <li>vender valores</li>
              <li>ejecutar operaciones</li>
              <li>modificar órdenes</li>
              <li>cambiar beneficiarios</li>
              <li>cerrar cuentas</li>
              <li>disponer de los activos del usuario</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">4. Ausencia de asesoría de inversión</h2>
            <p className="text-sm mb-3">
              Nuvos AI proporciona información, herramientas educativas, análisis, comparaciones,
              escenarios y explicaciones de carácter general. Salvo que Nuvos obtenga en el futuro las
              autorizaciones correspondientes y modifique expresamente estos Términos,{" "}
              <strong className="text-white">Nuvos AI no proporciona asesoría de inversión personalizada
              ni individualizada</strong>.
            </p>
            <p className="text-sm mb-3">
              El contenido de Nuvos AI no constituye una recomendación personalizada para comprar, vender
              o mantener un instrumento financiero. La existencia de un perfil de usuario, portafolio,
              objetivos, ingresos, experiencia, tolerancia al riesgo u otra información proporcionada por
              el usuario no significa, por sí misma, que Nuvos esté prestando asesoría de inversión.
            </p>
            <p className="text-sm">
              El usuario conserva en todo momento la responsabilidad de evaluar la información y decidir
              qué hacer con su capital.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">5. Arthur, el asistente de inteligencia artificial</h2>
            <p className="text-sm mb-3">
              Arthur es el asistente de inteligencia artificial de Nuvos AI. Arthur puede utilizar
              información proporcionada por el usuario, información financiera, datos de mercado,
              documentos, fuentes públicas, herramientas analíticas, modelos de inteligencia artificial y
              otras fuentes disponibles dentro del Servicio para adaptar explicaciones al contexto del
              usuario con fines educativos. Esta personalización{" "}
              <strong className="text-white">no crea una relación de asesoría financiera, fiduciaria o de
              gestión de inversiones</strong>.
            </p>
            <p className="text-sm mb-2">Arthur puede:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>explicar conceptos</li>
              <li>analizar información</li>
              <li>comparar alternativas</li>
              <li>identificar factores relevantes</li>
              <li>explicar riesgos</li>
              <li>mostrar escenarios</li>
              <li>realizar cálculos</li>
              <li>explicar metodologías de valoración</li>
              <li>formular preguntas</li>
              <li>señalar información que podría ser relevante</li>
              <li>ayudar a interpretar documentos</li>
              <li>ayudar al usuario a desarrollar su propio criterio</li>
            </ul>
            <p className="text-sm mt-3">
              Arthur no tiene autoridad para tomar decisiones financieras por el usuario. Consulta la{" "}
              <a href="/ai-policy" className="text-[#22c55e] underline hover:opacity-80">Política de
              Inteligencia Artificial y Arthur</a> para más detalle sobre cómo funciona y cuáles son sus
              límites.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">6. Limitaciones de inteligencia artificial</h2>
            <p className="text-sm mb-3">Los sistemas de inteligencia artificial pueden producir:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>errores</li>
              <li>información incompleta</li>
              <li>información desactualizada</li>
              <li>cálculos incorrectos</li>
              <li>interpretaciones incorrectas</li>
              <li>referencias incorrectas</li>
              <li>conclusiones inconsistentes</li>
              <li>respuestas que parezcan confiables aunque sean incorrectas</li>
            </ul>
            <p className="text-sm">
              Nuvos AI no garantiza que las respuestas generadas por Arthur sean correctas o completas. El
              usuario no debe considerar una respuesta correcta únicamente porque haya sido expresada con
              seguridad, detalle o lenguaje técnico. Las decisiones importantes deberán verificarse
              utilizando fuentes primarias y, cuando corresponda, profesionales independientes.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">7. Fuentes y datos financieros</h2>
            <p className="text-sm mb-3">
              Nuvos puede utilizar información de terceros, incluyendo proveedores de datos financieros,
              fuentes públicas, documentos corporativos, sitios web, bases de datos, servicios de búsqueda
              y otras fuentes. Nuvos procura utilizar información de fuentes confiables, pero no garantiza
              que toda información sea:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>exacta</li>
              <li>completa</li>
              <li>actualizada</li>
              <li>libre de errores</li>
              <li>disponible permanentemente</li>
              <li>adecuada para las circunstancias particulares del usuario</li>
              <li>apropiada para tomar una decisión financiera específica</li>
            </ul>
            <p className="text-sm">
              Los precios, estados financieros, noticias, estimaciones y demás información pueden cambiar
              después de haber sido obtenidos o mostrados.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">8. Riesgos de inversión</h2>
            <p className="text-sm mb-3">
              Toda inversión implica riesgo. El valor de una inversión puede aumentar o disminuir y el
              usuario puede perder una parte o la totalidad del capital invertido. El rendimiento histórico
              no garantiza resultados futuros.
            </p>
            <p className="text-sm mb-2">Nuvos AI no garantiza:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>ganancias</li>
              <li>rendimientos</li>
              <li>preservación de capital</li>
              <li>reducción de pérdidas</li>
              <li>resultados determinados</li>
              <li>éxito de una estrategia</li>
              <li>desempeño futuro de ningún activo</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">9. Responsabilidad del usuario</h2>
            <p className="text-sm mb-2">
              El usuario es responsable de sus propias decisiones financieras. Nuvos proporciona
              información y herramientas; la decisión de invertir, no invertir, comprar, vender, mantener,
              modificar una posición, retirar fondos, asignar capital o realizar cualquier otra acción
              financiera corresponde exclusivamente al usuario.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">10. Profesionales independientes</h2>
            <p className="text-sm mb-3">Nuvos AI no sustituye la asesoría de:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>abogados</li>
              <li>contadores</li>
              <li>asesores fiscales</li>
              <li>asesores financieros</li>
              <li>asesores en inversiones</li>
              <li>brokers</li>
              <li>agentes inmobiliarios</li>
              <li>profesionales de seguros</li>
              <li>otros especialistas</li>
            </ul>
            <p className="text-sm">
              Cuando una decisión pueda tener consecuencias legales, fiscales, financieras o patrimoniales
              importantes, el usuario debe considerar obtener asesoría profesional independiente.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">11. Elegibilidad</h2>
            <p className="text-sm">
              Nuvos AI está dirigido a personas de <strong className="text-white">18 años o más</strong>.
              Al utilizar Nuvos declaras que tienes capacidad legal suficiente para celebrar estos Términos.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">12. Cuenta del usuario</h2>
            <p className="text-sm mb-2">
              El usuario debe proporcionar información verdadera, completa y actualizada, y es responsable de:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>mantener la confidencialidad de sus credenciales</li>
              <li>proteger su cuenta</li>
              <li>no compartir sus credenciales</li>
              <li>revisar la actividad de su cuenta</li>
              <li>notificar a Nuvos cualquier acceso no autorizado que llegue a su conocimiento</li>
            </ul>
            <p className="text-sm mt-3">
              Nuvos podrá solicitar información adicional cuando resulte razonablemente necesario para
              proteger la cuenta, prevenir fraude o cumplir obligaciones legales.
            </p>
          </section>

          {/* ── Planes y pagos ── */}
          <div className="border-t border-white/10 pt-10">
            <p className="text-[#22c55e] text-xs font-bold uppercase tracking-widest mb-6">Planes, pagos y promociones</p>
          </div>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">13. Plan gratuito</h2>
            <p className="text-sm">
              El Plan Gratuito puede incluir, sujeto a los límites vigentes: acceso limitado a Arthur,
              portafolios y watchlists con límites de cantidad, contenido educativo, herramientas básicas,
              determinadas notificaciones y otras funcionalidades que Nuvos determine. Nuvos puede
              modificar los límites y funcionalidades del Plan Gratuito.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">14. Plan Premium</h2>
            <p className="text-sm">
              El Plan Premium puede incluir, sujeto a las funcionalidades vigentes: acceso ampliado a
              Arthur, portafolios y watchlists ampliados o ilimitados, análisis avanzados, herramientas de
              valoración, stress tests, oportunidades para analizar, alertas, análisis periódicos,
              investigaciones, memoria y personalización ampliadas, y otras funcionalidades Premium. El
              contenido exacto del Plan Premium será el mostrado al usuario al momento de contratación.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">15. Plan Dúo</h2>
            <p className="text-sm">
              El Plan Dúo permite el acceso de dos usuarios independientes conforme a las condiciones
              mostradas durante la contratación. Cada usuario tendrá su propio perfil, cuenta,
              información, conversaciones, portafolio y configuración. Los usuarios del Plan Dúo no
              adquieren automáticamente acceso a la información privada del otro usuario.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">16. Pruebas gratuitas y promociones</h2>
            <p className="text-sm mb-2">
              Nuvos puede ofrecer pruebas gratuitas, créditos, promociones, periodos Premium y programas
              de referidos. Las condiciones aplicables serán comunicadas al usuario antes o durante su
              participación. Nuvos puede limitar o cancelar beneficios obtenidos mediante:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>fraude</li>
              <li>abuso</li>
              <li>cuentas duplicadas</li>
              <li>manipulación del sistema</li>
              <li>automatización indebida</li>
              <li>incumplimiento de las condiciones promocionales</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">17. Suscripciones y pagos</h2>
            <p className="text-sm mb-2">
              Los precios y periodicidad aplicables serán mostrados antes de completar la compra. Las
              suscripciones podrán renovarse automáticamente cuando así se indique durante la
              contratación. Los pagos pueden procesarse mediante proveedores externos, incluyendo Stripe
              y, cuando corresponda, los sistemas de pago de Apple App Store o Google Play. Nuvos no
              pretende almacenar directamente los datos completos de tarjetas cuando sean procesados
              directamente por proveedores de pago.
            </p>
            <p className="text-sm">
              Las condiciones de facturación, cancelación y reembolso podrán variar dependiendo del canal
              utilizado para realizar la compra y de la legislación aplicable.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">18. Cancelaciones y reembolsos</h2>
            <p className="text-sm mb-2">
              El usuario puede cancelar una suscripción conforme al procedimiento disponible en el canal
              donde la haya contratado. Las solicitudes de reembolso estarán sujetas a la legislación
              aplicable, las condiciones mostradas durante la compra y las políticas del proveedor de pago
              correspondiente.
            </p>
            <p className="text-sm">
              Nada en estos Términos limita derechos que legalmente no puedan ser renunciados por el
              consumidor.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">19. Productos adicionales</h2>
            <p className="text-sm mb-2">
              Nuvos podrá ofrecer productos adicionales, incluyendo investigaciones, reportes,
              herramientas educativas, sesiones educativas individuales, materiales de aprendizaje y otros
              productos digitales. Las condiciones y precios se mostrarán antes de la compra.
            </p>
            <p className="text-sm">
              Una sesión individual de carácter educativo no constituye por sí misma asesoría de
              inversión, gestión de inversiones ni autorización para que Nuvos tome decisiones por cuenta
              del usuario.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">20. Programa de referidos</h2>
            <p className="text-sm">
              Nuvos podrá ofrecer beneficios por invitar nuevos usuarios. Las condiciones, requisitos,
              límites y beneficios serán comunicados en el momento de la promoción. Nuvos puede cancelar
              beneficios obtenidos mediante fraude o abuso.
            </p>
          </section>

          {/* ── Uso, propiedad y disponibilidad ── */}
          <div className="border-t border-white/10 pt-10">
            <p className="text-[#22c55e] text-xs font-bold uppercase tracking-widest mb-6">Uso del servicio</p>
          </div>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">21. Uso aceptable</h2>
            <p className="text-sm mb-3">El usuario no podrá:</p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>utilizar Nuvos para actividades ilegales</li>
              <li>cometer fraude</li>
              <li>manipular mercados</li>
              <li>intentar acceder a sistemas sin autorización</li>
              <li>introducir malware</li>
              <li>interferir con los servidores</li>
              <li>realizar ataques</li>
              <li>sobrecargar intencionalmente la infraestructura</li>
              <li>extraer información mediante mecanismos automatizados no autorizados</li>
              <li>realizar ingeniería inversa cuando esté prohibida por la legislación aplicable</li>
              <li>hacerse pasar por Nuvos o Arthur</li>
              <li>utilizar Nuvos para prestar servicios regulados sin contar con las autorizaciones necesarias</li>
              <li>utilizar Nuvos para asesorar financieramente a terceros de manera contraria a la legislación aplicable</li>
              <li>utilizar cuentas de otras personas sin autorización</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">22. Propiedad intelectual</h2>
            <p className="text-sm mb-3">
              Nuvos AI y sus elementos —incluyendo software, código, diseño, interfaces, marca, logotipos,
              textos, gráficos, bases de datos, funcionalidades, documentación y demás elementos
              protegibles— son propiedad de Nuvos o de sus respectivos licenciantes.
            </p>
            <p className="text-sm">
              El usuario recibe una licencia limitada, personal, revocable, no exclusiva y no transferible
              para utilizar el Servicio conforme a estos Términos.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">23. Contenido proporcionado por el usuario</h2>
            <p className="text-sm">
              El usuario conserva sus derechos sobre la información que proporcione a Nuvos, sujeto a las
              licencias y permisos necesarios para operar el Servicio. El usuario declara que tiene derecho
              a cargar los documentos, datos o información que proporcione, y no deberá cargar información
              de terceros cuando no tenga autorización para hacerlo.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">24. Disponibilidad del Servicio</h2>
            <p className="text-sm mb-2">Nuvos no garantiza que el Servicio:</p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>esté disponible permanentemente</li>
              <li>sea completamente libre de errores</li>
              <li>funcione sin interrupciones</li>
              <li>sea compatible con todos los dispositivos</li>
              <li>permanezca sin modificaciones</li>
            </ul>
            <p className="text-sm mt-3">
              Nuvos podrá realizar mantenimiento, actualizaciones, cambios o interrupciones temporales.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">25. Servicios de terceros</h2>
            <p className="text-sm mb-2">
              Nuvos depende de determinados proveedores externos para operar algunas funciones, incluyendo
              proveedores de inteligencia artificial, alojamiento, autenticación, pagos, correo
              electrónico, mensajería, llamadas de voz, datos financieros, búsqueda, conexión de cuentas
              financieras, infraestructura tecnológica y otros servicios.
            </p>
            <p className="text-sm">
              Una interrupción de un proveedor externo puede afectar determinadas funcionalidades de Nuvos.
            </p>
          </section>

          {/* ── Privacidad, seguridad y responsabilidad ── */}
          <div className="border-t border-white/10 pt-10">
            <p className="text-[#22c55e] text-xs font-bold uppercase tracking-widest mb-6">Privacidad, seguridad y responsabilidad</p>
          </div>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">26. Privacidad</h2>
            <p className="text-sm">
              El tratamiento de datos personales se encuentra regulado por el{" "}
              <a href="/privacy" className="text-[#22c55e] underline hover:opacity-80">Aviso de Privacidad
              de Nuvos AI</a>, que forma parte integral del marco contractual del Servicio y explica qué
              información recopilamos, cómo la utilizamos, con quién puede ser compartida, cómo la
              protegemos, cuánto tiempo podemos conservarla y cómo ejercer los derechos correspondientes.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">27. Seguridad</h2>
            <p className="text-sm">
              Nuvos implementa medidas técnicas y organizativas razonables para proteger la información
              bajo su control. Sin embargo, ningún sistema conectado a Internet puede garantizar seguridad
              absoluta. El usuario reconoce que existe un riesgo residual inherente a los servicios
              digitales.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">28. Limitación de responsabilidad</h2>
            <p className="text-sm mb-2">
              En la máxima medida permitida por la legislación aplicable, Nuvos no será responsable por:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>pérdidas de inversión</li>
              <li>pérdidas financieras</li>
              <li>pérdida de oportunidades</li>
              <li>decisiones tomadas por el usuario</li>
              <li>errores de información de terceros</li>
              <li>información incorrecta generada por IA</li>
              <li>interrupciones de mercados</li>
              <li>fallas de brokers o bancos</li>
              <li>fallas de proveedores tecnológicos</li>
              <li>interrupciones del Servicio</li>
              <li>daños indirectos o consecuenciales</li>
            </ul>
            <p className="text-sm mb-2">
              Nada en estos Términos excluye responsabilidades que legalmente no puedan excluirse.
            </p>
            <p className="text-sm p-4 bg-yellow-500/10 rounded-xl border border-yellow-500/20">
              En la máxima medida permitida por la ley, la responsabilidad acumulada de Nuvos derivada del
              Servicio se limitará a las cantidades efectivamente pagadas por el usuario a Nuvos durante
              los doce meses anteriores al evento que origine la reclamación.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">29. Indemnización</h2>
            <p className="text-sm">
              En la medida permitida por la legislación aplicable, el usuario acepta mantener indemne a
              Nuvos, sus colaboradores y proveedores frente a reclamaciones derivadas de incumplimiento de
              estos Términos, uso ilegal del Servicio, fraude, violación de derechos de terceros, contenido
              proporcionado sin autorización o uso indebido de la Plataforma. Esta disposición no limita
              derechos irrenunciables del consumidor.
            </p>
          </section>

          {/* ── Cuenta y cambios ── */}
          <div className="border-t border-white/10 pt-10">
            <p className="text-[#22c55e] text-xs font-bold uppercase tracking-widest mb-6">Cuenta, cambios y contacto</p>
          </div>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">30. Suspensión y terminación</h2>
            <p className="text-sm mb-2">
              El usuario puede dejar de utilizar Nuvos en cualquier momento. Nuvos podrá suspender o
              terminar una cuenta cuando exista incumplimiento de estos Términos, fraude, abuso, riesgo de
              seguridad, obligación legal u otra causa permitida por la legislación aplicable.
            </p>
            <p className="text-sm">
              Cuando sea razonablemente posible y legalmente permitido, Nuvos podrá informar al usuario
              sobre la causa correspondiente.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">31. Eliminación de cuenta</h2>
            <p className="text-sm">
              El usuario podrá solicitar la eliminación de su cuenta mediante las herramientas disponibles
              (Perfil → Eliminar mi cuenta). La eliminación estará sujeta a las obligaciones legales,
              fiscales, contables, contractuales y de seguridad que puedan requerir la conservación
              temporal de determinada información, por lo que no implica necesariamente la eliminación
              inmediata de toda información cuando exista una obligación legal de conservación.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">32. Cambios al Servicio</h2>
            <p className="text-sm">
              Nuvos puede modificar, actualizar, agregar o eliminar funcionalidades. Cuando un cambio
              afecte materialmente derechos u obligaciones del usuario, se proporcionará el aviso
              correspondiente cuando sea requerido por la legislación aplicable.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">33. Cambios a estos Términos</h2>
            <p className="text-sm">
              Nuvos puede actualizar estos Términos. La versión vigente estará disponible dentro de la
              Plataforma y en el sitio web. Los cambios materiales podrán comunicarse mediante medios
              razonables. La fecha de última actualización identificará la versión vigente.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">34. Legislación y derechos del consumidor</h2>
            <p className="text-sm">
              Estos Términos se interpretarán conforme a la legislación aplicable. Cuando el usuario tenga
              derechos irrenunciables derivados de las leyes de protección al consumidor, privacidad u
              otras disposiciones aplicables, dichos derechos permanecerán vigentes. Ninguna disposición
              pretende privar al usuario de protecciones que legalmente le correspondan.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">35. Divisibilidad</h2>
            <p className="text-sm">
              Si alguna disposición fuese declarada inválida o inaplicable, las demás disposiciones
              continuarán vigentes en la medida permitida por la legislación aplicable.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">36. Contacto</h2>
            <p className="text-sm">
              Para preguntas sobre estos Términos, contáctanos en:{" "}
              <span className="text-[#22c55e]">legal@nuvosai.com</span>
            </p>
          </section>

          {/* Acceptance block */}
          <div className="border border-white/15 rounded-2xl p-6 bg-white/[0.02] mt-4">
            <p className="text-xs font-bold uppercase tracking-widest text-[#22c55e] mb-3">Aceptación electrónica</p>
            <p className="text-sm text-white/80 leading-relaxed mb-3">
              Al crear una cuenta o utilizar Nuvos AI, confirmas que:
            </p>
            <ul className="text-sm text-white/70 space-y-1.5 mb-4">
              <li>☐ Has leído y aceptado los Términos de Uso.</li>
              <li>☐ Has leído el Aviso de Privacidad.</li>
              <li>☐ Comprendes que Nuvos AI es una plataforma educativa e informativa.</li>
              <li>☐ Comprendes que Nuvos AI no custodia ni administra tu dinero o valores.</li>
              <li>☐ Comprendes que Nuvos AI no ejecuta operaciones financieras por tu cuenta.</li>
              <li>☐ Comprendes que Arthur utiliza inteligencia artificial y puede cometer errores.</li>
              <li>☐ Comprendes que las decisiones financieras son responsabilidad del usuario.</li>
            </ul>
            <p className="text-xs text-white/30">
              La aceptación electrónica podrá quedar registrada junto con la fecha, hora, versión de los
              documentos aceptados, identificador de usuario y otros datos técnicos necesarios para
              acreditar dicha aceptación conforme a la legislación aplicable.
            </p>
          </div>

        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-white/30 text-xs">
          <span>© 2026 Nuvos AI · Borrador sujeto a revisión por asesoría legal · nuvosai.com</span>
          <div className="flex items-center gap-4">
            <a href="/privacy" className="hover:text-white/60 transition-colors">Aviso de Privacidad →</a>
            <a href="/ai-policy" className="hover:text-white/60 transition-colors">Política de IA →</a>
          </div>
        </div>

      </div>
    </main>
  );
}
