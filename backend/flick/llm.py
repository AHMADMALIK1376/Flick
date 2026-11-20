"""The Claude client: plain completions and completions with Claude's built-in
web search, with errors turned into kinds the presenter can act on."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol

import anthropic

from .models import WebSource

#: A server-tool turn can stop early with `pause_turn`; it is resent so the
#: model can finish. Bounded so a stuck turn cannot loop forever.
MAX_PAUSE_CONTINUATIONS = 3
#: Sources shown when the model cites nothing explicitly.
FALLBACK_SOURCE_COUNT = 3
REQUEST_TIMEOUT_S = 60.0


class LLMError(Exception):
    """kind: missing_key | invalid_key | rate_limit | network | timeout | api_error | empty_response."""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


@dataclass
class SearchResult:
    text: str
    sources: list[WebSource] = field(default_factory=list)
    searched: bool = False  # True only when Claude actually ran a search


class LLM(Protocol):
    async def complete(self, system: str, message: str, max_tokens: int = 700) -> str: ...

    async def search_complete(
        self, system: str, message: str, max_tokens: int = 700, max_searches: int = 3
    ) -> SearchResult: ...


class Claude:
    """Reads the key and model from settings on every call, so changes in Settings apply at once."""

    def __init__(self, get_key: Callable[[], str], get_model: Callable[[], str]):
        self._get_key = get_key
        self._get_model = get_model
        self._client: Optional[anthropic.AsyncAnthropic] = None
        self._client_key: Optional[str] = None

    def _client_for_key(self) -> anthropic.AsyncAnthropic:
        key = (self._get_key() or "").strip()
        if not key:
            raise LLMError("missing_key", "No Claude API key is set.")
        if self._client is None or key != self._client_key:
            # One client per key: it keeps its HTTPS connection warm between questions.
            self._client = anthropic.AsyncAnthropic(api_key=key, timeout=REQUEST_TIMEOUT_S, max_retries=1)
            self._client_key = key
        return self._client

    async def complete(self, system: str, message: str, max_tokens: int = 700) -> str:
        client = self._client_for_key()
        try:
            response = await client.messages.create(
                model=self._get_model(),
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": message}],
            )
        except anthropic.APIError as err:
            raise _map_error(err) from err
        text = "".join(b.text for b in response.content if getattr(b, "type", "") == "text").strip()
        if not text:
            raise LLMError("empty_response", "Claude returned an empty answer.")
        return text

    async def search_complete(
        self, system: str, message: str, max_tokens: int = 700, max_searches: int = 3
    ) -> SearchResult:
        """Claude decides whether to search: if the slides answer it, it doesn't."""
        client = self._client_for_key()
        messages: list[dict] = [{"role": "user", "content": message}]
        content: list = []
        try:
            for _ in range(MAX_PAUSE_CONTINUATIONS + 1):
                response = await client.messages.create(
                    model=self._get_model(),
                    max_tokens=max_tokens,
                    system=system,
                    messages=messages,
                    tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": max_searches}],
                )
                content.extend(response.content)
                if response.stop_reason != "pause_turn":
                    break
                messages.append({"role": "assistant", "content": response.content})
        except anthropic.APIError as err:
            raise _map_error(err) from err
        return parse_search_response(content)


def parse_search_response(content: list) -> SearchResult:
    """
    The spoken answer and its sources. Only text after the last search result
    counts: text before it is Claude narrating ("Let me look that up"), which
    should not be read aloud to an audience.
    """
    last_result = max((i for i, b in enumerate(content) if _type(b) == "web_search_tool_result"), default=-1)
    searched = last_result != -1
    answer_blocks = [b for b in content[last_result + 1 :] if _type(b) == "text"]
    text = re.sub(r"\s+", " ", "".join(_get(b, "text", "") for b in answer_blocks)).strip()
    if not text:
        raise LLMError("empty_response", "Claude returned an empty answer.")

    sources: list[WebSource] = []
    seen: set[str] = set()

    def add(url: Optional[str], title: Optional[str]) -> None:
        if url and url not in seen:
            seen.add(url)
            sources.append(WebSource(url=url, title=title or url))

    for block in answer_blocks:
        for c in _get(block, "citations", None) or []:
            if _type(c) == "web_search_result_location":
                add(_get(c, "url"), _get(c, "title"))

    if searched and not sources:
        for block in content:
            if _type(block) != "web_search_tool_result":
                continue
            results = _get(block, "content", [])
            if isinstance(results, list):
                for r in results[: FALLBACK_SOURCE_COUNT - len(sources)]:
                    add(_get(r, "url"), _get(r, "title"))
    return SearchResult(text=text, sources=sources, searched=searched)


def _get(obj, name: str, default=None):
    return obj.get(name, default) if isinstance(obj, dict) else getattr(obj, name, default)


def _type(obj) -> str:
    return _get(obj, "type", "") or ""


def _map_error(err: anthropic.APIError) -> LLMError:
    if isinstance(err, (anthropic.AuthenticationError, anthropic.PermissionDeniedError)):
        return LLMError("invalid_key", "The Claude API key was rejected.")
    if isinstance(err, anthropic.RateLimitError):
        return LLMError("rate_limit", "Too many requests to Claude right now.")
    if isinstance(err, anthropic.APITimeoutError):
        return LLMError("timeout", "Claude took too long to answer.")
    if isinstance(err, anthropic.APIConnectionError):
        return LLMError("network", "Could not reach Claude.")
    return LLMError("api_error", str(err))
