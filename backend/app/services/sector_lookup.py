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


# ── 11-sector rollup (Diego, 2026-08-30) ────────────────────────────────────
# For the portfolio diversification breakdown specifically — exactly these
# 11 real GICS top-level sectors (Spanish) + "ETFs", never any finer
# category and never "Otro". get_sector_es above (the granular sub-industry
# label) stays as-is for the risk-score heuristic and stress-test drawdown
# mapping, which want that finer granularity — this is a second, coarser
# view of the exact same real classification, not a replacement.
SECTOR_TECHNOLOGY = "Tecnología"
SECTOR_FINANCIALS = "Finanzas"
SECTOR_CONSUMER_DISCRETIONARY = "Consumo Discrecional"
SECTOR_CONSUMER_STAPLES = "Consumo Básico"
SECTOR_INDUSTRIALS = "Industriales"
SECTOR_MATERIALS = "Materiales"
SECTOR_REITS = "REITs"
SECTOR_COMMUNICATION_SERVICES = "Comunicación de Servicios"
SECTOR_HEALTH = "Salud"
SECTOR_ENERGY = "Energía"
SECTOR_UTILITIES = "Utilidades"
SECTOR_ETFS = "ETFs"

SECTOR_GROUPS_ES: list[str] = [
    SECTOR_TECHNOLOGY, SECTOR_FINANCIALS, SECTOR_CONSUMER_DISCRETIONARY,
    SECTOR_CONSUMER_STAPLES, SECTOR_INDUSTRIALS, SECTOR_MATERIALS, SECTOR_REITS,
    SECTOR_COMMUNICATION_SERVICES, SECTOR_HEALTH, SECTOR_ENERGY, SECTOR_UTILITIES,
]

