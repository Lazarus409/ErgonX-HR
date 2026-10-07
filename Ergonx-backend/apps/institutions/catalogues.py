"""Authoritative locale catalogues exposed to the browser.

ISO data comes from pycountry, currency display names/symbols from Babel, and
time-zone identifiers from Python's IANA zoneinfo database.
"""

from functools import lru_cache
from zoneinfo import available_timezones

import pycountry
from babel.numbers import get_currency_name, get_currency_symbol, get_territory_currencies


@lru_cache(maxsize=1)
def locale_catalogues():
    countries = sorted(
        ({"code": item.alpha_2, "name": item.name, "default_currency": (get_territory_currencies(item.alpha_2, tender=True) or [""])[0]} for item in pycountry.countries),
        key=lambda item: item["name"],
    )
    currencies = sorted(
        (
            {
                "code": item.alpha_3,
                "name": get_currency_name(item.alpha_3, locale="en"),
                "symbol": get_currency_symbol(item.alpha_3, locale="en"),
            }
            for item in pycountry.currencies
            if hasattr(item, "alpha_3")
        ),
        key=lambda item: item["code"],
    )
    return {
        "countries": countries,
        "currencies": currencies,
        "timezones": [{"id": value, "name": value.replace("_", " ")} for value in sorted(available_timezones())],
    }
