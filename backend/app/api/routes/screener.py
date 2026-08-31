import asyncio
import logging
import random
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from app.api.deps import get_current_user_id
from app.services import ai_service
from app.services import nif_service
from app.api.routes.market import _get_user_profile
from app.core.cache import cache_get, cache_set
from app.core.database import get_supabase, run_query
from app.core.finnhub import fh_quote, fh_metrics, fh_search
from app.core.limiter import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/market/screener", tags=["screener"])

# Real S&P 500 constituents (Wikipedia "List of S&P 500 companies", pulled fresh
# 2026-08-07 — 503 rows: the index tracks 500 companies but some (Alphabet,
# Fox Corp, ...) list two share classes, both real constituents). GICS Sector
# mapped onto the sector labels this file already used (Information Technology
# -> Technology, Health Care -> Healthcare) so _is_financial_sector/is_reit_sector
# in fundamental_analysis_service.py (which key off the LIVE Finnhub profile
# sector, not this field) are unaffected either way. Regenerate periodically —
# constituents change a few times a year.
UNIVERSE = [
    # ──── Communication Services ────
    {"ticker": "APP", "name": "AppLovin", "sector": "Communication Services", "industry": "Advertising"},
    {"ticker": "OMC", "name": "Omnicom Group", "sector": "Communication Services", "industry": "Advertising"},
    {"ticker": "TTD", "name": "Trade Desk (The)", "sector": "Communication Services", "industry": "Advertising"},
    {"ticker": "FOX", "name": "Fox Corporation (Class B)", "sector": "Communication Services", "industry": "Broadcasting"},
    {"ticker": "FOXA", "name": "Fox Corporation (Class A)", "sector": "Communication Services", "industry": "Broadcasting"},
    {"ticker": "WBD", "name": "Warner Bros. Discovery", "sector": "Communication Services", "industry": "Broadcasting"},
    {"ticker": "CHTR", "name": "Charter Communications", "sector": "Communication Services", "industry": "Cable & Satellite"},
    {"ticker": "CMCSA", "name": "Comcast", "sector": "Communication Services", "industry": "Cable & Satellite"},
    {"ticker": "T", "name": "AT&T", "sector": "Communication Services", "industry": "Integrated Telecommunication Services"},
    {"ticker": "VZ", "name": "Verizon", "sector": "Communication Services", "industry": "Integrated Telecommunication Services"},
    {"ticker": "TTWO", "name": "Take-Two Interactive", "sector": "Communication Services", "industry": "Interactive Home Entertainment"},
    {"ticker": "GOOG", "name": "Alphabet Inc. (Class C)", "sector": "Communication Services", "industry": "Interactive Media & Services"},
    {"ticker": "GOOGL", "name": "Alphabet Inc. (Class A)", "sector": "Communication Services", "industry": "Interactive Media & Services"},
    {"ticker": "META", "name": "Meta Platforms", "sector": "Communication Services", "industry": "Interactive Media & Services"},
    {"ticker": "DIS", "name": "Walt Disney Company (The)", "sector": "Communication Services", "industry": "Movies & Entertainment"},
    {"ticker": "LYV", "name": "Live Nation Entertainment", "sector": "Communication Services", "industry": "Movies & Entertainment"},
    {"ticker": "NFLX", "name": "Netflix", "sector": "Communication Services", "industry": "Movies & Entertainment"},
    {"ticker": "PSKY", "name": "Paramount Skydance Corporation", "sector": "Communication Services", "industry": "Movies & Entertainment"},
    {"ticker": "TKO", "name": "TKO Group Holdings", "sector": "Communication Services", "industry": "Movies & Entertainment"},
    {"ticker": "NWS", "name": "News Corp (Class B)", "sector": "Communication Services", "industry": "Publishing"},
    {"ticker": "NWSA", "name": "News Corp (Class A)", "sector": "Communication Services", "industry": "Publishing"},
    {"ticker": "ECHO", "name": "EchoStar", "sector": "Communication Services", "industry": "Wireless Telecommunication Services"},
    {"ticker": "TMUS", "name": "T-Mobile US", "sector": "Communication Services", "industry": "Wireless Telecommunication Services"},
    # ──── Consumer Discretionary ────
    {"ticker": "ROST", "name": "Ross Stores", "sector": "Consumer Discretionary", "industry": "Apparel Retail"},
    {"ticker": "TJX", "name": "TJX Companies", "sector": "Consumer Discretionary", "industry": "Apparel Retail"},
    {"ticker": "LULU", "name": "Lululemon Athletica", "sector": "Consumer Discretionary", "industry": "Apparel, Accessories & Luxury Goods"},
    {"ticker": "NKE", "name": "Nike, Inc.", "sector": "Consumer Discretionary", "industry": "Apparel, Accessories & Luxury Goods"},
    {"ticker": "RL", "name": "Ralph Lauren Corporation", "sector": "Consumer Discretionary", "industry": "Apparel, Accessories & Luxury Goods"},
    {"ticker": "TPR", "name": "Tapestry, Inc.", "sector": "Consumer Discretionary", "industry": "Apparel, Accessories & Luxury Goods"},
    {"ticker": "F", "name": "Ford Motor Company", "sector": "Consumer Discretionary", "industry": "Automobile Manufacturers"},
    {"ticker": "GM", "name": "General Motors", "sector": "Consumer Discretionary", "industry": "Automobile Manufacturers"},
    {"ticker": "TSLA", "name": "Tesla, Inc.", "sector": "Consumer Discretionary", "industry": "Automobile Manufacturers"},
    {"ticker": "APTV", "name": "Aptiv", "sector": "Consumer Discretionary", "industry": "Automotive Parts & Equipment"},
    {"ticker": "AZO", "name": "AutoZone", "sector": "Consumer Discretionary", "industry": "Automotive Retail"},
    {"ticker": "CVNA", "name": "Carvana", "sector": "Consumer Discretionary", "industry": "Automotive Retail"},
    {"ticker": "ORLY", "name": "O’Reilly Automotive", "sector": "Consumer Discretionary", "industry": "Automotive Retail"},
    {"ticker": "AMZN", "name": "Amazon", "sector": "Consumer Discretionary", "industry": "Broadline Retail"},
    {"ticker": "EBAY", "name": "eBay Inc.", "sector": "Consumer Discretionary", "industry": "Broadline Retail"},
    {"ticker": "LVS", "name": "Las Vegas Sands", "sector": "Consumer Discretionary", "industry": "Casinos & Gaming"},
    {"ticker": "MGM", "name": "MGM Resorts", "sector": "Consumer Discretionary", "industry": "Casinos & Gaming"},
    {"ticker": "WYNN", "name": "Wynn Resorts", "sector": "Consumer Discretionary", "industry": "Casinos & Gaming"},
    {"ticker": "BBY", "name": "Best Buy", "sector": "Consumer Discretionary", "industry": "Computer & Electronics Retail"},
    {"ticker": "GRMN", "name": "Garmin", "sector": "Consumer Discretionary", "industry": "Consumer Electronics"},
    {"ticker": "GPC", "name": "Genuine Parts Company", "sector": "Consumer Discretionary", "industry": "Distributors"},
    {"ticker": "DECK", "name": "Deckers Brands", "sector": "Consumer Discretionary", "industry": "Footwear"},
    {"ticker": "HD", "name": "Home Depot (The)", "sector": "Consumer Discretionary", "industry": "Home Improvement Retail"},
    {"ticker": "LOW", "name": "Lowe's", "sector": "Consumer Discretionary", "industry": "Home Improvement Retail"},
    {"ticker": "DHI", "name": "D. R. Horton", "sector": "Consumer Discretionary", "industry": "Homebuilding"},
    {"ticker": "LEN", "name": "Lennar", "sector": "Consumer Discretionary", "industry": "Homebuilding"},
    {"ticker": "NVR", "name": "NVR, Inc.", "sector": "Consumer Discretionary", "industry": "Homebuilding"},
    {"ticker": "PHM", "name": "PulteGroup", "sector": "Consumer Discretionary", "industry": "Homebuilding"},
    {"ticker": "WSM", "name": "Williams-Sonoma, Inc.", "sector": "Consumer Discretionary", "industry": "Homefurnishing Retail"},
    {"ticker": "ABNB", "name": "Airbnb", "sector": "Consumer Discretionary", "industry": "Hotels, Resorts & Cruise Lines"},
    {"ticker": "BKNG", "name": "Booking Holdings", "sector": "Consumer Discretionary", "industry": "Hotels, Resorts & Cruise Lines"},
    {"ticker": "CCL", "name": "Carnival Corporation", "sector": "Consumer Discretionary", "industry": "Hotels, Resorts & Cruise Lines"},
    {"ticker": "EXPE", "name": "Expedia Group", "sector": "Consumer Discretionary", "industry": "Hotels, Resorts & Cruise Lines"},
    {"ticker": "HLT", "name": "Hilton Worldwide", "sector": "Consumer Discretionary", "industry": "Hotels, Resorts & Cruise Lines"},
    {"ticker": "MAR", "name": "Marriott International", "sector": "Consumer Discretionary", "industry": "Hotels, Resorts & Cruise Lines"},
    {"ticker": "NCLH", "name": "Norwegian Cruise Line Holdings", "sector": "Consumer Discretionary", "industry": "Hotels, Resorts & Cruise Lines"},
    {"ticker": "RCL", "name": "Royal Caribbean Group", "sector": "Consumer Discretionary", "industry": "Hotels, Resorts & Cruise Lines"},
    {"ticker": "HAS", "name": "Hasbro", "sector": "Consumer Discretionary", "industry": "Leisure Products"},
    {"ticker": "TSCO", "name": "Tractor Supply", "sector": "Consumer Discretionary", "industry": "Other Specialty Retail"},
    {"ticker": "ULTA", "name": "Ulta Beauty", "sector": "Consumer Discretionary", "industry": "Other Specialty Retail"},
    {"ticker": "CMG", "name": "Chipotle Mexican Grill", "sector": "Consumer Discretionary", "industry": "Restaurants"},
    {"ticker": "DPZ", "name": "Domino's", "sector": "Consumer Discretionary", "industry": "Restaurants"},
    {"ticker": "DRI", "name": "Darden Restaurants", "sector": "Consumer Discretionary", "industry": "Restaurants"},
    {"ticker": "MCD", "name": "McDonald's", "sector": "Consumer Discretionary", "industry": "Restaurants"},
    {"ticker": "SBUX", "name": "Starbucks", "sector": "Consumer Discretionary", "industry": "Restaurants"},
    {"ticker": "YUM", "name": "Yum! Brands", "sector": "Consumer Discretionary", "industry": "Restaurants"},
    {"ticker": "DASH", "name": "DoorDash", "sector": "Consumer Discretionary", "industry": "Specialized Consumer Services"},
    # ──── Consumer Staples ────
    {"ticker": "ADM", "name": "Archer Daniels Midland", "sector": "Consumer Staples", "industry": "Agricultural Products & Services"},
    {"ticker": "BG", "name": "Bunge Global", "sector": "Consumer Staples", "industry": "Agricultural Products & Services"},
    {"ticker": "TAP", "name": "Molson Coors Beverage Company", "sector": "Consumer Staples", "industry": "Brewers"},
    {"ticker": "COST", "name": "Costco", "sector": "Consumer Staples", "industry": "Consumer Staples Merchandise Retail"},
    {"ticker": "DG", "name": "Dollar General", "sector": "Consumer Staples", "industry": "Consumer Staples Merchandise Retail"},
    {"ticker": "DLTR", "name": "Dollar Tree", "sector": "Consumer Staples", "industry": "Consumer Staples Merchandise Retail"},
    {"ticker": "TGT", "name": "Target Corporation", "sector": "Consumer Staples", "industry": "Consumer Staples Merchandise Retail"},
    {"ticker": "WMT", "name": "Walmart", "sector": "Consumer Staples", "industry": "Consumer Staples Merchandise Retail"},
    {"ticker": "BF-B", "name": "Brown–Forman", "sector": "Consumer Staples", "industry": "Distillers & Vintners"},
    {"ticker": "STZ", "name": "Constellation Brands", "sector": "Consumer Staples", "industry": "Distillers & Vintners"},
    {"ticker": "SYY", "name": "Sysco", "sector": "Consumer Staples", "industry": "Food Distributors"},
    {"ticker": "CASY", "name": "Casey's", "sector": "Consumer Staples", "industry": "Food Retail"},
    {"ticker": "KR", "name": "Kroger", "sector": "Consumer Staples", "industry": "Food Retail"},
    {"ticker": "CHD", "name": "Church & Dwight", "sector": "Consumer Staples", "industry": "Household Products"},
    {"ticker": "CL", "name": "Colgate-Palmolive", "sector": "Consumer Staples", "industry": "Household Products"},
    {"ticker": "CLX", "name": "Clorox", "sector": "Consumer Staples", "industry": "Household Products"},
    {"ticker": "KMB", "name": "Kimberly-Clark", "sector": "Consumer Staples", "industry": "Household Products"},
    {"ticker": "GIS", "name": "General Mills", "sector": "Consumer Staples", "industry": "Packaged Foods & Meats"},
    {"ticker": "HRL", "name": "Hormel Foods", "sector": "Consumer Staples", "industry": "Packaged Foods & Meats"},
    {"ticker": "HSY", "name": "Hershey Company (The)", "sector": "Consumer Staples", "industry": "Packaged Foods & Meats"},
    {"ticker": "KHC", "name": "Kraft Heinz", "sector": "Consumer Staples", "industry": "Packaged Foods & Meats"},
    {"ticker": "MDLZ", "name": "Mondelez International", "sector": "Consumer Staples", "industry": "Packaged Foods & Meats"},
    {"ticker": "MKC", "name": "McCormick & Company", "sector": "Consumer Staples", "industry": "Packaged Foods & Meats"},
    {"ticker": "SJM", "name": "J.M. Smucker Company (The)", "sector": "Consumer Staples", "industry": "Packaged Foods & Meats"},
    {"ticker": "TSN", "name": "Tyson Foods", "sector": "Consumer Staples", "industry": "Packaged Foods & Meats"},
    {"ticker": "EL", "name": "Estée Lauder Companies (The)", "sector": "Consumer Staples", "industry": "Personal Care Products"},
    {"ticker": "KVUE", "name": "Kenvue", "sector": "Consumer Staples", "industry": "Personal Care Products"},
    {"ticker": "PG", "name": "Procter & Gamble", "sector": "Consumer Staples", "industry": "Personal Care Products"},
    {"ticker": "KDP", "name": "Keurig Dr Pepper", "sector": "Consumer Staples", "industry": "Soft Drinks & Non-alcoholic Beverages"},
    {"ticker": "KO", "name": "Coca-Cola Company (The)", "sector": "Consumer Staples", "industry": "Soft Drinks & Non-alcoholic Beverages"},
    {"ticker": "MNST", "name": "Monster Beverage", "sector": "Consumer Staples", "industry": "Soft Drinks & Non-alcoholic Beverages"},
    {"ticker": "PEP", "name": "PepsiCo", "sector": "Consumer Staples", "industry": "Soft Drinks & Non-alcoholic Beverages"},
    {"ticker": "MO", "name": "Altria", "sector": "Consumer Staples", "industry": "Tobacco"},
    {"ticker": "PM", "name": "Philip Morris International", "sector": "Consumer Staples", "industry": "Tobacco"},
    # ──── Energy ────
    {"ticker": "CVX", "name": "Chevron Corporation", "sector": "Energy", "industry": "Integrated Oil & Gas"},
    {"ticker": "XOM", "name": "ExxonMobil", "sector": "Energy", "industry": "Integrated Oil & Gas"},
    {"ticker": "BKR", "name": "Baker Hughes", "sector": "Energy", "industry": "Oil & Gas Equipment & Services"},
    {"ticker": "HAL", "name": "Halliburton", "sector": "Energy", "industry": "Oil & Gas Equipment & Services"},
    {"ticker": "SLB", "name": "Schlumberger", "sector": "Energy", "industry": "Oil & Gas Equipment & Services"},
    {"ticker": "APA", "name": "APA Corporation", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "COP", "name": "ConocoPhillips", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "DVN", "name": "Devon Energy", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "EOG", "name": "EOG Resources", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "EQT", "name": "EQT Corporation", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "EXE", "name": "Expand Energy", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "FANG", "name": "Diamondback Energy", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "OXY", "name": "Occidental Petroleum", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "TPL", "name": "Texas Pacific Land Corporation", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "MPC", "name": "Marathon Petroleum", "sector": "Energy", "industry": "Oil & Gas Refining & Marketing"},
    {"ticker": "PSX", "name": "Phillips 66", "sector": "Energy", "industry": "Oil & Gas Refining & Marketing"},
    {"ticker": "VLO", "name": "Valero Energy", "sector": "Energy", "industry": "Oil & Gas Refining & Marketing"},
    {"ticker": "KMI", "name": "Kinder Morgan", "sector": "Energy", "industry": "Oil & Gas Storage & Transportation"},
    {"ticker": "OKE", "name": "Oneok", "sector": "Energy", "industry": "Oil & Gas Storage & Transportation"},
    {"ticker": "TRGP", "name": "Targa Resources", "sector": "Energy", "industry": "Oil & Gas Storage & Transportation"},
    {"ticker": "WMB", "name": "Williams Companies", "sector": "Energy", "industry": "Oil & Gas Storage & Transportation"},
    # ──── Financials ────
    {"ticker": "AMP", "name": "Ameriprise Financial", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "APO", "name": "Apollo Global Management", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "ARES", "name": "Ares Management", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "BEN", "name": "Franklin Resources", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "BLK", "name": "BlackRock", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "BNY", "name": "BNY Mellon", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "BX", "name": "Blackstone Inc.", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "IVZ", "name": "Invesco", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "KKR", "name": "KKR & Co.", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "NTRS", "name": "Northern Trust", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "STT", "name": "State Street Corporation", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "TROW", "name": "T. Rowe Price", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "AXP", "name": "American Express", "sector": "Financials", "industry": "Consumer Finance"},
    {"ticker": "COF", "name": "Capital One", "sector": "Financials", "industry": "Consumer Finance"},
    {"ticker": "SYF", "name": "Synchrony Financial", "sector": "Financials", "industry": "Consumer Finance"},
    {"ticker": "BAC", "name": "Bank of America", "sector": "Financials", "industry": "Diversified Banks"},
    {"ticker": "C", "name": "Citigroup", "sector": "Financials", "industry": "Diversified Banks"},
    {"ticker": "JPM", "name": "JPMorgan Chase", "sector": "Financials", "industry": "Diversified Banks"},
    {"ticker": "PNC", "name": "PNC Financial Services", "sector": "Financials", "industry": "Diversified Banks"},
    {"ticker": "TFC", "name": "Truist Financial", "sector": "Financials", "industry": "Diversified Banks"},
    {"ticker": "USB", "name": "U.S. Bancorp", "sector": "Financials", "industry": "Diversified Banks"},
    {"ticker": "WFC", "name": "Wells Fargo", "sector": "Financials", "industry": "Diversified Banks"},
    {"ticker": "CBOE", "name": "Cboe Global Markets", "sector": "Financials", "industry": "Financial Exchanges & Data"},
    {"ticker": "CME", "name": "CME Group", "sector": "Financials", "industry": "Financial Exchanges & Data"},
    {"ticker": "COIN", "name": "Coinbase", "sector": "Financials", "industry": "Financial Exchanges & Data"},
    {"ticker": "FDS", "name": "FactSet", "sector": "Financials", "industry": "Financial Exchanges & Data"},
    {"ticker": "ICE", "name": "Intercontinental Exchange", "sector": "Financials", "industry": "Financial Exchanges & Data"},
    {"ticker": "MCO", "name": "Moody's Corporation", "sector": "Financials", "industry": "Financial Exchanges & Data"},
    {"ticker": "MSCI", "name": "MSCI Inc.", "sector": "Financials", "industry": "Financial Exchanges & Data"},
    {"ticker": "NDAQ", "name": "Nasdaq, Inc.", "sector": "Financials", "industry": "Financial Exchanges & Data"},
    {"ticker": "SPGI", "name": "S&P Global", "sector": "Financials", "industry": "Financial Exchanges & Data"},
    {"ticker": "AJG", "name": "Arthur J. Gallagher & Co.", "sector": "Financials", "industry": "Insurance Brokers"},
    {"ticker": "AON", "name": "Aon plc", "sector": "Financials", "industry": "Insurance Brokers"},
    {"ticker": "BRO", "name": "Brown & Brown", "sector": "Financials", "industry": "Insurance Brokers"},
    {"ticker": "ERIE", "name": "Erie Indemnity", "sector": "Financials", "industry": "Insurance Brokers"},
    {"ticker": "MRSH", "name": "Marsh McLennan", "sector": "Financials", "industry": "Insurance Brokers"},
    {"ticker": "WTW", "name": "Willis Towers Watson", "sector": "Financials", "industry": "Insurance Brokers"},
    {"ticker": "GS", "name": "Goldman Sachs", "sector": "Financials", "industry": "Investment Banking & Brokerage"},
    {"ticker": "HOOD", "name": "Robinhood Markets", "sector": "Financials", "industry": "Investment Banking & Brokerage"},
    {"ticker": "IBKR", "name": "Interactive Brokers", "sector": "Financials", "industry": "Investment Banking & Brokerage"},
    {"ticker": "MS", "name": "Morgan Stanley", "sector": "Financials", "industry": "Investment Banking & Brokerage"},
    {"ticker": "RJF", "name": "Raymond James Financial", "sector": "Financials", "industry": "Investment Banking & Brokerage"},
    {"ticker": "SCHW", "name": "Charles Schwab Corporation", "sector": "Financials", "industry": "Investment Banking & Brokerage"},
    {"ticker": "AFL", "name": "Aflac", "sector": "Financials", "industry": "Life & Health Insurance"},
    {"ticker": "GL", "name": "Globe Life", "sector": "Financials", "industry": "Life & Health Insurance"},
    {"ticker": "MET", "name": "MetLife", "sector": "Financials", "industry": "Life & Health Insurance"},
    {"ticker": "PFG", "name": "Principal Financial Group", "sector": "Financials", "industry": "Life & Health Insurance"},
    {"ticker": "PRU", "name": "Prudential Financial", "sector": "Financials", "industry": "Life & Health Insurance"},
    {"ticker": "BRK-B", "name": "Berkshire Hathaway", "sector": "Financials", "industry": "Multi-Sector Holdings"},
    {"ticker": "AIG", "name": "American International Group", "sector": "Financials", "industry": "Multi-line Insurance"},
    {"ticker": "AIZ", "name": "Assurant", "sector": "Financials", "industry": "Multi-line Insurance"},
    {"ticker": "L", "name": "Loews Corporation", "sector": "Financials", "industry": "Multi-line Insurance"},
    {"ticker": "ACGL", "name": "Arch Capital Group", "sector": "Financials", "industry": "Property & Casualty Insurance"},
    {"ticker": "ALL", "name": "Allstate", "sector": "Financials", "industry": "Property & Casualty Insurance"},
    {"ticker": "CB", "name": "Chubb Limited", "sector": "Financials", "industry": "Property & Casualty Insurance"},
    {"ticker": "CINF", "name": "Cincinnati Financial", "sector": "Financials", "industry": "Property & Casualty Insurance"},
    {"ticker": "HIG", "name": "Hartford (The)", "sector": "Financials", "industry": "Property & Casualty Insurance"},
    {"ticker": "PGR", "name": "Progressive Corporation", "sector": "Financials", "industry": "Property & Casualty Insurance"},
    {"ticker": "TRV", "name": "Travelers Companies (The)", "sector": "Financials", "industry": "Property & Casualty Insurance"},
    {"ticker": "WRB", "name": "W. R. Berkley Corporation", "sector": "Financials", "industry": "Property & Casualty Insurance"},
    {"ticker": "CFG", "name": "Citizens Financial Group", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "FITB", "name": "Fifth Third Bancorp", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "HBAN", "name": "Huntington Bancshares", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "KEY", "name": "KeyCorp", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "MTB", "name": "M&T Bank", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "RF", "name": "Regions Financial Corporation", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "EG", "name": "Everest Group", "sector": "Financials", "industry": "Reinsurance"},
    {"ticker": "CPAY", "name": "Corpay", "sector": "Financials", "industry": "Transaction & Payment Processing Services"},
    {"ticker": "FIS", "name": "Fidelity National Information Services", "sector": "Financials", "industry": "Transaction & Payment Processing Services"},
    {"ticker": "FISV", "name": "Fiserv", "sector": "Financials", "industry": "Transaction & Payment Processing Services"},
    {"ticker": "GPN", "name": "Global Payments", "sector": "Financials", "industry": "Transaction & Payment Processing Services"},
    {"ticker": "JKHY", "name": "Jack Henry & Associates", "sector": "Financials", "industry": "Transaction & Payment Processing Services"},
    {"ticker": "MA", "name": "Mastercard", "sector": "Financials", "industry": "Transaction & Payment Processing Services"},
    {"ticker": "PYPL", "name": "PayPal", "sector": "Financials", "industry": "Transaction & Payment Processing Services"},
    {"ticker": "V", "name": "Visa Inc.", "sector": "Financials", "industry": "Transaction & Payment Processing Services"},
    {"ticker": "XYZ", "name": "Block, Inc.", "sector": "Financials", "industry": "Transaction & Payment Processing Services"},
    # ──── Healthcare ────
    {"ticker": "ABBV", "name": "AbbVie", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "AMGN", "name": "Amgen", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "BIIB", "name": "Biogen", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "GILD", "name": "Gilead Sciences", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "INCY", "name": "Incyte", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "MRNA", "name": "Moderna", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "REGN", "name": "Regeneron Pharmaceuticals", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "VRTX", "name": "Vertex Pharmaceuticals", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "CAH", "name": "Cardinal Health", "sector": "Healthcare", "industry": "Health Care Distributors"},
    {"ticker": "COR", "name": "Cencora", "sector": "Healthcare", "industry": "Health Care Distributors"},
    {"ticker": "HSIC", "name": "Henry Schein", "sector": "Healthcare", "industry": "Health Care Distributors"},
    {"ticker": "MCK", "name": "McKesson Corporation", "sector": "Healthcare", "industry": "Health Care Distributors"},
    {"ticker": "ABT", "name": "Abbott Laboratories", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "BAX", "name": "Baxter International", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "BDX", "name": "Becton Dickinson", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "BSX", "name": "Boston Scientific", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "DXCM", "name": "Dexcom", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "EW", "name": "Edwards Lifesciences", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "GEHC", "name": "GE HealthCare", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "IDXX", "name": "Idexx Laboratories", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "ISRG", "name": "Intuitive Surgical", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "MDT", "name": "Medtronic", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "PODD", "name": "Insulet Corporation", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "RMD", "name": "ResMed", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "RVTY", "name": "Revvity", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "STE", "name": "Steris", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "SYK", "name": "Stryker Corporation", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "ZBH", "name": "Zimmer Biomet", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "HCA", "name": "HCA Healthcare", "sector": "Healthcare", "industry": "Health Care Facilities"},
    {"ticker": "UHS", "name": "Universal Health Services", "sector": "Healthcare", "industry": "Health Care Facilities"},
    {"ticker": "CI", "name": "Cigna", "sector": "Healthcare", "industry": "Health Care Services"},
    {"ticker": "CVS", "name": "CVS Health", "sector": "Healthcare", "industry": "Health Care Services"},
    {"ticker": "DGX", "name": "Quest Diagnostics", "sector": "Healthcare", "industry": "Health Care Services"},
    {"ticker": "DVA", "name": "DaVita", "sector": "Healthcare", "industry": "Health Care Services"},
    {"ticker": "LH", "name": "Labcorp", "sector": "Healthcare", "industry": "Health Care Services"},
    {"ticker": "ALGN", "name": "Align Technology", "sector": "Healthcare", "industry": "Health Care Supplies"},
    {"ticker": "COO", "name": "Cooper Companies (The)", "sector": "Healthcare", "industry": "Health Care Supplies"},
    {"ticker": "WST", "name": "West Pharmaceutical Services", "sector": "Healthcare", "industry": "Health Care Supplies"},
    {"ticker": "SOLV", "name": "Solventum", "sector": "Healthcare", "industry": "Health Care Technology"},
    {"ticker": "VEEV", "name": "Veeva Systems", "sector": "Healthcare", "industry": "Health Care Technology"},
    {"ticker": "A", "name": "Agilent Technologies", "sector": "Healthcare", "industry": "Life Sciences Tools & Services"},
    {"ticker": "CRL", "name": "Charles River Laboratories", "sector": "Healthcare", "industry": "Life Sciences Tools & Services"},
    {"ticker": "DHR", "name": "Danaher Corporation", "sector": "Healthcare", "industry": "Life Sciences Tools & Services"},
    {"ticker": "IQV", "name": "IQVIA", "sector": "Healthcare", "industry": "Life Sciences Tools & Services"},
    {"ticker": "MTD", "name": "Mettler Toledo", "sector": "Healthcare", "industry": "Life Sciences Tools & Services"},
    {"ticker": "TECH", "name": "Bio-Techne", "sector": "Healthcare", "industry": "Life Sciences Tools & Services"},
    {"ticker": "TMO", "name": "Thermo Fisher Scientific", "sector": "Healthcare", "industry": "Life Sciences Tools & Services"},
    {"ticker": "WAT", "name": "Waters Corporation", "sector": "Healthcare", "industry": "Life Sciences Tools & Services"},
    {"ticker": "CNC", "name": "Centene Corporation", "sector": "Healthcare", "industry": "Managed Health Care"},
    {"ticker": "ELV", "name": "Elevance Health", "sector": "Healthcare", "industry": "Managed Health Care"},
    {"ticker": "HUM", "name": "Humana", "sector": "Healthcare", "industry": "Managed Health Care"},
    {"ticker": "UNH", "name": "UnitedHealth Group", "sector": "Healthcare", "industry": "Managed Health Care"},
    {"ticker": "BMY", "name": "Bristol Myers Squibb", "sector": "Healthcare", "industry": "Pharmaceuticals"},
    {"ticker": "JNJ", "name": "Johnson & Johnson", "sector": "Healthcare", "industry": "Pharmaceuticals"},
    {"ticker": "LLY", "name": "Lilly (Eli)", "sector": "Healthcare", "industry": "Pharmaceuticals"},
    {"ticker": "MRK", "name": "Merck & Co.", "sector": "Healthcare", "industry": "Pharmaceuticals"},
    {"ticker": "PFE", "name": "Pfizer", "sector": "Healthcare", "industry": "Pharmaceuticals"},
    {"ticker": "VTRS", "name": "Viatris", "sector": "Healthcare", "industry": "Pharmaceuticals"},
    {"ticker": "ZTS", "name": "Zoetis", "sector": "Healthcare", "industry": "Pharmaceuticals"},
    # ──── Industrials ────
    {"ticker": "AXON", "name": "Axon Enterprise", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "BA", "name": "Boeing", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "GD", "name": "General Dynamics", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "GE", "name": "GE Aerospace", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "HII", "name": "Huntington Ingalls Industries", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "HONA", "name": "Honeywell Aerospace", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "HWM", "name": "Howmet Aerospace", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "LHX", "name": "L3Harris", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "LMT", "name": "Lockheed Martin", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "NOC", "name": "Northrop Grumman", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "RTX", "name": "RTX Corporation", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "TDG", "name": "TransDigm Group", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "TXT", "name": "Textron", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "DE", "name": "Deere & Company", "sector": "Industrials", "industry": "Agricultural & Farm Machinery"},
    {"ticker": "CHRW", "name": "C.H. Robinson", "sector": "Industrials", "industry": "Air Freight & Logistics"},
    {"ticker": "EXPD", "name": "Expeditors International", "sector": "Industrials", "industry": "Air Freight & Logistics"},
    {"ticker": "FDX", "name": "FedEx", "sector": "Industrials", "industry": "Air Freight & Logistics"},
    {"ticker": "UPS", "name": "United Parcel Service", "sector": "Industrials", "industry": "Air Freight & Logistics"},
    {"ticker": "ALLE", "name": "Allegion", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "AOS", "name": "A. O. Smith", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "BLDR", "name": "Builders FirstSource", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "CARR", "name": "Carrier Global", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "FERG", "name": "Ferguson Enterprises", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "JCI", "name": "Johnson Controls", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "LII", "name": "Lennox International", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "MAS", "name": "Masco", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "TT", "name": "Trane Technologies", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "FDXF", "name": "FedEx Freight", "sector": "Industrials", "industry": "Cargo Ground Transportation"},
    {"ticker": "JBHT", "name": "J.B. Hunt", "sector": "Industrials", "industry": "Cargo Ground Transportation"},
    {"ticker": "ODFL", "name": "Old Dominion", "sector": "Industrials", "industry": "Cargo Ground Transportation"},
    {"ticker": "EME", "name": "Emcor", "sector": "Industrials", "industry": "Construction & Engineering"},
    {"ticker": "FIX", "name": "Comfort Systems USA", "sector": "Industrials", "industry": "Construction & Engineering"},
    {"ticker": "J", "name": "Jacobs Solutions", "sector": "Industrials", "industry": "Construction & Engineering"},
    {"ticker": "PWR", "name": "Quanta Services", "sector": "Industrials", "industry": "Construction & Engineering"},
    {"ticker": "CAT", "name": "Caterpillar Inc.", "sector": "Industrials", "industry": "Construction Machinery & Heavy Transportation Equipment"},
    {"ticker": "CMI", "name": "Cummins", "sector": "Industrials", "industry": "Construction Machinery & Heavy Transportation Equipment"},
    {"ticker": "PCAR", "name": "Paccar", "sector": "Industrials", "industry": "Construction Machinery & Heavy Transportation Equipment"},
    {"ticker": "WAB", "name": "Wabtec", "sector": "Industrials", "industry": "Construction Machinery & Heavy Transportation Equipment"},
    {"ticker": "BR", "name": "Broadridge Financial Solutions", "sector": "Industrials", "industry": "Data Processing & Outsourced Services"},
    {"ticker": "CPRT", "name": "Copart", "sector": "Industrials", "industry": "Diversified Support Services"},
    {"ticker": "CTAS", "name": "Cintas", "sector": "Industrials", "industry": "Diversified Support Services"},
    {"ticker": "LDOS", "name": "Leidos", "sector": "Industrials", "industry": "Diversified Support Services"},
    {"ticker": "AME", "name": "Ametek", "sector": "Industrials", "industry": "Electrical Components & Equipment"},
    {"ticker": "EMR", "name": "Emerson Electric", "sector": "Industrials", "industry": "Electrical Components & Equipment"},
    {"ticker": "ETN", "name": "Eaton Corporation", "sector": "Industrials", "industry": "Electrical Components & Equipment"},
    {"ticker": "ROK", "name": "Rockwell Automation", "sector": "Industrials", "industry": "Electrical Components & Equipment"},
    {"ticker": "VRT", "name": "Vertiv", "sector": "Industrials", "industry": "Electrical Components & Equipment"},
    {"ticker": "ROL", "name": "Rollins, Inc.", "sector": "Industrials", "industry": "Environmental & Facilities Services"},
    {"ticker": "RSG", "name": "Republic Services", "sector": "Industrials", "industry": "Environmental & Facilities Services"},
    {"ticker": "VLTO", "name": "Veralto", "sector": "Industrials", "industry": "Environmental & Facilities Services"},
    {"ticker": "WM", "name": "Waste Management", "sector": "Industrials", "industry": "Environmental & Facilities Services"},
    {"ticker": "GEV", "name": "GE Vernova", "sector": "Industrials", "industry": "Heavy Electrical Equipment"},
    {"ticker": "GNRC", "name": "Generac", "sector": "Industrials", "industry": "Heavy Electrical Equipment"},
    {"ticker": "ADP", "name": "Automatic Data Processing", "sector": "Industrials", "industry": "Human Resource & Employment Services"},
    {"ticker": "PAYX", "name": "Paychex", "sector": "Industrials", "industry": "Human Resource & Employment Services"},
    {"ticker": "DD", "name": "DuPont", "sector": "Industrials", "industry": "Industrial Conglomerates"},
    {"ticker": "HON", "name": "Honeywell Technologies", "sector": "Industrials", "industry": "Industrial Conglomerates"},
    {"ticker": "MMM", "name": "3M", "sector": "Industrials", "industry": "Industrial Conglomerates"},
    {"ticker": "DOV", "name": "Dover Corporation", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "FTV", "name": "Fortive", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "GWW", "name": "W. W. Grainger", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "HUBB", "name": "Hubbell Incorporated", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "IEX", "name": "IDEX Corporation", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "IR", "name": "Ingersoll Rand", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "ITW", "name": "Illinois Tool Works", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "NDSN", "name": "Nordson Corporation", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "OTIS", "name": "Otis Worldwide", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "PH", "name": "Parker Hannifin", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "PNR", "name": "Pentair", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "SNA", "name": "Snap-on", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "SWK", "name": "Stanley Black & Decker", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "XYL", "name": "Xylem Inc.", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "DAL", "name": "Delta Air Lines", "sector": "Industrials", "industry": "Passenger Airlines"},
    {"ticker": "LUV", "name": "Southwest Airlines", "sector": "Industrials", "industry": "Passenger Airlines"},
    {"ticker": "UAL", "name": "United Airlines Holdings", "sector": "Industrials", "industry": "Passenger Airlines"},
    {"ticker": "UBER", "name": "Uber", "sector": "Industrials", "industry": "Passenger Ground Transportation"},
    {"ticker": "CSX", "name": "CSX Corporation", "sector": "Industrials", "industry": "Rail Transportation"},
    {"ticker": "NSC", "name": "Norfolk Southern", "sector": "Industrials", "industry": "Rail Transportation"},
    {"ticker": "UNP", "name": "Union Pacific Corporation", "sector": "Industrials", "industry": "Rail Transportation"},
    {"ticker": "EFX", "name": "Equifax", "sector": "Industrials", "industry": "Research & Consulting Services"},
    {"ticker": "VRSK", "name": "Verisk Analytics", "sector": "Industrials", "industry": "Research & Consulting Services"},
    {"ticker": "FAST", "name": "Fastenal", "sector": "Industrials", "industry": "Trading Companies & Distributors"},
    {"ticker": "URI", "name": "United Rentals", "sector": "Industrials", "industry": "Trading Companies & Distributors"},
    # ──── Materials ────
    {"ticker": "DOW", "name": "Dow Inc.", "sector": "Materials", "industry": "Commodity Chemicals"},
    {"ticker": "CRH", "name": "CRH plc", "sector": "Materials", "industry": "Construction Materials"},
    {"ticker": "MLM", "name": "Martin Marietta Materials", "sector": "Materials", "industry": "Construction Materials"},
    {"ticker": "VMC", "name": "Vulcan Materials Company", "sector": "Materials", "industry": "Construction Materials"},
    {"ticker": "FCX", "name": "Freeport-McMoRan", "sector": "Materials", "industry": "Copper"},
    {"ticker": "CF", "name": "CF Industries", "sector": "Materials", "industry": "Fertilizers & Agricultural Chemicals"},
    {"ticker": "CTVA", "name": "Corteva", "sector": "Materials", "industry": "Fertilizers & Agricultural Chemicals"},
    {"ticker": "MOS", "name": "Mosaic Company (The)", "sector": "Materials", "industry": "Fertilizers & Agricultural Chemicals"},
    {"ticker": "NEM", "name": "Newmont", "sector": "Materials", "industry": "Gold"},
    {"ticker": "APD", "name": "Air Products", "sector": "Materials", "industry": "Industrial Gases"},
    {"ticker": "LIN", "name": "Linde plc", "sector": "Materials", "industry": "Industrial Gases"},
    {"ticker": "BALL", "name": "Ball Corporation", "sector": "Materials", "industry": "Metal, Glass & Plastic Containers"},
    {"ticker": "AMCR", "name": "Amcor", "sector": "Materials", "industry": "Paper & Plastic Packaging Products & Materials"},
    {"ticker": "AVY", "name": "Avery Dennison", "sector": "Materials", "industry": "Paper & Plastic Packaging Products & Materials"},
    {"ticker": "IP", "name": "International Paper", "sector": "Materials", "industry": "Paper & Plastic Packaging Products & Materials"},
    {"ticker": "PKG", "name": "Packaging Corporation of America", "sector": "Materials", "industry": "Paper & Plastic Packaging Products & Materials"},
    {"ticker": "SW", "name": "Smurfit Westrock", "sector": "Materials", "industry": "Paper & Plastic Packaging Products & Materials"},
    {"ticker": "ALB", "name": "Albemarle Corporation", "sector": "Materials", "industry": "Specialty Chemicals"},
    {"ticker": "ECL", "name": "Ecolab", "sector": "Materials", "industry": "Specialty Chemicals"},
    {"ticker": "IFF", "name": "International Flavors & Fragrances", "sector": "Materials", "industry": "Specialty Chemicals"},
    {"ticker": "LYB", "name": "LyondellBasell", "sector": "Materials", "industry": "Specialty Chemicals"},
    {"ticker": "PPG", "name": "PPG Industries", "sector": "Materials", "industry": "Specialty Chemicals"},
    {"ticker": "SHW", "name": "Sherwin-Williams", "sector": "Materials", "industry": "Specialty Chemicals"},
    {"ticker": "NUE", "name": "Nucor", "sector": "Materials", "industry": "Steel"},
    {"ticker": "STLD", "name": "Steel Dynamics", "sector": "Materials", "industry": "Steel"},
    # ──── Real Estate ────
    {"ticker": "DLR", "name": "Digital Realty", "sector": "Real Estate", "industry": "Data Center REITs"},
    {"ticker": "EQIX", "name": "Equinix", "sector": "Real Estate", "industry": "Data Center REITs"},
    {"ticker": "DOC", "name": "Healthpeak Properties", "sector": "Real Estate", "industry": "Health Care REITs"},
    {"ticker": "VTR", "name": "Ventas", "sector": "Real Estate", "industry": "Health Care REITs"},
    {"ticker": "WELL", "name": "Welltower", "sector": "Real Estate", "industry": "Health Care REITs"},
    {"ticker": "HST", "name": "Host Hotels & Resorts", "sector": "Real Estate", "industry": "Hotel & Resort REITs"},
    {"ticker": "VICI", "name": "Vici Properties", "sector": "Real Estate", "industry": "Hotel & Resort REITs"},
    {"ticker": "PLD", "name": "Prologis", "sector": "Real Estate", "industry": "Industrial REITs"},
    {"ticker": "AVB", "name": "AvalonBay Communities", "sector": "Real Estate", "industry": "Multi-Family Residential REITs"},
    {"ticker": "CPT", "name": "Camden Property Trust", "sector": "Real Estate", "industry": "Multi-Family Residential REITs"},
    {"ticker": "EQR", "name": "Equity Residential", "sector": "Real Estate", "industry": "Multi-Family Residential REITs"},
    {"ticker": "ESS", "name": "Essex Property Trust", "sector": "Real Estate", "industry": "Multi-Family Residential REITs"},
    {"ticker": "MAA", "name": "Mid-America Apartment Communities", "sector": "Real Estate", "industry": "Multi-Family Residential REITs"},
    {"ticker": "UDR", "name": "UDR, Inc.", "sector": "Real Estate", "industry": "Multi-Family Residential REITs"},
    {"ticker": "ARE", "name": "Alexandria Real Estate Equities", "sector": "Real Estate", "industry": "Office REITs"},
    {"ticker": "BXP", "name": "BXP, Inc.", "sector": "Real Estate", "industry": "Office REITs"},
    {"ticker": "IRM", "name": "Iron Mountain", "sector": "Real Estate", "industry": "Other Specialized REITs"},
    {"ticker": "CBRE", "name": "CBRE Group", "sector": "Real Estate", "industry": "Real Estate Services"},
    {"ticker": "CSGP", "name": "CoStar Group", "sector": "Real Estate", "industry": "Real Estate Services"},
    {"ticker": "FRT", "name": "Federal Realty Investment Trust", "sector": "Real Estate", "industry": "Retail REITs"},
    {"ticker": "KIM", "name": "Kimco Realty", "sector": "Real Estate", "industry": "Retail REITs"},
    {"ticker": "O", "name": "Realty Income", "sector": "Real Estate", "industry": "Retail REITs"},
    {"ticker": "REG", "name": "Regency Centers", "sector": "Real Estate", "industry": "Retail REITs"},
    {"ticker": "SPG", "name": "Simon Property Group", "sector": "Real Estate", "industry": "Retail REITs"},
    {"ticker": "EXR", "name": "Extra Space Storage", "sector": "Real Estate", "industry": "Self-Storage REITs"},
    {"ticker": "PSA", "name": "Public Storage", "sector": "Real Estate", "industry": "Self-Storage REITs"},
    {"ticker": "INVH", "name": "Invitation Homes", "sector": "Real Estate", "industry": "Single-Family Residential REITs"},
    {"ticker": "AMT", "name": "American Tower", "sector": "Real Estate", "industry": "Telecom Tower REITs"},
    {"ticker": "CCI", "name": "Crown Castle", "sector": "Real Estate", "industry": "Telecom Tower REITs"},
    {"ticker": "SBAC", "name": "SBA Communications", "sector": "Real Estate", "industry": "Telecom Tower REITs"},
    {"ticker": "WY", "name": "Weyerhaeuser", "sector": "Real Estate", "industry": "Timber REITs"},
    # ──── Technology ────
    {"ticker": "ADBE", "name": "Adobe Inc.", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "ADSK", "name": "Autodesk", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "CDNS", "name": "Cadence Design Systems", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "CRM", "name": "Salesforce", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "DDOG", "name": "Datadog", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "FICO", "name": "Fair Isaac", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "INTU", "name": "Intuit", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "ORCL", "name": "Oracle Corporation", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "PLTR", "name": "Palantir Technologies", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "PTC", "name": "PTC Inc.", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "SNPS", "name": "Synopsys", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "TRMB", "name": "Trimble Inc.", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "TYL", "name": "Tyler Technologies", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "WDAY", "name": "Workday, Inc.", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "ANET", "name": "Arista Networks", "sector": "Technology", "industry": "Communications Equipment"},
    {"ticker": "CIEN", "name": "Ciena", "sector": "Technology", "industry": "Communications Equipment"},
    {"ticker": "CSCO", "name": "Cisco", "sector": "Technology", "industry": "Communications Equipment"},
    {"ticker": "FFIV", "name": "F5, Inc.", "sector": "Technology", "industry": "Communications Equipment"},
    {"ticker": "LITE", "name": "Lumentum", "sector": "Technology", "industry": "Communications Equipment"},
    {"ticker": "MSI", "name": "Motorola Solutions", "sector": "Technology", "industry": "Communications Equipment"},
    {"ticker": "APH", "name": "Amphenol", "sector": "Technology", "industry": "Electronic Components"},
    {"ticker": "COHR", "name": "Coherent Corp.", "sector": "Technology", "industry": "Electronic Components"},
    {"ticker": "GLW", "name": "Corning Inc.", "sector": "Technology", "industry": "Electronic Components"},
    {"ticker": "KEYS", "name": "Keysight Technologies", "sector": "Technology", "industry": "Electronic Equipment & Instruments"},
    {"ticker": "ROP", "name": "Roper Technologies", "sector": "Technology", "industry": "Electronic Equipment & Instruments"},
    {"ticker": "TDY", "name": "Teledyne Technologies", "sector": "Technology", "industry": "Electronic Equipment & Instruments"},
    {"ticker": "ZBRA", "name": "Zebra Technologies", "sector": "Technology", "industry": "Electronic Equipment & Instruments"},
    {"ticker": "FLEX", "name": "Flex Ltd.", "sector": "Technology", "industry": "Electronic Manufacturing Services"},
    {"ticker": "JBL", "name": "Jabil", "sector": "Technology", "industry": "Electronic Manufacturing Services"},
    {"ticker": "TEL", "name": "TE Connectivity", "sector": "Technology", "industry": "Electronic Manufacturing Services"},
    {"ticker": "ACN", "name": "Accenture", "sector": "Technology", "industry": "IT Consulting & Other Services"},
    {"ticker": "CTSH", "name": "Cognizant", "sector": "Technology", "industry": "IT Consulting & Other Services"},
    {"ticker": "IBM", "name": "IBM", "sector": "Technology", "industry": "IT Consulting & Other Services"},
    {"ticker": "IT", "name": "Gartner", "sector": "Technology", "industry": "IT Consulting & Other Services"},
    {"ticker": "AKAM", "name": "Akamai Technologies", "sector": "Technology", "industry": "Internet Services & Infrastructure"},
    {"ticker": "GDDY", "name": "GoDaddy", "sector": "Technology", "industry": "Internet Services & Infrastructure"},
    {"ticker": "VRSN", "name": "Verisign", "sector": "Technology", "industry": "Internet Services & Infrastructure"},
    {"ticker": "AMAT", "name": "Applied Materials", "sector": "Technology", "industry": "Semiconductor Materials & Equipment"},
    {"ticker": "KLAC", "name": "KLA Corporation", "sector": "Technology", "industry": "Semiconductor Materials & Equipment"},
    {"ticker": "LRCX", "name": "Lam Research", "sector": "Technology", "industry": "Semiconductor Materials & Equipment"},
    {"ticker": "Q", "name": "Qnity Electronics", "sector": "Technology", "industry": "Semiconductor Materials & Equipment"},
    {"ticker": "TER", "name": "Teradyne", "sector": "Technology", "industry": "Semiconductor Materials & Equipment"},
    {"ticker": "ADI", "name": "Analog Devices", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "AMD", "name": "Advanced Micro Devices", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "AVGO", "name": "Broadcom", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "FSLR", "name": "First Solar", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "INTC", "name": "Intel", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "MCHP", "name": "Microchip Technology", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "MPWR", "name": "Monolithic Power Systems", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "MRVL", "name": "Marvell Technology", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "MU", "name": "Micron Technology", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "NVDA", "name": "Nvidia", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "NXPI", "name": "NXP Semiconductors", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "ON", "name": "ON Semiconductor", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "QCOM", "name": "Qualcomm", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "SWKS", "name": "Skyworks Solutions", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "TXN", "name": "Texas Instruments", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "CRWD", "name": "CrowdStrike", "sector": "Technology", "industry": "Systems Software"},
    {"ticker": "FTNT", "name": "Fortinet", "sector": "Technology", "industry": "Systems Software"},
    {"ticker": "GEN", "name": "Gen Digital", "sector": "Technology", "industry": "Systems Software"},
    {"ticker": "MSFT", "name": "Microsoft", "sector": "Technology", "industry": "Systems Software"},
    {"ticker": "NOW", "name": "ServiceNow", "sector": "Technology", "industry": "Systems Software"},
    {"ticker": "PANW", "name": "Palo Alto Networks", "sector": "Technology", "industry": "Systems Software"},
    {"ticker": "CDW", "name": "CDW Corporation", "sector": "Technology", "industry": "Technology Distributors"},
    {"ticker": "AAPL", "name": "Apple Inc.", "sector": "Technology", "industry": "Technology Hardware, Storage & Peripherals"},
    {"ticker": "DELL", "name": "Dell Technologies", "sector": "Technology", "industry": "Technology Hardware, Storage & Peripherals"},
    {"ticker": "HPE", "name": "Hewlett Packard Enterprise", "sector": "Technology", "industry": "Technology Hardware, Storage & Peripherals"},
    {"ticker": "HPQ", "name": "HP Inc.", "sector": "Technology", "industry": "Technology Hardware, Storage & Peripherals"},
    {"ticker": "NTAP", "name": "NetApp", "sector": "Technology", "industry": "Technology Hardware, Storage & Peripherals"},
    {"ticker": "SMCI", "name": "Supermicro", "sector": "Technology", "industry": "Technology Hardware, Storage & Peripherals"},
    {"ticker": "SNDK", "name": "Sandisk", "sector": "Technology", "industry": "Technology Hardware, Storage & Peripherals"},
    {"ticker": "STX", "name": "Seagate Technology", "sector": "Technology", "industry": "Technology Hardware, Storage & Peripherals"},
    {"ticker": "WDC", "name": "Western Digital", "sector": "Technology", "industry": "Technology Hardware, Storage & Peripherals"},
    # ──── Utilities ────
    {"ticker": "AEP", "name": "American Electric Power", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "CEG", "name": "Constellation Energy", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "DUK", "name": "Duke Energy", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "EIX", "name": "Edison International", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "ES", "name": "Eversource Energy", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "ETR", "name": "Entergy", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "EVRG", "name": "Evergy", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "EXC", "name": "Exelon", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "FE", "name": "FirstEnergy", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "LNT", "name": "Alliant Energy", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "PEG", "name": "Public Service Enterprise Group", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "PPL", "name": "PPL Corporation", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "SO", "name": "Southern Company", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "VST", "name": "Vistra Corp.", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "WEC", "name": "WEC Energy Group", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "ATO", "name": "Atmos Energy", "sector": "Utilities", "industry": "Gas Utilities"},
    {"ticker": "AES", "name": "AES Corporation", "sector": "Utilities", "industry": "Independent Power Producers & Energy Traders"},
    {"ticker": "NRG", "name": "NRG Energy", "sector": "Utilities", "industry": "Independent Power Producers & Energy Traders"},
    {"ticker": "AEE", "name": "Ameren", "sector": "Utilities", "industry": "Multi-Utilities"},
    {"ticker": "CMS", "name": "CMS Energy", "sector": "Utilities", "industry": "Multi-Utilities"},
    {"ticker": "CNP", "name": "CenterPoint Energy", "sector": "Utilities", "industry": "Multi-Utilities"},
    {"ticker": "D", "name": "Dominion Energy", "sector": "Utilities", "industry": "Multi-Utilities"},
    {"ticker": "DTE", "name": "DTE Energy", "sector": "Utilities", "industry": "Multi-Utilities"},
    {"ticker": "ED", "name": "Consolidated Edison", "sector": "Utilities", "industry": "Multi-Utilities"},
    {"ticker": "NEE", "name": "NextEra Energy", "sector": "Utilities", "industry": "Multi-Utilities"},
    {"ticker": "NI", "name": "NiSource", "sector": "Utilities", "industry": "Multi-Utilities"},
    {"ticker": "PCG", "name": "PG&E Corporation", "sector": "Utilities", "industry": "Multi-Utilities"},
    {"ticker": "PNW", "name": "Pinnacle West Capital", "sector": "Utilities", "industry": "Multi-Utilities"},
    {"ticker": "SRE", "name": "Sempra", "sector": "Utilities", "industry": "Multi-Utilities"},
    {"ticker": "XEL", "name": "Xcel Energy", "sector": "Utilities", "industry": "Multi-Utilities"},
    {"ticker": "AWK", "name": "American Water Works", "sector": "Utilities", "industry": "Water Utilities"},

    # ── ETFs (not individual companies, kept for the quick-analysis search) ──
    {"ticker": "SPY",   "name": "S&P 500 ETF",        "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "QQQ",   "name": "Nasdaq 100 ETF",     "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "VTI",   "name": "Total Market ETF",   "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "GLD",   "name": "Gold ETF",           "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "ARKK",  "name": "ARK Innovation ETF", "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "IWM",   "name": "Russell 2000 ETF",   "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "XLK",   "name": "Tech Sector ETF",    "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "XLF",   "name": "Financial ETF",      "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "XLV",   "name": "Healthcare ETF",     "sector": "ETF",                     "industry": "ETF"},
    {"ticker": "XLE",   "name": "Energy ETF",         "sector": "ETF",                     "industry": "ETF"},

    # ── High-growth / speculative — real companies genuinely outside the S&P 500
    # (foreign ADRs, recent IPOs, not-yet-index-eligible) — kept so the quick-
    # analysis search and Oportunidades can still surface them.
    {"ticker": "NET",   "name": "Cloudflare",         "sector": "Technology",             "industry": "Software - Infrastructure"},
    {"ticker": "SHOP",  "name": "Shopify",            "sector": "Technology",             "industry": "Software - Application"},
    {"ticker": "SNOW",  "name": "Snowflake",          "sector": "Technology",             "industry": "Software - Application"},
    {"ticker": "TSM",   "name": "TSMC",               "sector": "Technology",             "industry": "Semiconductors"},
    {"ticker": "ARM",   "name": "Arm Holdings",       "sector": "Technology",             "industry": "Semiconductors"},
    {"ticker": "ENPH",  "name": "Enphase Energy",     "sector": "Technology",             "industry": "Solar"},
    {"ticker": "SNAP",  "name": "Snap",               "sector": "Communication Services", "industry": "Internet Content & Information"},
    {"ticker": "PINS",  "name": "Pinterest",          "sector": "Communication Services", "industry": "Internet Content & Information"},
    {"ticker": "RBLX",  "name": "Roblox",             "sector": "Communication Services", "industry": "Electronic Gaming & Multimedia"},
    {"ticker": "SPOT",  "name": "Spotify",            "sector": "Communication Services", "industry": "Entertainment"},
    {"ticker": "MELI",  "name": "MercadoLibre",       "sector": "Consumer Discretionary", "industry": "Internet Retail"},
    {"ticker": "BABA",  "name": "Alibaba",            "sector": "Consumer Discretionary", "industry": "Internet Retail"},
    {"ticker": "RIVN",  "name": "Rivian",             "sector": "Consumer Discretionary", "industry": "Auto Manufacturers"},
    {"ticker": "NVO",   "name": "Novo Nordisk",       "sector": "Healthcare",              "industry": "Drug Manufacturers - General"},
    {"ticker": "AZN",   "name": "AstraZeneca",        "sector": "Healthcare",              "industry": "Drug Manufacturers - General"},
    {"ticker": "BE",    "name": "Bloom Energy",       "sector": "Industrials",             "industry": "Electrical Equipment & Parts"},
    {"ticker": "PLUG",  "name": "Plug Power",         "sector": "Industrials",             "industry": "Electrical Equipment & Parts"},
    {"ticker": "RUN",   "name": "Sunrun",             "sector": "Industrials",             "industry": "Solar"},
    {"ticker": "NOVA",  "name": "Sunnova Energy",     "sector": "Industrials",             "industry": "Solar"},
    {"ticker": "IONQ",  "name": "IonQ",               "sector": "Technology",              "industry": "Computer Hardware"},
    {"ticker": "RGTI",  "name": "Rigetti Computing",  "sector": "Technology",              "industry": "Computer Hardware"},
    {"ticker": "AI",    "name": "C3.ai",              "sector": "Technology",              "industry": "Software - Application"},
    {"ticker": "BBAI",  "name": "BigBear.ai",         "sector": "Technology",              "industry": "Software - Application"},
    {"ticker": "AFRM",  "name": "Affirm",             "sector": "Financials",              "industry": "Credit Services"},
    {"ticker": "UPST",  "name": "Upstart",            "sector": "Financials",              "industry": "Credit Services"},
    {"ticker": "SOFI",  "name": "SoFi Technologies",  "sector": "Financials",              "industry": "Credit Services"},
    {"ticker": "RKLB",  "name": "Rocket Lab",         "sector": "Industrials",             "industry": "Aerospace & Defense"},
    {"ticker": "JOBY",  "name": "Joby Aviation",      "sector": "Industrials",             "industry": "Aerospace & Defense"},
    {"ticker": "ACHR",  "name": "Archer Aviation",    "sector": "Industrials",             "industry": "Aerospace & Defense"},
    {"ticker": "RXRX",  "name": "Recursion Pharma",   "sector": "Healthcare",              "industry": "Biotechnology"},
    {"ticker": "BEAM",  "name": "Beam Therapeutics",  "sector": "Healthcare",              "industry": "Biotechnology"},
    {"ticker": "NTLA",  "name": "Intellia Therapeutics","sector": "Healthcare",            "industry": "Biotechnology"},
    {"ticker": "HIMS",  "name": "Hims & Hers Health", "sector": "Healthcare",              "industry": "Health Information Services"},
    {"ticker": "CELH",  "name": "Celsius Holdings",   "sector": "Consumer Staples",        "industry": "Beverages - Non-Alcoholic"},
    {"ticker": "DUOL",  "name": "Duolingo",           "sector": "Technology",              "industry": "Software - Application"},
    {"ticker": "CAVA",  "name": "CAVA Group",         "sector": "Consumer Discretionary",  "industry": "Restaurants"},
    {"ticker": "RDDT",  "name": "Reddit",             "sector": "Communication Services",  "industry": "Internet Content & Information"},
    {"ticker": "MSTR",  "name": "MicroStrategy",      "sector": "Technology",              "industry": "Software - Application"},
    {"ticker": "MARA",  "name": "MARA Holdings",      "sector": "Financials",              "industry": "Capital Markets"},

    # ════════════════════════════════════════════════════════════════════
    # S&P 400 MidCap expansion (Diego, 2026-08-19: "expandirnos a más
    # empresas de las que ya están" — mid-caps/extended Nasdaq beyond the
    # S&P 500 above). Wikipedia's "List of S&P 400 companies" for tickers/
    # GICS sector+sub-industry, but every ticker below was cross-checked
    # against a live Finnhub company-profile lookup (name overwritten with
    # Finnhub's own, ticker dropped if it didn't resolve at all) rather than
    # trusting the Wikipedia transcription outright — that pass caught and
    # fixed several real transcription errors (e.g. a truncated "PNF" that
    # should have been "PNFP"). GICS sector labels mapped onto this file's
    # existing labels the same way the S&P 500 list above already does
    # (Information Technology -> Technology, Health Care -> Healthcare).
    # Same cost-scaling reasoning as the S&P 500 expansion's own comment at
    # the top of this file applies here too — AI enrichment cost stays flat
    # (bounded by _MAX_PER_SECTOR × sector count in undervalued_screener_
    # service.py, not raw universe size); only the deterministic per-ticker
    # scan (Finnhub/FMP/yfinance calls, already bounded-concurrency) scales
    # with this. Regenerate/re-verify periodically, same as the S&P 500 list.
    # ════════════════════════════════════════════════════════════════════
    # ──── Communication Services (S&P 400 MidCap) ────
    {"ticker": "NXST", "name": "Nexstar Media Group Inc", "sector": "Communication Services", "industry": "Broadcasting"},
    {"ticker": "NYT", "name": "New York Times Co", "sector": "Communication Services", "industry": "Publishing"},
    {"ticker": "ROKU", "name": "Roku Inc", "sector": "Communication Services", "industry": "Movies & Entertainment"},
    {"ticker": "SIRI", "name": "Sirius XM Holdings Inc", "sector": "Communication Services", "industry": "Broadcasting"},
    {"ticker": "ZETA", "name": "Zeta Global Holdings Corp", "sector": "Communication Services", "industry": "Internet Services & Infrastructure"},
    # ──── Consumer Discretionary (S&P 400 MidCap) ────
    {"ticker": "ALV", "name": "Autoliv Inc", "sector": "Consumer Discretionary", "industry": "Automotive Parts & Equipment"},
    {"ticker": "AN", "name": "AutoNation Inc", "sector": "Consumer Discretionary", "industry": "Automotive Retail"},
    {"ticker": "ANF", "name": "Abercrombie & Fitch Co", "sector": "Consumer Discretionary", "industry": "Apparel Retail"},
    {"ticker": "ARMK", "name": "Aramark", "sector": "Consumer Discretionary", "industry": "Distributors"},
    {"ticker": "BBWI", "name": "Bath & Body Works Inc", "sector": "Consumer Discretionary", "industry": "Other Specialty Retail"},
    {"ticker": "BC", "name": "Brunswick Corp", "sector": "Consumer Discretionary", "industry": "Leisure Products"},
    {"ticker": "BROS", "name": "Dutch Bros Inc", "sector": "Consumer Discretionary", "industry": "Restaurants"},
    {"ticker": "BURL", "name": "Burlington Stores Inc", "sector": "Consumer Discretionary", "industry": "Apparel Retail"},
    {"ticker": "BWA", "name": "Borgwarner Inc", "sector": "Consumer Discretionary", "industry": "Automotive Parts & Equipment"},
    {"ticker": "BYD", "name": "Boyd Gaming Corp", "sector": "Consumer Discretionary", "industry": "Casinos & Gaming"},
    {"ticker": "CHDN", "name": "Churchill Downs Inc", "sector": "Consumer Discretionary", "industry": "Casinos & Gaming"},
    {"ticker": "CHH", "name": "Choice Hotels International Inc", "sector": "Consumer Discretionary", "industry": "Hotels, Resorts & Cruise Lines"},
    {"ticker": "CHWY", "name": "Chewy Inc", "sector": "Consumer Discretionary", "industry": "Other Specialty Retail"},
    {"ticker": "COLM", "name": "Columbia Sportswear Co", "sector": "Consumer Discretionary", "industry": "Apparel, Accessories & Luxury Goods"},
    {"ticker": "CPRI", "name": "Capri Holdings Ltd", "sector": "Consumer Discretionary", "industry": "Apparel, Accessories & Luxury Goods"},
    {"ticker": "CROX", "name": "Crocs Inc", "sector": "Consumer Discretionary", "industry": "Footwear"},
    {"ticker": "DKS", "name": "DICK'S Sporting Goods Inc", "sector": "Consumer Discretionary", "industry": "Specialty Stores"},
    {"ticker": "FIVE", "name": "Five Below Inc", "sector": "Consumer Discretionary", "industry": "Specialty Stores"},
    {"ticker": "FND", "name": "Floor & Decor Holdings Inc", "sector": "Consumer Discretionary", "industry": "Home Improvement Retail"},
    {"ticker": "GAP", "name": "Gap Inc", "sector": "Consumer Discretionary", "industry": "Apparel Retail"},
    {"ticker": "GHC", "name": "Graham Holdings Co", "sector": "Consumer Discretionary", "industry": "Education Services"},
    {"ticker": "GME", "name": "GameStop Corp", "sector": "Consumer Discretionary", "industry": "Computer & Electronics Retail"},
    {"ticker": "GNTX", "name": "Gentex Corp", "sector": "Consumer Discretionary", "industry": "Automotive Parts & Equipment"},
    {"ticker": "H", "name": "Hyatt Hotels Corp", "sector": "Consumer Discretionary", "industry": "Hotels, Resorts & Cruise Lines"},
    {"ticker": "HGV", "name": "Hilton Grand Vacations Inc", "sector": "Consumer Discretionary", "industry": "Hotels, Resorts & Cruise Lines"},
    {"ticker": "HOG", "name": "Harley-Davidson Inc", "sector": "Consumer Discretionary", "industry": "Motorcycle Manufacturers"},
    {"ticker": "HRB", "name": "H & R Block Inc", "sector": "Consumer Discretionary", "industry": "Specialized Consumer Services"},
    {"ticker": "KBH", "name": "KB Home", "sector": "Consumer Discretionary", "industry": "Homebuilding"},
    {"ticker": "LAD", "name": "Lithia Motors Inc", "sector": "Consumer Discretionary", "industry": "Automotive Retail"},
    {"ticker": "LEA", "name": "Lear Corp", "sector": "Consumer Discretionary", "industry": "Automotive Parts & Equipment"},
    {"ticker": "LOPE", "name": "Grand Canyon Education Inc", "sector": "Consumer Discretionary", "industry": "Education Services"},
    {"ticker": "M", "name": "Macy's Inc", "sector": "Consumer Discretionary", "industry": "Broadline Retail"},
    {"ticker": "MAT", "name": "Mattel Inc", "sector": "Consumer Discretionary", "industry": "Leisure Products"},
    {"ticker": "MTN", "name": "Vail Resorts Inc", "sector": "Consumer Discretionary", "industry": "Hotels, Resorts & Cruise Lines"},
    {"ticker": "MUSA", "name": "Murphy USA Inc", "sector": "Consumer Discretionary", "industry": "Automotive Retail"},
    {"ticker": "OLLI", "name": "Ollie's Bargain Outlet Holdings Inc", "sector": "Consumer Discretionary", "industry": "Broadline Retail"},
    {"ticker": "PAG", "name": "Penske Automotive Group Inc", "sector": "Consumer Discretionary", "industry": "Automotive Retail"},
    {"ticker": "PII", "name": "Polaris Inc", "sector": "Consumer Discretionary", "industry": "Leisure Products"},
    {"ticker": "PLNT", "name": "Planet Fitness Inc", "sector": "Consumer Discretionary", "industry": "Specialty Stores"},
    {"ticker": "PVH", "name": "PVH Corp", "sector": "Consumer Discretionary", "industry": "Apparel, Accessories & Luxury Goods"},
    {"ticker": "RH", "name": "RH", "sector": "Consumer Discretionary", "industry": "Homefurnishing Retail"},
    {"ticker": "SCI", "name": "Service Corporation International", "sector": "Consumer Discretionary", "industry": "Specialized Consumer Services"},
    {"ticker": "SN", "name": "Sharkninja Inc", "sector": "Consumer Discretionary", "industry": "Household Appliances"},
    {"ticker": "THO", "name": "Thor Industries Inc", "sector": "Consumer Discretionary", "industry": "Leisure Products"},
    {"ticker": "TNL", "name": "Travel + Leisure Co", "sector": "Consumer Discretionary", "industry": "Hotels, Resorts & Cruise Lines"},
    {"ticker": "TOL", "name": "Toll Brothers Inc", "sector": "Consumer Discretionary", "industry": "Homebuilding"},
    {"ticker": "TXRH", "name": "Texas Roadhouse Inc", "sector": "Consumer Discretionary", "industry": "Restaurants"},
    {"ticker": "VC", "name": "Visteon Corp", "sector": "Consumer Discretionary", "industry": "Automotive Parts & Equipment"},
    {"ticker": "VFC", "name": "VF Corp", "sector": "Consumer Discretionary", "industry": "Apparel, Accessories & Luxury Goods"},
    {"ticker": "WEYS", "name": "WEYCO Group Inc", "sector": "Consumer Discretionary", "industry": "Footwear"},
    # ──── Consumer Staples (S&P 400 MidCap) ────
    {"ticker": "ACI", "name": "Albertsons Companies Inc", "sector": "Consumer Staples", "industry": "Food Retail"},
    {"ticker": "BJ", "name": "BJ's Wholesale Club Holdings Inc", "sector": "Consumer Staples", "industry": "Consumer Staples Merchandise Retail"},
    {"ticker": "CART", "name": "Maplebear Inc", "sector": "Consumer Staples", "industry": "Food Retail"},
    {"ticker": "COKE", "name": "Coca-Cola Consolidated Inc", "sector": "Consumer Staples", "industry": "Soft Drinks & Non-alcoholic Beverages"},
    {"ticker": "DAR", "name": "Darling Ingredients Inc", "sector": "Consumer Staples", "industry": "Agricultural Products & Services"},
    {"ticker": "ELF", "name": "elf Beauty Inc", "sector": "Consumer Staples", "industry": "Personal Care Products"},
    {"ticker": "INGR", "name": "Ingredion Inc", "sector": "Consumer Staples", "industry": "Agricultural Products & Services"},
    {"ticker": "PFGC", "name": "Performance Food Group Co", "sector": "Consumer Staples", "industry": "Food Distributors"},
    {"ticker": "POST", "name": "Post Holdings Inc", "sector": "Consumer Staples", "industry": "Packaged Foods & Meats"},
    {"ticker": "PPC", "name": "Pilgrims Pride Corp", "sector": "Consumer Staples", "industry": "Packaged Foods & Meats"},
    {"ticker": "SAM", "name": "Boston Beer Company Inc", "sector": "Consumer Staples", "industry": "Brewers"},
    {"ticker": "SFM", "name": "Sprouts Farmers Market Inc", "sector": "Consumer Staples", "industry": "Food Retail"},
    {"ticker": "USFD", "name": "US Foods Holding Corp", "sector": "Consumer Staples", "industry": "Food Distributors"},
    {"ticker": "WMK", "name": "Weis Markets Inc", "sector": "Consumer Staples", "industry": "Food Retail"},
    # ──── Energy (S&P 400 MidCap) ────
    {"ticker": "AM", "name": "Antero Midstream Corp", "sector": "Energy", "industry": "Oil & Gas Storage & Transportation"},
    {"ticker": "AR", "name": "Antero Resources Corp", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "CHRD", "name": "Chord Energy Corp", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "CNX", "name": "CNX Resources Corp", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "DINO", "name": "HF Sinclair Corp", "sector": "Energy", "industry": "Oil & Gas Refining & Marketing"},
    {"ticker": "DTM", "name": "DT Midstream Inc", "sector": "Energy", "industry": "Oil & Gas Storage & Transportation"},
    {"ticker": "FTI", "name": "TechnipFMC PLC", "sector": "Energy", "industry": "Oil & Gas Equipment & Services"},
    {"ticker": "MTDR", "name": "Matador Resources Co", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "MUR", "name": "Murphy Oil Corp", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "NOV", "name": "Nov Inc", "sector": "Energy", "industry": "Oil & Gas Equipment & Services"},
    {"ticker": "OVV", "name": "Ovintiv Inc", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "PBF", "name": "PBF Energy Inc", "sector": "Energy", "industry": "Oil & Gas Refining & Marketing"},
    {"ticker": "PR", "name": "Permian Resources Corp", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "RRC", "name": "Range Resources Corp", "sector": "Energy", "industry": "Oil & Gas Exploration & Production"},
    {"ticker": "VAL", "name": "Valaris Ltd", "sector": "Energy", "industry": "Oil & Gas Drilling"},
    {"ticker": "VNOM", "name": "Viper Energy Inc", "sector": "Energy", "industry": "Oil & Gas Storage & Transportation"},
    # ──── Financials (S&P 400 MidCap) ────
    {"ticker": "AFG", "name": "American Financial Group Inc", "sector": "Financials", "industry": "Multi-line Insurance"},
    {"ticker": "ALLY", "name": "Ally Financial Inc", "sector": "Financials", "industry": "Consumer Finance"},
    {"ticker": "AMG", "name": "Affiliated Managers Group Inc", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "ASB", "name": "Associated Banc-Corp", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "BHF", "name": "Brighthouse Financial Inc", "sector": "Financials", "industry": "Life & Health Insurance"},
    {"ticker": "CBSH", "name": "Commerce Bancshares Inc", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "CFR", "name": "Cullen/Frost Bankers Inc", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "CG", "name": "Carlyle Group Inc", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "CNO", "name": "CNO Financial Group Inc", "sector": "Financials", "industry": "Life & Health Insurance"},
    {"ticker": "COLB", "name": "Columbia Banking System Inc", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "CRBG", "name": "Corebridge Financial Inc", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "EEFT", "name": "Euronet Worldwide Inc", "sector": "Financials", "industry": "Transaction & Payment Processing Services"},
    {"ticker": "EQH", "name": "Equitable Holdings Inc", "sector": "Financials", "industry": "Diversified Financial Services"},
    {"ticker": "ESNT", "name": "Essent Group Ltd", "sector": "Financials", "industry": "Commercial & Residential Mortgage Finance"},
    {"ticker": "EVR", "name": "Evercore Inc", "sector": "Financials", "industry": "Investment Banking & Brokerage"},
    {"ticker": "EWBC", "name": "East West Bancorp Inc", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "FAF", "name": "First American Financial Corp", "sector": "Financials", "industry": "Property & Casualty Insurance"},
    {"ticker": "FCFS", "name": "Firstcash Holdings Inc", "sector": "Financials", "industry": "Consumer Finance"},
    {"ticker": "FFIN", "name": "First Financial Bankshares Inc", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "FHI", "name": "Federated Hermes Inc", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "FHN", "name": "First Horizon Corp", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "FLG", "name": "Flagstar Bank NA", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "FNB", "name": "FNB Corp", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "FNF", "name": "Fidelity National Financial Inc", "sector": "Financials", "industry": "Property & Casualty Insurance"},
    {"ticker": "FOUR", "name": "Shift4 Payments, Inc", "sector": "Financials", "industry": "Transaction & Payment Processing Services"},
    {"ticker": "GBCI", "name": "Glacier Bancorp Inc", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "HLI", "name": "Houlihan Lokey Inc", "sector": "Financials", "industry": "Investment Banking & Brokerage"},
    {"ticker": "HLNE", "name": "Hamilton Lane Inc", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "HOMB", "name": "Home BancShares Inc", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "HWC", "name": "Hancock Whitney Corp", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "IBOC", "name": "International Bancshares Corp", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "JEF", "name": "Jefferies Financial Group Inc", "sector": "Financials", "industry": "Multi-Sector Holdings"},
    {"ticker": "KNSL", "name": "Kinsale Capital Group Inc", "sector": "Financials", "industry": "Property & Casualty Insurance"},
    {"ticker": "MORN", "name": "Morningstar Inc", "sector": "Financials", "industry": "Financial Exchanges & Data"},
    {"ticker": "MTG", "name": "MGIC Investment Corp", "sector": "Financials", "industry": "Reinsurance"},
    {"ticker": "NLY", "name": "Annaly Capital Management Inc", "sector": "Financials", "industry": "Mortgage REITs"},
    {"ticker": "ONB", "name": "Old National Bancorp", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "ORI", "name": "Old Republic International Corp", "sector": "Financials", "industry": "Property & Casualty Insurance"},
    {"ticker": "OZK", "name": "Bank Ozk", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "PB", "name": "Prosperity Bancshares, Inc", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "PNFP", "name": "Pinnacle Financial Partners Inc", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "PRI", "name": "Primerica Inc", "sector": "Financials", "industry": "Life & Health Insurance"},
    {"ticker": "RGA", "name": "Reinsurance Group of America Inc", "sector": "Financials", "industry": "Reinsurance"},
    {"ticker": "RLI", "name": "RLI Corp", "sector": "Financials", "industry": "Property & Casualty Insurance"},
    {"ticker": "RNR", "name": "Renaissancere Holdings Ltd", "sector": "Financials", "industry": "Reinsurance"},
    {"ticker": "RYAN", "name": "Ryan Specialty Holdings Inc", "sector": "Financials", "industry": "Insurance Brokers"},
    {"ticker": "SEIC", "name": "SEI Investments Co", "sector": "Financials", "industry": "Asset Management & Custody Banks"},
    {"ticker": "SF", "name": "Stifel Financial Corp", "sector": "Financials", "industry": "Investment Banking & Brokerage"},
    {"ticker": "SIGI", "name": "Selective Insurance Group Inc", "sector": "Financials", "industry": "Property & Casualty Insurance"},
    {"ticker": "SLM", "name": "SLM Corp", "sector": "Financials", "industry": "Consumer Finance"},
    {"ticker": "SSB", "name": "SouthState Bank Corp", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "STWD", "name": "Starwood Property Trust Inc", "sector": "Financials", "industry": "Mortgage REITs"},
    {"ticker": "TCBI", "name": "Texas Capital Bancshares Inc", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "THG", "name": "Hanover Insurance Group Inc", "sector": "Financials", "industry": "Property & Casualty Insurance"},
    {"ticker": "TOST", "name": "Toast Inc", "sector": "Financials", "industry": "Transaction & Payment Processing Services"},
    {"ticker": "UBSI", "name": "United Bankshares Inc", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "UMBF", "name": "UMB Financial Corp", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "UNM", "name": "Unum Group", "sector": "Financials", "industry": "Life & Health Insurance"},
    {"ticker": "VLY", "name": "Valley National Bancorp", "sector": "Financials", "industry": "Regional Banks"},
    {"ticker": "WTFC", "name": "Wintrust Financial Corp", "sector": "Financials", "industry": "Regional Banks"},
    # ──── Healthcare (S&P 400 MidCap) ────
    {"ticker": "ARWR", "name": "Arrowhead Pharmaceuticals Inc", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "AVTR", "name": "Avantor Inc", "sector": "Healthcare", "industry": "Life Sciences Tools & Services"},
    {"ticker": "BIO", "name": "Bio Rad Laboratories Inc", "sector": "Healthcare", "industry": "Life Sciences Tools & Services"},
    {"ticker": "BMRN", "name": "BioMarin Pharmaceutical Inc", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "BRKR", "name": "Bruker Corp", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "BTSG", "name": "Brightspring Health Services Inc", "sector": "Healthcare", "industry": "Health Care Services"},
    {"ticker": "CHE", "name": "Chemed Corp", "sector": "Healthcare", "industry": "Health Care Services"},
    {"ticker": "CYTK", "name": "Cytokinetics Inc", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "DOCS", "name": "Doximity Inc", "sector": "Healthcare", "industry": "Health Care Technology"},
    {"ticker": "EHC", "name": "Encompass Health Corp", "sector": "Healthcare", "industry": "Health Care Facilities"},
    {"ticker": "ELAN", "name": "Elanco Animal Health Inc", "sector": "Healthcare", "industry": "Pharmaceuticals"},
    {"ticker": "ENSG", "name": "Ensign Group Inc", "sector": "Healthcare", "industry": "Health Care Facilities"},
    {"ticker": "EXEL", "name": "Exelixis Inc", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "GMED", "name": "Globus Medical Inc", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "HAE", "name": "Haemonetics Corp", "sector": "Healthcare", "industry": "Health Care Supplies"},
    {"ticker": "HALO", "name": "Halozyme Therapeutics Inc", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "HQY", "name": "Healthequity Inc", "sector": "Healthcare", "industry": "Managed Health Care"},
    {"ticker": "ILMN", "name": "Illumina Inc", "sector": "Healthcare", "industry": "Life Sciences Tools & Services"},
    {"ticker": "JAZZ", "name": "Jazz Pharmaceuticals PLC", "sector": "Healthcare", "industry": "Pharmaceuticals"},
    {"ticker": "KRYS", "name": "Krystal Biotech Inc", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "LIVN", "name": "LivaNova PLC", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "LNTH", "name": "Lantheus Holdings Inc", "sector": "Healthcare", "industry": "Health Care Supplies"},
    {"ticker": "MEDP", "name": "Medpace Holdings Inc", "sector": "Healthcare", "industry": "Life Sciences Tools & Services"},
    {"ticker": "MOH", "name": "Molina Healthcare Inc", "sector": "Healthcare", "industry": "Managed Health Care"},
    {"ticker": "NBIX", "name": "Neurocrine Biosciences Inc", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "NVST", "name": "Envista Holdings Corp", "sector": "Healthcare", "industry": "Health Care Supplies"},
    {"ticker": "OPCH", "name": "Option Care Health Inc", "sector": "Healthcare", "industry": "Health Care Facilities"},
    {"ticker": "PEN", "name": "Penumbra Inc", "sector": "Healthcare", "industry": "Health Care Equipment"},
    {"ticker": "RGEN", "name": "Repligen Corp", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "ROIV", "name": "Roivant Sciences Ltd", "sector": "Healthcare", "industry": "Biotechnology"},
    {"ticker": "SHC", "name": "Sotera Health Co", "sector": "Healthcare", "industry": "Health Care Services"},
    {"ticker": "THC", "name": "Tenet Healthcare Corp", "sector": "Healthcare", "industry": "Health Care Facilities"},
    {"ticker": "UTHR", "name": "United Therapeutics Corp", "sector": "Healthcare", "industry": "Biotechnology"},
    # ──── Industrials (S&P 400 MidCap) ────
    {"ticker": "AAL", "name": "American Airlines Group Inc", "sector": "Industrials", "industry": "Passenger Airlines"},
    {"ticker": "AAON", "name": "Aaon Inc", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "ACM", "name": "AECOM", "sector": "Industrials", "industry": "Construction & Engineering"},
    {"ticker": "AGCO", "name": "AGCO Corp", "sector": "Industrials", "industry": "Agricultural & Farm Machinery"},
    {"ticker": "AIT", "name": "Applied Industrial Technologies Inc", "sector": "Industrials", "industry": "Trading Companies & Distributors"},
    {"ticker": "ALK", "name": "Alaska Air Group Inc", "sector": "Industrials", "industry": "Passenger Airlines"},
    {"ticker": "ALSN", "name": "Allison Transmission Holdings Inc", "sector": "Industrials", "industry": "Construction Machinery & Heavy Transportation Equipment"},
    {"ticker": "APG", "name": "APi Group Corp", "sector": "Industrials", "industry": "Construction & Engineering"},
    {"ticker": "ATI", "name": "ATI Inc", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "AVAV", "name": "AeroVironment Inc", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "AYI", "name": "Acuity Inc", "sector": "Industrials", "industry": "Electrical Components & Equipment"},
    {"ticker": "BAH", "name": "Booz Allen Hamilton Holding Corp", "sector": "Industrials", "industry": "Research & Consulting Services"},
    {"ticker": "BCO", "name": "Brinks Co", "sector": "Industrials", "industry": "Security & Alarm Services"},
    {"ticker": "BWXT", "name": "BWX Technologies Inc", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "CACI", "name": "CACI International Inc", "sector": "Industrials", "industry": "Diversified Support Services"},
    {"ticker": "CAR", "name": "Avis Budget Group Inc", "sector": "Industrials", "industry": "Passenger Ground Transportation"},
    {"ticker": "CLH", "name": "Clean Harbors Inc", "sector": "Industrials", "industry": "Environmental & Facilities Services"},
    {"ticker": "CNH", "name": "CNH Industrial NV", "sector": "Industrials", "industry": "Agricultural & Farm Machinery"},
    {"ticker": "CNM", "name": "Core & Main Inc", "sector": "Industrials", "industry": "Trading Companies & Distributors"},
    {"ticker": "CR", "name": "Crane Co", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "CRS", "name": "Carpenter Technology Corp", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "CSL", "name": "Carlisle Companies Inc", "sector": "Industrials", "industry": "Industrial Conglomerates"},
    {"ticker": "CW", "name": "Curtiss-Wright Corp", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "DCI", "name": "Donaldson Company Inc", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "DY", "name": "Dycom Industries Inc", "sector": "Industrials", "industry": "Construction & Engineering"},
    {"ticker": "ENS", "name": "EnerSys", "sector": "Industrials", "industry": "Electrical Components & Equipment"},
    {"ticker": "ESAB", "name": "ESAB Corp", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "EXLS", "name": "Exlservice Holdings Inc", "sector": "Industrials", "industry": "Data Processing & Outsourced Services"},
    {"ticker": "EXPO", "name": "Exponent Inc", "sector": "Industrials", "industry": "Research & Consulting Services"},
    {"ticker": "FBIN", "name": "Fortune Brands Innovations Inc", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "FCN", "name": "FTI Consulting Inc", "sector": "Industrials", "industry": "Research & Consulting Services"},
    {"ticker": "FLR", "name": "Fluor Corp", "sector": "Industrials", "industry": "Construction & Engineering"},
    {"ticker": "FLS", "name": "Flowserve Corp", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "G", "name": "Genpact Ltd", "sector": "Industrials", "industry": "Data Processing & Outsourced Services"},
    {"ticker": "GATX", "name": "GATX Corp", "sector": "Industrials", "industry": "Construction Machinery & Heavy Transportation Equipment"},
    {"ticker": "GGG", "name": "Graco Inc", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "GXO", "name": "GXO Logistics Inc", "sector": "Industrials", "industry": "Air Freight & Logistics"},
    {"ticker": "HXL", "name": "Hexcel Corp", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "IESC", "name": "IES Holdings Inc", "sector": "Industrials", "industry": "Construction & Engineering"},
    {"ticker": "ITT", "name": "ITT Inc", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "KBR", "name": "KBR Inc", "sector": "Industrials", "industry": "Diversified Support Services"},
    {"ticker": "KEX", "name": "Kirby Corp", "sector": "Industrials", "industry": "Marine Transportation"},
    {"ticker": "KNX", "name": "Knight-Swift Transportation Holdings Inc", "sector": "Industrials", "industry": "Cargo Ground Transportation"},
    {"ticker": "KTOS", "name": "Kratos Defense and Security Solutions Inc", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "LECO", "name": "Lincoln Electric Holdings Inc", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "LPX", "name": "Louisiana-Pacific Corp", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "LSTR", "name": "Landstar System Inc", "sector": "Industrials", "industry": "Cargo Ground Transportation"},
    {"ticker": "MIDD", "name": "Middleby Corp", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "MLI", "name": "Mueller Industries Inc", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "MMS", "name": "Maximus Inc", "sector": "Industrials", "industry": "Data Processing & Outsourced Services"},
    {"ticker": "MSA", "name": "MSA Safety Inc", "sector": "Industrials", "industry": "Office Services & Supplies"},
    {"ticker": "MSM", "name": "MSC Industrial Direct Co Inc", "sector": "Industrials", "industry": "Trading Companies & Distributors"},
    {"ticker": "MTZ", "name": "MasTec Inc", "sector": "Industrials", "industry": "Construction & Engineering"},
    {"ticker": "NVT", "name": "nVent Electric PLC", "sector": "Industrials", "industry": "Electrical Components & Equipment"},
    {"ticker": "OC", "name": "Owens Corning", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "OSK", "name": "Oshkosh Corp", "sector": "Industrials", "industry": "Construction Machinery & Heavy Transportation Equipment"},
    {"ticker": "PCTY", "name": "Paylocity Holding Corp", "sector": "Industrials", "industry": "Human Resource & Employment Services"},
    {"ticker": "PSN", "name": "Parsons Corp", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "R", "name": "Ryder System Inc", "sector": "Industrials", "industry": "Cargo Ground Transportation"},
    {"ticker": "RBA", "name": "RB Global Inc", "sector": "Industrials", "industry": "Diversified Support Services"},
    {"ticker": "RBC", "name": "RBC Bearings Inc", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "RRX", "name": "Regal Rexnord Corp", "sector": "Industrials", "industry": "Electrical Components & Equipment"},
    {"ticker": "SAIA", "name": "Saia Inc", "sector": "Industrials", "industry": "Cargo Ground Transportation"},
    {"ticker": "SAIC", "name": "Science Applications International Corp", "sector": "Industrials", "industry": "Diversified Support Services"},
    {"ticker": "SARO", "name": "StandardAero, Inc.", "sector": "Industrials", "industry": "Aerospace & Defense"},
    {"ticker": "SPXC", "name": "SPX Technologies Inc", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "SSD", "name": "Simpson Manufacturing Co Inc", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "ST", "name": "Sensata Technologies Holding PLC", "sector": "Industrials", "industry": "Electrical Components & Equipment"},
    {"ticker": "STRL", "name": "Sterling Infrastructure Inc", "sector": "Industrials", "industry": "Construction & Engineering"},
    {"ticker": "TEX", "name": "Terex Corp", "sector": "Industrials", "industry": "Construction Machinery & Heavy Transportation Equipment"},
    {"ticker": "TKR", "name": "Timken Co", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "TREX", "name": "Trex Company Inc", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "TRU", "name": "TransUnion", "sector": "Industrials", "industry": "Research & Consulting Services"},
    {"ticker": "TTC", "name": "Toro Co", "sector": "Industrials", "industry": "Agricultural & Farm Machinery"},
    {"ticker": "TTEK", "name": "Tetra Tech Inc", "sector": "Industrials", "industry": "Construction & Engineering"},
    {"ticker": "UFPI", "name": "UFP Industries Inc", "sector": "Industrials", "industry": "Building Products"},
    {"ticker": "VMI", "name": "Valmont Industries Inc", "sector": "Industrials", "industry": "Industrial Machinery & Supplies & Components"},
    {"ticker": "WNC", "name": "Wabash National Corp", "sector": "Industrials", "industry": "Construction Machinery & Heavy Transportation Equipment"},
    {"ticker": "XPO", "name": "XPO Inc", "sector": "Industrials", "industry": "Air Freight & Logistics"},
    # ──── Materials (S&P 400 MidCap) ────
    {"ticker": "AA", "name": "Alcoa Corp", "sector": "Materials", "industry": "Aluminum"},
    {"ticker": "ASH", "name": "Ashland Inc", "sector": "Materials", "industry": "Diversified Chemicals"},
    {"ticker": "ATR", "name": "Aptargroup Inc", "sector": "Materials", "industry": "Metal, Glass & Plastic Containers"},
    {"ticker": "AVNT", "name": "Avient Corp", "sector": "Materials", "industry": "Specialty Chemicals"},
    {"ticker": "AXTA", "name": "Axalta Coating Systems Ltd", "sector": "Materials", "industry": "Specialty Chemicals"},
    {"ticker": "CBT", "name": "Cabot Corp", "sector": "Materials", "industry": "Diversified Chemicals"},
    {"ticker": "CCK", "name": "Crown Holdings Inc", "sector": "Materials", "industry": "Paper & Plastic Packaging Products & Materials"},
    {"ticker": "CDE", "name": "Coeur Mining, Inc", "sector": "Materials", "industry": "Gold"},
    {"ticker": "CLF", "name": "Cleveland-Cliffs Inc", "sector": "Materials", "industry": "Steel"},
    {"ticker": "CMC", "name": "Commercial Metals Co", "sector": "Materials", "industry": "Steel"},
    {"ticker": "EXP", "name": "Eagle Materials Inc", "sector": "Materials", "industry": "Construction Materials"},
    {"ticker": "GEF", "name": "Greif Inc", "sector": "Materials", "industry": "Metal, Glass & Plastic Containers"},
    {"ticker": "GPK", "name": "Graphic Packaging Holding Co", "sector": "Materials", "industry": "Paper & Plastic Packaging Products & Materials"},
    {"ticker": "HL", "name": "Hecla Mining Co", "sector": "Materials", "industry": "Silver"},
    {"ticker": "KNF", "name": "Knife River Corp", "sector": "Materials", "industry": "Construction Materials"},
    {"ticker": "MP", "name": "MP Materials Corp", "sector": "Materials", "industry": "Diversified Metals & Mining"},
    {"ticker": "NEU", "name": "NewMarket Corp", "sector": "Materials", "industry": "Specialty Chemicals"},
    {"ticker": "OLN", "name": "Olin Corp", "sector": "Materials", "industry": "Diversified Chemicals"},
    {"ticker": "RGLD", "name": "Royal Gold Inc", "sector": "Materials", "industry": "Gold"},
    {"ticker": "RPM", "name": "RPM International Inc", "sector": "Materials", "industry": "Specialty Chemicals"},
    {"ticker": "RS", "name": "Reliance Inc", "sector": "Materials", "industry": "Steel"},
    {"ticker": "SLGN", "name": "Silgan Holdings Inc", "sector": "Materials", "industry": "Metal, Glass & Plastic Containers"},
    {"ticker": "SMG", "name": "Scotts Miracle-Gro Co", "sector": "Materials", "industry": "Fertilizers & Agricultural Chemicals"},
    {"ticker": "SON", "name": "Sonoco Products Co", "sector": "Materials", "industry": "Paper & Plastic Packaging Products & Materials"},
    {"ticker": "WFG", "name": "West Fraser Timber Co Ltd", "sector": "Materials", "industry": "Paper & Plastic Packaging Products & Materials"},
    {"ticker": "WLK", "name": "Westlake Corp", "sector": "Materials", "industry": "Diversified Chemicals"},
    {"ticker": "WOR", "name": "Worthington Enterprises, Inc", "sector": "Materials", "industry": "Steel"},
    {"ticker": "WRK", "name": "WestRock Co", "sector": "Materials", "industry": "Paper & Plastic Packaging Products & Materials"},
    {"ticker": "X", "name": "United States Steel Corp", "sector": "Materials", "industry": "Steel"},
    # ──── Real Estate (S&P 400 MidCap) ────
    {"ticker": "ADC", "name": "Agree Realty Corp", "sector": "Real Estate", "industry": "Retail REITs"},
    {"ticker": "AHR", "name": "American Healthcare REIT Inc", "sector": "Real Estate", "industry": "Health Care REITs"},
    {"ticker": "AMH", "name": "American Homes 4 Rent", "sector": "Real Estate", "industry": "Single-Family Residential REITs"},
    {"ticker": "BRX", "name": "Brixmor Property Group Inc", "sector": "Real Estate", "industry": "Retail REITs"},
    {"ticker": "CDP", "name": "COPT Defense Properties", "sector": "Real Estate", "industry": "Office REITs"},
    {"ticker": "CTRE", "name": "CareTrust REIT Inc", "sector": "Real Estate", "industry": "Health Care REITs"},
    {"ticker": "CUBE", "name": "CubeSmart", "sector": "Real Estate", "industry": "Industrial REITs"},
    {"ticker": "CUZ", "name": "Cousins Properties Inc", "sector": "Real Estate", "industry": "Office REITs"},
    {"ticker": "EGP", "name": "Eastgroup Properties Inc", "sector": "Real Estate", "industry": "Industrial REITs"},
    {"ticker": "ELS", "name": "Equity LifeStyle Properties Inc", "sector": "Real Estate", "industry": "Single-Family Residential REITs"},
    {"ticker": "EPR", "name": "EPR Properties", "sector": "Real Estate", "industry": "Other Specialized REITs"},
    {"ticker": "FR", "name": "First Industrial Realty Trust Inc", "sector": "Real Estate", "industry": "Industrial REITs"},
    {"ticker": "GLPI", "name": "Gaming and Leisure Properties Inc", "sector": "Real Estate", "industry": "Other Specialized REITs"},
    {"ticker": "HR", "name": "Healthcare Realty Trust Inc", "sector": "Real Estate", "industry": "Health Care REITs"},
    {"ticker": "IRT", "name": "Independence Realty Trust, Inc", "sector": "Real Estate", "industry": "Multi-Family Residential REITs"},
    {"ticker": "JLL", "name": "Jones Lang LaSalle Inc", "sector": "Real Estate", "industry": "Real Estate Services"},
    {"ticker": "KRC", "name": "Kilroy Realty Corp", "sector": "Real Estate", "industry": "Office REITs"},
    {"ticker": "KRG", "name": "Kite Realty Group Trust", "sector": "Real Estate", "industry": "Retail REITs"},
    {"ticker": "LAMR", "name": "Lamar Advertising Co", "sector": "Real Estate", "industry": "Other Specialized REITs"},
    {"ticker": "NNN", "name": "NNN REIT Inc", "sector": "Real Estate", "industry": "Retail REITs"},
    {"ticker": "OHI", "name": "Omega Healthcare Investors, Inc", "sector": "Real Estate", "industry": "Health Care REITs"},
    {"ticker": "PK", "name": "Park Hotels & Resorts Inc", "sector": "Real Estate", "industry": "Hotel & Resort REITs"},
    {"ticker": "REXR", "name": "Rexford Industrial Realty Inc", "sector": "Real Estate", "industry": "Industrial REITs"},
    {"ticker": "RYN", "name": "Rayonier Inc", "sector": "Real Estate", "industry": "Timber REITs"},
    {"ticker": "SBRA", "name": "Sabra Health Care REIT Inc", "sector": "Real Estate", "industry": "Health Care REITs"},
    {"ticker": "STAG", "name": "STAG Industrial Inc", "sector": "Real Estate", "industry": "Industrial REITs"},
    {"ticker": "VNO", "name": "Vornado Realty Trust", "sector": "Real Estate", "industry": "Office REITs"},
    {"ticker": "Z", "name": "Zillow Group Inc", "sector": "Real Estate", "industry": "Real Estate Services"},
    # ──── Technology (S&P 400 MidCap) ────
    {"ticker": "AEIS", "name": "Advanced Energy Industries Inc", "sector": "Technology", "industry": "Semiconductor Materials & Equipment"},
    {"ticker": "ALGM", "name": "Allegro Microsystems Inc", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "AMKR", "name": "Amkor Technology Inc", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "APPF", "name": "Appfolio Inc", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "ARW", "name": "Arrow Electronics Inc", "sector": "Technology", "industry": "Technology Distributors"},
    {"ticker": "AVT", "name": "Avnet Inc", "sector": "Technology", "industry": "Technology Distributors"},
    {"ticker": "BDC", "name": "Belden Inc", "sector": "Technology", "industry": "Electronic Components"},
    {"ticker": "BILL", "name": "BILL Holdings Inc", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "BSY", "name": "Bentley Systems, Inc", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "CGNX", "name": "Cognex Corp", "sector": "Technology", "industry": "Electronic Equipment & Instruments"},
    {"ticker": "CRUS", "name": "Cirrus Logic Inc", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "CVLT", "name": "Commvault Systems Inc", "sector": "Technology", "industry": "Systems Software"},
    {"ticker": "CXT", "name": "Crane NXT Co", "sector": "Technology", "industry": "Electronic Equipment & Instruments"},
    {"ticker": "DBX", "name": "Dropbox Inc", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "DLB", "name": "Dolby Laboratories Inc", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "DOCN", "name": "DigitalOcean Holdings Inc", "sector": "Technology", "industry": "Internet Services & Infrastructure"},
    {"ticker": "DOCU", "name": "DocuSign Inc", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "DT", "name": "Dynatrace Inc", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "ENTG", "name": "Entegris Inc", "sector": "Technology", "industry": "Semiconductor Materials & Equipment"},
    {"ticker": "FN", "name": "Fabrinet", "sector": "Technology", "industry": "Electronic Manufacturing Services"},
    {"ticker": "GWRE", "name": "Guidewire Software Inc", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "IDCC", "name": "InterDigital Inc", "sector": "Technology", "industry": "Communications Equipment"},
    {"ticker": "IPGP", "name": "IPG Photonics Corp", "sector": "Technology", "industry": "Electronic Manufacturing Services"},
    {"ticker": "KD", "name": "Kyndryl Holdings Inc", "sector": "Technology", "industry": "IT Consulting & Other Services"},
    {"ticker": "LFUS", "name": "Littelfuse Inc", "sector": "Technology", "industry": "Electronic Components"},
    {"ticker": "LSCC", "name": "Lattice Semiconductor Corp", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "MANH", "name": "Manhattan Associates Inc", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "MKSI", "name": "MKS Incorporated", "sector": "Technology", "industry": "Semiconductor Materials & Equipment"},
    {"ticker": "MTSI", "name": "MACOM Technology Solutions Holdings Inc", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "NOVT", "name": "Novanta Inc", "sector": "Technology", "industry": "Electronic Equipment & Instruments"},
    {"ticker": "NTNX", "name": "Nutanix Inc", "sector": "Technology", "industry": "Systems Software"},
    {"ticker": "OKTA", "name": "Okta Inc", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "OLED", "name": "Universal Display Corp", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "ONTO", "name": "Onto Innovation Inc", "sector": "Technology", "industry": "Semiconductor Materials & Equipment"},
    {"ticker": "PATH", "name": "UiPath Inc", "sector": "Technology", "industry": "Systems Software"},
    {"ticker": "PEGA", "name": "Pegasystems Inc", "sector": "Technology", "industry": "Application Software"},
    {"ticker": "QLYS", "name": "Qualys Inc", "sector": "Technology", "industry": "Systems Software"},
    {"ticker": "RMBS", "name": "Rambus Inc", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "SANM", "name": "Sanmina Corp", "sector": "Technology", "industry": "Electronic Manufacturing Services"},
    {"ticker": "SITM", "name": "SiTime Corp", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "SLAB", "name": "Silicon Laboratories Inc", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "SMTC", "name": "Semtech Corp", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "SNX", "name": "TD Synnex Corp", "sector": "Technology", "industry": "Technology Distributors"},
    {"ticker": "SYNA", "name": "Synaptics Inc", "sector": "Technology", "industry": "Semiconductors"},
    {"ticker": "TTMI", "name": "TTM Technologies Inc", "sector": "Technology", "industry": "Electronic Manufacturing Services"},
    {"ticker": "TWLO", "name": "Twilio Inc", "sector": "Technology", "industry": "Systems Software"},
    {"ticker": "VIAV", "name": "Viavi Solutions Inc", "sector": "Technology", "industry": "Communications Equipment"},
    {"ticker": "VNT", "name": "Vontier Corp", "sector": "Technology", "industry": "Electronic Equipment & Instruments"},
    {"ticker": "WK", "name": "Workiva Inc", "sector": "Technology", "industry": "Application Software"},
    # ──── Utilities (S&P 400 MidCap) ────
    {"ticker": "BKH", "name": "Black Hills Corp", "sector": "Utilities", "industry": "Multi-Utilities"},
    {"ticker": "IDA", "name": "Idacorp Inc", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "NFG", "name": "National Fuel Gas Co", "sector": "Utilities", "industry": "Gas Utilities"},
    {"ticker": "NJR", "name": "New Jersey Resources Corp", "sector": "Utilities", "industry": "Gas Utilities"},
    {"ticker": "NWE", "name": "NorthWestern Energy Group Inc", "sector": "Utilities", "industry": "Multi-Utilities"},
    {"ticker": "OGE", "name": "OGE Energy Corp", "sector": "Utilities", "industry": "Multi-Utilities"},
    {"ticker": "OGS", "name": "ONE Gas Inc", "sector": "Utilities", "industry": "Gas Utilities"},
    {"ticker": "ORA", "name": "Ormat Technologies Inc", "sector": "Utilities", "industry": "Renewable Electricity"},
    {"ticker": "POR", "name": "Portland General Electric Co", "sector": "Utilities", "industry": "Electric Utilities"},
    {"ticker": "SR", "name": "Spire Inc", "sector": "Utilities", "industry": "Gas Utilities"},
    {"ticker": "SWX", "name": "Southwest Gas Holdings Inc", "sector": "Utilities", "industry": "Gas Utilities"},
    {"ticker": "UGI", "name": "UGI Corp", "sector": "Utilities", "industry": "Gas Utilities"},
]

