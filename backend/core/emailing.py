"""E-mails corporativos padronizados (HTML + texto puro) com a marca Consultimer.

Todos os e-mails do sistema passam por `send_branded_email`, que monta o
layout (cabeçalho com logo, bloco de resumo, seções e rodapé), anexa o logo
inline (CID, sem depender de hospedagem pública) e envia também a versão em
texto puro como alternativa.
"""

from email.mime.image import MIMEImage
from html import escape
from pathlib import Path

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

BRAND = "Consultimer"
SUBJECT_PREFIX = f"{BRAND} · "
LOGO_PATH = Path(settings.BASE_DIR) / "core" / "static" / "core" / "img" / "consultimer-logo-branco.png"
LOGO_CID = "consultimer-logo"

COLOR_HEADER = "#262528"
COLOR_ACCENT = "#f58530"
COLOR_TEXT = "#202124"
COLOR_MUTED = "#6b6b70"
COLOR_BORDER = "#e4e4e7"
COLOR_BG = "#f4f4f5"

LANGUAGES = ("pt", "en", "es")
DEFAULT_LANGUAGE = "pt"

FOOTER_LINES = {
    "pt": (
        "Consultimer — Cabeamento estruturado para data centers",
        "Esta é uma mensagem automática enviada pelo sistema de gestão de obras.",
    ),
    "en": (
        "Consultimer — Structured cabling for data centers",
        "This is an automatic message sent by the project management system.",
    ),
    "es": (
        "Consultimer — Cableado estructurado para data centers",
        "Este es un mensaje automático enviado por el sistema de gestión de obras.",
    ),
}
BUTTON_FALLBACK = {
    "pt": "Se o botão não funcionar, copie e cole este endereço no navegador:",
    "en": "If the button does not work, copy and paste this address into your browser:",
    "es": "Si el botón no funciona, copie y pegue esta dirección en el navegador:",
}


def normalize_language(value):
    """Aceita 'pt', 'pt-BR', 'en-US', 'es-ES'... e devolve pt/en/es (padrão pt)."""
    code = (value or "").strip().lower()[:2]
    return code if code in LANGUAGES else DEFAULT_LANGUAGE


def branded_subject(*parts):
    return SUBJECT_PREFIX + " · ".join(str(p) for p in parts if p)


def _multiline(text):
    return escape(text).replace("\n", "<br>")


def render_html(*, title, intro="", summary=None, highlight=None, sections=None, button=None, note="", logo=True, lang="pt"):
    """summary: lista de (rótulo, valor). highlight: (rótulo, valor) em destaque.
    sections: lista de (título, texto). button: (rótulo, url)."""
    parts = []

    if intro:
        parts.append(f'<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:{COLOR_TEXT};">{_multiline(intro)}</p>')

    if highlight:
        label, value = highlight
        parts.append(
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">'
            f'<tr><td style="background:{COLOR_BG};border-left:4px solid {COLOR_ACCENT};padding:14px 18px;">'
            f'<div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:{COLOR_MUTED};">{escape(label)}</div>'
            f'<div style="font-size:28px;font-weight:700;color:{COLOR_TEXT};line-height:1.2;">{escape(value)}</div>'
            f"</td></tr></table>"
        )

    if summary:
        rows = "".join(
            f'<tr><td style="padding:9px 0;border-bottom:1px solid {COLOR_BORDER};width:38%;font-size:13px;color:{COLOR_MUTED};vertical-align:top;">{escape(label)}</td>'
            f'<td style="padding:9px 0;border-bottom:1px solid {COLOR_BORDER};font-size:14px;color:{COLOR_TEXT};vertical-align:top;">{_multiline(value)}</td></tr>'
            for label, value in summary
        )
        parts.append(f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">{rows}</table>')

    for heading, text in sections or []:
        parts.append(
            f'<h2 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:{COLOR_ACCENT};">{escape(heading)}</h2>'
            f'<p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:{COLOR_TEXT};">{_multiline(text)}</p>'
        )

    if button:
        label, url = button
        parts.append(
            f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr>'
            f'<td style="background:{COLOR_ACCENT};border-radius:6px;">'
            f'<a href="{escape(url, quote=True)}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">{escape(label)}</a>'
            f"</td></tr></table>"
            f'<p style="margin:0 0 20px;font-size:12px;color:{COLOR_MUTED};word-break:break-all;">{escape(BUTTON_FALLBACK[lang])}<br>{escape(url)}</p>'
        )

    if note:
        parts.append(f'<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:{COLOR_MUTED};">{_multiline(note)}</p>')

    footer = "<br>".join(escape(line) for line in FOOTER_LINES[lang])
    logo_html = (
        f'<img src="cid:{LOGO_CID}" alt="{BRAND}" width="170" style="display:block;border:0;height:auto;">'
        if logo
        else f'<span style="font-size:22px;font-weight:700;color:#ffffff;">{BRAND}</span>'
    )

    return f"""<!DOCTYPE html>
<html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:{COLOR_BG};font-family:Segoe UI,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{COLOR_BG};padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:{COLOR_HEADER};padding:18px 28px;">{logo_html}</td></tr>
<tr><td style="background:{COLOR_ACCENT};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 8px;">
<h1 style="margin:0 0 18px;font-size:20px;color:{COLOR_TEXT};">{escape(title)}</h1>
{"".join(parts)}
</td></tr>
<tr><td style="padding:18px 28px;background:{COLOR_BG};border-top:1px solid {COLOR_BORDER};font-size:12px;line-height:1.6;color:{COLOR_MUTED};">{footer}</td></tr>
</table></td></tr></table></body></html>"""


def build_email(*, subject, to, text, html, from_email=None, connection=None, attachments=None, reply_to=None):
    message = EmailMultiAlternatives(
        subject=subject,
        body=text,
        from_email=from_email or settings.DEFAULT_FROM_EMAIL,
        to=to,
        connection=connection,
        reply_to=reply_to,
    )
    message.attach_alternative(html, "text/html")
    # Logo inline (CID): subtipo "related" para o cliente resolver o cid: sem hospedagem.
    message.mixed_subtype = "related"
    if LOGO_PATH.exists() and f"cid:{LOGO_CID}" in html:
        logo = MIMEImage(LOGO_PATH.read_bytes(), _subtype="png")
        logo.add_header("Content-ID", f"<{LOGO_CID}>")
        logo.add_header("Content-Disposition", "inline", filename="consultimer.png")
        message.attach(logo)
    for filename, content, mimetype in attachments or []:
        message.attach(filename, content, mimetype)
    return message
