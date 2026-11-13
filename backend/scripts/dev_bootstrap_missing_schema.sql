-- Nuvos dev-environment bootstrap — recovered read-only (schema-only, no rows,
-- no secrets) from production via pg_dump, 2026-11. These objects predate the
-- backend/migrations/ convention and were never captured as .sql files anywhere
-- in the repo. NEVER run this against production — it's only to let an
-- isolated/local Postgres apply the 122 migrations, which assume these already exist.

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$function$


;


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: chat_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."chat_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" character varying(10) NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "session_id" character varying(80),
    CONSTRAINT "chat_history_role_check" CHECK ((("role")::"text" = ANY ((ARRAY['user'::character varying, 'assistant'::character varying])::"text"[])))
);


ALTER TABLE "public"."chat_history" OWNER TO "postgres";

--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "birth_date" "text" DEFAULT ''::"text" NOT NULL,
    "monthly_income" "text" DEFAULT '0'::"text" NOT NULL,
    "monthly_contribution" "text" DEFAULT '0'::"text" NOT NULL,
    "risk_tolerance" "text" DEFAULT 'moderate'::"text" NOT NULL,
    "quiz_answers" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "mentor" "text",
    "subscription_tier" "text" DEFAULT 'free'::"text" NOT NULL,
    "stripe_customer_id" "text",
    "msg_count" integer DEFAULT 0 NOT NULL,
    "msg_window_start" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "trial_started_at" timestamp with time zone,
    "maturity_score" integer DEFAULT 0 NOT NULL,
    "maturity_history" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "push_token" "text",
    "avatar_url" "text",
    "paper_alias" "text",
    "referral_code" "text",
    "referred_by" "text",
    "referred_count" integer DEFAULT 0,
    "nav_order" "jsonb",
    "is_admin" boolean DEFAULT false NOT NULL,
    "theme" "text" DEFAULT 'dark'::"text" NOT NULL,
    "watchlist_order" "jsonb",
    "investment_goal" "text",
    "investment_goal_amount" "text",
    "investment_horizon" "text",
    "knowledge_level" "text",
    "behavioral_risk_score" integer,
    "streak_count" integer DEFAULT 0,
    "last_learn_date" "text",
    "terms_accepted_at" "text",
    "terms_version" "text",
    "subscription_started_at" timestamp with time zone,
    "broker_offer_seen_at" timestamp with time zone,
    "duo_secondary_email" "text",
    "duo_plan_purchased_at" timestamp with time zone,
    "feedback_last_shown_at" timestamp with time zone,
    "claimed_streak_milestones" integer[] DEFAULT '{}'::integer[],
    "streak_bonus_premium_until" timestamp with time zone,
    "completed_topic_ids" "text"[] DEFAULT '{}'::"text"[],
    "portfolio_view_mode" character varying(20) DEFAULT 'advanced'::character varying,
    "checklist_done" boolean DEFAULT false,
    "watchlist_view_mode" character varying(20) DEFAULT 'advanced'::character varying,
    "country" "text",
    "initial_capital" "text",
    "has_broker" boolean DEFAULT false,
    "broker_name" "text",
    "has_investments" boolean DEFAULT false,
    "duo_primary_user_id" "uuid",
    "duo_secondary_user_id" "uuid",
    "net_worth_usd" numeric,
    "monthly_expenses_usd" numeric,
    "currency" "text" DEFAULT 'USD'::"text",
    "preferred_language" "text" DEFAULT 'es'::"text",
    "investing_style" "text" DEFAULT 'not_set'::"text",
    "time_horizon_years" integer,
    "financial_freedom_target_usd" numeric,
    "phone_number" "text",
    "claimed_panic_streak_milestones" "jsonb" DEFAULT '[]'::"jsonb",
    "vi_search_count" integer DEFAULT 0 NOT NULL,
    "vi_search_window_start" timestamp with time zone,
    "ai_insight_count" integer DEFAULT 0 NOT NULL,
    "ai_insight_month" "text",
    "referral_reward_tier" integer DEFAULT 0 NOT NULL,
    "free_1on1_sessions" integer DEFAULT 0 NOT NULL,
    "market_perception" "text"[],
    "market_perception_other" "text",
    "detail_level" character varying(20) DEFAULT 'intermedio'::character varying,
    "required_return_pct" numeric,
    "min_margin_of_safety_pct" numeric,
    "preferred_discount_rate_method" character varying(20) DEFAULT 'wacc'::character varying,
    "favorite_metrics" "jsonb" DEFAULT '[]'::"jsonb",
    "dashboard_section_order" "jsonb",
    "longest_streak_count" integer DEFAULT 0 NOT NULL,
    "subscription_source" "text",
    "premium_granted_at" timestamp with time zone,
    "paid_1on1_sessions" integer DEFAULT 0 NOT NULL,
    "max_real_patrimonio_usd" numeric,
    "duo_invite_status" "text",
    "has_seen_welcome_card" boolean DEFAULT false NOT NULL,
    "premium_until" timestamp with time zone,
    "has_debt" boolean,
    "debt_amount_usd" numeric(14,2),
    "has_seen_phone_prompt" boolean DEFAULT false NOT NULL,
    "feature_flags" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "user_profiles_duo_invite_status_check" CHECK ((("duo_invite_status" IS NULL) OR ("duo_invite_status" = ANY (ARRAY['pending'::"text", 'accepted'::"text"])))),
    CONSTRAINT "user_profiles_investing_style_check" CHECK (("investing_style" = ANY (ARRAY['value'::"text", 'growth'::"text", 'dividend'::"text", 'index'::"text", 'momentum'::"text", 'not_set'::"text"])))
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";