_TTL        = 4 * 3600   # 4 hours — individual ticker cache
_WEEKLY_TTL = 7 * 86400  # 7 days — weekly picks cache (one set per week per user)


def _fetch_one(entry: dict) -> dict:
    ticker = entry["ticker"]
    cached = cache_get(f"screener:{ticker}")
    if cached:
        return cached
    try:
        q       = fh_quote(ticker)
        metrics = fh_metrics(ticker)

        price   = q["price"]     if q else None
        chg_pct = q["change_pct"] if q else None

        # market cap: Finnhub returns in millions — convert to units
        mkt_cap_m = metrics.get("marketCapitalization")
        mkt_cap   = mkt_cap_m * 1_000_000 if mkt_cap_m else None

        pe      = metrics.get("peBasicExclExtraTTM") or metrics.get("peNormalizedAnnual")
        fwd_pe  = metrics.get("peForwardTTM")
        # revenueGrowthTTMYoy is already in % (e.g. 15.3 = 15.3%), convert to ratio for score logic
        rev_gr_pct = metrics.get("revenueGrowthTTMYoy")
        rev_gr     = rev_gr_pct / 100.0 if rev_gr_pct is not None else None
        # netProfitMarginTTM is already in % (e.g. 21.5), convert to ratio for score logic
        margin_pct = metrics.get("netProfitMarginTTM")
        margin     = margin_pct / 100.0 if margin_pct is not None else None
        div_yield  = metrics.get("dividendYieldIndicatedAnnual")

        # Simple composite score 0-100
        score = 50
        if rev_gr   and rev_gr   > 0.20: score += 15
        elif rev_gr and rev_gr   > 0.10: score += 8
        if margin   and margin   > 0.20: score += 15
        elif margin and margin   > 0.10: score += 8
        if fwd_pe:
            if fwd_pe < 20:   score += 15
            elif fwd_pe < 30: score += 8
            elif fwd_pe > 50: score -= 10
        score = max(0, min(100, score))

        data = {
            "ticker":     ticker,
            "name":       entry["name"],
            "sector":     entry["sector"],
            "industry":   entry.get("industry", ""),
            "price":      round(price, 2)    if price     else None,
            "change_pct": chg_pct,
            "market_cap": mkt_cap,
            "pe":         round(pe, 1)       if pe        else None,
            "fwd_pe":     round(fwd_pe, 1)   if fwd_pe    else None,
            "rev_growth": round(rev_gr_pct, 1) if rev_gr_pct is not None else None,
            "margin":     round(margin_pct, 1) if margin_pct is not None else None,
            "div_yield":  round(div_yield, 2)  if div_yield  else None,
            "recom":      "",
            "score":      score,
        }
        cache_set(f"screener:{ticker}", data, ttl=_TTL)
        return data
    except Exception:
        return {**entry, "industry": entry.get("industry", ""), "price": None, "score": 0}


