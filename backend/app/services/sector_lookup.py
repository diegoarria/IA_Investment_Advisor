"""Real sector for ANY ticker, never "Otro" — Diego, 2026-08-29: "TODAS LAS
ACCIONES TIENEN SUS SECTORES, NINGUNA DEBE QUEDAR EN 'OTRO'".

Before this module, both frontends (web/mobile portfolio pages) fell back to
a hand-typed ~300-ticker literal map that only covered popular US large
caps — anything else (foreign ADRs, small caps, less common ETFs) silently
became "Otro". Two real, already-live data sources replace that guesswork:

1. `screener.py`'s UNIVERSE (928 S&P 500 constituents) — real GICS
   sector/industry per ticker, in-memory, zero network cost.
2. Finnhub's live company profile (`fh_profile`, works for virtually any
   listed ticker, not just the S&P 500) — for everything UNIVERSE doesn't
   cover.

`get_sector_es(ticker)` never returns "Otro" for a ticker that genuinely
has sector data available from either source — it only returns None when
neither source has anything (an invalid/delisted symbol), and even then the
caller decides the label, this module never invents one.
"""
import logging

from app.core.cache import cache_get, cache_set

logger = logging.getLogger(__name__)

# GICS sub-industry (English, as stored in screener.py's UNIVERSE) → Spanish
# label. Covers every distinct `industry` value in UNIVERSE (verified against
# the full 928-row list, 2026-08-29) plus "ETF" for the handful of ETF rows.
_GICS_INDUSTRY_ES: dict[str, str] = {
    "Advertising": "Publicidad",
    "Aerospace & Defense": "Aeroespacial y Defensa",
    "Agricultural & Farm Machinery": "Maquinaria Agrícola",
    "Agricultural Products & Services": "Productos y Servicios Agrícolas",
    "Air Freight & Logistics": "Carga Aérea y Logística",
    "Aluminum": "Aluminio",
    "Apparel Retail": "Retail de Ropa",
    "Apparel, Accessories & Luxury Goods": "Ropa, Accesorios y Lujo",
    "Application Software": "Software de Aplicaciones",
    "Asset Management & Custody Banks": "Gestión de Activos y Custodia",
    "Auto Manufacturers": "Fabricantes de Autos",
    "Automobile Manufacturers": "Fabricantes de Automóviles",
    "Automotive Parts & Equipment": "Autopartes y Equipo",
    "Automotive Retail": "Retail Automotriz",
    "Beverages - Non-Alcoholic": "Bebidas No Alcohólicas",
    "Biotechnology": "Biotecnología",
    "Brewers": "Cerveceras",
    "Broadcasting": "Radiodifusión",
    "Broadline Retail": "Retail Diversificado",
    "Building Products": "Productos para Construcción",
    "Cable & Satellite": "Cable y Satélite",
    "Capital Markets": "Mercados de Capitales",
    "Cargo Ground Transportation": "Transporte Terrestre de Carga",
    "Casinos & Gaming": "Casinos y Juegos",
    "Commercial & Residential Mortgage Finance": "Financiamiento Hipotecario",
    "Commodity Chemicals": "Químicos Básicos",
    "Communications Equipment": "Equipos de Comunicación",
    "Computer & Electronics Retail": "Retail de Computadoras y Electrónica",
    "Computer Hardware": "Hardware de Computadoras",
    "Construction & Engineering": "Construcción e Ingeniería",
    "Construction Machinery & Heavy Transportation Equipment": "Maquinaria de Construcción",
    "Construction Materials": "Materiales de Construcción",
    "Consumer Electronics": "Electrónica de Consumo",
    "Consumer Finance": "Finanzas al Consumidor",
    "Consumer Staples Merchandise Retail": "Retail de Consumo Básico",
    "Copper": "Cobre",
    "Credit Services": "Servicios de Crédito",
    "Data Center REITs": "REITs de Centros de Datos",
    "Data Processing & Outsourced Services": "Procesamiento de Datos",
    "Distillers & Vintners": "Destilerías y Vinícolas",
    "Distributors": "Distribuidores",
    "Diversified Banks": "Bancos Diversificados",
    "Diversified Chemicals": "Químicos Diversificados",
    "Diversified Financial Services": "Servicios Financieros Diversificados",
    "Diversified Metals & Mining": "Minería Diversificada",
    "Diversified Support Services": "Servicios de Apoyo Diversificados",
    "Drug Manufacturers - General": "Farmacéutica",
    "ETF": "ETF",
    "Education Services": "Servicios Educativos",
    "Electric Utilities": "Eléctricas",
    "Electrical Components & Equipment": "Componentes Eléctricos",
    "Electrical Equipment & Parts": "Equipo Eléctrico",
    "Electronic Components": "Componentes Electrónicos",
    "Electronic Equipment & Instruments": "Equipos Electrónicos",
    "Electronic Gaming & Multimedia": "Videojuegos y Multimedia",
    "Electronic Manufacturing Services": "Manufactura Electrónica",
    "Entertainment": "Entretenimiento",
    "Environmental & Facilities Services": "Servicios Ambientales",
    "Fertilizers & Agricultural Chemicals": "Fertilizantes y Agroquímicos",
    "Financial Exchanges & Data": "Bolsas y Datos Financieros",
    "Food Distributors": "Distribuidores de Alimentos",
    "Food Retail": "Retail de Alimentos",
    "Footwear": "Calzado",
    "Gas Utilities": "Gas",
    "Gold": "Oro",
    "Health Care Distributors": "Distribuidores de Salud",
    "Health Care Equipment": "Equipos Médicos",
    "Health Care Facilities": "Instalaciones de Salud",
    "Health Care REITs": "REITs de Salud",
    "Health Care Services": "Servicios de Salud",
    "Health Care Supplies": "Insumos Médicos",
    "Health Care Technology": "Tecnología en Salud",
    "Health Information Services": "Servicios de Información de Salud",
    "Heavy Electrical Equipment": "Equipo Eléctrico Pesado",
    "Home Improvement Retail": "Retail de Mejoras para el Hogar",
    "Homebuilding": "Construcción de Vivienda",
    "Homefurnishing Retail": "Retail de Muebles",
    "Hotel & Resort REITs": "REITs Hoteleros",
    "Hotels, Resorts & Cruise Lines": "Hoteles y Cruceros",
    "Household Appliances": "Electrodomésticos",
    "Household Products": "Productos del Hogar",
    "Human Resource & Employment Services": "Recursos Humanos",
    "IT Consulting & Other Services": "Consultoría IT",
    "Independent Power Producers & Energy Traders": "Generadoras de Energía Independientes",
    "Industrial Conglomerates": "Conglomerados Industriales",
    "Industrial Gases": "Gases Industriales",
    "Industrial Machinery & Supplies & Components": "Maquinaria Industrial",
    "Industrial REITs": "REITs Industriales",
    "Insurance Brokers": "Corredores de Seguros",
    "Integrated Oil & Gas": "Petróleo y Gas Integrado",
    "Integrated Telecommunication Services": "Telecomunicaciones",
    "Interactive Home Entertainment": "Videojuegos",
    "Interactive Media & Services": "Medios Interactivos",
    "Internet Content & Information": "Contenido de Internet",
    "Internet Retail": "Retail en Línea",
    "Internet Services & Infrastructure": "Infraestructura de Internet",
    "Investment Banking & Brokerage": "Banca de Inversión",
    "Leisure Products": "Productos de Ocio",
    "Life & Health Insurance": "Seguros de Vida y Salud",
    "Life Sciences Tools & Services": "Ciencias de la Vida",
    "Managed Health Care": "Salud Administrada",
    "Marine Transportation": "Transporte Marítimo",
    "Metal, Glass & Plastic Containers": "Envases",
    "Mortgage REITs": "REITs Hipotecarios",
    "Motorcycle Manufacturers": "Fabricantes de Motocicletas",
    "Movies & Entertainment": "Cine y Entretenimiento",
    "Multi-Family Residential REITs": "REITs Residenciales",
    "Multi-Sector Holdings": "Holdings Multisectoriales",
    "Multi-Utilities": "Multiservicios",
    "Multi-line Insurance": "Seguros Multilínea",
    "Office REITs": "REITs de Oficinas",
    "Office Services & Supplies": "Servicios de Oficina",
    "Oil & Gas Drilling": "Perforación de Petróleo y Gas",
    "Oil & Gas Equipment & Services": "Equipos de Petróleo y Gas",
    "Oil & Gas Exploration & Production": "Exploración de Petróleo y Gas",
    "Oil & Gas Refining & Marketing": "Refinación de Petróleo y Gas",
    "Oil & Gas Storage & Transportation": "Almacenamiento de Petróleo y Gas",
    "Other Specialized REITs": "REITs Especializados",
    "Other Specialty Retail": "Retail Especializado",
    "Packaged Foods & Meats": "Alimentos Empacados",
    "Paper & Plastic Packaging Products & Materials": "Empaques de Papel y Plástico",
    "Passenger Airlines": "Aerolíneas",
    "Passenger Ground Transportation": "Transporte Terrestre de Pasajeros",
    "Personal Care Products": "Cuidado Personal",
    "Pharmaceuticals": "Farmacéutica",
    "Property & Casualty Insurance": "Seguros Generales",
    "Publishing": "Editoriales",
    "Rail Transportation": "Transporte Ferroviario",
    "Real Estate Services": "Servicios Inmobiliarios",
    "Regional Banks": "Bancos Regionales",
    "Reinsurance": "Reaseguros",
    "Renewable Electricity": "Energía Renovable",
    "Research & Consulting Services": "Investigación y Consultoría",
    "Restaurants": "Restaurantes",
    "Retail REITs": "REITs Comerciales",
    "Security & Alarm Services": "Seguridad y Alarmas",
    "Self-Storage REITs": "REITs de Autoalmacenaje",
    "Semiconductor Materials & Equipment": "Equipos de Semiconductores",
    "Semiconductors": "Semiconductores",
    "Silver": "Plata",
    "Single-Family Residential REITs": "REITs Residenciales",
    "Soft Drinks & Non-alcoholic Beverages": "Bebidas No Alcohólicas",
    "Software - Application": "Software de Aplicaciones",
    "Software - Infrastructure": "Software de Infraestructura",
    "Solar": "Energía Solar",
    "Specialized Consumer Services": "Servicios al Consumidor",
    "Specialty Chemicals": "Químicos Especializados",
    "Specialty Stores": "Tiendas Especializadas",
    "Steel": "Acero",
    "Systems Software": "Software de Sistemas",
    "Technology Distributors": "Distribuidores de Tecnología",
    "Technology Hardware, Storage & Peripherals": "Hardware Tecnológico",
    "Telecom Tower REITs": "REITs de Torres de Telecom",
    "Timber REITs": "REITs Forestales",
    "Tobacco": "Tabaco",
    "Trading Companies & Distributors": "Comercializadoras y Distribuidoras",
    "Transaction & Payment Processing Services": "Procesamiento de Pagos",
    "Water Utilities": "Agua",
    "Wireless Telecommunication Services": "Telecomunicaciones Inalámbricas",
}

