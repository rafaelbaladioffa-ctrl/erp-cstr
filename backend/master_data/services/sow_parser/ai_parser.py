"""Abstração do provider de IA usado pelo parser de SOW — nenhuma regra de
negócio deste módulo (nem o resto do sistema) fica acoplada a um
fornecedor específico. `get_ai_sow_parser()` é a factory usada pelo
service: retorna None quando a IA não está configurada (AI_API_KEY vazia)
ou o provider é desconhecido, e o service segue em modo
DETERMINISTIC_ONLY sem quebrar (ver
master_data/services/sow_parser/service.py) — nunca lança exceção por
"IA não configurada", isso é um estado normal e esperado.

Configuração só por variável de ambiente (nunca hardcoded, nunca gravada
no banco):
    AI_PROVIDER   — nome do provider (hoje só "openrouter" é implementado)
    AI_API_KEY    — chave da API (nunca logada, nunca persistida)
    AI_MODEL      — slug do modelo (ex: "minimax/minimax-m3:free")
"""

import json
import os

import requests

from master_data.ai.prompts.sow_parser_v1 import PROMPT_VERSION, build_sow_parser_prompt

from .schemas import validate_ai_output

DEFAULT_TIMEOUT_SECONDS = 45


class AiSowParserError(Exception):
    """A chamada à IA falhou (rede, timeout, resposta não-JSON, schema
    inválido) — sempre tratado pelo service como "seguir em modo
    DETERMINISTIC_ONLY para este import", nunca propagado até quebrar o
    módulo inteiro."""


class AiSowParser:
    """Interface que qualquer provider de IA deve implementar."""

    def parse(self, raw_text, deterministic_drafts, master_data_context):
        raise NotImplementedError


class OpenRouterAiSowParser(AiSowParser):
    """Implementação concreta única desta primeira versão — usa a API de
    chat completions do OpenRouter com `response_format=json_object` (não
    aceita texto livre como resultado final, ver pedido original)."""

    API_URL = "https://openrouter.ai/api/v1/chat/completions"

    def __init__(self, api_key, model, timeout=DEFAULT_TIMEOUT_SECONDS):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def parse(self, raw_text, deterministic_drafts, master_data_context):
        if not self.model:
            raise AiSowParserError("AI_MODEL não configurado.")
        prompt = build_sow_parser_prompt(raw_text, deterministic_drafts, master_data_context)
        try:
            response = requests.post(
                self.API_URL,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            payload = response.json()
            content = payload["choices"][0]["message"]["content"]
            data = json.loads(content)
        except (requests.RequestException, KeyError, IndexError, ValueError, json.JSONDecodeError) as exc:
            raise AiSowParserError(f"Falha ao consultar o provider de IA: {exc}") from exc
        return validate_ai_output(data)


def get_ai_sow_parser():
    """Factory configurada por environment variables — retorna None (não
    uma exceção) quando AI_API_KEY não está definida ou o provider não é
    reconhecido, sinalizando ao service que deve seguir em modo
    DETERMINISTIC_ONLY. Nunca loga nem persiste a API key."""

    api_key = os.getenv("AI_API_KEY", "").strip()
    if not api_key:
        return None
    provider = os.getenv("AI_PROVIDER", "openrouter").strip().lower()
    model = os.getenv("AI_MODEL", "").strip()
    if provider == "openrouter":
        if not model:
            return None
        return OpenRouterAiSowParser(api_key=api_key, model=model)
    return None


def get_ai_provider_label():
    """Nome do provider configurado (ou "") — só para registrar em
    SowImport.ai_provider/ai_model, nunca a chave em si."""
    return os.getenv("AI_PROVIDER", "openrouter").strip().lower() if os.getenv("AI_API_KEY", "").strip() else ""


__all__ = [
    "AiSowParser",
    "AiSowParserError",
    "OpenRouterAiSowParser",
    "get_ai_sow_parser",
    "get_ai_provider_label",
    "PROMPT_VERSION",
]