def _fetch_batch(entries: list[dict], max_workers: int = 20) -> list[dict]:
    """Was a plain sequential `[_fetch_one(e) for e in entries]` — fine for
    the 20-ticker /screen route, but deadly for the ~556-ticker UNIVERSE
    scan both `weekly_picks()`'s on-demand fallback and worker.py's Sunday
    `job_weekly_screener_generate` run: up to 2 sequential blocking Finnhub
    calls PER ticker on a cold cache meant minutes of wall-clock time before
    a single result came back (the "Screener Semanal se queda cargando"
    bug). Bounded thread-pool concurrency instead — 20 in flight at once
    (not unbounded, to stay under Finnhub's rate limit) cuts that to
    roughly 1/20th of the sequential wall-clock time. Callers already wrap
    this whole function in `asyncio.to_thread`, so running a thread pool
    inside it doesn't block the event loop any more than before."""
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        results = list(pool.map(_fetch_one, entries))
    return [r for r in results if r.get("price") is not None]


@router.post("")
async def screen(request: dict, user_id: str = Depends(get_current_user_id)):
    sector  = request.get("sector")   # None = all
    query   = request.get("query", "").strip()

    subset = [s for s in UNIVERSE if not sector or s["sector"] == sector]

    # Fetch up to 20 stocks (cached after first call)
    stocks = await asyncio.to_thread(_fetch_batch, subset[:20])
    stocks.sort(key=lambda x: x.get("score", 0), reverse=True)

    ai_insight = None
    if query and stocks:
        profile = await _get_user_profile_safe(user_id)
        ai_insight = await ai_service.screen_stocks(stocks, query, profile)

    return {"results": stocks[:15], "ai_insight": ai_insight}


