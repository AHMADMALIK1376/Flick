"""Pushes live events (thinking, answer, prep progress) to every connected
window: the dashboard, the answer card and the mic."""

from __future__ import annotations

import asyncio
from typing import Any

#: Events a slow listener can fall behind by before old ones are dropped.
QUEUE_SIZE = 100


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    def publish(self, kind: str, data: Any) -> None:
        event = {"type": kind, "data": data}
        for queue in list(self._subscribers):
            if queue.full():
                try:
                    queue.get_nowait()  # drop the oldest rather than block everyone
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait(event)
