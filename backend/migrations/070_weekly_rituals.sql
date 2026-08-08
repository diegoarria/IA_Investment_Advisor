-- ============================================================================
-- 070_weekly_rituals.sql
--
-- Nuvos Weekly Rituals — three new cadence-based touchpoints requested by
-- Diego: Sunday "Prepárate para la semana" (portfolio/watchlist event
-- rollup), a daily "Pregunta del Día" (one shared question for every user,
-- vote A/B, see the community %, Premium sees Nuvos's own pick +
-- explanation), and Saturday "Reflexión de la semana" (3 free-text prompts,
-- answers saved so the user can re-read them later). None of this
-- infrastructure existed before — no poll/vote table, no curated-content
-- bank, no weekly event rollup anywhere in the codebase.
--
-- daily_questions is a CURATED bank (seeded below with real content, never
-- LLM-generated at send time) — last_used_at is the never-repeat
-- mechanism: the picking job always takes the oldest-used (NULLS FIRST)
-- row, so no question repeats until the entire bank has cycled once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_questions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_es           TEXT NOT NULL,
  question_en           TEXT NOT NULL,
  option_a_es           TEXT NOT NULL,
  option_a_en           TEXT NOT NULL,
  option_b_es           TEXT NOT NULL,
  option_b_en           TEXT NOT NULL,
  nuvos_choice          CHAR(1) NOT NULL CHECK (nuvos_choice IN ('a', 'b')),
  nuvos_explanation_es  TEXT NOT NULL,
  nuvos_explanation_en  TEXT NOT NULL,
  active                BOOLEAN NOT NULL DEFAULT true,
  last_used_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_questions_pick_order
  ON daily_questions (active, last_used_at NULLS FIRST);

-- Which question is "live" today — one global row per date, not per user.
CREATE TABLE IF NOT EXISTS daily_question_of_the_day (
  date         DATE PRIMARY KEY,
  question_id  UUID NOT NULL REFERENCES daily_questions(id)
);

-- One vote per user per day.
CREATE TABLE IF NOT EXISTS daily_question_votes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id  UUID NOT NULL REFERENCES daily_questions(id),
  date         DATE NOT NULL,
  choice       CHAR(1) NOT NULL CHECK (choice IN ('a', 'b')),
  voted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_question_votes_by_question ON daily_question_votes (question_id);

ALTER TABLE daily_question_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own daily question votes" ON daily_question_votes;
CREATE POLICY "Users manage own daily question votes" ON daily_question_votes
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- Deliberately no public SELECT policy on other users' rows — the
-- aggregate community % is served by the backend (service-role query),
-- never read directly by client-side Supabase calls.

-- Saturday reflection — 3 free-text prompts per week, saved so the user
-- can re-read past weeks (same "real user data, not ephemeral" convention
-- as the rest of this app — confirmed with Diego before building this).
CREATE TABLE IF NOT EXISTS weekly_reflections (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start_date        DATE NOT NULL,  -- Monday of that week
  went_well              TEXT,
  learned                TEXT,
  would_do_differently   TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, week_start_date)
);

ALTER TABLE weekly_reflections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own weekly reflections" ON weekly_reflections;
CREATE POLICY "Users manage own weekly reflections" ON weekly_reflections
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Single toggle for all three rituals (Sunday prep, daily question,
-- Saturday reflection) — same DEFAULT true convention as every existing
-- push_* column (migration 011).
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS push_weekly_rituals BOOLEAN DEFAULT true;

