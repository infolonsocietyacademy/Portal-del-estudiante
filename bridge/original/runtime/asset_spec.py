"""Explicit gold / Nasdaq-100 symbol identities; never infer from price."""
import re

def asset_kind(symbol):
    if not isinstance(symbol, str):
        return None
    if re.fullmatch(r'XAUUSD(?:[._-]?[A-Za-z0-9]{1,8})?', symbol):
        return 'gold'
    if re.fullmatch(r'(?:NAS100|USTEC|USTECH100|USTECH|US100|USNDX|NDX100)(?:[._-]?[A-Za-z0-9]{1,8})?', symbol, re.I):
        return 'nas100'
    return None

def metadata_matches(symbol, info):
    if info is None or info.currency_profit != 'USD':
        return False
    kind = asset_kind(symbol)
    if kind == 'gold':
        return info.currency_base == 'XAU'
    if kind == 'nas100':
        description = str(getattr(info, 'description', '')).lower()
        return bool(re.search(r'nasdaq|nas[ -]?100|us[ -]?(?:tech|100)|tech[ -]?100', description))
    return False
