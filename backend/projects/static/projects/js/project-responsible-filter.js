(function () {
    "use strict";

    const originalOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url) {
        let requestUrl = url;
        if (typeof requestUrl === "string" && requestUrl.includes("/admin/autocomplete/")) {
            const parsedUrl = new URL(requestUrl, window.location.origin);
            if (parsedUrl.searchParams.get("field_name") === "responsible_client") {
                const clientField = document.getElementById("id_client");
                parsedUrl.searchParams.set("client_id", clientField ? clientField.value : "");
                requestUrl = parsedUrl.pathname + parsedUrl.search;
            }
        }
        const args = Array.prototype.slice.call(arguments);
        args[1] = requestUrl;
        return originalOpen.apply(this, args);
    };

    document.addEventListener("DOMContentLoaded", function () {
        const clientField = document.getElementById("id_client");
        const responsibleField = document.getElementById("id_responsible_client");
        if (!clientField || !responsibleField) {
            return;
        }
        clientField.addEventListener("change", function () {
            responsibleField.value = "";
            responsibleField.dispatchEvent(new Event("change", {bubbles: true}));
        });
    });
})();
