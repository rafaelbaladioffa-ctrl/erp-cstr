"""Layout do e-mail do Update Semanal (vários projetos num só e-mail).

Estrutura: indicadores da semana, visão geral compacta (barra de progresso por
projeto) e um cartão enxuto por projeto. Só tabelas e estilos inline (compatível
com Outlook); as classes `c-*` ativam as cores do tema escuro (ver DARK_CSS em
core/emailing.py).
"""

from html import escape

from core.email_texts import tr
from core.emailing import COLOR_ACCENT, COLOR_BORDER, COLOR_MUTED, COLOR_TEXT

BAR_BG = "#e4e4e7"


def _bar(percent, height=8):
    """Barra de progresso em tabela (sem CSS moderno, para o Outlook renderizar)."""
    percent = max(0, min(100, int(percent)))
    fill = (
        f'<td width="{percent}%" bgcolor="{COLOR_ACCENT}" style="background:{COLOR_ACCENT};height:{height}px;line-height:{height}px;font-size:0;">&nbsp;</td>'
        if percent
        else ""
    )
    rest = (
        f'<td width="{100 - percent}%" style="height:{height}px;line-height:{height}px;font-size:0;">&nbsp;</td>'
        if percent < 100
        else ""
    )
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="c-track" '
        f'style="background:{BAR_BG};border-radius:{height // 2}px;overflow:hidden;"><tr>{fill}{rest}</tr></table>'
    )


def _pill(lang, label, value):
    cls, bg, fg = ("c-ok", "#dcfce7", "#166534") if value else ("c-no", "#f4f4f5", "#52525b")
    text = tr(lang, "yes" if value else "no")
    return (
        f'<span class="{cls}" style="display:inline-block;background:{bg};color:{fg};border-radius:10px;'
        f'padding:3px 10px;font-size:12px;margin:0 6px 6px 0;white-space:nowrap;">{escape(label)}: <b>{escape(text)}</b></span>'
    )


def _stat(value, label):
    return (
        f'<td class="c-hl" width="33%" align="center" style="background:#f4f4f5;padding:14px 8px;border-radius:6px;">'
        f'<div class="c-txt" style="font-size:26px;font-weight:700;line-height:1.1;color:{COLOR_TEXT};">{escape(str(value))}</div>'
        f'<div class="c-mut" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:{COLOR_MUTED};margin-top:4px;">{escape(label)}</div>'
        f"</td>"
    )


def _fact(label, value):
    return (
        f'<td width="50%" valign="top" style="padding:0 8px 10px 0;">'
        f'<div class="c-mut" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:{COLOR_MUTED};">{escape(label)}</div>'
        f'<div class="c-txt" style="font-size:13px;color:{COLOR_TEXT};">{escape(value)}</div></td>'
    )


def render_weekly_body(lang, projects):
    """`projects`: lista de dicts (name, code, site, po, responsible_client_label,
    responsible_client, responsible_cstr, percent, certification, finished, notes)."""
    total = len(projects)
    average = round(sum(p["percent"] for p in projects) / total) if total else 0
    finished = sum(1 for p in projects if p["finished"])
    gap = '<td width="8" style="font-size:0;">&nbsp;</td>'

    parts = [
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr>'
        + _stat(total, tr(lang, "weekly_stat_projects"))
        + gap
        + _stat(f"{average}%", tr(lang, "weekly_stat_avg"))
        + gap
        + _stat(finished, tr(lang, "weekly_stat_done"))
        + "</tr></table>"
    ]

    # Visão geral: uma linha por projeto com barra e percentual.
    rows = "".join(
        f'<tr><td class="c-txt c-brd" style="padding:8px 10px 8px 0;border-bottom:1px solid {COLOR_BORDER};font-size:13px;color:{COLOR_TEXT};">'
        f'{escape(p["name"])}<div class="c-mut" style="font-size:11px;color:{COLOR_MUTED};">{escape(p["site"])}</div></td>'
        f'<td class="c-brd" width="140" style="padding:8px 0;border-bottom:1px solid {COLOR_BORDER};">{_bar(p["percent"], 6)}</td>'
        f'<td class="c-txt c-brd" width="44" align="right" style="padding:8px 0 8px 10px;border-bottom:1px solid {COLOR_BORDER};font-size:13px;font-weight:700;color:{COLOR_TEXT};">{p["percent"]}%</td></tr>'
        for p in projects
    )
    parts.append(
        f'<h2 style="margin:0 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:{COLOR_ACCENT};">{escape(tr(lang, "weekly_overview"))}</h2>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px;">{rows}</table>'
    )

    parts.append(
        f'<h2 style="margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:{COLOR_ACCENT};">{escape(tr(lang, "weekly_details"))}</h2>'
    )
    for p in projects:
        notes = (
            f'<div class="c-hl c-mut" style="background:#f4f4f5;border-left:3px solid {COLOR_ACCENT};padding:8px 12px;margin-top:4px;font-size:12px;line-height:1.5;color:{COLOR_MUTED};">'
            f'<b>{escape(tr(lang, "observations"))}</b><br>{escape(p["notes"]).replace(chr(10), "<br>")}</div>'
            if p["notes"]
            else ""
        )
        parts.append(
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="c-brd" '
            f'style="border:1px solid {COLOR_BORDER};border-radius:8px;margin:0 0 14px;"><tr><td style="padding:14px 16px;">'
            # cabeçalho: nome + código à esquerda, percentual à direita
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;"><tr>'
            f'<td valign="top"><div class="c-txt" style="font-size:15px;font-weight:700;color:{COLOR_TEXT};">{escape(p["name"])}</div>'
            f'<div class="c-mut" style="font-size:11px;color:{COLOR_MUTED};">{escape(p["code"])}</div></td>'
            f'<td width="60" align="right" valign="top" class="c-txt" style="font-size:22px;font-weight:700;color:{COLOR_ACCENT};">{p["percent"]}%</td>'
            f"</tr></table>"
            f'<div style="margin:0 0 12px;">{_bar(p["percent"])}</div>'
            # fatos em duas colunas
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
            f'{_fact(tr(lang, "site"), p["site"])}{_fact(tr(lang, "po"), p["po"])}</tr><tr>'
            f'{_fact(p["responsible_client_label"], p["responsible_client"])}{_fact(tr(lang, "responsible_company"), p["responsible_cstr"])}'
            f"</tr></table>"
            f'<div style="margin-top:2px;">{_pill(lang, tr(lang, "certification"), p["certification"])}'
            f'{_pill(lang, tr(lang, "finished"), p["finished"])}</div>'
            f"{notes}"
            f"</td></tr></table>"
        )
    return "".join(parts)
