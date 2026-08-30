"""Resolução do motor de regras (Fase 3): dado o texto livre de
`ProjectItem.technology`, encontra a `GenerationRule` ativa correspondente
e retorna suas etapas ordenadas. Casamento tolerante (trim + case-
insensitive) — mesmo idioma já usado em scope_import/services.py pra
resolver activity_type/item_type propostos pela IA contra o catálogo."""

from .models import GenerationRule


def activities_for_technology(technology):
    """Retorna a lista de GenerationRuleStep (ordenados) da regra ativa cuja
    `technology` bate (trim + casefold) com o texto informado, ou uma lista
    vazia se nenhuma regra corresponder."""
    normalized = (technology or "").strip().casefold()
    if not normalized:
        return []
    rule = (
        GenerationRule.objects.filter(is_active=True, technology__iexact=normalized)
        .prefetch_related("steps__activity_type")
        .first()
    )
    if rule is None:
        # technology__iexact já cobre a maioria dos casos (SQL ILIKE), mas
        # não normaliza espaços nas pontas — cai pra uma varredura em
        # Python só quando o iexact não achou nada, pra cobrir esse caso
        # raro sem pagar o custo de sempre carregar todas as regras.
        for candidate in GenerationRule.objects.filter(is_active=True).prefetch_related("steps__activity_type"):
            if candidate.technology.strip().casefold() == normalized:
                rule = candidate
                break
    if rule is None:
        return []
    return list(rule.steps.all())
