"""Escopo de colaboradores por gestão.

Regra: um usuário cujo cadastro de técnico tem cargo de SUPERVISOR enxerga
apenas os colaboradores sob a sua gestão (ele mesmo + quem tem ele como
gestor, direta ou indiretamente). Coordenadores, gerentes e demais cargos
não sofrem essa restrição. Superusuários e usuários "equipe" (is_staff,
administradores) também não.
"""

import unicodedata

from core.models import Collaborator


def _normalize(value):
    text = unicodedata.normalize("NFKD", value or "")
    return "".join(c for c in text if not unicodedata.combining(c)).lower()


def is_supervisor(collaborator):
    title = collaborator.job_title.name if collaborator.job_title_id else ""
    return "supervisor" in _normalize(title)


def managed_collaborator_ids(user):
    """IDs de colaboradores que o usuário pode ver, ou None quando não há
    restrição por gestão."""
    if user is None or not getattr(user, "is_authenticated", False):
        return None
    if user.is_superuser or user.is_staff:
        return None
    person = getattr(user, "person", None)
    collaborator = getattr(person, "collaborator_role", None) if person is not None else None
    if collaborator is None or not is_supervisor(collaborator):
        return None

    visible = {collaborator.pk}
    frontier = {collaborator.pk}
    while frontier:
        children = set(Collaborator.objects.filter(manager_id__in=frontier).values_list("pk", flat=True))
        frontier = children - visible
        visible |= children
    return visible


def scope_collaborators(queryset, user, field="pk"):
    """Restringe um queryset ao que o gestor-supervisor pode ver. `field` é o
    caminho até o id do colaborador (ex.: "collaborator_id")."""
    ids = managed_collaborator_ids(user)
    if ids is None:
        return queryset
    return queryset.filter(**{f"{field}__in": ids})
