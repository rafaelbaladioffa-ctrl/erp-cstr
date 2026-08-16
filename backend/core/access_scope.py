"""Escopo de acesso do usuário-cliente (ver users.User.client/client_sites/
client_categories, em Usuários e Acessos): restringe QUAIS linhas de
Projeto/Categoria um usuário consegue ver/editar/excluir, além das
permissões padrão do Django (add/change/delete/view).

Um usuário vira "usuário-cliente" quando tem um Cliente vinculado
(User.client) — nesse caso ele só enxerga os Projetos daquele Cliente (e,
se preenchidos, só dos Sites e/ou Categorias marcados nele — client_sites e
client_categories filtram Projeto diretamente, além de restringir o próprio
cadastro de Categorias). Usuários sem Cliente vinculado (equipe interna) não
têm nenhuma restrição adicional.

Usado tanto pelo Django Admin (projects/admin.py, core/admin.py) quanto pela
API (api/views.py) — uma única fonte de verdade para a regra de negócio.
"""


def get_scope_for_user(user):
    """Retorna None se o usuário não tem nenhuma restrição (superusuário,
    anônimo, ou sem Cliente vinculado). Caso contrário, retorna um dict
    {"clients": {id}, "sites": set[int] | None, "categories": set[int] | None}
    — None numa dimensão específica significa "sem restrição nessa dimensão"."""
    if not user or not getattr(user, "is_authenticated", False):
        return {"clients": set(), "sites": set(), "categories": set()}
    if user.is_superuser:
        return None
    if not user.client_id:
        return None

    site_ids = set(user.client_sites.values_list("id", flat=True))
    category_ids = set(user.client_categories.values_list("id", flat=True))

    return {
        "clients": {user.client_id},
        "sites": site_ids if site_ids else None,
        "categories": category_ids if category_ids else None,
    }


def scope_project_queryset(
    queryset, user, *, field_prefix="", client_field="client_id", site_field="site_id", category_field="category_id"
):
    """Filtra `queryset` pelo escopo de Cliente/Site/Categoria do usuário.
    Use `field_prefix` (ex: "project__") quando o queryset não é de Project
    diretamente, mas tem uma FK para Project (ex: ProjectTask, RackPosition)."""
    scope = get_scope_for_user(user)
    if scope is None:
        return queryset
    if scope["clients"] is not None:
        queryset = queryset.filter(**{f"{field_prefix}{client_field}__in": scope["clients"]})
    if scope["sites"] is not None:
        queryset = queryset.filter(**{f"{field_prefix}{site_field}__in": scope["sites"]})
    if scope["categories"] is not None:
        queryset = queryset.filter(**{f"{field_prefix}{category_field}__in": scope["categories"]})
    return queryset


def scope_category_queryset(queryset, user):
    scope = get_scope_for_user(user)
    if scope is None:
        return queryset
    if scope["categories"] is not None:
        queryset = queryset.filter(id__in=scope["categories"])
    return queryset


def user_can_access_project(user, project):
    if project is None:
        return True
    scope = get_scope_for_user(user)
    if scope is None:
        return True
    if scope["clients"] is not None and project.client_id not in scope["clients"]:
        return False
    if scope["sites"] is not None and project.site_id not in scope["sites"]:
        return False
    if scope["categories"] is not None and project.category_id not in scope["categories"]:
        return False
    return True


def scope_client_queryset(queryset, user, *, client_field="id"):
    """Filtra `queryset` para o(s) Cliente(s) do escopo do usuário. Use
    `client_field="id"` quando o queryset é de Client diretamente, ou o nome
    da FK (ex: "client_id") quando é de um modelo relacionado a Client."""
    scope = get_scope_for_user(user)
    if scope is None:
        return queryset
    return queryset.filter(**{f"{client_field}__in": scope["clients"]})


def scope_site_queryset(queryset, user, *, client_field="client_id", site_field="id"):
    """Filtra `queryset` de Site (ou relacionado) pelo Cliente e, se
    restrito, pelos Sites marcados no escopo do usuário."""
    scope = get_scope_for_user(user)
    if scope is None:
        return queryset
    queryset = queryset.filter(**{f"{client_field}__in": scope["clients"]})
    if scope["sites"] is not None:
        queryset = queryset.filter(**{f"{site_field}__in": scope["sites"]})
    return queryset


def deny_if_client_scoped(queryset, user):
    """Para cadastros internos que um usuário-cliente não deve enxergar de
    forma alguma (Empresas, Colaboradores, Cargos, Responsáveis, Tipos de
    Projeto, Tarefas do catálogo etc): nega acesso total se o usuário tiver
    escopo de cliente."""
    if get_scope_for_user(user) is not None:
        return queryset.none()
    return queryset


def user_can_access_category(user, category):
    if category is None:
        return True
    scope = get_scope_for_user(user)
    if scope is None:
        return True
    if scope["categories"] is not None and category.id not in scope["categories"]:
        return False
    return True