# Finnhub's `finnhubIndustry` uses its own (broader, non-GICS) taxonomy —
# separate translation table since the strings don't overlap with the GICS
# sub-industries above. Covers Finnhub's common values; anything not listed
# here still returns the real English string rather than "Otro" (see
# get_sector_es below) — an untranslated real label beats a fabricated one.
_FINNHUB_INDUSTRY_ES: dict[str, str] = {
    "Technology": "Tecnología",
    "Semiconductors": "Semiconductores",
    "Software": "Software",
    "Software - Application": "Software de Aplicaciones",
    "Software - Infrastructure": "Software de Infraestructura",
    "Communications": "Comunicaciones",
    "Telecommunication Services": "Telecomunicaciones",
    "Media": "Medios",
    "Internet": "Internet",
    "Retail": "Retail",
    "Consumer Goods": "Bienes de Consumo",
    "Consumer Cyclical": "Consumo Discrecional",
    "Consumer Defensive": "Consumo Básico",
    "Beverages": "Bebidas",
    "Food Products": "Alimentos",
    "Restaurants": "Restaurantes",
    "Apparel": "Ropa",
    "Health Care": "Salud",
    "Healthcare": "Salud",
    "Biotechnology": "Biotecnología",
    "Pharmaceuticals": "Farmacéutica",
    "Medical Devices": "Equipos Médicos",
    "Drug Manufacturers": "Farmacéutica",
    "Financial Services": "Servicios Financieros",
    "Banks": "Bancos",
    "Banks - Regional": "Bancos Regionales",
    "Banks - Diversified": "Bancos Diversificados",
    "Insurance": "Seguros",
    "Insurance - Life": "Seguros de Vida",
    "Insurance - Property & Casualty": "Seguros Generales",
    "Asset Management": "Gestión de Activos",
    "Capital Markets": "Mercados de Capitales",
    "Credit Services": "Servicios de Crédito",
    "Real Estate": "Bienes Raíces",
    "REIT": "REIT",
    "Energy": "Energía",
    "Oil & Gas": "Petróleo y Gas",
    "Oil & Gas E&P": "Exploración de Petróleo y Gas",
    "Renewable Energy": "Energía Renovable",
    "Utilities": "Servicios Públicos",
    "Utilities - Regulated Electric": "Eléctricas",
    "Basic Materials": "Materiales Básicos",
    "Chemicals": "Químicos",
    "Metals & Mining": "Minería",
    "Steel": "Acero",
    "Gold": "Oro",
    "Industrials": "Industriales",
    "Aerospace & Defense": "Aeroespacial y Defensa",
    "Airlines": "Aerolíneas",
    "Transportation": "Transporte",
    "Logistics": "Logística",
    "Machinery": "Maquinaria",
    "Construction": "Construcción",
    "Automobiles": "Automotriz",
    "Auto Manufacturers": "Fabricantes de Autos",
    "Auto Parts": "Autopartes",
    "Leisure": "Ocio",
    "Hotels & Entertainment Services": "Hoteles y Entretenimiento",
    "Gaming": "Juegos",
    "Publishing": "Editoriales",
    "Education": "Educación",
    "Business Services": "Servicios Empresariales",
    "Conglomerates": "Conglomerados",
}