--
-- Name: chat_history chat_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_history"
    ADD CONSTRAINT "chat_history_pkey" PRIMARY KEY ("id");


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");


--
-- Name: user_profiles user_profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_user_id_key" UNIQUE ("user_id");


--
-- Name: idx_chat_history_user_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_chat_history_user_created" ON "public"."chat_history" USING "btree" ("user_id", "created_at" DESC);


--
-- Name: idx_chat_history_user_role_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_chat_history_user_role_created" ON "public"."chat_history" USING "btree" ("user_id", "role", "created_at" DESC);


--
-- Name: idx_chat_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_chat_session" ON "public"."chat_history" USING "btree" ("user_id", "session_id", "created_at");


--
-- Name: idx_chat_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_chat_user" ON "public"."chat_history" USING "btree" ("user_id", "created_at" DESC);


--
-- Name: idx_profiles_paper_alias; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_profiles_paper_alias" ON "public"."user_profiles" USING "btree" ("paper_alias") WHERE ("paper_alias" IS NOT NULL);


--
-- Name: idx_profiles_referral_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_profiles_referral_code" ON "public"."user_profiles" USING "btree" ("referral_code") WHERE ("referral_code" IS NOT NULL);


--
-- Name: idx_user_profiles_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_user_profiles_user_id" ON "public"."user_profiles" USING "btree" ("user_id");


--
-- Name: user_profiles trg_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: chat_history chat_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_history"
    ADD CONSTRAINT "chat_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_duo_primary_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_duo_primary_user_id_fkey" FOREIGN KEY ("duo_primary_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: user_profiles user_profiles_duo_secondary_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_duo_secondary_user_id_fkey" FOREIGN KEY ("duo_secondary_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: user_profiles user_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: chat_history Service: chat; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service: chat" ON "public"."chat_history" TO "service_role" USING (true);


--
-- Name: user_profiles Service: profiles; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service: profiles" ON "public"."user_profiles" TO "service_role" USING (true);


--
-- Name: chat_history Users own chat; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users own chat" ON "public"."chat_history" USING (("auth"."uid"() = "user_id"));


--
-- Name: user_profiles Users own profile; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users own profile" ON "public"."user_profiles" USING (("auth"."uid"() = "user_id"));


--
-- Name: chat_history; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."chat_history" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE "chat_history"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."chat_history" TO "anon";
GRANT ALL ON TABLE "public"."chat_history" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_history" TO "service_role";


--
-- Name: TABLE "user_profiles"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";


--
-- PostgreSQL database dump complete
--


