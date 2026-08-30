import os
from datetime import timedelta
from pathlib import Path

from django.templatetags.static import static


BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.getenv("DJANGO_DEBUG", "0") == "1"

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "unsafe-development-key"
    else:
        raise RuntimeError(
            "DJANGO_SECRET_KEY não foi definida. Configure essa variável de ambiente antes de subir em produção "
            "(DJANGO_DEBUG=0)."
        )
ALLOWED_HOSTS = [item.strip() for item in os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if item.strip()]
CSRF_TRUSTED_ORIGINS = [item.strip() for item in os.getenv("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",") if item.strip()]

INSTALLED_APPS = [
    "unfold",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "axes",
    "audit.apps.AuditConfig",
    "core",
    "users",
    "projects",
    "scope_import",
    "updates",
    "technical",
    "dispatch",
    "bot",
    "api",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "audit.middleware.AuditContextMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Precisa ser o último middleware (exigência do django-axes).
    "axes.middleware.AxesMiddleware",
]

# django-axes intercepta o authenticate() padrão do Django — usado tanto
# pelo login do Django Admin quanto pelo TokenObtainPairView do
# simplejwt (que chama authenticate() internamente) — então uma única
# configuração cobre o brute force nos dois pontos de entrada.
AUTHENTICATION_BACKENDS = [
    "axes.backends.AxesStandaloneBackend",
    "django.contrib.auth.backends.ModelBackend",
]

# Evita cair em /accounts/profile/ (padrão do Django, sem view registrada
# nesse sistema) quando alguém loga entrando direto por /admin/login/ em vez
# de /admin/ (que já redireciona com o "next" certo automaticamente).
LOGIN_REDIRECT_URL = "/admin/"

ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("POSTGRES_DB", "erp"),
        "USER": os.getenv("POSTGRES_USER", "erp"),
        "PASSWORD": os.getenv("POSTGRES_PASSWORD", "erp"),
        "HOST": os.getenv("POSTGRES_HOST", "db"),
        "PORT": os.getenv("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 60,
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "pt-br"
LANGUAGES = (("pt-br", "Português do Brasil"),)
LOCALE_PATHS = (BASE_DIR / "locale",)
TIME_ZONE = "America/Sao_Paulo"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "users.User"

UNFOLD = {
    "SITE_TITLE": "Consultimer | Projetos",
    "SITE_HEADER": "Consultimer ERP",
    "SITE_SUBHEADER": "Gestão de projetos e operações",
    "SITE_LOGO": {
        "light": lambda request: static("core/img/consultimer-logo-light.png"),
        "dark": lambda request: static("core/img/consultimer-logo-branco.png"),
    },
    "SITE_FAVICONS": [
        {"rel": "icon", "sizes": "32x32", "type": "image/png", "href": lambda request: static("core/img/favicon-32.png")},
        {"rel": "icon", "sizes": "16x16", "type": "image/png", "href": lambda request: static("core/img/favicon-16.png")},
        {"rel": "apple-touch-icon", "href": lambda request: static("core/img/apple-touch-icon.png")},
    ],
    "SITE_SYMBOL": "hub",
    "SHOW_HISTORY": True,
    "SHOW_VIEW_ON_SITE": False,
    "STYLES": [lambda request: static("core/css/consultimer-theme.css")],
    "COLORS": {
        "primary": {
            "50": "255 247 237",
            "100": "255 237 213",
            "200": "254 215 170",
            "300": "253 186 116",
            "400": "251 146 60",
            "500": "245 133 48",
            "600": "241 96 35",
            "700": "218 74 19",
            "800": "194 65 12",
            "900": "154 52 18",
            "950": "67 20 7",
        },
    },
}

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_PAGINATION_CLASS": "api.pagination.DefaultPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.ScopedRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        # Camada extra de defesa (além do django-axes) especificamente no
        # endpoint de login: barra rajadas rápidas por IP antes mesmo de o
        # axes contar as tentativas falhas no banco.
        "login": "5/min",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
}

# --- Proteção contra brute force (django-axes) ---------------------------
# Bloqueia por combinação de IP + usuário após N tentativas de login
# falhas, tanto no Django Admin quanto no endpoint de login da API
# (/api/token/), já que ambos passam pelo authenticate() padrão do Django.
AXES_FAILURE_LIMIT = 5
AXES_COOLOFF_TIME = timedelta(minutes=30)
AXES_LOCKOUT_PARAMETERS = ["ip_address", "username"]
AXES_RESET_ON_SUCCESS = True
AXES_RESET_COOL_OFF_ON_FAILURE_DURING_LOCKOUT = True
AXES_LOCKOUT_TEMPLATE = None
AXES_VERBOSE = True

CORS_ALLOWED_ORIGINS = [
    item.strip()
    for item in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
    if item.strip()
]

EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = os.getenv("EMAIL_HOST", "smtp.gmail.com")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "1") == "1"
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "apikey")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "atualizacoes@consultimer.com")

# Segredo compartilhado usado pelo bot do WhatsApp para chamar a API sem
# fazer login normal (ver api/views.BotSharedSecretPermission).
WHATSAPP_BOT_SECRET = os.getenv("WHATSAPP_BOT_SECRET", "")

# Provedor de IA usado pela Importação de Escopo (scope_import/ai_provider.py)
# — só o backend fala com o OpenRouter, a chave nunca é exposta ao frontend.
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "")

SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

# --- Sessão do Django Admin: mesmo comportamento de login do frontend ---------
# Nunca fica logado ao reabrir o navegador (cookie de sessão, não persistente).
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
# Desloga automaticamente após 10 minutos sem nenhuma requisição nova.
SESSION_COOKIE_AGE = 10 * 60
# Renova a contagem dos 10 minutos a cada requisição (vira um timeout por
# inatividade, não um limite fixo de sessão).
SESSION_SAVE_EVERY_REQUEST = True