def _universe_ticker_industry() -> dict[str, str]:
    """Ticker → GICS industry (English), built lazily from screener.py's
    UNIVERSE. Deferred import — screener.py imports from market.py at
    module level, so importing screener.py here at module load time would
    be circular; by the time this actually runs (a request), both modules
    are already fully loaded."""
    cache_key = "sector_lookup:universe_index"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    from app.api.routes.screener import UNIVERSE
    index = {row["ticker"]: row["industry"] for row in UNIVERSE if row.get("industry")}
    cache_set(cache_key, index, ttl=3600)
    return index


def get_sector_es(ticker: str) -> str | None:
    """Real sector label in Spanish for `ticker`, or None only when neither
    the S&P 500 GICS table nor a live Finnhub profile has any industry data
    for it (invalid/delisted symbol) — never a fabricated "Otro"."""
    ticker = ticker.upper()

    cache_key = f"sector_lookup:{ticker}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached or None

    industry_en = _universe_ticker_industry().get(ticker)
    if industry_en:
        label = _GICS_INDUSTRY_ES.get(industry_en, industry_en)
        cache_set(cache_key, label, ttl=86400)
        return label

    try:
        from app.core.finnhub import fh_profile
        profile = fh_profile(ticker)
    except Exception as exc:
        logger.warning("get_sector_es(%s): fh_profile failed: %s", ticker, exc)
        profile = None

    industry_en = (profile or {}).get("finnhubIndustry")
    if industry_en:
        label = _FINNHUB_INDUSTRY_ES.get(industry_en, industry_en)
        cache_set(cache_key, label, ttl=86400)
        return label

    # ETFs have no company profile (profile2 returns null — they aren't a
    # company), so they always fall through to here. fh_search's `type`
    # field ("ETP") is how Finnhub itself flags a ticker as an ETF/ETP —
    # confirmed live (SOXX/ARKK/SPY all return null from fh_profile but
    # "ETP" from fh_search). This is a real classification, not a guess.
    try:
        from app.core.finnhub import fh_search
        matches = fh_search(ticker)
        if any(m.get("symbol") == ticker and m.get("type") in ("ETP", "ETF") for m in matches):
            cache_set(cache_key, "ETF", ttl=86400)
            return "ETF"
    except Exception as exc:
        logger.warning("get_sector_es(%s): fh_search fallback failed: %s", ticker, exc)

    # Genuinely unknown — cache briefly (not 24h) so a transient Finnhub
    # hiccup for a real ticker gets retried soon instead of being stuck
    # unclassified for a full day.
    cache_set(cache_key, "", ttl=600)
    return None
