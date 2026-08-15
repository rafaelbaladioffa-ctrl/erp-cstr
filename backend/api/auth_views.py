from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView


class ThrottledTokenObtainPairView(TokenObtainPairView):
    """Login da API (usuário/senha -> par de tokens JWT). Limitado por
    ScopedRateThrottle (ver DEFAULT_THROTTLE_RATES["login"]) como primeira
    camada de defesa contra brute force; o django-axes complementa
    bloqueando por IP+usuário após N tentativas falhas."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"


class ThrottledTokenRefreshView(TokenRefreshView):
    """Renovação de token. Também limitada para evitar uso do endpoint de
    refresh como vetor alternativo de força bruta contra tokens roubados
    ou adivinhados."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"
