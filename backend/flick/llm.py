"""The Claude client: plain completions and completions with Claude's built-in
web search, with errors turned into kinds the presenter can act on."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional, Protocol, Union

import anthropic

from .models import WebSource

#: A server-tool turn can stop early with `pause_turn`; it is resent so the
#: model can finish. Bounded so a stuck turn cannot loop forever.
MAX_PAUSE_CONTINUATIONS = 3
#: Sources shown when the model cites nothing explicitly.
FALLBACK_SOURCE_COUNT = 3
REQUEST_TIMEOUT_S = 60.0


#: A user message: plain text, or content blocks (so part of it can be cached).
Message = Union[str, list[dict]]
#: Called with each complete sentence as the answer is written.
OnText = Callable[[str], Awaitable[None]]
#: Called when Claude starts searching the web.
OnSearch = Callable[[], Awaitable[None]]

#: Sentence ends: Latin, Urdu (۔) and Arabic (؟) punctuation.
_SENTENCE_END = re.compile(r"(?<=[.!?\u06D4\u061F])\s+")


class SentenceStream:
    """Collects streamed text and hands it on one complete sentence at a time,
    so speech can start after the first sentence instead of the whole answer."""

    def __init__(self, on_sentence: OnText):
        self._on_sentence = on_sentence
        self._buffer = ""

    async def feed(self, text: str) -> None:
        self._buffer += text
        parts = _SENTENCE_END.split(self._buffer)
        self._buffer = parts.pop()  # the unfinished sentence
        for sentence in parts:
            if sentence.strip():
                await self._on_sentence(sentence.strip())

    async def flush(self) -> None:
        rest, self._buffer = self._buffer.strip(), ""
        if rest:
            await self._on_sentence(rest)


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
    async def check_key(self) -> None: ...

    async def complete(self, system: str, message: Message, max_tokens: int = 700) -> str: ...

    async def search_complete(
        self, system: str, message: Message, max_tokens: int = 700, max_searches: int = 3
    ) -> SearchResult: ...

    async def stream_complete(
        self, system: str, message: Message, max_tokens: int, on_text: OnText
    ) -> str: ...

    async def stream_search(
        self, system: str, message: Message, max_tokens: int, max_searches: int, on_text: OnText, on_search: OnSearch
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

    async def warm_up(self) -> None:
        """Opens the HTTPS connection before the first question (a free call)."""
        try:
            await self._client_for_key().models.list(limit=1)
        except Exception:
            pass  # no key yet, offline: the first real question will say so

    async def check_key(self) -> None:
        """Raises LLMError when the key is missing or does not work. A free call (lists models)."""
        client = self._client_for_key()  # LLMError("missing_key") when no key is saved
        try:
            await client.models.list(limit=1)
        except anthropic.APIError as err:
            raise _map_error(err) from err

    async def complete(self, system: str, message: Message, max_tokens: int = 700) -> str:
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

    async def stream_complete(self, system: str, message: Message, max_tokens: int, on_text: OnText) -> str:
        """Like `complete`, but hands each sentence to `on_text` as soon as it is written."""
        client = self._client_for_key()
        sentences = SentenceStream(on_text)
        try:
            async with client.messages.stream(
                model=self._get_model(),
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": message}],
            ) as stream:
                async for event in stream:
                    if event.type == "text":
                        await sentences.feed(event.text)
                final = await stream.get_final_message()
        except anthropic.APIError as err:
            raise _map_error(err) from err
        await sentences.flush()
        text = "".join(b.text for b in final.content if getattr(b, "type", "") == "text").strip()
        if not text:
            raise LLMError("empty_response", "Claude returned an empty answer.")
        return text

    async def stream_search(
        self,
        system: str,
        message: Message,
        max_tokens: int,
        max_searches: int,
        on_text: OnText,
        on_search: OnSearch,
    ) -> SearchResult:
        """
        `search_complete`, streamed. Sentences go to `on_text` as they are
        written; `on_search` fires when Claude starts a web search, so the app
        can say "one moment" instead of going silent.
        """
        client = self._client_for_key()
        messages: list[dict] = [{"role": "user", "content": message}]
        content: list = []
        sentences = SentenceStream(on_text)
        try:
            for _ in range(MAX_PAUSE_CONTINUATIONS + 1):
                async with client.messages.stream(
                    model=self._get_model(),
                    max_tokens=max_tokens,
                    system=system,
                    messages=messages,
                    tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": max_searches}],
                ) as stream:
                    async for event in stream:
                        if event.type == "text":
                            await sentences.feed(event.text)
                        elif event.type == "content_block_start" and _type(event.content_block) == "server_tool_use":
                            await sentences.flush()
                            await on_search()
                        elif event.type == "content_block_stop":
                            await sentences.flush()
                    final = await stream.get_final_message()
                content.extend(final.content)
                if final.stop_reason != "pause_turn":
                    break
                messages.append({"role": "assistant", "content": final.content})
        except anthropic.APIError as err:
            raise _map_error(err) from err
        await sentences.flush()
        return parse_search_response(content)

    async def search_complete(
        self, system: str, message: Message, max_tokens: int = 700, max_searches: int = 3
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
