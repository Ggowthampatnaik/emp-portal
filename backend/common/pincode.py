"""Indian PIN code lookup: a PIN code in, its town, state and areas out.

The source is India Post's directory as published by api.postalpincode.in -
free, no key, every PIN code with each post office's district and state. It is
called from here, not from the browser, so the answer can be cached and the
form never depends on a third-party site being up: if the lookup fails, the
person types the rest of the address themselves.

The directory still uses some older names ("Jammu & Kashmir" for Leh,
"Pondicherry", "Daman & Diu"), so states are mapped onto the current names the
address form offers (common/address.py).
"""

import logging
import re
from collections import Counter

import requests
from django.conf import settings
from django.core.cache import cache

from common.address import INDIAN_PIN, INDIAN_STATES

logger = logging.getLogger("empportal.pincode")

FOUND_FOR = 60 * 60 * 24 * 30  # PIN codes do not move
NOT_FOUND_FOR = 60 * 60 * 24  # but the directory does get new ones

#: Older or abbreviated names in the directory -> today's official ones.
STATE_ALIASES = {
    "andaman and nicobar": "Andaman and Nicobar Islands",
    "pondicherry": "Puducherry",
    "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
    "daman and diu": "Dadra and Nagar Haveli and Daman and Diu",
    "orissa": "Odisha",
    "uttaranchal": "Uttarakhand",
    "chattisgarh": "Chhattisgarh",
    "new delhi": "Delhi",
}
#: Ladakh became a union territory in 2019; the directory still files it
#: under Jammu & Kashmir.
LADAKH_DISTRICTS = {"leh", "kargil", "leh ladakh"}


class LookupUnavailable(Exception):
    """The directory could not be reached - not the same as "no such PIN"."""


def _key(text: str) -> str:
    """'Jammu & Kashmir' and 'Jammu and Kashmir' compare equal."""
    return " ".join(re.sub(r"[^a-z]+", " ", text.lower().replace("&", " and ")).split())


_BY_KEY = {_key(state): state for state in INDIAN_STATES}

#: The directory drops connections that arrive with python-requests' default
#: User-Agent, so the portal names itself.
HEADERS = {"User-Agent": "TrigyanEmployeePortal/1.0", "Accept": "application/json"}


def normalise_state(state: str, district: str = "") -> str | None:
    """The directory's state name as one of the form's, or None."""
    if _key(district) in LADAKH_DISTRICTS:
        return "Ladakh"
    key = _key(state)
    return _BY_KEY.get(key) or STATE_ALIASES.get(key)


def _title(text: str) -> str:
    """Directory names arrive in mixed case; "NEW DELHI" reads as "New Delhi"."""
    return text.title() if text.isupper() or text.islower() else text


def _town(district: str) -> str:
    """A district name the address form will accept as a town: "Dadra & Nagar
    Haveli" -> "Dadra and Nagar Haveli", brackets and stray symbols dropped."""
    text = district.replace("&", " and ")
    text = re.sub(r"[^\w .'-]+", " ", text)
    return " ".join(_title(text).split())


def _fetch(pincode: str) -> list[dict] | None:
    url = settings.PINCODE_LOOKUP_URL.format(pincode=pincode)
    try:
        response = requests.get(url, headers=HEADERS, timeout=settings.PINCODE_LOOKUP_TIMEOUT)
        response.raise_for_status()
        body = response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning("PIN code lookup failed for %s: %s", pincode, exc)
        raise LookupUnavailable from exc

    entry = body[0] if isinstance(body, list) and body else {}
    if entry.get("Status") != "Success":
        return None
    return entry.get("PostOffice") or None


def lookup_pincode(pincode: str) -> dict | None:
    """Town, state and areas for an Indian PIN code; None when there is no such PIN.

    ``city`` and ``state`` are the most common answer among the PIN code's post
    offices, or None for state when the offices disagree (a PIN on a border) -
    the person picks then. ``areas`` are the post office names, which are what
    people call their locality.
    """
    if not INDIAN_PIN.match(pincode):
        return None

    cache_key = f"pincode:{pincode}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached or None

    offices = _fetch(pincode)
    if not offices:
        cache.set(cache_key, {}, NOT_FOUND_FOR)
        return None

    districts = Counter(_town(o["District"]) for o in offices if o.get("District"))
    states = Counter(
        s for o in offices if (s := normalise_state(o.get("State") or "", o.get("District") or ""))
    )
    result = {
        "pincode": pincode,
        "city": districts.most_common(1)[0][0] if districts else None,
        "state": next(iter(states)) if len(states) == 1 else None,
        "states": sorted(states),
        "areas": sorted({_title(o["Name"]) for o in offices if o.get("Name")}),
    }
    cache.set(cache_key, result, FOUND_FOR)
    return result
