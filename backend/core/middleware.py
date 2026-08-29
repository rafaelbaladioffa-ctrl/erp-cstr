BEACON_SCRIPT = """
<script>
(function () {
  var logoutUrl = "/admin/session-beacon-logout/";
  var internalNav = false;
  document.addEventListener("click", function (e) {
    if (e.target && e.target.closest && e.target.closest("a[href], button[type=submit], input[type=submit]")) {
      internalNav = true;
    }
  }, true);
  document.addEventListener("submit", function () { internalNav = true; }, true);
  // F5/Ctrl+R/Cmd+R (recarregar a página) também dispara "pagehide" — sem
  // isso, um simples F5 era tratado como fechar a aba e derrubava a sessão.
  document.addEventListener("keydown", function (e) {
    if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r")) {
      internalNav = true;
    }
  }, true);
  window.addEventListener("pagehide", function (event) {
    if (event.persisted || internalNav) return;
    navigator.sendBeacon(logoutUrl);
  });
})();
</script>
""".strip()


class AdminAutoLogoutBeaconMiddleware:
    """
    Injeta um script no Django Admin que avisa o servidor (via
    navigator.sendBeacon) para encerrar a sessão assim que a aba/janela é
    realmente fechada — complementa o SESSION_EXPIRE_AT_BROWSER_CLOSE, que
    depende só do navegador descartar o cookie sozinho.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if (
            request.path.startswith("/admin/")
            and getattr(request, "user", None)
            and request.user.is_authenticated
            and response.get("Content-Type", "").startswith("text/html")
            and hasattr(response, "content")
        ):
            response.content = response.content.replace(
                b"</body>", (BEACON_SCRIPT + "</body>").encode("utf-8")
            )
        return response
