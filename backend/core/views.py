from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST


@csrf_exempt
@require_POST
def admin_session_beacon_logout(request):
    """
    Chamado via navigator.sendBeacon quando a aba/janela do Django Admin é
    fechada de verdade (não durante navegação normal dentro do admin) —
    encerra a sessão no servidor imediatamente, sem depender só do cookie
    de sessão expirar sozinho no navegador.
    """
    if request.user.is_authenticated:
        request.session.flush()
    return HttpResponse(status=204)