@router.get("/undervalued")
async def undervalued(
    sector: str | None = None, limit: int = 60, lang: str | None = None,
    browse: bool = False, user_id: str = Depends(get_current_user_id),
):
    """Real, DCF-backed undervalued candidates — cache-only read (see
    undervalued_screener_service), refreshed weekly by a background job.
    Distinct from screen()/weekly_picks() above, which layer an LLM
    narrative over live Finnhub metrics, not the real DCF engine.

    `browse=true` (used by the Oportunidades list screen) removes the
    per-sector cap so every real candidate across the whole S&P 500-sized
    universe is returned, not just the ~5/sector "featured" ones — see
    get_undervalued's `per_sector_cap` docstring for what that trades off
    (non-featured candidates lack the AI blurb / relative-historical
    valuation). Existing callers (default `browse=false`) keep the exact
    prior behavior.

    `lang` is passed explicitly by the frontend (its live i18n.language) —
    preferred over reading profile.preferred_language, since the checklist
    item NAMES are translated client-side purely off i18n.language, and a
    stale/unsynced profile field would otherwise generate AI text in a
    different language than what the item names show (a real bug: profile
    sync to the backend can lag or fail silently, and there's no way for
    the user to notice a desync between "what I see" and "what the profile
    says"). Falls back to the profile field only if the frontend didn't
    send one (e.g. an older client build)."""
    from app.api.routes.chat import _is_premium
    profile = await _get_user_profile_safe(user_id)
    if lang not in ("es", "en"):
        lang = getattr(profile, "preferred_language", None) or "es"
    from app.services.undervalued_screener_service import get_undervalued, bootstrap_fill_if_empty_sync

    if not _is_premium(profile):
        # 100% Premium (Diego's Aug 16 Free/Premium spec, §5) — no limited
        # free version, no tickers/content leaked. Free gets a REAL count
        # of how many candidates exist this week (never hardcoded, never
        # fabricated), sourced from the same cache-only read Premium uses
        # (per_sector_cap=None = full real universe, same as browse=true)
        # — zero extra AI/API cost.
        try:
            full = get_undervalued(limit=10_000, sector=sector, lang=lang, per_sector_cap=None)
            if not full["results"]:
                await asyncio.to_thread(bootstrap_fill_if_empty_sync)
                full = get_undervalued(limit=10_000, sector=sector, lang=lang, per_sector_cap=None)
        except Exception as exc:
            logger.error("undervalued(): teaser count failed: %s", exc, exc_info=True)
            full = {"results": []}
        return {"is_premium": False, "teaser_count": len(full["results"])}

    try:
        result = get_undervalued(limit=limit, sector=sector, lang=lang, **({"per_sector_cap": None} if browse else {}))
        if not result["results"]:
            # Cache is completely empty (worker hasn't run its startup/weekly
            # refresh yet) — never return a blank screen. Slower this one time
            # (small subset scan), fast for every request after.
            await asyncio.to_thread(bootstrap_fill_if_empty_sync)
            result = get_undervalued(limit=limit, sector=sector, lang=lang, **({"per_sector_cap": None} if browse else {}))
    except Exception as exc:
        # This list must never fail visibly — worst case, show an empty
        # (but honest) list rather than a raw 500.
        logger.error("undervalued(): get_undervalued/bootstrap failed: %s", exc, exc_info=True)
        result = {"results": [], "generated_at": 0}
    return {"is_premium": True, **result}


