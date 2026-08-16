"""Lógica genérica de exportação/importação CSV para os Cadastros Gerais,
compartilhada entre o Django Admin (core/admin_mixins.py) e a API REST
(api/views.py). As colunas são derivadas automaticamente dos campos
editáveis do model — sem precisar mapear coluna por coluna a cada novo
cadastro. Campos de relação (ForeignKey) são exportados/importados pelo
texto do __str__ do registro relacionado.
"""

import csv
import io
from datetime import datetime

from django.db import transaction

CSV_DELIMITER = ";"

# Limite de tamanho para upload de CSV (proteção contra DoS por arquivo
# gigante consumindo memória/tempo de processamento na importação).
MAX_CSV_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB

# Caracteres que, se estiverem no início de uma célula, fazem Excel/Google
# Sheets interpretar o valor como fórmula (CSV/DDE injection).
_FORMULA_LEAD_CHARS = ("=", "+", "-", "@", "\t", "\r")


def neutralize_formula(value: str) -> str:
    """Prefixa com um apóstrofo valores que começam com caractere de fórmula,
    para que Excel/Sheets os trate como texto literal em vez de executar."""
    if value and value[0] in _FORMULA_LEAD_CHARS:
        return f"'{value}"
    return value


def get_csv_fields(model):
    return [field for field in model._meta.fields if field.name != "id" and field.editable]


def serialize_csv_value(obj, field):
    if field.is_relation:
        related = getattr(obj, field.name)
        return neutralize_formula(str(related)) if related is not None else ""
    value = getattr(obj, field.attname)
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Sim" if value else "Não"
    if hasattr(value, "strftime"):
        return value.strftime("%d/%m/%Y %H:%M") if hasattr(value, "hour") else value.strftime("%d/%m/%Y")
    return neutralize_formula(str(value))


def build_csv_content(model, queryset):
    """Retorna o conteúdo CSV completo (com BOM UTF-8) como string, pronto
    para ser escrito numa resposta HTTP ou arquivo."""
    fields = get_csv_fields(model)
    buffer = io.StringIO()
    buffer.write("﻿")
    writer = csv.writer(buffer, delimiter=CSV_DELIMITER)
    writer.writerow([str(field.verbose_name) for field in fields])
    for obj in queryset:
        writer.writerow([serialize_csv_value(obj, field) for field in fields])
    return buffer.getvalue()


def parse_csv_value(row, field):
    raw = (row.get(str(field.verbose_name)) or row.get(field.name) or "").strip()
    if field.is_relation:
        if not raw:
            if field.null:
                return None
            raise ValueError(f"{field.verbose_name}: obrigatório.")
        related_model = field.related_model
        match = next(
            (candidate for candidate in related_model.objects.all() if str(candidate) == raw),
            None,
        )
        if match is None:
            raise ValueError(f'{field.verbose_name}: não encontrado "{raw}".')
        return match

    internal_type = field.get_internal_type()
    if internal_type == "BooleanField":
        return raw.strip().casefold() not in ("", "não", "nao", "0", "false")
    if internal_type == "DateField":
        if not raw:
            return None
        for date_format in ("%d/%m/%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(raw, date_format).date()
            except ValueError:
                continue
        raise ValueError(f'{field.verbose_name}: data inválida "{raw}" (use DD/MM/AAAA).')
    if internal_type == "DateTimeField":
        if not raw:
            return None
        for date_format in ("%d/%m/%Y %H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(raw, date_format)
            except ValueError:
                continue
        raise ValueError(f'{field.verbose_name}: data/hora inválida "{raw}".')
    if internal_type in ("DecimalField", "FloatField"):
        return raw.replace(",", ".") if raw else None
    if internal_type in ("IntegerField", "PositiveIntegerField", "PositiveSmallIntegerField", "BigIntegerField"):
        return int(raw) if raw else None
    return raw


def import_csv_rows(model, file_content):
    """Importa os registros descritos em `file_content` (texto do CSV,
    delimitador sniffado automaticamente). Cria um registro por linha via
    full_clean()+save(); linhas com erro não interrompem as demais.
    Retorna (created, errors) — errors é uma lista de strings 'Linha N: ...'."""
    if len(file_content.encode("utf-8")) > MAX_CSV_UPLOAD_BYTES:
        raise ValueError(f"Arquivo CSV muito grande (máximo {MAX_CSV_UPLOAD_BYTES // (1024 * 1024)} MB).")

    fields = get_csv_fields(model)
    sample = file_content[:4096]
    delimiter = csv.Sniffer().sniff(sample, delimiters=";,\t").delimiter
    rows = csv.DictReader(io.StringIO(file_content), delimiter=delimiter)
    if not rows.fieldnames:
        raise ValueError("O arquivo CSV está vazio ou em um formato inválido.")

    created = 0
    errors = []
    for line_number, row in enumerate(rows, start=2):
        try:
            with transaction.atomic():
                values = {field.name: parse_csv_value(row, field) for field in fields}
                obj = model(**values)
                obj.full_clean()
                obj.save()
                created += 1
        except Exception as exc:
            errors.append(f"Linha {line_number}: {exc}")
    return created, errors
