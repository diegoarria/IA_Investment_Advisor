import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Aviso de Privacidad Simplificado — Nuvos AI",
  description: "Versión corta, en lenguaje simple, de cómo Nuvos AI trata tus datos.",
};

export default function PrivacySimplePage() {
  return (
    <main className="h-screen overflow-y-auto bg-[#07080f] text-white">
      <div className="max-w-3xl mx-auto px-6 py-16">

        {/* Header */}
        <div className="mb-12">
          <p className="text-[#22c55e] text-sm font-semibold tracking-widest uppercase mb-3">Legal</p>
          <h1 className="text-4xl font-black tracking-tight mb-2">Aviso de Privacidad Simplificado</h1>
          <p className="text-white/40 text-sm">Nuvos AI</p>
          <p className="text-white/30 text-xs mt-1">Última actualización: 22 de septiembre de 2026</p>
        </div>

        <div className="mb-10 p-4 rounded-xl border border-[#22c55e]/20 bg-[#22c55e]/05 text-sm text-white/80">
          Para utilizar Nuvos AI necesitamos tratar determinados datos personales para crear tu cuenta,
          proporcionar el Servicio y personalizar determinadas funcionalidades. Esta es la versión corta;
          el{" "}
          <a href="/privacy" className="text-[#22c55e] underline hover:opacity-80">Aviso de Privacidad
          Integral</a> tiene el detalle completo.
        </div>

        <div className="space-y-8 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-white text-lg font-bold mb-3">¿Qué información podemos recopilar?</h2>
            <p className="text-sm mb-2">Dependiendo de las funciones que utilices:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>correo electrónico y datos de cuenta</li>
              <li>información que proporciones durante el onboarding</li>
              <li>objetivos y preferencias financieras</li>
              <li>información de portafolio</li>
              <li>información que introduzcas en Arthur</li>
              <li>documentos que decidas subir</li>
              <li>información técnica de tu dispositivo</li>
              <li>información relacionada con el uso de la aplicación</li>
              <li>información financiera que decidas importar mediante una integración autorizada</li>
            </ul>
          </section>

          <section className="p-4 bg-white/5 rounded-xl border border-white/10">
            <h2 className="text-white text-base font-bold mb-2">¿Nuvos tiene mi contraseña del broker?</h2>
            <p className="text-sm mb-2">
              <strong className="text-white">No</strong>, cuando la conexión se realiza mediante un
              proveedor que gestione directamente las credenciales, como Plaid o Belvo.
            </p>
            <p className="text-sm">
              Nuvos no necesita tu contraseña del broker o banco para mostrar la información autorizada
              mediante dicha conexión. Sin embargo, Nuvos puede recibir determinados datos financieros que
              hayas autorizado compartir, como posiciones, saldos o transacciones, dependiendo de la
              integración.
            </p>
          </section>

          <section className="p-4 bg-white/5 rounded-xl border border-white/10">
            <h2 className="text-white text-base font-bold mb-2">¿Nuvos puede sacar mi dinero?</h2>
            <p className="text-sm mb-2"><strong className="text-white">No.</strong></p>
            <p className="text-sm">
              Nuvos no puede retirar, transferir, depositar, comprar, vender ni disponer de tu dinero o
              valores mediante la conexión de una cuenta financiera. Nuvos tampoco custodia tu dinero o
              inversiones.
            </p>
          </section>

          <section>
            <h2 className="text-white text-lg font-bold mb-3">¿Para qué utilizamos tus datos?</h2>
            <p className="text-sm mb-2">Principalmente para:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>operar tu cuenta</li>
              <li>proporcionar Arthur</li>
              <li>personalizar tu experiencia educativa</li>
              <li>mostrar y analizar tu portafolio</li>
              <li>generar reportes</li>
              <li>enviar alertas que hayas solicitado</li>
              <li>procesar pagos</li>
              <li>mantener la seguridad</li>
              <li>mejorar Nuvos</li>
            </ul>
          </section>

          <section className="p-4 bg-white/5 rounded-xl border border-white/10">
            <h2 className="text-white text-base font-bold mb-2">¿Vendemos tus datos?</h2>
            <p className="text-sm"><strong className="text-white">No vendemos tus datos personales.</strong></p>
          </section>

          <section>
            <h2 className="text-white text-lg font-bold mb-3">¿Quién puede procesar información?</h2>
            <p className="text-sm">
              Nuvos utiliza proveedores tecnológicos para operar determinados servicios, incluyendo
              infraestructura, autenticación, pagos, inteligencia artificial, datos financieros, correo
              electrónico y conexiones con instituciones financieras (Plaid, Belvo). Puedes consultar la
              lista y descripción de estos proveedores en el{" "}
              <a href="/privacy" className="text-[#22c55e] underline hover:opacity-80">Aviso de Privacidad
              Integral</a>.
            </p>
          </section>

          <section>
            <h2 className="text-white text-lg font-bold mb-3">¿Puedo eliminar mis datos?</h2>
            <p className="text-sm">
              Sí. Puedes solicitar la eliminación de tu cuenta desde Perfil → Eliminar mi cuenta, y ejercer
              los derechos que correspondan conforme a la legislación aplicable escribiendo a{" "}
              <span className="text-[#22c55e]">legal@nuvosai.com</span>.
            </p>
          </section>

        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-white/30 text-xs">
          <span>© 2026 Nuvos AI · Al crear tu cuenta, aceptas el tratamiento de tus datos conforme al Aviso de Privacidad aplicable.</span>
          <a href="/privacy" className="hover:text-white/60 transition-colors">Aviso de Privacidad Integral →</a>
        </div>

      </div>
    </main>
  );
}