@router.get("/valuation-backtest")
async def valuation_backtest(user_id: str = Depends(get_current_user_id)):
    """"What $10,000 became" panel — a real 5-year equal-weighted-basket
    comparison (TODAY's real Nuvos classification applied to real monthly
    prices, see valuation_backtest_service.py's module docstring for why
    this is NOT a genuine point-in-time signal backtest and must be labeled
    as such in the UI). Cache-only read, refreshed weekly alongside the
    undervalued screener; returns {} (never a fabricated placeholder) if
    the worker hasn't populated it yet — the frontend hides the panel in
    that case rather than showing a stale/fake chart."""
    from app.services.valuation_backtest_service import get_valuation_backtest
    try:
        result = get_valuation_backtest()
    except Exception as exc:
        logger.error("valuation_backtest(): get_valuation_backtest failed: %s", exc, exc_info=True)
        result = None
    return result or {}


def _latest_reported_earnings_period(ticker: str) -> str | None:
    """Most recent fiscal period (e.g. '2026-06-30') this ticker has actually
    reported earnings for, per Finnhub /stock/earnings. Used as the
    invalidation signal for the quick-analysis cache: the DCF+AI analysis is
    kept for up to _QUICK_ANALYSIS_CACHE_TTL (3 months), but gets recomputed
    the moment this value changes — i.e. right after the company's next
    earnings report — rather than on a dumb calendar timer. Cached 12h since
    this is just a cheap metadata check, not the analysis itself; returns
    None (never invented) on any failure, in which case the caller falls
    back to serving the existing cache untouched."""
    ck = f"fh:latest_earnings_period:{ticker}"
    cached = cache_get(ck)
    if cached is not None:
        return cached or None
    try:
        import os
        import requests as _req
        key = os.getenv("FINNHUB_API_KEY", "")
        if not key:
            return None
        r = _req.get(
            "https://finnhub.io/api/v1/stock/earnings",
            params={"symbol": ticker, "token": key},
            timeout=8,
        )
        items = r.json() if r.status_code == 200 else None
        if not items or not isinstance(items, list):
            cache_set(ck, "", ttl=3600 * 12)
            return None
        periods = [i.get("period") for i in items if i.get("period")]
        latest = max(periods) if periods else None
        cache_set(ck, latest or "", ttl=3600 * 12)
        return latest
    except Exception:
        return None


def _with_live_price(result: dict, ticker: str) -> dict:
    """Overlays a live (≤60s-old, Finnhub-cached) quote onto an otherwise
    long-cached quick-analysis payload — the DCF/AI narrative can safely sit
    in cache for months, but the price and day-change shown next to it
    should always track the market. Falls back to whatever price the cached
    payload already has if the live quote is unavailable."""
    quote = fh_quote(ticker)
    if not quote or not quote.get("price"):
        return result
    result = dict(result)
    result["price"] = quote["price"]
    result["change_pct"] = quote.get("change_pct", result.get("change_pct"))
    return result


def _with_live_price_diagnostic(cached: dict, ticker: str) -> dict:
    """`_with_live_price`'s equivalent for `/company-diagnostic`'s nested
    `CompanyDiagnosticData` shape (methodology audit round 3, see /Users/
    diegoarria/.claude/plans/cosmic-munching-crown.md) — this endpoint's
    cache-hit path previously returned the cached payload completely as-is,
    with NO live-price overlay at all (unlike quick_analysis), so
    `valuation.currentPrice`/`peCurrent`/`peNormalized`/`marginOfSafetyPercent`
    could silently be stale for up to 90 days on repeat views of the same
    ticker. `baseFairValue`/`conservative`/`optimistic` (the DCF scenario
    values themselves) are NOT price-dependent and stay untouched, same
    philosophy as `_with_live_price`. Falls back to the cached values
    unchanged if the live quote is unavailable — never fabricates one."""
    from app.services.valuation.numeric_helpers import calc_margin_of_safety

    quote = fh_quote(ticker)
    if not quote or not quote.get("price"):
        return cached
    price = quote["price"]
    cached = dict(cached)
    valuation = dict(cached.get("valuation") or {})
    if not valuation:
        return cached

    valuation["currentPrice"] = price
    base_fv = valuation.get("baseFairValue")
    if base_fv is not None:
        valuation["marginOfSafetyPercent"] = calc_margin_of_safety(base_fv, price)

    eps_gaap = valuation.get("_epsGaap")
    if eps_gaap and eps_gaap > 0:
        valuation["peCurrent"] = round(price / eps_gaap, 1)
    eps_normalized = valuation.get("_epsNormalized")
    if eps_normalized and eps_normalized > 0:
        valuation["peNormalized"] = round(price / eps_normalized, 1)

    cached["valuation"] = valuation
    return cached


async def _get_user_profile_safe(user_id: str):
    """Wraps market._get_user_profile (a blocking sync DB call made directly
    inside async routes throughout this file) in a thread so it can never
    block the event loop, plus retries on a transient failure — this is
    the premium-gate check for every screener/quick-analysis endpoint, and a
    single flaky read here must never look identical to "not premium" to a
    real Premium user.

    Also retries a `None` return, not just a raised exception —
    market._get_user_profile itself never raises (it catches its own
    Supabase/parse errors internally, see its own docstring/comment), so a
    transient read hiccup there surfaces as a plain `None`, indistinguishable
    from "this user genuinely has no profile row" unless retried here too
    (2026-08-26, Diego: a real Premium user's own search hit this — profile
    confirmed intact in the DB seconds later, so the first read was
    transient, not a real missing-profile case)."""
    result = None
    for attempt in range(3):
        try:
            result = await asyncio.to_thread(_get_user_profile, user_id)
        except Exception as exc:
            logger.error("_get_user_profile_safe(%s): attempt %d raised: %s", user_id, attempt + 1, exc)
            result = None
        if result is not None:
            return result
        if attempt < 2:
            await asyncio.sleep(0.3 * (attempt + 1))
    logger.warning("_get_user_profile_safe(%s): no profile after %d attempts", user_id, attempt + 1)
    return None


_NAME_STOPWORDS_RE = re.compile(r"\b(inc|incorporated|corp|corporation|co|company|the|ltd|plc|group|holdings?|class [a-z])\b")