-- ============================================================================
-- Seed bank — 24 real investing trade-off / psychology questions (24 days
-- of rotation before any repeat; the pick logic works for any bank size,
-- so this is just a starting set, not a hard limit — add more with a
-- plain INSERT later). Every explanation is a real, defensible investing
-- principle — never a specific buy/sell recommendation (same "Arthur
-- nunca prescribe" rule the rest of the app follows).
--
-- No natural unique key on question text, so this block is written to run
-- exactly ONCE — do not re-run this migration file after it's already
-- been applied, or the bank will duplicate.
-- ============================================================================

INSERT INTO daily_questions (question_es, question_en, option_a_es, option_a_en, option_b_es, option_b_en, nuvos_choice, nuvos_explanation_es, nuvos_explanation_en) VALUES

('¿Qué prefieres?', 'What would you prefer?',
 '+15% anual', '+15% annual return',
 '+5% + dividendos', '+5% + dividends',
 'a', 'Depende de tu horizonte, pero a largo plazo el crecimiento compuesto de un +15% real suele superar a un +5%+dividendos si ambos son sostenibles — la clave es que el +15% sea real, no una ilusión de corto plazo.', 'It depends on your horizon, but over the long run a real +15% compounds faster than +5%+dividends if both are sustainable — the key is that the +15% has to be genuinely real, not a short-term illusion.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Una acción de alta convicción (30% del portafolio)', 'One high-conviction stock (30% of portfolio)',
 'Una canasta diversificada de 20 acciones', 'A diversified basket of 20 stocks',
 'b', 'La concentración solo paga si tu análisis es genuinamente superior al del mercado — para la mayoría de inversores, incluso los buenos, la diversificación reduce el riesgo de arruinar el resultado por un solo error de tesis.', 'Concentration only pays off if your analysis is genuinely better than the market''s — for most investors, even good ones, diversification lowers the risk of one wrong thesis wrecking the whole outcome.'),

('¿Qué harías?', 'What would you do?',
 'Vender en pánico si cae -20%', 'Sell in a panic if it drops -20%',
 'Mantener y evaluar si la tesis sigue intacta', 'Hold and reassess whether the thesis still holds',
 'b', 'Una caída de precio no es automáticamente una señal de que algo cambió en el negocio — la pregunta correcta es si la tesis original sigue siendo válida, no cuánto bajó el precio.', 'A price drop isn''t automatically a sign something changed in the business — the right question is whether the original thesis still holds, not how far the price fell.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Comprar todo de una vez', 'Buy it all at once',
 'Promediar en varias compras (DCA)', 'Average in over several purchases (DCA)',
 'b', 'Promediar reduce el riesgo de haber comprado justo en el peor momento posible — cuesta algo de rendimiento potencial si el precio solo sube, pero es más robusto ante la incertidumbre real de no saber el futuro.', 'Averaging in reduces the risk of buying at exactly the worst possible moment — it costs some potential return if the price only goes up, but it''s more robust to the real uncertainty of not knowing the future.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Una empresa con crecimiento explosivo pero sin utilidades', 'A company with explosive growth but no profits',
 'Una empresa madura, rentable, con crecimiento lento', 'A mature, profitable company with slow growth',
 'b', 'El crecimiento sin rentabilidad es una promesa, no un hecho — una empresa que ya demuestra que puede generar utilidades reales tiene menos supuestos que deben cumplirse para que la inversión funcione.', 'Growth without profitability is a promise, not a fact — a company that already proves it can generate real earnings has fewer assumptions that need to hold true for the investment to work out.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Revisar tu portafolio todos los días', 'Check your portfolio every day',
 'Revisarlo una vez al mes', 'Check it once a month',
 'b', 'Revisar el portafolio con demasiada frecuencia aumenta la tentación de reaccionar al ruido de corto plazo en vez de a cambios reales en el negocio — menos frecuencia suele producir mejores decisiones, no peores.', 'Checking your portfolio too often increases the temptation to react to short-term noise instead of real changes in the business — less frequent checking tends to produce better decisions, not worse.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Invertir en lo que está de moda ahora', 'Invest in what''s trendy right now',
 'Invertir en negocios aburridos pero predecibles', 'Invest in boring but predictable businesses',
 'b', 'Lo que está de moda ya suele estar reflejado en el precio — un negocio aburrido y predecible, comprado a un precio razonable, es más fácil de valorar con confianza que una historia de moda.', 'What''s trendy tends to already be priced in — a boring, predictable business bought at a reasonable price is easier to value with real confidence than a fashionable story.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Endeudarte para invertir más (apalancamiento)', 'Borrow money to invest more (leverage)',
 'Invertir solo lo que ya tienes ahorrado', 'Invest only what you''ve already saved',
 'b', 'El apalancamiento amplifica tanto las ganancias como las pérdidas — y una caída temporal puede forzarte a vender en el peor momento solo para cubrir la deuda, algo que nunca le pasa a quien invierte sin deuda.', 'Leverage amplifies both gains and losses — and a temporary drop can force you to sell at the worst possible time just to cover the debt, something that never happens to someone investing without debt.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Una acción barata (P/E bajo) de un negocio mediocre', 'A cheap stock (low P/E) in a mediocre business',
 'Una acción cara (P/E alto) de un negocio excelente', 'An expensive stock (high P/E) in an excellent business',
 'b', 'Un negocio excelente comprado a un precio justo suele generar mejores resultados a largo plazo que un negocio mediocre comprado barato — el negocio mediocre sigue siendo mediocre después de que subió de precio.', 'An excellent business bought at a fair price tends to outperform a mediocre business bought cheap over the long run — the mediocre business is still mediocre after its price goes up.'),

('¿Qué harías?', 'What would you do?',
 'Vender tus ganadoras para "asegurar la ganancia"', 'Sell your winners to "lock in the gain"',
 'Dejar correr a las ganadoras si la tesis sigue intacta', 'Let your winners run if the thesis still holds',
 'b', 'Vender una acción solo porque subió, sin que haya cambiado la tesis, corta justo las inversiones que más están funcionando — el precio subiendo no es en sí mismo una razón para vender.', 'Selling a stock just because it went up, with no change to the thesis, cuts off exactly the investments that are working best — the price rising isn''t itself a reason to sell.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Intentar predecir el próximo movimiento del mercado', 'Try to predict the market''s next move',
 'Mantenerte invertido consistentemente, pase lo que pase', 'Stay invested consistently, no matter what',
 'b', 'Predecir el momento exacto de entrada y salida del mercado es extremadamente difícil incluso para profesionales — el tiempo EN el mercado suele ganarle al intento de acertar el momento del mercado.', 'Timing the exact entry and exit of the market is extremely hard even for professionals — time IN the market tends to beat trying to time the market.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Una empresa que reparte todo en dividendos', 'A company that pays out everything in dividends',
 'Una empresa que reinvierte todo en crecer el negocio', 'A company that reinvests everything to grow the business',
 'b', 'Si la empresa tiene oportunidades reales de reinvertir a buenas tasas de retorno, reinvertir compone más valor que repartirlo — el dividendo solo es mejor cuando la empresa ya no tiene dónde reinvertir bien.', 'If the company has real opportunities to reinvest at good rates of return, reinvesting compounds more value than paying it out — the dividend is only better once the company runs out of good places to reinvest.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Copiar lo que compran los inversores famosos', 'Copy what famous investors are buying',
 'Entender tú mismo por qué una empresa es una buena inversión', 'Understand yourself why a company is a good investment',
 'b', 'Copiar una posición sin entender la tesis te deja sin saber cuándo vender ni cómo reaccionar si cae — la ventaja real de invertir viene de entender el negocio, no de imitar a alguien más.', 'Copying a position without understanding the thesis leaves you not knowing when to sell or how to react if it drops — the real edge in investing comes from understanding the business, not imitating someone else.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Un negocio con deuda alta pero crecimiento rápido', 'A business with high debt but fast growth',
 'Un negocio con caja neta positiva y crecimiento moderado', 'A business with net positive cash and moderate growth',
 'b', 'La deuda alta convierte cualquier tropiezo temporal del negocio en un problema existencial — un balance sólido le da a la empresa margen real para sobrevivir un mal año sin poner en riesgo a los accionistas.', 'High debt turns any temporary business stumble into an existential problem — a solid balance sheet gives the company real room to survive a bad year without putting shareholders at risk.'),

('¿Qué harías?', 'What would you do?',
 'Invertir todos tus ahorros de emergencia también', 'Invest your emergency savings too',
 'Mantener un fondo de emergencia fuera del mercado', 'Keep an emergency fund out of the market',
 'b', 'Necesitar liquidar inversiones en una emergencia, justo cuando el mercado puede estar bajo, es de las peores formas de perder dinero — un fondo de emergencia separado te protege de tener que vender en el peor momento.', 'Needing to liquidate investments during an emergency, right when the market might be down, is one of the worst ways to lose money — a separate emergency fund protects you from having to sell at the worst possible time.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Una empresa con un CEO carismático', 'A company with a charismatic CEO',
 'Una empresa con métricas financieras sólidas', 'A company with solid financial metrics',
 'b', 'El carisma no es lo mismo que buena asignación de capital — los números (ROIC, márgenes, flujo de caja real) son una evidencia mucho más confiable de que la administración está creando valor de verdad.', 'Charisma isn''t the same as good capital allocation — the numbers (ROIC, margins, real cash flow) are far more reliable evidence that management is actually creating value.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Vender cuando todos están comprando eufóricamente', 'Sell when everyone is buying euphorically',
 'Comprar cuando todos están vendiendo con miedo', 'Buy when everyone is selling in fear',
 'b', 'Los extremos de sentimiento del mercado suelen alejar más el precio del valor real del negocio, no acercarlo — actuar en contra del extremo (con análisis real detrás, no solo por llevar la contraria) suele ser más rentable.', 'Extreme market sentiment tends to push the price further from the business''s real value, not closer to it — acting against the extreme (backed by real analysis, not just contrarianism for its own sake) tends to be more profitable.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Una acción con mucha cobertura de analistas', 'A stock with heavy analyst coverage',
 'Una empresa pequeña que casi nadie sigue', 'A small company almost nobody follows',
 'b', 'Cuando muchos analistas ya cubren una acción, es más probable que el precio ya refleje toda la información pública disponible — hay más espacio para encontrar valor real en lugares donde pocos están mirando.', 'When lots of analysts already cover a stock, the price is more likely to already reflect all available public information — there''s more room to find real value in places few people are looking.'),

('¿Qué harías?', 'What would you do?',
 'Cambiar de estrategia después de un mal trimestre', 'Change strategy after one bad quarter',
 'Mantener el proceso si sigue siendo sólido, pase lo que pase en el corto plazo', 'Stick with the process if it''s still sound, regardless of short-term results',
 'b', 'Un buen proceso de decisión puede producir malos resultados en el corto plazo simplemente por azar — cambiar de estrategia cada vez que hay un mal trimestre suele destruir más valor que mantener la disciplina.', 'A good decision process can produce bad short-term results just by chance — changing strategy every time there''s a bad quarter tends to destroy more value than staying disciplined.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Una empresa que recompra sus propias acciones', 'A company that buys back its own shares',
 'Una empresa que emite más acciones para crecer', 'A company that issues more shares to grow',
 'a', 'Recomprar acciones cuando cotizan por debajo de su valor real es una forma eficiente de devolver capital a los accionistas — pero solo es una señal positiva si se hace a un precio razonable, no solo por hacerlo.', 'Buying back shares when they trade below real value is an efficient way to return capital to shareholders — but it''s only a real positive signal if done at a reasonable price, not just for its own sake.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Diversificar entre 50+ acciones', 'Diversify across 50+ stocks',
 'Concentrarte en 10-15 posiciones que realmente entiendes', 'Concentrate in 10-15 positions you truly understand',
 'b', 'Diversificar demasiado diluye tanto el riesgo como el rendimiento potencial de tus mejores ideas — un número manejable de posiciones bien entendidas suele dar mejor resultado que un portafolio imposible de seguir de cerca.', 'Over-diversifying dilutes both the risk AND the potential return of your best ideas — a manageable number of well-understood positions tends to outperform a portfolio too large to follow closely.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Reaccionar de inmediato a las noticias del día', 'React immediately to the day''s news',
 'Esperar y evaluar si la noticia realmente cambia el negocio', 'Wait and assess whether the news actually changes the business',
 'b', 'La mayoría de las noticias de un día no cambian el valor real de largo plazo de un negocio — reaccionar de inmediato suele significar decidir con información incompleta y emociones de corto plazo.', 'Most day-to-day news doesn''t change a business''s real long-term value — reacting immediately usually means deciding with incomplete information and short-term emotion.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Comparar tu portafolio con el de tus amigos', 'Compare your portfolio to your friends'' portfolios',
 'Medir tu progreso contra tus propias metas financieras', 'Measure your progress against your own financial goals',
 'b', 'Cada persona tiene un horizonte, tolerancia al riesgo y metas distintas — compararte con otros lleva a decisiones que no encajan con tu propia situación real.', 'Everyone has a different horizon, risk tolerance, and goals — comparing yourself to others leads to decisions that don''t fit your own real situation.'),

('¿Qué prefieres?', 'What would you prefer?',
 'Un negocio con un solo cliente gigante', 'A business with one giant customer',
 'Un negocio con miles de clientes pequeños', 'A business with thousands of small customers',
 'b', 'La concentración de clientes es un riesgo real y a menudo subestimado — perder a un solo cliente gigante puede dañar el negocio de forma mucho más severa que perder a cualquiera de miles de clientes pequeños.', 'Customer concentration is a real, often underrated risk — losing one giant customer can hurt the business far more severely than losing any one of thousands of small customers.');
