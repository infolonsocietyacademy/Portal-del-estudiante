#!/usr/bin/env python3
"""Fetch a bounded public CFTC dataset once for all students. No API key needed."""
import datetime as dt
import json
import os
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1] / 'institutional-flow' / 'data'
API = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json'
MARKETS = {'GC': ('088691', 'GOLD - COMMODITY EXCHANGE INC.'),
           'NQ': ('209742', 'NASDAQ MINI - CHICAGO MERCANTILE EXCHANGE')}
PAGE_SIZE, MAX_RECORDS = 13, 52
SELECT = ','.join(['cftc_contract_market_code', 'market_and_exchange_names',
                   'report_date_as_yyyy_mm_dd', 'open_interest_all', 'change_in_open_interest_all'])


def normalized(rows, code, name, today=None):
    today = today or dt.date.today()
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_RECORDS:
        raise ValueError('Invalid CFTC row count')
    result, previous = [], '9999-12-31'
    for row in rows:
        if row.get('cftc_contract_market_code') != code or row.get('market_and_exchange_names') != name:
            raise ValueError('Unexpected CFTC contract')
        date = str(row['report_date_as_yyyy_mm_dd'])[:10]
        if dt.date.fromisoformat(date) > today or date >= previous:
            raise ValueError('Unordered, duplicate or future report date')
        values = [str(row[key]) for key in ['open_interest_all', 'change_in_open_interest_all']]
        if not all(value.lstrip('-').isdigit() for value in values):
            raise ValueError('Non-integer CFTC contract counts')
        oi, change = map(int, values)
        if not 0 <= oi <= 2**53 - 1 or abs(change) > 2**53 - 1:
            raise ValueError('Invalid CFTC contract counts')
        result.append({'date': date, 'openInterest': oi, 'changeOpenInterest': change})
        previous = date
    return result


def fetch_market(code, name):
    query = urlencode({'$select': SELECT, '$where': f"cftc_contract_market_code = '{code}'",
                       '$order': 'report_date_as_yyyy_mm_dd DESC', '$limit': MAX_RECORDS})
    request = Request(API + '?' + query, headers={'User-Agent': 'OLON-CFTC-Historical-Research/1.0', 'Accept': 'application/json'})
    with urlopen(request, timeout=25) as response:
        if response.headers.get_content_type() != 'application/json':
            raise ValueError('Unexpected CFTC content type')
        body = response.read(128 * 1024 + 1)
    if len(body) > 128 * 1024:
        raise ValueError('CFTC response too large')
    return normalized(json.loads(body), code, name)


def documents(market, rows, checked):
    pages = []
    for offset in range(0, len(rows), PAGE_SIZE):
        page = offset // PAGE_SIZE
        pages.append({'schemaVersion': 1, 'market': market, 'cftcCode': MARKETS[market][0],
                      'source': 'CFTC', 'dataset': '6dca-aqww', 'reportType': 'FUTURES_ONLY',
                      'scope': 'ALL_CONTRACT_MONTHS', 'checkedAt': checked,
                      'latestReportDate': rows[0]['date'], 'page': page, 'pageSize': PAGE_SIZE,
                      'nextPage': page + 1 if offset + PAGE_SIZE < len(rows) else None,
                      'records': rows[offset:offset + PAGE_SIZE]})
    return pages


def sync():
    # Validate both markets before writing any output; errors preserve the previous snapshot.
    collected = {market: fetch_market(code, name) for market, (code, name) in MARKETS.items()}
    checked = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    outputs = {market: documents(market, rows, checked) for market, rows in collected.items()}
    for market, pages in outputs.items():
        directory = ROOT / market
        directory.mkdir(parents=True, exist_ok=True)
        for page, document in enumerate(pages):
            path = directory / f'{page}.json'
            temporary = path.with_suffix('.tmp')
            temporary.write_text(json.dumps(document, ensure_ascii=False, separators=(',', ':')) + '\n')
            os.replace(temporary, path)
        for path in directory.glob('*.json'):
            if path.stem.isdigit() and int(path.stem) >= len(pages):
                path.unlink()
        print(f'{market}: {len(collected[market])} verified weekly reports; latest {collected[market][0]["date"]}')


if __name__ == '__main__':
    sync()