def _normalize_company_name(s: str) -> str:
    s = s.lower().replace("&", " and ")
    s = re.sub(r"\([^)]*\)", " ", s)  # "Coca-Cola Company (The)" -> drop "(The)"
    s = re.sub(r"[.,'’-]", " ", s)    # hyphen -> space so "Coca-Cola" matches "coca cola"
    s = _NAME_STOPWORDS_RE.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def _match_universe(query: str) -> str | None:
    """Tries the curated UNIVERSE list (real, well-known US tickers this app
    already screens — see UNIVERSE above) BEFORE ever hitting an external
    search provider. Confirmed live (2026-08-18) that Finnhub/Yahoo's global
    symbol search happily returns a same-named but wrong-exchange/wrong-
    company ticker for extremely common searches — "nike" -> NIKE.WA
    (Warsaw), "visa" -> VISA.TO (Toronto), "ford" -> FORD.VI (Vienna),
    "coca cola" -> EMBONOR-B.SN (a Chilean bottler) — all real tickers, all
    NOT what a user typing a plain company name into a US-stock screener
    means. Matching the curated list first makes the ~550 tickers this app
    is actually built around resolve correctly and consistently every time,
    no matter how the external search providers are behaving that day;
    anything outside that list still falls through to the existing
    Finnhub/Yahoo chain below exactly as before."""
    q_upper = query.strip().upper()
    for entry in UNIVERSE:
        if entry["ticker"].upper() == q_upper:
            return entry["ticker"]

    q_norm = _normalize_company_name(query)
    if not q_norm:
        return None
    best_ticker, best_score = None, 0
    for entry in UNIVERSE:
        name_norm = _normalize_company_name(entry["name"])
        if not name_norm:
            continue
        if name_norm == q_norm:
            score = 100
        elif name_norm.startswith(q_norm + " ") or q_norm.startswith(name_norm + " "):
            score = 90
        elif re.search(rf"\b{re.escape(q_norm)}\b", name_norm):
            score = 60
        else:
            continue
        if score > best_score:
            best_ticker, best_score = entry["ticker"], score
    return best_ticker


def _resolve_quick_ticker(query: str) -> str | None:
    """Resolves free-text (a ticker or a company name) to a real ticker
    symbol for the quick-analysis search below."""
    universe_match = _match_universe(query)
    if universe_match:
        return universe_match

    stripped = query.strip()
    candidate = stripped.upper()
    looks_like_ticker = candidate.replace(".", "").replace("-", "").isalpha() and 1 <= len(candidate) <= 6

    # Only trust the input as a literal ticker when the user typed it in
    # caps already (a deliberate ticker, e.g. "AAPL", "BRK.B") — a plain
    # company name ("Apple", "Tesla", "Nike", "Ford") ALSO passes the same
    # shape check (short, all letters) but isn't a real ticker under that
    # literal spelling. This used to return "APPLE"/"TESLA" as-is and fail
    # every single-word company-name search downstream instead of ever
    # reaching the search below, which would have found AAPL/TSLA.
    if looks_like_ticker and stripped == candidate:
        return candidate

    # Deliberately NOT filtered to "common stock"/"equity" only — Finnhub
    # tags plenty of legitimately searchable, valuable tickers (ADRs, REITs,
    # ETFs, preferred shares) under other `type` strings, and excluding them
    # here was silently telling users "no se pudo identificar esa empresa"
    # for real, valid tickers. Only skip the types that can never resolve to
    # tradeable equity fundamentals (get_fundamental_analysis degrades to a
    # clean 404 downstream for anything else that has no real data).
    _NEVER_RESOLVABLE = {"crypto", "forex", "index"}
    try:
        for r in fh_search(stripped):
            if r.get("symbol") and r.get("type", "").strip().lower() not in _NEVER_RESOLVABLE:
                return r["symbol"]
    except Exception as exc:
        logger.warning("_resolve_quick_ticker(%r): fh_search failed: %s", query, exc)

    # Finnhub found nothing (or is having a bad day) — this search is meant
    # to find ANY US-listed ticker/company, so fall back to an independent
    # second source (Yahoo Finance's symbol search, the same one
    # /market/search already relies on) rather than giving up after a single
    # provider's hiccup.
    try:
        import requests as _requests
        resp = _requests.get(
            "https://query2.finance.yahoo.com/v1/finance/search",
            params={"q": stripped, "lang": "en-US", "region": "US", "quotesCount": 5, "newsCount": 0, "listsCount": 0},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=6,
        )
        quotes = (resp.json() or {}).get("quotes", [])
        for item in quotes:
            if item.get("symbol") and item.get("quoteType") in ("EQUITY", "ETF"):
                return item["symbol"]
    except Exception as exc:
        logger.warning("_resolve_quick_ticker(%r): Yahoo fallback failed: %s", query, exc)

    # Last resort: both search providers came up empty (or errored) — if the
    # input still has the shape of a real ticker (e.g. lowercase "tsla"),
    # trust it rather than refusing outright. get_fundamental_analysis
    # degrades to a clean 404 downstream if it turns out not to be real.
    if looks_like_ticker:
        return candidate

    return None


def _asdict_or_none(obj) -> Optional[dict]:
    """Converts a dataclass instance (e.g. `IndustryBenchmarks`) to a plain
    JSON-serializable dict, or passes None through — small local helper so
    the quality-engine dataclasses don't need every caller to import
    `dataclasses.asdict` separately."""
    if obj is None:
        return None
    from dataclasses import asdict
    return asdict(obj)


async def _compute_extra_valuations(ticker: str, data: dict, dcf: dict):
    """Relative/Historical Valuation + Industry Benchmarks for quick_analysis's
    single-ticker live search — industry-aware (real `industry`, not just
    `sector`), tighter than the sector-only version get_fundamental_analysis()
    computes for itself. Split out from quick_analysis so the whole block can
    be bounded by one asyncio.wait_for — a stalled peer/history fetch must
    never hang the request past a few seconds; the quick-analysis card just
    degrades to the base DCF result.

    Nuvos AI Fair Value Engine redesign, Incremento 12 — Consensus Engine
    (the archetype-weighted blend of Conservative/Professional DCF/Relative/
    Historical, previously computed here too) is retired: the Nuvos AI Fair
    Value Engine's Bear/Base/Bull is the single number shown to users
    (Incremento 11 — THE FLIP). Relative/Historical stay — they still feed
    the exit multiple anchor (decision #1)."""
    from app.services.fundamental_analysis_service import get_financials
    from app.services.historical_valuation_service import compute_historical_valuation
    from app.services.relative_valuation_service import compute_relative_valuation

    relative_valuation = None
    historical_valuation = None

    price = data.get("current_price")
    shares_out = dcf.get("shares_outstanding")
    total_debt = data.get("total_debt") or 0
    cash = data.get("cash") or 0
    sector = data.get("sector")
    industry = next((u["industry"] for u in UNIVERSE if u["ticker"] == ticker), None)

    fin = await asyncio.to_thread(get_financials, ticker, 10)
    income = fin.get("incomeStatement", {}).get("annual", [])
    balance = fin.get("balanceSheet", {}).get("annual", [])
    cashflow = fin.get("cashFlow", {}).get("annual", [])
    n = min(len(income), len(balance), len(cashflow))
    income, balance, cashflow = income[-n:], balance[-n:], cashflow[-n:]
    latest_income = income[-1] if income else {}
    latest_eps = latest_income.get("Diluted EPS") or latest_income.get("Basic EPS")
    latest_ebitda = latest_income.get("EBITDA")
    fcf_trend_vals = [v for v in (data.get("fcf_trend") or []) if v is not None]
    latest_fcf = fcf_trend_vals[-1] if fcf_trend_vals else None

    if price and shares_out:
        relative_valuation = await asyncio.to_thread(
            compute_relative_valuation, ticker, price, shares_out, latest_eps, latest_ebitda, latest_fcf,
            total_debt, cash, sector, industry,
        )
        if n >= 5:
            historical_valuation = await asyncio.to_thread(
                compute_historical_valuation, ticker, income, balance, cashflow, price, shares_out, total_debt, cash,
                latest_eps, latest_ebitda, latest_fcf,
            )

    # Fase 2, Incremento 1 (Quality Engine — Industry Engine, see
    # /Users/diegoarria/.claude/plans/stateful-painting-flurry.md): real,
    # live peer-derived benchmarks — same peer group this function already
    # resolved above, no separate fetch. `peer_analysis_cache` is returned
    # so the Peer Comparison Engine (Incremento 10, called later in
    # _build_quick_analysis once the company's own Quality Score exists)
    # can reuse the SAME warmed peer analyses instead of re-fetching them —
    # both engines resolve the identical real peer group via
    # `relative_valuation_service._find_peers`.
    from app.services.quality.industry_engine import compute_industry_benchmarks
    peer_analysis_cache: dict = {}
    industry_benchmarks = compute_industry_benchmarks(ticker, sector, industry, analysis_cache=peer_analysis_cache)

    return relative_valuation, historical_valuation, industry_benchmarks, peer_analysis_cache


_QUICK_ANALYSIS_CACHE_TTL = 90 * 24 * 3600  # 3 months — a ceiling, not the real invalidation trigger.
# The DCF+AI analysis is only actually stale once the company reports new
# earnings (see _latest_reported_earnings_period), which is checked on every
# cache hit; this TTL just guarantees a hard refresh even for a ticker that
# somehow never reports again. The live price is never subject to this at
# all — see _with_live_price.


def _quick_analysis_cache_key(ticker: str, lang: str) -> str:
    # v13 — bumped for methodology audit round 5 — mandatory per-share Fair
    # Value Engine (see /Users/diegoarria/.claude/plans/cosmic-munching-
    # crown.md): GQV's growth-evidence hierarchy has a new top-priority
    # per-share-compounded tier (real revenue CAGR × real buyback yield),
    # and the legacy DCF/Reverse DCF now use a real per-year shrinking
    # share count. A v12 entry predates all of this.
    # v11 — bumped for methodology audit round 2 (see /Users/diegoarria/
    # .claude/plans/cosmic-munching-crown.md): net cash now includes Long
    # Term Investments (real liquidity was understated for companies
    # holding long-duration marketable securities, e.g. Apple), plus new
    # `pe_ratio_forward`/`pe_on_normalized_eps`/`pe_gaap` fields. A v10
    # entry predates all of this.
    # v10 — bumped for the FCF maintenance/growth-CapEx normalization fix
    # (see /Users/diegoarria/.claude/plans/cosmic-munching-crown.md,
    # methodology audit): `_fcf_margin_adjustment`'s input now uses
    # maintenance-capex-only FCF instead of OCF-minus-total-CapEx, changing
    # the Fair P/E and Fair Value scenarios for capex-heavy tickers, plus a
    # new `fcf_assumptions`/`wacc_details` transparency block inside
    # `gqv_fair_value`. A v9 entry has neither.
    # v9 — bumped for Nuvos Fair Value Engine V2 Phases 1-4 (2026-08-12/13,
    # see /Users/diegoarria/.claude/plans/cosmic-munching-crown.md): Phase 1
    # changed REAL fair-value outputs for real tickers (structural earnings
    # states now reclassify several companies from "elevated" to
    # "structurally_elevated", changing `high_growth_years`/moat duration
    # and the resulting Bear/Base/Bull scenarios); Phases 2-4 added new
    # fields entirely absent from any older cached entry
    # (`business_economics`, `uncertainty_profile`, `outlier_flags`). A v8
    # entry has none of this — without this bump, previously-viewed tickers
    # keep serving pre-Phase-1 fair values and are missing every Phase 2-4
    # field for up to 90 more days.
    # v7 — bumped for the Nuvos Fair Value Engine (Growth + Quality + Value)
    # becoming PRIMARY over the DCF (see /Users/diegoarria/.claude/plans/
    # cosmic-munching-crown.md and the methodology audit that followed it):
    # `gqv_fair_value`/`valuation_source` are new top-level-consumed fields,
    # `intrinsic_value_base`/`margin_of_safety_pct` now resolve through
    # `_primary_valuation` (GQV first, DCF fallback) instead of always
    # reading the DCF's own scenarios, and the DCF panel itself is relabeled
    # as a cross-check on web whenever GQV is primary. A stale v6 entry has
    # no `gqv_fair_value` at all and still points `intrinsic_value_base` at
    # the DCF unconditionally — without this bump, every previously-viewed
    # ticker (this includes AAPL, confirmed via a live screenshot showing
    # the old DCF-only panel post-deploy) keeps serving pre-GQV numbers
    # under the new primary-engine UI for up to 90 more days.
    # v6 — bumped because avg_roic (fundamental_analysis_service.py) switched
    # from a flat historical mean to the same recency-weighted average
    # already used for operating margin. The flat mean let a company's
    # oldest, deeply loss-making years drag nuvos_fair_value's whole
    # avg_roic > 0 gate negative even after it turned durably profitable —
    # Spotify got NO fair value at all, Uber got a near-zero/broken one.
    # Also fixed the AI narrative permanently crashing (KeyError) for every
    # financial-sector ticker (AXP, NU, JPM, ...) — silently falling back to
    # generic text regardless of how good the underlying numbers were. Every
    # ticker's numbers may have changed, and financial tickers' summaries
    # were always broken before — without this bump, both keep serving
    # broken v5 data for up to 90 more days.
    # v5 — bumped for the "Calidad de la valuación" model-confidence card
    # (see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md):
    # added years_available/beta to the response.
    # v4 — bumped for the "Modelo Completo" interactive DCF builder (see
    # /Users/diegoarria/.claude/plans/stateful-painting-flurry.md): added
    # per-scenario yearly/waterfall fields, fcf_conversion_pct,
    # exit_multiple_ladder, and revenue CAGR/Wall Street growth reference
    # fields to nuvos_fair_value. A stale v3 entry would just be missing
    # these keys client-side (None-shaped), not wrong, but the redesign
    # discipline is to always bump on a payload-shape change.
    # v3 — bumped for the Nuvos AI Fair Value Engine redesign (Incrementos
    # 1-16, see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md):
    # the ENTIRE valuation computation changed (exit-multiple terminal
    # value, Bear/Base/Bull scenarios, THE FLIP re-deriving fair_value_range/
    # confidence_meter from them, Consensus/Monte Carlo/manual-calculator
    # fields removed from the response shape). A cache entry computed before
    # this redesign is only invalidated by new earnings, which has nothing
    # to do with a code change — without this bump, every ticker keeps
    # serving pre-redesign numbers under the new UI for up to 90 more days.
    # v2 — bumped so a stale English-requested cache entry generated before
    # the "summary"/"blurb" schema's hardcoded "español" instruction was
    # fixed (it silently overrode the top-level language directive) doesn't
    # keep serving Spanish text under an English UI for its remaining TTL.
    # v12 — bumped for methodology audit round 3 (see /Users/diegoarria/
    # .claude/plans/cosmic-munching-crown.md): ROIC operating-invested-
    # capital fallback (buyback-compressed equity), and the AI narrative
    # prompt now cites the real GQV-first fair value instead of the legacy
    # DCF number. A v11 entry predates both.
    # v14 — bumped 2026-08-19: shares_outstanding now derives from
    # marketCapitalization/price instead of the raw Finnhub shareOutstanding
    # field (fixes a ~1500x-inflated fair value for dual-class tickers like
    # BRK.B, whose profile2 shareOutstanding was company-wide Class-A-
    # equivalent while price was the real Class B quote). A v13 entry has
    # the wrong shares_outstanding baked in for any dual-class ticker.
    # v15 — bumped 2026-08-19: financial-sector `sector_model_note` now set
    # when `valuation_sanity_warning` fires (previously computed and
    # discarded). A v14 entry has no caution note for a ticker like BRK.B
    # even when the sanity check would have flagged it.
    # v16 — bumped 2026-08-19: financial-sector dcf now carries
    # pe_on_normalized_eps (fixes a real 404 for tickers like BRK.B whose
    # trailing GAAP EPS + Yahoo forward estimate were both unavailable).
    return f"quick_analysis:v16:{lang}:{ticker}"


