from rest_framework.permissions import SAFE_METHODS, BasePermission, DjangoModelPermissions


class IsSuperUser(BasePermission):
    """Restringe o acesso a superusuários — usado no Log de Auditoria, que
    no Django Admin só é visível (leitura) para superusuário, sem exceção
    por grupo/permissão."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_superuser)


class ViewAwareModelPermissions(DjangoModelPermissions):
    """Igual ao DjangoModelPermissions, mas também exige a permissão
    'view_<model>' para métodos seguros (GET/HEAD/OPTIONS), em vez de
    liberar leitura para qualquer usuário autenticado.
    """

    def __init__(self):
        super().__init__()
        self.perms_map = dict(self.perms_map)
        self.perms_map["GET"] = ["%(app_label)s.view_%(model_name)s"]
        self.perms_map["OPTIONS"] = ["%(app_label)s.view_%(model_name)s"]
        self.perms_map["HEAD"] = ["%(app_label)s.view_%(model_name)s"]


class RequireChangePermissionForActions:
    """Mixin para ViewSets: exige a permissão 'change_<model>' do Django
    para as actions customizadas listadas em `change_permission_actions`
    (ex: enviar e-mail, gerar PDF), já que essas ações alteram o estado
    do registro mas não são um POST/PUT/PATCH/DELETE padrão do DRF.
    """

    change_permission_actions: tuple[str, ...] = ()

    def get_permissions(self):
        permissions = super().get_permissions()
        if self.action in self.change_permission_actions:
            permissions.append(_HasChangePermission())
        return permissions


class _HasChangePermission(DjangoModelPermissions):
    perms_map = {method: ["%(app_label)s.change_%(model_name)s"] for method in ("GET", "POST", "PUT", "PATCH", "DELETE")}

    def has_permission(self, request, view):
        if not hasattr(view, "get_queryset"):
            return False
        # DjangoModelPermissions ignora métodos "seguros" por padrão; aqui
        # forçamos a checagem também para GET (usado pela action de PDF).
        if request.method not in SAFE_METHODS:
            return super().has_permission(request, view)
        queryset = view.get_queryset()
        perms = self.get_required_permissions("PUT", queryset.model)
        return request.user and request.user.has_perms(perms)
