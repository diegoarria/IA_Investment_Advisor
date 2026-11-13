"""
Nuvos ETF — static sector/country name translations. A closed, known
dictionary (GICS sectors + the country names FMP's country-weightings
endpoint actually returns), never a model guessing a translation. Anything
outside this dictionary is shown in its original (English) form rather
than risking an invented translation — same "fallback honesto" discipline
as editorial_descriptions.py.
"""

SECTOR_ES: dict[str, str] = {
    "Technology": "Tecnología",
    "Healthcare": "Salud",
    "Financial Services": "Servicios financieros",
    "Energy": "Energía",
    "Consumer Cyclical": "Consumo cíclico",
    "Consumer Defensive": "Consumo defensivo",
    "Industrials": "Industriales",
    "Utilities": "Servicios públicos",
    "Real Estate": "Bienes raíces",
    "Basic Materials": "Materiales básicos",
    "Communication Services": "Servicios de comunicación",
    "Biotechnology": "Biotecnología",
}

COUNTRY_ES: dict[str, str] = {
    "United States": "Estados Unidos",
    "Japan": "Japón",
    "United Kingdom": "Reino Unido",
    "China": "China",
    "Switzerland": "Suiza",
    "Mexico": "México",
    "Ireland": "Irlanda",
    "France": "Francia",
    "Germany": "Alemania",
    "Canada": "Canadá",
    "Netherlands": "Países Bajos",
    "India": "India",
    "Brazil": "Brasil",
    "South Korea": "Corea del Sur",
    "Taiwan": "Taiwán",
    "Australia": "Australia",
    "Spain": "España",
    "Italy": "Italia",
    "Sweden": "Suecia",
    "Denmark": "Dinamarca",
    "Hong Kong": "Hong Kong",
    "Singapore": "Singapur",
    "South Africa": "Sudáfrica",
    "Israel": "Israel",
}


def translate_sector(name: str | None, lang: str = "es") -> str | None:
    if not name:
        return name
    if lang != "es":
        return name
    return SECTOR_ES.get(name, name)


def translate_country(name: str | None, lang: str = "es") -> str | None:
    if not name:
        return name
    if lang != "es":
        return name
    return COUNTRY_ES.get(name, name)