async def _build_quick_analysis(ticker: str, lang: str) -> dict:
    """Computes the full quick-analysis payload for one ticker+lang — the
    real DCF engine plus a short AI narrative. Pure compute: doesn't touch
    cache or the per-user thesis-event log, so it can be called both by the
    /quick-analysis route (cache miss path) and by worker.py's cache-warming
    job for the screen's default ticker, without depending on a request or
    user_id."""
    import time

    from app.services.fundamental_analysis_service import get_fundamental_analysis
    try:
        # Bounded so a stalled FMP/Finnhub call can never hang this endpoint
        # indefinitely — the frontend gets a fast, clear failure to retry
        # instead of an infinite spinner on a screen that must always open.
        # _compute_peer_dependent_data=False: this function computes its OWN, better
        # (industry-aware, not just sector-aware) Consensus a few lines
        # below via _compute_extra_valuations — paying for get_fundamental_
        # analysis's internal sector-only Consensus too would just be
        # duplicate peer-fetching for a result this overwrites anyway (see
        # combine_fair_value_range call below).
        data = await asyncio.wait_for(
            asyncio.to_thread(get_fundamental_analysis, ticker, _compute_peer_dependent_data=False), timeout=20.0,
        )
    except Exception as exc:
        # A real data-provider hiccup (FMP/Finnhub timeout, rate limit,
        # malformed response) must never surface as a raw 500 — this
        # search box is meant to never fail visibly to the user.
        logger.error("quick_analysis(%s): get_fundamental_analysis failed: %s", ticker, exc, exc_info=True)
        raise HTTPException(status_code=503, detail=f"No pudimos obtener los datos financieros de {ticker} en este momento. Intenta de nuevo en unos segundos.")
    if not data or not data.get("dcf"):
        raise HTTPException(status_code=404, detail=f"No hay suficientes datos financieros reales para calcular el valor intrínseco de {ticker}")

    # The AI narrative is a nice-to-have layer on top of the real DCF
    # numbers already in `data` — a Claude timeout/error must degrade to a
    # plain-numbers card, never take down the whole request.
    try:
        ai_result = await asyncio.wait_for(ai_service.generate_quick_valuation_summary(data, lang=lang), timeout=20.0)
    except Exception as exc:
        logger.error("quick_analysis(%s): generate_quick_valuation_summary failed: %s", ticker, exc, exc_info=True)
        ai_result = {
            "summary": (
                "We couldn't generate the AI summary right now. The real numbers above are still accurate."
                if lang == "en" else
                "No pudimos generar el resumen con IA en este momento. Las cifras reales de arriba siguen siendo correctas."
            ),
            "business_understanding_stars": None, "business_understanding_reason": "", "checklist_reasons": {},
        }
    dcf = data["dcf"]
    # Nuvos Fair Value Engine (Growth + Quality + Value) — primary whenever
    # it produced a real, gate-passed result for this ticker; same fallback
    # logic the Oportunidades screener already applies. See
    # /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.
    from app.services.undervalued_screener_service import _primary_valuation
    _primary = _primary_valuation(dcf)

    # Relative/Historical Valuation + Industry Benchmarks — computed live
    # here for this ONE ticker (unlike the weekly screener's whole-universe
    # batch, a single-ticker peer/history fetch is cheap enough for a live
    # search) and cached alongside the rest of this response for 24h, so a
    # repeat search of the same ticker never re-pays this cost. A failure
    # here must never break the base DCF result — the quick-analysis card
    # degrades to showing only the base Fair Value Range.
    #
    # Nuvos AI Fair Value Engine redesign, Incremento 11 (THE FLIP) —
    # `fair_value_range` is just this ticker's own Bear/Base/Bull scenarios
    # (already computed inside get_fundamental_analysis, on
    # `dcf["nuvos_fair_value"]`), not refreshed from anything computed here.
    # Consensus Engine itself is retired (Incremento 12).
    relative_valuation = None
    historical_valuation = None
    industry_benchmarks = None
    peer_analysis_cache: dict = {}
    try:
        relative_valuation, historical_valuation, industry_benchmarks, peer_analysis_cache = await asyncio.wait_for(
            _compute_extra_valuations(ticker, data, dcf), timeout=15.0,
        )
    except Exception as exc:
        logger.warning("quick_analysis(%s): valuation engine (relative/historical/industry) failed: %s", ticker, exc)

    # 7-point investment checklist — item 1 (Entender el negocio) is Claude's
    # qualitative judgment from ai_result above; items 2-7's "stars" ratings
    # are real, computed by fundamental_analysis_service, and their "reason"
    # text is Claude's nuanced explanation grounded in real multi-factor
    # evidence (see undervalued_screener_service._finalize_checklist, reused
    # here so both entry points merge identically).
    from app.services.undervalued_screener_service import _finalize_checklist
    try:
        _finalize_checklist(data, {
            "key": "business_understanding",
            "name": "Entender el negocio" if lang != "en" else "Understanding the business",
            "stars": ai_result.get("business_understanding_stars"),
            "reason": ai_result.get("business_understanding_reason", ""),
        }, ai_result.get("checklist_reasons"))
        checklist = data.get("checklist")
    except Exception as exc:
        logger.error("quick_analysis(%s): _finalize_checklist failed: %s", ticker, exc, exc_info=True)
        checklist = None

    # DCF calculator inputs (frontend "Calculadora de Valor Intrínseco") —
    # re-derived independently from `data`/`dcf` rather than reusing locals
    # from _compute_extra_valuations, since that call may have timed out or
    # raised before producing anything.
    _fcf_trend_vals = [v for v in (data.get("fcf_trend") or []) if v is not None]
    current_fcf = _fcf_trend_vals[-1] if _fcf_trend_vals else None
    net_cash = (data.get("cash") or 0) - (data.get("total_debt") or 0)
    shares_outstanding = dcf.get("shares_outstanding")
    from app.services.undervalued_screener_service import build_dcf_guidance
    dcf_assumptions = build_dcf_guidance(dcf, data.get("thesis_scores"))

    # Confidence Meter v3 (Fase 1, Incremento 5 — Parte F; extended Fase 1.5,
    # Incremento 18). Nuvos AI Fair Value Engine redesign, Incremento 11
    # (THE FLIP) — no longer passes `method_values`: Consensus, its source,
    # is retired from display (Incremento 12), so "method agreement" now
    # degrades to `fair_value_range`'s own dispersion, which IS the real
    # Bear<->Bull spread of the single engine (see combine_fair_value_range
    # and confidence_engine.py's docstring) — `dispersion_source` reports
    # `"bear_bull_dispersion"` for every ticker now, not a proxy label.
    # financial_statement_quality_score/management_consistency_score were
    # already computed once inside get_fundamental_analysis() (network-free)
    # and are just read back from `dcf` here, never re-derived.
    from app.services.valuation.confidence_engine import compute_confidence_meter_v3
    thesis_scores = data.get("thesis_scores") or {}
    confidence_meter_v3 = compute_confidence_meter_v3(
        predictability_score=dcf.get("confidence_score"),
        years_available=data.get("data_years_available", 0),
        fair_value_range=dcf.get("fair_value_range") or {},
        liquidity_ok=(data.get("liquidity_gate") or {}).get("paso", True),
        business_quality_score=thesis_scores.get("business_quality"),
        financial_strength_score=thesis_scores.get("financial_strength"),
        financial_statement_quality_score=dcf.get("financial_statement_quality_score"),
        management_consistency_score=dcf.get("management_consistency_score"),
    )

    # Fase 2, Incremento 2 (Quality Engine — "¿qué tan buena es esta
    # empresa?", completely independent of the DCF/price above — see
    # /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).
    # Extraction logic lives once in quality_engine.py (also used by
    # nif_service.py's business_quality pillar, Incremento 3) — never
    # duplicated across callers.
    from app.services.quality.quality_engine import build_quality_score_from_analysis
    quality_result = build_quality_score_from_analysis(data)
    quality_engine_result = {
        "quality_score": quality_result.quality_score,
        "profitability_score": quality_result.profitability_score,
        "margins_score": quality_result.margins_score,
        "cash_flow_score": quality_result.cash_flow_score,
        "growth_score": quality_result.growth_score,
        "balance_sheet_score": quality_result.balance_sheet_score,
        "factors": [
            {"name": f.name, "value": f.value, "score": f.score, "reason": f.reason} for f in quality_result.factors
        ],
    }

    # Fase 2, Incremento 10 (Peer Comparison Engine — Parte J). Reuses the
    # exact real peer group `industry_benchmarks` above already resolved
    # (`peer_analysis_cache`, warmed by `_compute_extra_valuations`) — no
    # second peer-finding pass, no re-fetched peer analyses.
    from app.services.quality.peer_comparison_engine import compute_quality_peer_comparison
    industry_for_peers = next((u["industry"] for u in UNIVERSE if u["ticker"] == ticker), None)
    peer_comparison_result_obj = compute_quality_peer_comparison(
        ticker, data.get("sector"), industry_for_peers,
        company_quality_score=(quality_result.quality_score if quality_result.has_any_signal else None),
        analysis_cache=peer_analysis_cache,
    )
    peer_comparison_result = (
        {
            "peer_count": peer_comparison_result_obj.peer_count,
            "peers_used": peer_comparison_result_obj.peers_used,
            "company_quality_score": peer_comparison_result_obj.company_quality_score,
            "quality_score_percentile": peer_comparison_result_obj.quality_score_percentile,
            "quality_score_rank": peer_comparison_result_obj.quality_score_rank,
            "peer_quality_scores": [
                {
                    "ticker": s.ticker, "quality_score": s.quality_score, "roic_pct": s.roic_pct,
                    "operating_margin_pct": s.operating_margin_pct, "revenue_cagr_pct": s.revenue_cagr_pct,
                }
                for s in peer_comparison_result_obj.peer_quality_scores
            ],
        }
        if peer_comparison_result_obj is not None else None
    )

    # Fase 2, Incremento 10 (Deterioration Engine — Parte K). Mechanical
    # first-half-vs-second-half trend DIRECTION on the same real multi-year
    # arrays every other Fase 2 engine already reuses — complements (never
    # duplicates) the Moat Engine's non-directional CV-based stability.
    from app.services.quality.deterioration_engine import compute_deterioration_signals
    fcf_trend_for_deterioration = data.get("fcf_trend") or []
    revenue_trend_for_deterioration = data.get("revenue_trend") or []
    fcf_margin_trend_for_deterioration = [
        (f / r) * 100 if f is not None and r else None
        for f, r in zip(fcf_trend_for_deterioration, revenue_trend_for_deterioration)
    ]
    deterioration_result_obj = compute_deterioration_signals(
        roic_trend=data.get("roic_trend") or [],
        operating_margin_trend=data.get("operating_margin_trend") or [],
        net_margin_trend=data.get("net_margin_trend") or [],
        fcf_margin_trend=fcf_margin_trend_for_deterioration,
        revenue_trend=revenue_trend_for_deterioration,
    )
    deterioration_result = {
        "deteriorating_count": deterioration_result_obj.deteriorating_count,
        "improving_count": deterioration_result_obj.improving_count,
        "stable_count": deterioration_result_obj.stable_count,
        "highest_concern": deterioration_result_obj.highest_concern,
        "factors": [
            {"name": f.name, "direction": f.direction, "change_pct": f.change_pct, "reason": f.reason}
            for f in deterioration_result_obj.factors
        ],
    }

    # Fase 2, Incremento 7 (Moat Engine — deterministic score only, Parte B).
    # Reuses avg_roic_pct/growth_buildup already computed for the DCF and
    # the industry_benchmarks computed above (same peer group, no second
    # fetch). The AI-narrated 11-moat-type qualitative deep dive is
    # deliberately NOT called here (real network + AI cost per request) —
    # it's wired into nif_service.build_nif_dashboard instead, alongside
    # that flow's existing parallel AI narration calls.
    from app.services.quality.moat_engine import compute_moat_score
    growth_buildup = dcf.get("growth_buildup") or {}
    op_margin_trend_for_moat = data.get("operating_margin_trend") or []
    op_margin_valid = [v for v in op_margin_trend_for_moat if v is not None]
    avg_operating_margin_pct = round(sum(op_margin_valid) / len(op_margin_valid), 1) if op_margin_valid else None
    gross_margin_trend_for_moat = data.get("gross_margin_trend") or []
    gross_margin_latest_pct = next((v for v in reversed(gross_margin_trend_for_moat) if v is not None), None)
    moat_result_obj = compute_moat_score(
        avg_roic_pct=growth_buildup.get("avg_roic_pct"), roic_trend=data.get("roic_trend") or [],
        avg_operating_margin_pct=avg_operating_margin_pct, operating_margin_trend=op_margin_trend_for_moat,
        gross_margin_latest_pct=gross_margin_latest_pct,
        industry_median_roic_pct=(industry_benchmarks.median_roic_pct if industry_benchmarks else None),
        industry_median_operating_margin_pct=(industry_benchmarks.median_operating_margin_pct if industry_benchmarks else None),
    )
    moat_engine_result = {
        "moat_score": moat_result_obj.moat_score,
        "roic_premium_score": moat_result_obj.roic_premium_score,
        "margin_premium_score": moat_result_obj.margin_premium_score,
        "stability_score": moat_result_obj.stability_score,
        "factors": [
            {"name": f.name, "value": f.value, "score": f.score, "reason": f.reason} for f in moat_result_obj.factors
        ],
    }

    # Fase 2, Incremento 9 (Conviction Engine — Parte H). Pure synthesis of
    # three already-computed real scores above (quality_score, moat_score,
    # moat's own stability_score) plus the real CAPM beta the DCF engine
    # already computed for WACC (dcf["wacc_details"]["beta"]) — zero new
    # fetches, zero AI.
    from app.services.quality.conviction_engine import compute_conviction_score
    conviction_result_obj = compute_conviction_score(
        quality_score=quality_result.quality_score if quality_result.has_any_signal else None,
        moat_score=moat_result_obj.moat_score if moat_result_obj.has_any_signal else None,
        stability_score=moat_result_obj.stability_score,
        beta=(dcf.get("wacc_details") or {}).get("beta"),
    )
    conviction_engine_result = {
        "conviction_score": conviction_result_obj.conviction_score,
        "quality_score": conviction_result_obj.quality_score,
        "moat_score": conviction_result_obj.moat_score,
        "stability_score": conviction_result_obj.stability_score,
        "beta_score": conviction_result_obj.beta_score,
        "factors": [
            {"name": f.name, "value": f.value, "score": f.score, "reason": f.reason} for f in conviction_result_obj.factors
        ],
    }

    # Fase 2, Incremento 4 (Capital Allocation Engine — "¿cómo administra
    # el capital esta empresa?", Parte C). Reuses buyback_rate_pct/
    # payout_ratio_pct already computed for management_capital_allocation
    # evidence, and the reinvestment_rate_trend the DCF engine already
    # builds — the only NEW work here is checking real historical buyback
    # timing against real prices.
    from app.services.quality.capital_allocation_engine import compute_capital_allocation_score
    mgmt_evidence = (data.get("checklist_evidence") or {}).get("management_capital_allocation") or {}
    payout_ratio_pct = mgmt_evidence.get("payout_ratio_pct")
    capital_allocation_result_obj = compute_capital_allocation_score(
        ticker=ticker, current_price=data.get("current_price"),
        implied_shares_trend=data.get("implied_shares_trend") or [],
        fiscal_period_dates=data.get("fiscal_period_dates") or [],
        dividends_paid_trend=data.get("dividends_paid_trend") or [],
        reinvestment_rate_trend=data.get("reinvestment_rate_trend") or [],
        buyback_rate_pct=mgmt_evidence.get("buyback_rate_pct"),
        payout_ratio=(payout_ratio_pct / 100) if payout_ratio_pct is not None else None,
    )
    capital_allocation_result = {
        "capital_allocation_score": capital_allocation_result_obj.capital_allocation_score,
        "buyback_timing_score": capital_allocation_result_obj.buyback_timing_score,
        "dividend_consistency_score": capital_allocation_result_obj.dividend_consistency_score,
        "reinvestment_quality_score": capital_allocation_result_obj.reinvestment_quality_score,
        "buyback_years": [
            {
                "fiscal_period": b.fiscal_period, "shares_reduced_pct": b.shares_reduced_pct,
                "price_at_buyback": b.price_at_buyback, "current_price": b.current_price,
                "looks_good_in_hindsight": b.looks_good_in_hindsight,
            }
            for b in capital_allocation_result_obj.buyback_years
        ],
        "factors": [
            {"name": f.name, "value": f.value, "score": f.score, "reason": f.reason}
            for f in capital_allocation_result_obj.factors
        ],
        "acquisitions_note": capital_allocation_result_obj.acquisitions_note,
    }

    # Fase 2, Incremento 5 (Earnings Quality Engine — Parte E). Reuses
    # data_validation (Fase 1's accounting cross-check) and the margin/FCF/
    # net-income trends already computed; sbc_latest is the one new field
    # (added to fundamental_analysis_service.py's return dict this
    # increment — the raw statement field was already fetched, just never
    # read downstream).
    from app.services.quality.earnings_quality_engine import compute_earnings_quality
    fcf_trend_for_eq = data.get("fcf_trend") or []
    revenue_trend_for_eq = data.get("revenue_trend") or []
    earnings_quality_result_obj = compute_earnings_quality(
        sbc_latest=data.get("sbc_latest"),
        revenue_latest=(revenue_trend_for_eq[-1] if revenue_trend_for_eq else None),
        fcf_latest=(fcf_trend_for_eq[-1] if fcf_trend_for_eq else None),
        data_validation=data.get("data_validation"),
        gross_margin_trend=data.get("gross_margin_trend") or [], operating_margin_trend=data.get("operating_margin_trend") or [],
        net_margin_trend=data.get("net_margin_trend") or [],
        fcf_trend=fcf_trend_for_eq, net_income_trend=data.get("net_income_trend") or [],
        years=data.get("years") or [],
        revenue_cagr_pct=data.get("revenue_cagr_pct"), fcf_cagr_pct=data.get("fcf_cagr_pct"),
    )
    earnings_quality_result = {
        "alert_count": earnings_quality_result_obj.alert_count,
        "highest_severity": earnings_quality_result_obj.highest_severity,
        "sbc_to_revenue_pct": earnings_quality_result_obj.sbc_to_revenue_pct,
        "sbc_to_fcf_pct": earnings_quality_result_obj.sbc_to_fcf_pct,
        "alerts": [
            {"key": a.key, "severity": a.severity, "description": a.description, "evidence": a.evidence}
            for a in earnings_quality_result_obj.alerts
        ],
        "acquisitions_note": earnings_quality_result_obj.acquisitions_note,
    }

    result = {
        "ticker": data["ticker"],
        "company_name": data.get("company_name"),
        "sector": data.get("sector"),
        "price": data.get("current_price"),
        "change_pct": data.get("change_pct"),
        "exchange": data.get("exchange"),
        "current_fcf": current_fcf,
        "net_cash": net_cash,
        "shares_outstanding": shares_outstanding,
        "dcf_assumptions": dcf_assumptions,
        "intrinsic_value_base": _primary["intrinsic_value_base"],
        "expected_value_per_share": dcf.get("expected_value_per_share"),
        "margin_of_safety_pct": _primary["margin_of_safety_pct"],
        "valuation_source": _primary["valuation_source"],
        "implied_growth_pct": dcf.get("implied_growth_pct"),
        "yearly_detail": dcf.get("yearly_detail"),
        "pv_of_fcf_sum": dcf.get("pv_of_fcf_sum"),
        "pv_of_terminal_value": dcf.get("pv_of_terminal_value"),
        "enterprise_value": dcf.get("enterprise_value"),
        "total_debt": dcf.get("total_debt"),
        "cash": dcf.get("cash"),
        "thesis_scores": data.get("thesis_scores"),
        "composite_score": data.get("composite_score"),
        "fair_value_range": dcf.get("fair_value_range"),
        "confidence_meter": confidence_meter_v3 or dcf.get("confidence_meter"),
        "market_expectations": dcf.get("market_expectations"),
        # Fase 1, Incremento 4 (see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md):
        # sensitivity_matrix lets the frontend stop reimplementing its own
        # client-side heatmap and show the REAL backend matrix instead;
        # reverse_dcf_sanity_check/expectations_investing expose the
        # reverse-DCF the backend already solves for (Parte E); driver_based_
        # valuation/sector_model_note are the Incremento 2/3 additions.
        #
        # `scenarios`/`probability_weights` (the pessimistic/base/optimistic
        # weighting UI) are no longer exposed here — Nuvos AI Fair Value
        # Engine redesign, Incremento 15: ScenarioWeightingPanel is retired,
        # replaced by the Bear/Base/Bull panel. `dcf["probability_weights"]`
        # itself is untouched — it still feeds expected_value_per_share and
        # the AI context builder internally.
        "sensitivity_matrix": dcf.get("sensitivity_matrix"),
        "reverse_dcf_sanity_check": dcf.get("reverse_dcf_sanity_check"),
        "expectations_investing": dcf.get("expectations_investing"),
        "driver_based_valuation": dcf.get("driver_based_valuation"),
        # Fase 1.5, Incrementos 4/5/8 (see /Users/diegoarria/.claude/plans/
        # stateful-painting-flurry.md) — same shadow-mode discipline as
        # driver_based_valuation above: computed on every request, not yet
        # the production number. Exposed here so the frontend's Profesional-
        # tier preview panel (Incremento 9) can show them; NOT wired into
        # the primary valuation display until the production flip
        # (Incremento 7, blocked on the validation harness).
        "driver_based_scenarios": dcf.get("driver_based_scenarios"),
        "driver_based_sensitivity_matrix": dcf.get("driver_based_sensitivity_matrix"),
        "driver_based_value_drivers": dcf.get("driver_based_value_drivers"),
        # Nuvos AI Fair Value Engine — one engine, three named scenarios
        # (Bear/Base/Bull); the primary valuation since the flip (Incremento
        # 11) — see combine_fair_value_range.
        "nuvos_fair_value": dcf.get("nuvos_fair_value"),
        # Nuvos Fair Value Engine (Growth + Quality + Value) — see
        # /Users/diegoarria/.claude/plans/cosmic-munching-crown.md. ADDED
        # alongside `nuvos_fair_value` above (unrelated name collision — that
        # key is the DCF + exit-multiple model), exposed as an experimental/
        # secondary panel on web while it's calibrated against more real
        # tickers before becoming primary.
        "gqv_fair_value": dcf.get("gqv_fair_value"),
        # `growth_engine` (Fase 1.5's shadow-mode preview panel) is no
        # longer exposed here either — Incremento 15: GrowthEnginePreviewPanel
        # was retired as redundant with nuvos_fair_value's own growth_factors.
        # `dcf["growth_engine"]`/growth_engine_result stay untouched
        # internally — they still feed the Assumptions Engine's
        # business_quality dimension (fundamental_analysis_service.py).
        "sector_model_note": data.get("sector_model_note"),
        # `fair_value_engine` (the rule-based justified-multiple model) is no
        # longer computed/exposed here either — Nuvos AI Fair Value Engine
        # redesign, Incremento 16: never shown as an independent method on
        # web, and its mobile-only card (FinalResultPanel) was retired in
        # the same increment. The module itself stays: its 6 adjustment
        # functions are a direct dependency of exit_multiple_engine.py
        # (Incremento 1) — see fair_value_engine.py's updated docstring.
        "industry_benchmarks": _asdict_or_none(industry_benchmarks),
        "quality_engine": quality_engine_result,
        # "Calidad de la valuación" card (Modelo Completo follow-up, see
        # /Users/diegoarria/.claude/plans/stateful-painting-flurry.md) —
        # both real, already computed elsewhere in this same request (beta
        # for CAPM WACC, years_available for confidence_meter_v3 above),
        # just not previously copied into this response dict.
        "years_available": data.get("data_years_available", 0),
        "beta": (dcf.get("wacc_details") or {}).get("beta"),
        "moat_engine": moat_engine_result,
        "conviction_engine": conviction_engine_result,
        "peer_comparison_engine": peer_comparison_result,
        "deterioration_engine": deterioration_result,
        "capital_allocation_engine": capital_allocation_result,
        "earnings_quality_engine": earnings_quality_result,
        "relative_valuation": relative_valuation,
        "historical_valuation": historical_valuation,
        # Real Finnhub analyst consensus price target — a genuinely
        # different reference point than the DCF (sell-side, largely
        # multiple/momentum-driven, not cash-flow-based), never blended
        # into it. Exposed for the "Otros puntos de referencia" section
        # of FairValueScenariosPanel (Incremento 17 — visual redesign).
        "analyst_price_target": data.get("analyst_target"),
        "summary": ai_result.get("summary", ""),
        "checklist": checklist,
        "liquidity_gate": data.get("liquidity_gate"),
        "generated_at": int(time.time()),
        # Internal bookkeeping field — not part of the documented response
        # shape, only read by quick_analysis() to decide whether this cache
        # entry is still valid (see _latest_reported_earnings_period).
        "_earnings_period": await asyncio.to_thread(_latest_reported_earnings_period, ticker),
    }
    return result


_FREE_VI_SEARCH_LIMIT = 3
_VI_SEARCH_WINDOW_HOURS = 24 * 7  # 1 week


async def _check_and_increment_vi_search_limit(user_id: str, profile) -> None:
    """Free users get 3 Valor Intrínseco searches per rolling 7-day window
    (raised from 2 to 3, Diego, 2026-08-19: explicit revision of the Aug 16
    spec's original limit — "esas 3 búsquedas x semana"), on top of the
    always-free default Apple view (see `is_default_view` in
    quick_analysis, which skips this check entirely). Premium is
    unlimited — the caller checks _is_premium and skips this entirely for
    a Premium user. Same counter+window pattern as chat.py's
    msg_count/msg_window_start free-message limit."""
    db = get_supabase()
    now = datetime.now(timezone.utc)
    window_start = None
    if profile.vi_search_window_start:
        try:
            window_start = datetime.fromisoformat(profile.vi_search_window_start.replace("Z", "+00:00"))
        except Exception:
            pass

    if window_start is None or (now - window_start) >= timedelta(hours=_VI_SEARCH_WINDOW_HOURS):
        await run_query(
            db.table("user_profiles").update({
                "vi_search_count": 1,
                "vi_search_window_start": now.isoformat(),
            }).eq("user_id", user_id)
        )
        return

    if profile.vi_search_count >= _FREE_VI_SEARCH_LIMIT:
        reset_at = window_start + timedelta(hours=_VI_SEARCH_WINDOW_HOURS)
        days_left = max(1, int((reset_at - now).total_seconds() / 86400))
        raise HTTPException(
            status_code=429,
            detail={
                "code": "vi_search_limit",
                "message": f"Ya usaste tus {_FREE_VI_SEARCH_LIMIT} búsquedas gratis de esta semana. Actívate Premium para búsquedas ilimitadas, o vuelve en {days_left} día(s).",
                "reset_in_days": days_left,
            },
        )

    await run_query(
        db.table("user_profiles").update({"vi_search_count": profile.vi_search_count + 1}).eq("user_id", user_id)
    )


def _vi_search_limit_already_exceeded(profile) -> bool:
    """Read-only twin of _check_and_increment_vi_search_limit — never
    increments. company_diagnostic (below) is called in parallel with
    quick_analysis for the same search action; quick_analysis is the one
    that actually counts it against the weekly allowance, so
    company_diagnostic must not double-charge the same search — it only
    asks "has this profile already used up this week's free searches",
    same window math, same limit, zero side effect.

    Diego, 2026-08-19: "vamos a asustar a todos los usuarios si no
    mostramos valor" — company_diagnostic (the real 4-pillar Ficha de
    Diagnóstico) used to be a flat Premium-only 403 for every free/guest
    request, showing nothing but an upsell card even on a search that was
    well within the free weekly allowance. Free and guest users now get
    the identical real diagnostic Premium sees, for their first
    _FREE_VI_SEARCH_LIMIT searches each week."""
    now = datetime.now(timezone.utc)
    window_start = None
    if profile.vi_search_window_start:
        try:
            window_start = datetime.fromisoformat(profile.vi_search_window_start.replace("Z", "+00:00"))
        except Exception:
            pass
    if window_start is None or (now - window_start) >= timedelta(hours=_VI_SEARCH_WINDOW_HOURS):
        return False
    return profile.vi_search_count >= _FREE_VI_SEARCH_LIMIT


# Guest (no account) equivalent of the counter above — same 3-per-7-days
# rule, but a guest has no user_profiles row to store it on, so it lives in
# the cache layer instead (Redis when configured, in-memory otherwise — see
# app/core/cache.py), keyed by a client-generated anonymous id that persists
# in the guest's browser (never a real identity, never tied to an account
# even if they later register). Diego, 2026-08-19: "quiero que los free y
# los usuarios sin cuenta puedan tener acceso a sus 3 búsquedas semanales
# en Oportunidades" — quick-analysis required a real session before this,
# so a true guest (no token at all) couldn't call it, period, no matter
# what the free-tier copy promised.
def _guest_vi_search_key(guest_id: str) -> str:
    return f"guest_vi_search:{guest_id}"


async def _check_and_increment_guest_vi_search_limit(guest_id: str) -> None:
    now = datetime.now(timezone.utc)
    key = _guest_vi_search_key(guest_id)
    entry = cache_get(key)
    window_start = None
    if entry:
        try:
            window_start = datetime.fromisoformat(entry["window_start"])
        except Exception:
            window_start = None

    if window_start is None or (now - window_start) >= timedelta(hours=_VI_SEARCH_WINDOW_HOURS):
        cache_set(key, {"count": 1, "window_start": now.isoformat()}, ttl=_VI_SEARCH_WINDOW_HOURS * 3600)
        return

    count = entry.get("count", 0) if entry else 0
    if count >= _FREE_VI_SEARCH_LIMIT:
        reset_at = window_start + timedelta(hours=_VI_SEARCH_WINDOW_HOURS)
        days_left = max(1, int((reset_at - now).total_seconds() / 86400))
        raise HTTPException(
            status_code=429,
            detail={
                "code": "vi_search_limit",
                "message": f"Ya usaste tus {_FREE_VI_SEARCH_LIMIT} búsquedas gratis de esta semana. Crea una cuenta gratis para guardar tu historial, o vuelve en {days_left} día(s).",
                "reset_in_days": days_left,
            },
        )

    cache_set(key, {"count": count + 1, "window_start": window_start.isoformat()}, ttl=_VI_SEARCH_WINDOW_HOURS * 3600)


def _guest_vi_search_limit_already_exceeded(guest_id: str) -> bool:
    """Read-only twin of _check_and_increment_guest_vi_search_limit — see
    _vi_search_limit_already_exceeded's own comment for why company-
    diagnostic-public must never increment this counter itself."""
    entry = cache_get(_guest_vi_search_key(guest_id))
    if not entry:
        return False
    try:
        window_start = datetime.fromisoformat(entry["window_start"])
    except Exception:
        return False
    if (datetime.now(timezone.utc) - window_start) >= timedelta(hours=_VI_SEARCH_WINDOW_HOURS):
        return False
    return entry.get("count", 0) >= _FREE_VI_SEARCH_LIMIT


_DEFAULT_VI_TICKER = "AAPL"