# Every English GICS sub-industry key from _GICS_INDUSTRY_ES above, rolled
# up to its real GICS top-level sector — standard GICS sector membership,
# not a guess (e.g. all REIT sub-industries → Real Estate → SECTOR_REITS;
# semiconductors/software/hardware → Information Technology →
# SECTOR_TECHNOLOGY). "ETF" is handled separately via is_etf, not here.
_GICS_INDUSTRY_GROUP: dict[str, str] = {
    "Advertising": SECTOR_COMMUNICATION_SERVICES,
    "Aerospace & Defense": SECTOR_INDUSTRIALS,
    "Agricultural & Farm Machinery": SECTOR_INDUSTRIALS,
    "Agricultural Products & Services": SECTOR_CONSUMER_STAPLES,
    "Air Freight & Logistics": SECTOR_INDUSTRIALS,
    "Aluminum": SECTOR_MATERIALS,
    "Apparel Retail": SECTOR_CONSUMER_DISCRETIONARY,
    "Apparel, Accessories & Luxury Goods": SECTOR_CONSUMER_DISCRETIONARY,
    "Application Software": SECTOR_TECHNOLOGY,
    "Asset Management & Custody Banks": SECTOR_FINANCIALS,
    "Auto Manufacturers": SECTOR_CONSUMER_DISCRETIONARY,
    "Automobile Manufacturers": SECTOR_CONSUMER_DISCRETIONARY,
    "Automotive Parts & Equipment": SECTOR_CONSUMER_DISCRETIONARY,
    "Automotive Retail": SECTOR_CONSUMER_DISCRETIONARY,
    "Beverages - Non-Alcoholic": SECTOR_CONSUMER_STAPLES,
    "Biotechnology": SECTOR_HEALTH,
    "Brewers": SECTOR_CONSUMER_STAPLES,
    "Broadcasting": SECTOR_COMMUNICATION_SERVICES,
    "Broadline Retail": SECTOR_CONSUMER_DISCRETIONARY,
    "Building Products": SECTOR_INDUSTRIALS,
    "Cable & Satellite": SECTOR_COMMUNICATION_SERVICES,
    "Capital Markets": SECTOR_FINANCIALS,
    "Cargo Ground Transportation": SECTOR_INDUSTRIALS,
    "Casinos & Gaming": SECTOR_CONSUMER_DISCRETIONARY,
    "Commercial & Residential Mortgage Finance": SECTOR_FINANCIALS,
    "Commodity Chemicals": SECTOR_MATERIALS,
    "Communications Equipment": SECTOR_TECHNOLOGY,
    "Computer & Electronics Retail": SECTOR_CONSUMER_DISCRETIONARY,
    "Computer Hardware": SECTOR_TECHNOLOGY,
    "Construction & Engineering": SECTOR_INDUSTRIALS,
    "Construction Machinery & Heavy Transportation Equipment": SECTOR_INDUSTRIALS,
    "Construction Materials": SECTOR_MATERIALS,
    "Consumer Electronics": SECTOR_CONSUMER_DISCRETIONARY,
    "Consumer Finance": SECTOR_FINANCIALS,
    "Consumer Staples Merchandise Retail": SECTOR_CONSUMER_STAPLES,
    "Copper": SECTOR_MATERIALS,
    "Credit Services": SECTOR_FINANCIALS,
    "Data Center REITs": SECTOR_REITS,
    "Data Processing & Outsourced Services": SECTOR_TECHNOLOGY,
    "Distillers & Vintners": SECTOR_CONSUMER_STAPLES,
    "Distributors": SECTOR_CONSUMER_DISCRETIONARY,
    "Diversified Banks": SECTOR_FINANCIALS,
    "Diversified Chemicals": SECTOR_MATERIALS,
    "Diversified Financial Services": SECTOR_FINANCIALS,
    "Diversified Metals & Mining": SECTOR_MATERIALS,
    "Diversified Support Services": SECTOR_INDUSTRIALS,
    "Drug Manufacturers - General": SECTOR_HEALTH,
    "Education Services": SECTOR_CONSUMER_DISCRETIONARY,
    "Electric Utilities": SECTOR_UTILITIES,
    "Electrical Components & Equipment": SECTOR_INDUSTRIALS,
    "Electrical Equipment & Parts": SECTOR_INDUSTRIALS,
    "Electronic Components": SECTOR_TECHNOLOGY,
    "Electronic Equipment & Instruments": SECTOR_TECHNOLOGY,
    "Electronic Gaming & Multimedia": SECTOR_COMMUNICATION_SERVICES,
    "Electronic Manufacturing Services": SECTOR_TECHNOLOGY,
    "Entertainment": SECTOR_COMMUNICATION_SERVICES,
    "Environmental & Facilities Services": SECTOR_INDUSTRIALS,
    "Fertilizers & Agricultural Chemicals": SECTOR_MATERIALS,
    "Financial Exchanges & Data": SECTOR_FINANCIALS,
    "Food Distributors": SECTOR_CONSUMER_STAPLES,
    "Food Retail": SECTOR_CONSUMER_STAPLES,
    "Footwear": SECTOR_CONSUMER_DISCRETIONARY,
    "Gas Utilities": SECTOR_UTILITIES,
    "Gold": SECTOR_MATERIALS,
    "Health Care Distributors": SECTOR_HEALTH,
    "Health Care Equipment": SECTOR_HEALTH,
    "Health Care Facilities": SECTOR_HEALTH,
    "Health Care REITs": SECTOR_REITS,
    "Health Care Services": SECTOR_HEALTH,
    "Health Care Supplies": SECTOR_HEALTH,
    "Health Care Technology": SECTOR_HEALTH,
    "Health Information Services": SECTOR_HEALTH,
    "Heavy Electrical Equipment": SECTOR_INDUSTRIALS,
    "Home Improvement Retail": SECTOR_CONSUMER_DISCRETIONARY,
    "Homebuilding": SECTOR_CONSUMER_DISCRETIONARY,
    "Homefurnishing Retail": SECTOR_CONSUMER_DISCRETIONARY,
    "Hotel & Resort REITs": SECTOR_REITS,
    "Hotels, Resorts & Cruise Lines": SECTOR_CONSUMER_DISCRETIONARY,
    "Household Appliances": SECTOR_CONSUMER_DISCRETIONARY,
    "Household Products": SECTOR_CONSUMER_STAPLES,
    "Human Resource & Employment Services": SECTOR_INDUSTRIALS,
    "IT Consulting & Other Services": SECTOR_TECHNOLOGY,
    "Independent Power Producers & Energy Traders": SECTOR_UTILITIES,
    "Industrial Conglomerates": SECTOR_INDUSTRIALS,
    "Industrial Gases": SECTOR_MATERIALS,
    "Industrial Machinery & Supplies & Components": SECTOR_INDUSTRIALS,
    "Industrial REITs": SECTOR_REITS,
    "Insurance Brokers": SECTOR_FINANCIALS,
    "Integrated Oil & Gas": SECTOR_ENERGY,
    "Integrated Telecommunication Services": SECTOR_COMMUNICATION_SERVICES,
    "Interactive Home Entertainment": SECTOR_COMMUNICATION_SERVICES,
    "Interactive Media & Services": SECTOR_COMMUNICATION_SERVICES,
    "Internet Content & Information": SECTOR_COMMUNICATION_SERVICES,
    "Internet Retail": SECTOR_CONSUMER_DISCRETIONARY,
    "Internet Services & Infrastructure": SECTOR_TECHNOLOGY,
    "Investment Banking & Brokerage": SECTOR_FINANCIALS,
    "Leisure Products": SECTOR_CONSUMER_DISCRETIONARY,
    "Life & Health Insurance": SECTOR_FINANCIALS,
    "Life Sciences Tools & Services": SECTOR_HEALTH,
    "Managed Health Care": SECTOR_HEALTH,
    "Marine Transportation": SECTOR_INDUSTRIALS,
    "Metal, Glass & Plastic Containers": SECTOR_MATERIALS,
    "Mortgage REITs": SECTOR_REITS,
    "Motorcycle Manufacturers": SECTOR_CONSUMER_DISCRETIONARY,
    "Movies & Entertainment": SECTOR_COMMUNICATION_SERVICES,
    "Multi-Family Residential REITs": SECTOR_REITS,
    "Multi-Sector Holdings": SECTOR_FINANCIALS,
    "Multi-Utilities": SECTOR_UTILITIES,
    "Multi-line Insurance": SECTOR_FINANCIALS,
    "Office REITs": SECTOR_REITS,
    "Office Services & Supplies": SECTOR_INDUSTRIALS,
    "Oil & Gas Drilling": SECTOR_ENERGY,
    "Oil & Gas Equipment & Services": SECTOR_ENERGY,
    "Oil & Gas Exploration & Production": SECTOR_ENERGY,
    "Oil & Gas Refining & Marketing": SECTOR_ENERGY,
    "Oil & Gas Storage & Transportation": SECTOR_ENERGY,
    "Other Specialized REITs": SECTOR_REITS,
    "Other Specialty Retail": SECTOR_CONSUMER_DISCRETIONARY,
    "Packaged Foods & Meats": SECTOR_CONSUMER_STAPLES,
    "Paper & Plastic Packaging Products & Materials": SECTOR_MATERIALS,
    "Passenger Airlines": SECTOR_INDUSTRIALS,
    "Passenger Ground Transportation": SECTOR_INDUSTRIALS,
    "Personal Care Products": SECTOR_CONSUMER_STAPLES,
    "Pharmaceuticals": SECTOR_HEALTH,
    "Property & Casualty Insurance": SECTOR_FINANCIALS,
    "Publishing": SECTOR_COMMUNICATION_SERVICES,
    "Rail Transportation": SECTOR_INDUSTRIALS,
    "Real Estate Services": SECTOR_REITS,
    "Regional Banks": SECTOR_FINANCIALS,
    "Reinsurance": SECTOR_FINANCIALS,
    "Renewable Electricity": SECTOR_UTILITIES,
    "Research & Consulting Services": SECTOR_INDUSTRIALS,
    "Restaurants": SECTOR_CONSUMER_DISCRETIONARY,
    "Retail REITs": SECTOR_REITS,
    "Security & Alarm Services": SECTOR_INDUSTRIALS,
    "Self-Storage REITs": SECTOR_REITS,
    "Semiconductor Materials & Equipment": SECTOR_TECHNOLOGY,
    "Semiconductors": SECTOR_TECHNOLOGY,
    "Silver": SECTOR_MATERIALS,
    "Single-Family Residential REITs": SECTOR_REITS,
    "Soft Drinks & Non-alcoholic Beverages": SECTOR_CONSUMER_STAPLES,
    "Software - Application": SECTOR_TECHNOLOGY,
    "Software - Infrastructure": SECTOR_TECHNOLOGY,
    "Solar": SECTOR_UTILITIES,
    "Specialized Consumer Services": SECTOR_CONSUMER_DISCRETIONARY,
    "Specialty Chemicals": SECTOR_MATERIALS,
    "Specialty Stores": SECTOR_CONSUMER_DISCRETIONARY,
    "Steel": SECTOR_MATERIALS,
    "Systems Software": SECTOR_TECHNOLOGY,
    "Technology Distributors": SECTOR_TECHNOLOGY,
    "Technology Hardware, Storage & Peripherals": SECTOR_TECHNOLOGY,
    "Telecom Tower REITs": SECTOR_REITS,
    "Timber REITs": SECTOR_REITS,
    "Tobacco": SECTOR_CONSUMER_STAPLES,
    "Trading Companies & Distributors": SECTOR_INDUSTRIALS,
    "Transaction & Payment Processing Services": SECTOR_FINANCIALS,
    "Water Utilities": SECTOR_UTILITIES,
    "Wireless Telecommunication Services": SECTOR_COMMUNICATION_SERVICES,
}

