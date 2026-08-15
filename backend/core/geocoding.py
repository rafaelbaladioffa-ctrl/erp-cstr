import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


def geocode_address(query):
    """Converte um endereço em (latitude, longitude) usando o Nominatim
    (OpenStreetMap), um serviço gratuito de geocodificação. Retorna None
    se o endereço não puder ser localizado ou em caso de erro de rede.
    """
    query = (query or "").strip()
    if not query:
        return None

    contact = getattr(settings, "DEFAULT_FROM_EMAIL", "contato@consultimer.com")
    headers = {"User-Agent": f"ERP-CSTR/1.0 ({contact})"}

    try:
        response = requests.get(
            NOMINATIM_URL,
            params={"q": query, "format": "json", "limit": 1},
            headers=headers,
            timeout=8,
        )
        response.raise_for_status()
        results = response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Falha ao geocodificar '%s': %s", query, exc)
        return None

    if not results:
        return None

    try:
        return float(results[0]["lat"]), float(results[0]["lon"])
    except (KeyError, TypeError, ValueError):
        return None