@router.get("/quick-analysis")
@limiter.limit("30/minute")
async def quick_analysis(
    request: Request,
    query: str, lang: str | None = None, is_default_view: bool = False, user_id: str = Depends(get_current_user_id),
):
    """Ad-hoc single-ticker valuation search — the real DCF engine (same one
    behind Arthur and the undervalued screener) plus a SHORT narrative
    summary (see ai_service.generate_quick_valuation_summary), for any
    ticker/company name, not just the curated screener universe.

    The DCF+AI analysis is cached for up to 3 months per (ticker, lang) —
    this used to be fully live on every request (both the Claude call AND
    the FMP/Finnhub fetches behind get_fundamental_analysis re-ran every
    search), which meant a popular ticker got re-billed on every single
    search with no cost tracking at all. Fundamentals only meaningfully
    change once the company reports new earnings, so on every cache hit we
    cheaply check _latest_reported_earnings_period and recompute the whole
    analysis (numbers + AI text together, never just one or the other) the
    moment it changes — the 3-month TTL is just a safety-net ceiling, not
    the real trigger. The price/change_pct shown, however, is NEVER served
    stale: _with_live_price overlays a live (≤60s-old) quote on top of the
    cached analysis on every request, cache hit or not.

    `lang` is passed explicitly by the frontend (see /undervalued's
    docstring for why this is preferred over profile.preferred_language)."""
    from app.api.routes.chat import _is_premium
    profile = await _get_user_profile_safe(user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found. Complete onboarding first.")
    # Free users get 1 search per week as a taste of the real feature —
    # Premium is unlimited. Checked here (not a flat block) so the search
    # box itself is never fully behind a paywall. The screen's own default
    # AAPL view (`is_default_view`, set by the frontend only for the
    # auto-load on open, never for an explicit user search) is exempt from
    # this counter entirely — Diego: Apple must always open, no matter
    # what, same as web. Validated against the literal query (not the
    # resolved ticker) so a client can't fake `is_default_view=true` for an
    # arbitrary ticker to bypass the limit.
    if not _is_premium(profile):
        if not (is_default_view and query.strip().upper() == _DEFAULT_VI_TICKER):
            await _check_and_increment_vi_search_limit(user_id, profile)

    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="Escribe un ticker o nombre de empresa")

    if lang not in ("es", "en"):
        lang = getattr(profile, "preferred_language", None) or "es"

    ticker = await asyncio.to_thread(_resolve_quick_ticker, query)
    if not ticker:
        raise HTTPException(status_code=404, detail="No se pudo identificar esa empresa/ticker")

    result = await _quick_analysis_result(ticker, lang)
    _log_thesis_event(user_id, ticker, result)
    return _with_live_price(result, ticker)


async def _quick_analysis_result(ticker: str, lang: str) -> dict:
    """Cache-or-build core shared by the authenticated /quick-analysis
    above and the no-auth /quick-analysis/public below — same real numbers
    either way, the only difference between the two routes is how the
    caller is identified for the free-tier weekly counter. Caller still
    applies _with_live_price() and any user-specific side effect
    (_log_thesis_event) on top of what this returns."""
    cache_key = _quick_analysis_cache_key(ticker, lang)
    cached = cache_get(cache_key)
    if cached:
        current_period = await asyncio.to_thread(_latest_reported_earnings_period, ticker)
        cached_period = cached.get("_earnings_period")
        # Only recompute when we positively KNOW a new period was reported —
        # if the live check fails (rate-limited, Finnhub hiccup) we fall back
        # to the cache rather than pay for a full recompute on a false alarm.
        if not current_period or current_period == cached_period:
            return cached

    result = await _build_quick_analysis(ticker, lang)
    # Only successful, complete results are cached — never a 404/503, so a
    # transient provider hiccup doesn't get "stuck" wrong for 3 months.
    cache_set(cache_key, result, _QUICK_ANALYSIS_CACHE_TTL)
    return result


@router.get("/quick-analysis/public")
@limiter.limit("20/minute")
async def quick_analysis_public(
    request: Request, query: str, guest_id: str = Query(..., min_length=1),
    lang: str | None = None, is_default_view: bool = False,
):
    """No-auth counterpart of /quick-analysis for guests browsing without
    an account — Diego, 2026-08-19: "quiero que los free y los usuarios
    sin cuenta puedan tener acceso a sus 3 búsquedas semanales en
    Oportunidades." The authenticated route requires a real session, so a
    true guest (no token at all) couldn't call it before this, no matter
    what the free-tier copy on screen promised.

    Same real DCF engine, same cache, same 3-per-week rule as the
    authenticated route — just keyed by a client-generated anonymous
    `guest_id` (stored in the guest's own browser, never a real identity,
    never tied to an account even if they later register) instead of a
    Supabase user_id, since a guest has no user_profiles row to store a
    counter on (see _check_and_increment_guest_vi_search_limit). Skips
    _log_thesis_event — nothing to attribute a thesis-history entry to
    without a real account — and the company-diagnostic Premium upsell is
    untouched by this at all; this only unlocks the same quick valuation
    summary a free logged-in user already gets, not the Premium ficha."""
    guest_id = (guest_id or "").strip()
    if not (is_default_view and query.strip().upper() == _DEFAULT_VI_TICKER):
        await _check_and_increment_guest_vi_search_limit(guest_id)

    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="Escribe un ticker o nombre de empresa")

    if lang not in ("es", "en"):
        lang = "es"

    ticker = await asyncio.to_thread(_resolve_quick_ticker, query)
    if not ticker:
        raise HTTPException(status_code=404, detail="No se pudo identificar esa empresa/ticker")

    result = await _quick_analysis_result(ticker, lang)
    return _with_live_price(result, ticker)


_NIF_DASHBOARD_CACHE_TTL = _QUICK_ANALYSIS_CACHE_TTL  # same ceiling philosophy as quick-analysis


def _nif_dashboard_cache_key(ticker: str, lang: str) -> str:
    # v5 — same reason as _quick_analysis_cache_key's v9 bump: the Valuation
    # pillar/Confidence Score both derive from nuvos_fair_value, which Nuvos
    # Fair Value Engine V2 Phases 1-4 changed (real reclassifications from
    # Phase 1, new business_economics/uncertainty_profile/outlier_flags
    # fields from Phases 2-4).
    # v4 — same reason as _quick_analysis_cache_key's v6 bump: the Valuation
    # pillar/Confidence Score both derive from nuvos_fair_value, which the
    # avg_roic recency-weighting fix changed (sometimes from None to a real
    # value — a stale entry wouldn't just be a slightly-off number, it could
    # be a pillar with no data at all where one now exists).
    # v3 — same reason as _quick_analysis_cache_key's v4 bump: the "Modelo
    # Completo" changes touch the same nuvos_fair_value dict this dashboard
    # reads its Valuation pillar/Confidence Score from.
    # v2 — same reason as _quick_analysis_cache_key's v3 bump: the NIF
    # dashboard's Valuation pillar and Confidence Score both derive from
    # the DCF the Nuvos AI Fair Value Engine redesign rewrote end to end.
    return f"nif_dashboard:v5:{lang}:{ticker}"


@router.get("/nif-dashboard")
async def nif_dashboard(query: str, lang: str | None = None, user_id: str = Depends(get_current_user_id)):
    """Nuvos Investment Framework (NIF) — the 4-pillar (Business Quality,
    Financial Strength, Management Quality, Valuation) AI-driven dashboard
    for a single ticker. Separate endpoint from /quick-analysis on purpose:
    different cache lifetime/failure domain, and /quick-analysis's response
    shape is load-bearing for the manual Intrinsic Value Calculator, which
    must never change. The frontend calls both in parallel for the same
    search — a NIF failure must never affect the calculator, and vice versa.

    Premium-only in this first phase (unlike /quick-analysis, which gives
    free users one search/week) — this avoids the free-tier weekly search
    counter being decremented twice for what the user experiences as one
    search action."""
    from app.api.routes.chat import _is_premium
    profile = await _get_user_profile_safe(user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found. Complete onboarding first.")
    if not _is_premium(profile):
        raise HTTPException(status_code=403, detail={
            "code": "premium_required",
            "message": "El análisis Nuvos Investment Framework es exclusivo para Premium.",
        })

    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="Escribe un ticker o nombre de empresa")

    if lang not in ("es", "en"):
        lang = getattr(profile, "preferred_language", None) or "es"

    ticker = await asyncio.to_thread(_resolve_quick_ticker, query)
    if not ticker:
        raise HTTPException(status_code=404, detail="No se pudo identificar esa empresa/ticker")

    cache_key = _nif_dashboard_cache_key(ticker, lang)
    cached = cache_get(cache_key)
    if cached:
        current_period = await asyncio.to_thread(_latest_reported_earnings_period, ticker)
        cached_period = cached.get("_earnings_period")
        if not current_period or current_period == cached_period:
            return _with_live_price(cached, ticker)

    try:
        result = await nif_service.build_nif_dashboard(ticker, lang)
    except Exception as exc:
        logger.error("nif_dashboard(%s): build_nif_dashboard failed: %s", ticker, exc, exc_info=True)
        raise HTTPException(status_code=503, detail=f"No pudimos generar el análisis NIF de {ticker} en este momento. Intenta de nuevo en unos segundos.")
    if not result:
        raise HTTPException(status_code=404, detail=f"No hay suficientes datos financieros reales para analizar {ticker}")

    result["_earnings_period"] = await asyncio.to_thread(_latest_reported_earnings_period, ticker)
    cache_set(cache_key, result, _NIF_DASHBOARD_CACHE_TTL)
    return _with_live_price(result, ticker)


_COMPANY_DIAGNOSTIC_CACHE_TTL = _QUICK_ANALYSIS_CACHE_TTL  # same 90-day ceiling philosophy


def _company_diagnostic_cache_key(ticker: str, lang: str) -> str:
    # v6 — bumped because `company_diagnostic_service.py` (scoreLabel,
    # badges, moatPoints, competitor comparison rows/conclusion,
    # financialHealth "N/D" fallbacks) and `moat_engine.py`'s MoatFactor
    # reasons were previously Spanish-only regardless of `lang` — English
    # requests cached under v5 have Spanish text baked in. A v5 entry
    # predates the real per-lang templated strings.
    # v5 — bumped for methodology audit round 5 — mandatory per-share Fair
    # Value Engine (see /Users/diegoarria/.claude/plans/cosmic-munching-
    # crown.md): GQV's growth-evidence hierarchy has a new top-priority
    # per-share-compounded tier, and the legacy DCF/Reverse DCF now use a
    # real per-year shrinking share count. A v4 entry predates this.
    # v4 — bumped for methodology audit round 3 (see /Users/diegoarria/
    # .claude/plans/cosmic-munching-crown.md): ROIC operating-invested-
    # capital fallback + roicAdjustedForBuybacks flag, AI narrative now
    # cites the real GQV-first fair value, and new internal _epsGaap/
    # _epsNormalized fields power the cache-hit live-price overlay.
    # v3 — bumped for methodology audit round 2 (see /Users/diegoarria/
    # .claude/plans/cosmic-munching-crown.md): net cash now includes Long
    # Term Investments, plus new peForward/peNormalized valuation fields.
    # v2 — bumped for the FCF maintenance/growth-CapEx normalization fix
    # (see /Users/diegoarria/.claude/plans/cosmic-munching-crown.md,
    # methodology audit) — this endpoint's valuation fields derive from the
    # same gqv_fair_value output that changed. A v1 entry predates the fix.
    # v7 — bumped 2026-08-19: same shares_outstanding fix as
    # _quick_analysis_cache_key's v14 bump (dual-class tickers like BRK.B
    # had a ~1500x-inflated fair value).
    # v8 — bumped 2026-08-19: new `sectorModelNote` field, surfacing the
    # financial-sector `valuation_sanity_warning` (was computed but
    # discarded before — confirmed live for BRK.B) to this, the only
    # currently-active diagnostic UI.
    # v9 — bumped 2026-08-19: same pe_on_normalized_eps fix as
    # _quick_analysis_cache_key's v16 bump — a v8 entry for a financial-
    # sector ticker with no GAAP/forward P/E is a cached 404 (build_
    # company_diagnostic returned None), not a cached success, so this
    # doesn't even need a special "was it a null result" check — a stale
    # None simply gets recomputed for real once this key changes.
    return f"company_diagnostic:v9:{lang}:{ticker}"


async def _company_diagnostic_result(query: str, lang: str | None, user_id: str | None) -> dict:
    """Shared core for company_diagnostic (authenticated) and
    company_diagnostic_public (guest) — identical real data for both, only
    the caller's weekly-allowance check and thesis-logging differ."""
    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="Escribe un ticker o nombre de empresa")

    if lang not in ("es", "en"):
        lang = lang or "es"

    ticker = await asyncio.to_thread(_resolve_quick_ticker, query)
    if not ticker:
        raise HTTPException(status_code=404, detail="No se pudo identificar esa empresa/ticker")

    cache_key = _company_diagnostic_cache_key(ticker, lang)
    cached = cache_get(cache_key)
    if cached:
        current_period = await asyncio.to_thread(_latest_reported_earnings_period, ticker)
        cached_period = cached.get("_earnings_period")
        if not current_period or current_period == cached_period:
            return await asyncio.to_thread(_with_live_price_diagnostic, cached, ticker)

    from app.services.fundamental_analysis_service import get_fundamental_analysis
    from app.services.company_diagnostic_service import build_company_diagnostic
    from app.services.ai_service import generate_company_diagnostic_narrative

    data = await asyncio.to_thread(get_fundamental_analysis, ticker)
    if not data:
        logger.warning("company_diagnostic(%s): get_fundamental_analysis returned falsy", ticker)
        raise HTTPException(status_code=404, detail=f"No hay suficientes datos financieros reales para diagnosticar {ticker}")

    # Wrapped so an unexpected exception here (a real code bug hitting some
    # ticker-specific data shape, not one of build_company_diagnostic's own
    # deliberate None-return gates, which already log their own reason) logs
    # loudly with a traceback instead of surfacing as an opaque, unlabeled
    # 500 indistinguishable from every other failure on this endpoint.
    try:
        diagnostic = await asyncio.to_thread(build_company_diagnostic, ticker, data, lang)
    except Exception:
        logger.exception("company_diagnostic(%s): build_company_diagnostic raised", ticker)
        raise HTTPException(status_code=404, detail=f"No hay suficientes datos financieros reales para diagnosticar {ticker}")
    if not diagnostic:
        raise HTTPException(status_code=404, detail=f"No hay suficientes datos financieros reales para diagnosticar {ticker}")

    narrative = None
    try:
        narrative = await generate_company_diagnostic_narrative(
            data=data, diagnostic=diagnostic, lang=lang, user_id=user_id,
        )
    except Exception as exc:
        logger.warning("company_diagnostic(%s): narrative generation failed: %s", ticker, exc)
    if narrative:
        diagnostic["oneLinerPitch"] = narrative.get("oneLinerPitch") or f"{diagnostic['companyName']} ({ticker}) — {diagnostic['scoreLabel']}."
        diagnostic["investmentThesis"] = narrative.get("investmentThesis")
        diagnostic["noiseVsReality"] = narrative.get("noiseVsReality")
        diagnostic["actionPlan"] = narrative.get("actionPlan")
    else:
        # oneLinerPitch is the one narrative-adjacent field the frontend
        # always renders (never treated as optional) — when the AI call
        # fails, fall back to a real, templated sentence built purely from
        # already-real fields (never a fabricated number/claim), same
        # discipline as badges/moatPoints. The other 3 fields stay None
        # (never a fabricated placeholder) — the frontend must treat those
        # as optional rather than show fake narrative.
        diagnostic["oneLinerPitch"] = f"{diagnostic['companyName']} ({ticker}) — {diagnostic['scoreLabel']}."
        diagnostic["investmentThesis"] = None
        diagnostic["noiseVsReality"] = None
        diagnostic["actionPlan"] = None

    diagnostic["_earnings_period"] = await asyncio.to_thread(_latest_reported_earnings_period, ticker)
    cache_set(cache_key, diagnostic, _COMPANY_DIAGNOSTIC_CACHE_TTL)
    return diagnostic


@router.get("/company-diagnostic")
@limiter.limit("30/minute")
async def company_diagnostic(request: Request, query: str, lang: str | None = None, user_id: str = Depends(get_current_user_id)):
    """CompanyDiagnosticCard's real-data backing (see /Users/diegoarria/
    .claude/plans/cosmic-munching-crown.md) — real deterministic scores/
    badges/moat-points/competitor-comparison from `company_diagnostic_
    service.py`, plus ONE new on-demand AI call (`ai_service.generate_
    company_diagnostic_narrative`) for the thesis/noise-vs-reality/action-
    plan narrative fields.

    Free/guest users get the identical real diagnostic Premium sees, for
    their first _FREE_VI_SEARCH_LIMIT searches each week (Diego, 2026-08-19:
    "vamos a asustar a todos los usuarios si no mostramos valor" — a flat
    Premium-only 403 showed nothing but an upsell card even on searches well
    within the free weekly allowance). This endpoint is called in parallel
    with /quick-analysis for the same search action; quick_analysis is the
    one that actually increments the weekly counter, so this only performs a
    READ-ONLY check (_vi_search_limit_already_exceeded) to avoid double-
    charging the same search.

    Cached per (ticker, lang) for up to 90 days, same earnings-period
    freshness re-check as /quick-analysis and /nif-dashboard — this is a
    genuinely on-demand endpoint, never called from the weekly full-universe
    screener refresh (see company_diagnostic_service.py's own docstring for
    the cost reasoning)."""
    from app.api.routes.chat import _is_premium
    profile = await _get_user_profile_safe(user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found. Complete onboarding first.")
    if not _is_premium(profile) and _vi_search_limit_already_exceeded(profile):
        raise HTTPException(status_code=403, detail={
            "code": "premium_required",
            "message": "La Ficha de Diagnóstico Nuvos AI es exclusiva para Premium.",
        })

    if lang not in ("es", "en"):
        lang = getattr(profile, "preferred_language", None) or "es"

    diagnostic = await _company_diagnostic_result(query, lang, user_id)
    return diagnostic


@router.get("/company-diagnostic/public")
@limiter.limit("20/minute")
async def company_diagnostic_public(request: Request, query: str, guest_id: str = Query(..., min_length=1), lang: str | None = None):
    """Guest (no account) equivalent of company_diagnostic — same real data,
    same cache, gated by the same read-only weekly-allowance check keyed by
    an anonymous client-generated guest_id (see _guest_vi_search_limit_
    already_exceeded / quick_analysis_public for the identical pattern)."""
    if _guest_vi_search_limit_already_exceeded(guest_id):
        raise HTTPException(status_code=403, detail={
            "code": "premium_required",
            "message": "La Ficha de Diagnóstico Nuvos AI es exclusiva para Premium.",
        })
    if lang not in ("es", "en"):
        lang = "es"
    diagnostic = await _company_diagnostic_result(query, lang, None)
    return diagnostic


def _log_thesis_event(user_id: str, ticker: str, result: dict) -> None:
    """Investment Graph — every time a user views this ticker's valuation
    (whether freshly computed or served from cache), it's logged as a
    'thesis' node in that company's history. Logged on BOTH exit paths of
    quick_analysis (cache hit and fresh compute) since viewing the analysis
    is the event that matters here, not whether the numbers were recomputed."""
    from app.services import investment_graph_service as graph_service
    asyncio.create_task(graph_service.log_event(
        user_id, ticker, "thesis",
        payload={
            "company_name": result.get("company_name"),
            "price": result.get("price"),
            "margin_of_safety_pct": result.get("margin_of_safety_pct"),
            "composite_score": result.get("composite_score"),
            "confidence_meter": result.get("confidence_meter"),
        },
    ))


_WEEKLY_HISTORY_TTL = 24 * 86400  # ~3 weeks — rolling "don't repeat" window
_WEEKLY_HISTORY_MAX = 15          # last 3 weeks' worth of picks (5/week)


def _weekly_cache_key(user_id: str) -> str:
    # isocalendar() weeks run Mon-Sun, but the Screener Semanal cadence is
    # Sunday-to-Saturday (generated + pushed Sunday morning, see worker.py's
    # job_weekly_screener_generate) — shift the date forward one day so
    # Sunday itself already lands in the upcoming week's bucket instead of
    # the ending one, or Sunday's pre-generated cache would be written under
    # a key that goes stale the moment Monday's real ISO week begins.
    shifted = datetime.now() + timedelta(days=1)
    iso_year, iso_week, _ = shifted.isocalendar()
    return f"screener:weekly:{user_id}:{iso_year}:{iso_week}"


def _weekly_history_key(user_id: str) -> str:
    return f"screener:weekly:history:{user_id}"


async def _generate_weekly_picks_for_user(
    user_id: str, existing: list[str], stocks: list[dict], profile=None,
) -> dict:
    """Shared by the on-demand /weekly route and the Sunday pre-generation
    job (worker.py's job_weekly_screener_generate) — same personalization,
    same hard risk-tier guardrail, same repeat-avoidance history, whichever
    caller populates the week's cache first."""
    recent = cache_get(_weekly_history_key(user_id)) or []
    # Also skip tickers shown in recent weeks — falls back to the full pool
    # if that filter would leave nothing (never block a user down to zero).
    candidates_all = [s for s in stocks if s["ticker"] not in existing]
    candidates = [s for s in candidates_all if s["ticker"] not in recent] or candidates_all

    if profile is None:
        profile = await _get_user_profile_safe(user_id)
    result = await ai_service.generate_weekly_picks(candidates, profile, existing, recent_tickers=recent)
    result["generated_at"] = datetime.now().isoformat()

    new_tickers = [p["ticker"] for p in result.get("picks", []) if p.get("ticker")]
    if new_tickers:
        updated_history = (new_tickers + [t for t in recent if t not in new_tickers])[:_WEEKLY_HISTORY_MAX]
        cache_set(_weekly_history_key(user_id), updated_history, ttl=_WEEKLY_HISTORY_TTL)

    return result


@router.get("/weekly")
async def weekly_picks(
    tickers: str = "",
    user_id: str = Depends(get_current_user_id),
):
    """Return 5 personalized weekly picks based on user profile and existing
    portfolio — this is the Screener Semanal. Cache is pre-warmed for every
    Premium user every Sunday by worker.py's job_weekly_screener_generate;
    this on-demand path is the fallback for any user that job missed (new
    Premium user mid-week, a run that failed for them, etc.), so the cache
    is never left empty until next Sunday.

    Premium-only: the Sunday batch job already only generates for Premium
    users, but this on-demand fallback had no gate at all, so a Free user
    hitting this endpoint directly got the real AI-generated picks for
    free (and cost a real Claude call on top of it). Diego, 2026-08-30 —
    Free's web/mobile card now renders its own blurred preview and never
    calls this route; this is the actual enforcement, not just UI
    politeness."""
    from app.api.routes.chat import _is_premium
    profile = await _get_user_profile_safe(user_id)
    if not _is_premium(profile):
        return {"locked": True, "week_theme": None, "business_profile": None, "picks": [], "mentor_note": None, "disclaimer": None}

    existing  = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    cache_key = _weekly_cache_key(user_id)
    cached    = cache_get(cache_key)
    if cached:
        return cached

    # Rare path (Sunday's job already pre-warms every Premium user's cache —
    # see job_weekly_screener_generate) — but it still needs to answer FAST
    # when it does happen, not stall the request on a full ~556-ticker scan.
    # A random 200-ticker sample of UNIVERSE (bounded-parallel via
    # _fetch_batch) gives generate_weekly_picks() a plenty-diverse candidate
    # pool for one user's 5 picks without the full scan's worst-case
    # latency; the Sunday job still uses the complete UNIVERSE for
    # everyone's regular weekly cache, so no user permanently sees a
    # smaller-than-intended universe.
    sample_size = min(200, len(UNIVERSE))
    universe_sample = random.sample(UNIVERSE, sample_size)
    stocks = await asyncio.to_thread(_fetch_batch, universe_sample)
    stocks.sort(key=lambda x: x.get("score", 0), reverse=True)

    result = await _generate_weekly_picks_for_user(user_id, existing, stocks)
    cache_set(cache_key, result, ttl=_WEEKLY_TTL)
    return result


@router.post("/alert-context")
async def alert_context(request: dict, user_id: str = Depends(get_current_user_id)):
    """Return AI context for a price alert (called when user taps an alert)."""
    ticker    = request.get("ticker", "").upper()
    change_pct = request.get("change_pct", 0)
    profile   = await _get_user_profile_safe(user_id)
    direction = "subió" if change_pct >= 0 else "cayó"
    event     = f"{ticker} {direction} {abs(change_pct):.1f}% hoy"
    insight   = await ai_service.generate_alert_context(ticker, change_pct, profile)
    return {"ticker": ticker, "change_pct": change_pct, "insight": insight}