# Every English Finnhub `finnhubIndustry` key from _FINNHUB_INDUSTRY_ES
# above, rolled up the same way.
_FINNHUB_INDUSTRY_GROUP: dict[str, str] = {
    "Technology": SECTOR_TECHNOLOGY,
    "Semiconductors": SECTOR_TECHNOLOGY,
    "Software": SECTOR_TECHNOLOGY,
    "Software - Application": SECTOR_TECHNOLOGY,
    "Software - Infrastructure": SECTOR_TECHNOLOGY,
    "Communications": SECTOR_COMMUNICATION_SERVICES,
    "Telecommunication Services": SECTOR_COMMUNICATION_SERVICES,
    "Media": SECTOR_COMMUNICATION_SERVICES,
    "Internet": SECTOR_COMMUNICATION_SERVICES,
    "Retail": SECTOR_CONSUMER_DISCRETIONARY,
    "Consumer Goods": SECTOR_CONSUMER_DISCRETIONARY,
    "Consumer Cyclical": SECTOR_CONSUMER_DISCRETIONARY,
    "Consumer Defensive": SECTOR_CONSUMER_STAPLES,
    "Beverages": SECTOR_CONSUMER_STAPLES,
    "Food Products": SECTOR_CONSUMER_STAPLES,
    "Restaurants": SECTOR_CONSUMER_DISCRETIONARY,
    "Apparel": SECTOR_CONSUMER_DISCRETIONARY,
    "Health Care": SECTOR_HEALTH,
    "Healthcare": SECTOR_HEALTH,
    "Biotechnology": SECTOR_HEALTH,
    "Pharmaceuticals": SECTOR_HEALTH,
    "Medical Devices": SECTOR_HEALTH,
    "Drug Manufacturers": SECTOR_HEALTH,
    "Financial Services": SECTOR_FINANCIALS,
    "Banks": SECTOR_FINANCIALS,
    "Banks - Regional": SECTOR_FINANCIALS,
    "Banks - Diversified": SECTOR_FINANCIALS,
    "Insurance": SECTOR_FINANCIALS,
    "Insurance - Life": SECTOR_FINANCIALS,
    "Insurance - Property & Casualty": SECTOR_FINANCIALS,
    "Asset Management": SECTOR_FINANCIALS,
    "Capital Markets": SECTOR_FINANCIALS,
    "Credit Services": SECTOR_FINANCIALS,
    "Real Estate": SECTOR_REITS,
    "REIT": SECTOR_REITS,
    "Energy": SECTOR_ENERGY,
    "Oil & Gas": SECTOR_ENERGY,
    "Oil & Gas E&P": SECTOR_ENERGY,
    "Renewable Energy": SECTOR_UTILITIES,
    "Utilities": SECTOR_UTILITIES,
    "Utilities - Regulated Electric": SECTOR_UTILITIES,
    "Basic Materials": SECTOR_MATERIALS,
    "Chemicals": SECTOR_MATERIALS,
    "Metals & Mining": SECTOR_MATERIALS,
    "Steel": SECTOR_MATERIALS,
    "Gold": SECTOR_MATERIALS,
    "Industrials": SECTOR_INDUSTRIALS,
    "Aerospace & Defense": SECTOR_INDUSTRIALS,
    "Airlines": SECTOR_INDUSTRIALS,
    "Transportation": SECTOR_INDUSTRIALS,
    "Logistics": SECTOR_INDUSTRIALS,
    "Machinery": SECTOR_INDUSTRIALS,
    "Construction": SECTOR_INDUSTRIALS,
    "Automobiles": SECTOR_CONSUMER_DISCRETIONARY,
    "Auto Manufacturers": SECTOR_CONSUMER_DISCRETIONARY,
    "Auto Parts": SECTOR_CONSUMER_DISCRETIONARY,
    "Leisure": SECTOR_CONSUMER_DISCRETIONARY,
    "Hotels & Entertainment Services": SECTOR_CONSUMER_DISCRETIONARY,
    "Gaming": SECTOR_CONSUMER_DISCRETIONARY,
    "Publishing": SECTOR_COMMUNICATION_SERVICES,
    "Education": SECTOR_CONSUMER_DISCRETIONARY,
    "Business Services": SECTOR_INDUSTRIALS,
    "Conglomerates": SECTOR_INDUSTRIALS,
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


def _resolve_industry_en(ticker: str) -> tuple[str | None, str | None, bool]:
    """Returns (source, industry_en, is_etf) — source is "universe" or
    "finnhub" when industry_en is set, else None. Shared by get_sector_es
    and get_sector_group_es so both agree on the exact same underlying
    classification (and never issue two separate Finnhub calls for the
    same ticker) — they only differ in how coarsely they translate it."""
    ticker = ticker.upper()

    cache_key = f"sector_lookup:industry_en:{ticker}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached.get("source"), cached.get("industry_en"), cached.get("is_etf", False)

    source = None
    industry_en = _universe_ticker_industry().get(ticker)
    if industry_en:
        source = "universe"
    else:
        try:
            from app.core.finnhub import fh_profile
            profile = fh_profile(ticker)
        except Exception as exc:
            logger.warning("_resolve_industry_en(%s): fh_profile failed: %s", ticker, exc)
            profile = None
        industry_en = (profile or {}).get("finnhubIndustry")
        if industry_en:
            source = "finnhub"

    is_etf = False
    if not industry_en:
        # ETFs have no company profile (profile2 returns null — they aren't
        # a company), so they always fall through to here. fh_search's
        # `type` field ("ETP") is how Finnhub itself flags a ticker as an
        # ETF/ETP — confirmed live (SOXX/ARKK/SPY all return null from
        # fh_profile but "ETP" from fh_search). This is a real
        # classification, not a guess.
        try:
            from app.core.finnhub import fh_search
            matches = fh_search(ticker)
            is_etf = any(m.get("symbol") == ticker and m.get("type") in ("ETP", "ETF") for m in matches)
        except Exception as exc:
            logger.warning("_resolve_industry_en(%s): fh_search fallback failed: %s", ticker, exc)

    # Genuinely unknown — cache briefly (not 24h) so a transient Finnhub
    # hiccup for a real ticker gets retried soon instead of being stuck
    # unclassified for a full day.
    ttl = 86400 if (industry_en or is_etf) else 600
    cache_set(cache_key, {"source": source, "industry_en": industry_en, "is_etf": is_etf}, ttl=ttl)
    return source, industry_en, is_etf


def get_sector_es(ticker: str) -> str | None:
    """Real, granular sub-industry sector label in Spanish for `ticker`
    (e.g. "Semiconductores", "REITs de Salud") — or None only when neither
    the S&P 500 GICS table nor a live Finnhub profile has any industry data
    for it (invalid/delisted symbol) — never a fabricated "Otro". Used by
    the risk-score heuristic and the stress-test drawdown mapping, which
    want this finer granularity. For the portfolio diversification
    breakdown (exactly the 11 GICS sectors + ETFs, no finer categories),
    see get_sector_group_es below — same real underlying classification,
    just rolled up coarser."""
    source, industry_en, is_etf = _resolve_industry_en(ticker)
    if source == "universe":
        return _GICS_INDUSTRY_ES.get(industry_en, industry_en)
    if source == "finnhub":
        return _FINNHUB_INDUSTRY_ES.get(industry_en, industry_en)
    if is_etf:
        return "ETF"
    return None


def get_sector_group_es(ticker: str) -> str | None:
    """Real sector for `ticker`, rolled up to exactly the 11 GICS
    top-level sectors (Spanish) + "ETFs" — the taxonomy Diego specified
    2026-08-30 for the portfolio diversification breakdown (see
    SECTOR_GROUPS_ES above): Tecnología, Finanzas, Consumo Discrecional,
    Consumo Básico, Industriales, Materiales, REITs, Comunicación de
    Servicios, Salud, Energía, Utilidades, ETFs. Never "Otro" — same
    real-data-or-nothing guarantee as get_sector_es, just coarser."""
    source, industry_en, is_etf = _resolve_industry_en(ticker)
    if is_etf:
        return SECTOR_ETFS
    if source == "universe":
        return _GICS_INDUSTRY_GROUP.get(industry_en)
    if source == "finnhub":
        return _FINNHUB_INDUSTRY_GROUP.get(industry_en)
    return None
