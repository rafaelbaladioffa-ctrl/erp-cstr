"""Interface desacoplada de provedor de IA para interpretação de escopo —
hoje só existe a implementação OpenRouter (modelo gratuito), mas o resto do
sistema (services.py, views.py) nunca fala com OpenRouter diretamente, só
com a interface AIProvider, pra trocar de provedor no futuro sem tocar em
mais nada além deste arquivo."""

import abc
import json
import logging
import re

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)

SYSTEM_PROMPT_TEMPLATE = """Você é um assistente que interpreta o escopo de um projeto de instalação \
de infraestrutura de rede/telecom (cabeamento óptico, UTP, patching, certificação etc.) e propõe uma \
estrutura de planejamento a partir de um texto livre colado pelo usuário (pode ser uma planilha colada, \
uma lista, um e-mail do cliente, ou qualquer descrição informal).

Sua saída deve ser APENAS um objeto JSON válido (sem markdown, sem texto antes ou depois), no formato:

{{
  "work_blocks": [
    {{
      "name": "nome do bloco/área (ex: UMN, BFC, EG1 — use o que o texto sugerir; se não houver \
agrupamento claro, use um único bloco chamado 'Geral')",
      "items": [
        {{
          "internal_code": "código interno do item, se houver, senão string vazia",
          "item_type": "um destes valores EXATOS: {item_types}",
          "technology": "tecnologia/material do item, se houver (ex: Robust 2F), senão string vazia",
          "fiber_count": null ou número inteiro de fibras, se aplicável,
          "length_meters": null ou metragem numérica, se aplicável,
          "origin": "origem, se houver, senão string vazia",
          "destination": "destino, se houver, senão string vazia",
          "route": "rota, se houver, senão string vazia",
          "priority": "low, medium, high ou critical (padrão medium)",
          "complexity": "simple, medium ou complex (padrão medium)",
          "tasks": [
            {{
              "activity_type": "um destes valores EXATOS: {activity_types}",
              "quantity_planned": número (quantidade planejada dessa atividade nesse item),
              "unit": "unidade curta (ex: m, porta, un)"
            }}
          ]
        }}
      ]
    }}
  ]
}}

Regras importantes:
- Use OS VALORES EXATOS da lista fornecida para "item_type" e "activity_type" — nunca invente um valor \
novo. Se nada da lista corresponder bem, use "Outro" para item_type e "Outros / A Classificar" para \
activity_type.
- Cada item deve ter ao menos uma tarefa (task) associada, refletindo as atividades que o texto sugere \
para aquele item (ex: se o texto menciona "lançar e certificar", gere uma task de lançamento e outra de \
certificação).
- Não invente dados que não estão no texto — deixe strings vazias / null quando a informação não existir.
- Nunca decida arredondar, agrupar ou pular itens que o texto lista explicitamente."""


class AIProviderError(Exception):
    """Erro em qualquer etapa da interpretação por IA (rede, timeout, resposta
    não é JSON válido, ou não bate com o schema esperado)."""


class AIProvider(abc.ABC):
    @abc.abstractmethod
    def interpret_scope(self, raw_text: str, *, activity_types: list[dict], item_types: list[dict]) -> dict:
        """Retorna a estrutura proposta (work_blocks -> items -> tasks) como
        dict Python já parseado do JSON. `activity_types`/`item_types` são
        listas de {"name": ...} do catálogo ativo, para a IA mapear contra
        valores reais em vez de inventar texto livre. Levanta AIProviderError
        em qualquer falha (rede, timeout, JSON inválido, schema inesperado)."""


class OpenRouterProvider(AIProvider):
    def __init__(self, api_key=None, model=None, timeout=180):
        self.api_key = api_key if api_key is not None else settings.OPENROUTER_API_KEY
        self.model = model if model is not None else settings.OPENROUTER_MODEL
        self.timeout = timeout

    def interpret_scope(self, raw_text, *, activity_types, item_types):
        if not self.api_key:
            raise AIProviderError("OPENROUTER_API_KEY não está configurada.")
        if not self.model:
            raise AIProviderError("OPENROUTER_MODEL não está configurado.")

        system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
            item_types=", ".join(f'"{item["name"]}"' for item in item_types),
            activity_types=", ".join(f'"{activity["name"]}"' for activity in activity_types),
        )

        try:
            response = requests.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": raw_text},
                    ],
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            logger.warning("Falha ao chamar o OpenRouter: %s", exc)
            raise AIProviderError(f"Falha ao chamar o provedor de IA: {exc}") from exc

        try:
            content = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            logger.warning("Resposta do OpenRouter sem o formato esperado: %s", payload)
            raise AIProviderError("Resposta do provedor de IA veio em formato inesperado.") from exc

        cleaned = _JSON_FENCE_RE.sub("", content.strip()).strip()
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            logger.warning("IA não retornou JSON válido: %s", content[:500])
            raise AIProviderError("A IA não retornou um JSON válido.") from exc

        if not isinstance(parsed, dict) or not isinstance(parsed.get("work_blocks"), list):
            raise AIProviderError("A resposta da IA não tem o formato esperado (work_blocks ausente).")

        return parsed
