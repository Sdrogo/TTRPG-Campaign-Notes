"""The in-process broker behind the live updates (spec 46_2, spec 52).

Each open stream subscribes a queue, tagged with its Room and its user. A
write publishes, once its transaction has committed, a content-free event to
every queue of the Room, or to some users' queues only (a draft's writes, a
map or Document hidden from the others, so they never learn it exists). One
backend process serves each environment, so an in-process broker reaches
every stream; more processes would need Postgres `LISTEN/NOTIFY`
(architecture.md -> Storage Model)."""

import asyncio
import uuid
from collections.abc import Collection
from dataclasses import dataclass, field

# A stream that falls this far behind is closed rather than buffered: the
# client reconnects and re-reads the board, which is all an event asks of it.
QUEUE_SIZE = 64


# The topics of the Room stream (spec 52 Decision 1).
SESSION_ZERO = "session_zero"
MAP = "map"
DOCUMENT = "document"
COMMENTS = "comments"


@dataclass(frozen=True)
class Event:
    """What changed, never what it says (spec 46_2 Decision 3, spec 52
    Decision 3): the `revision` after the write (the Session 0's or the
    map's; none for a Document), the kind of change (`card`, `timer`, ... on
    Session 0; `changed` or `deleted` otherwise), the id of the object when
    it has one, and the `topic` it belongs to."""

    revision: int | None
    kind: str
    id: uuid.UUID | None = None
    topic: str = SESSION_ZERO


@dataclass(eq=False)
class Subscription:
    """One open stream. `None` in the queue closes it. `topics` limits what
    it hears (the Session 0 alias, spec 52 Decision 2); `None` is all."""

    room_id: uuid.UUID
    user_id: uuid.UUID
    topics: frozenset[str] | None = None
    queue: asyncio.Queue[Event | None] = field(
        default_factory=lambda: asyncio.Queue(maxsize=QUEUE_SIZE)
    )

    def offer(self, item: Event | None) -> None:
        """Queues `item`; a full queue is emptied and closed instead."""
        try:
            self.queue.put_nowait(item)
        except asyncio.QueueFull:
            while not self.queue.empty():
                self.queue.get_nowait()
            self.queue.put_nowait(None)


class Broker:
    """The open streams of every Room, in this process."""

    def __init__(self) -> None:
        self._rooms: dict[uuid.UUID, set[Subscription]] = {}

    def subscribe(
        self,
        room_id: uuid.UUID,
        user_id: uuid.UUID,
        topics: frozenset[str] | None = None,
    ) -> Subscription:
        """Opens a stream's queue."""
        subscription = Subscription(room_id, user_id, topics)
        self._rooms.setdefault(room_id, set()).add(subscription)
        return subscription

    def unsubscribe(self, subscription: Subscription) -> None:
        """Forgets a closed stream."""
        streams = self._rooms.get(subscription.room_id)
        if streams is None:
            return
        streams.discard(subscription)
        if not streams:
            del self._rooms[subscription.room_id]

    def _streams(
        self, room_id: uuid.UUID, user_ids: Collection[uuid.UUID] | None
    ) -> list[Subscription]:
        return [
            s for s in self._rooms.get(room_id, ()) if user_ids is None or s.user_id in user_ids
        ]

    def publish(
        self,
        room_id: uuid.UUID,
        event: Event,
        *,
        user_ids: Collection[uuid.UUID] | None = None,
    ) -> None:
        """Sends `event` to the Room's streams, or to those of `user_ids`
        only, leaving out the streams not listening to its topic."""
        for subscription in self._streams(room_id, user_ids):
            if subscription.topics is None or event.topic in subscription.topics:
                subscription.offer(event)

    def disconnect(self, room_id: uuid.UUID, user_id: uuid.UUID | None = None) -> None:
        """Closes the Room's streams, or `user_id`'s: they left the Room, or
        it is gone."""
        for subscription in self._streams(room_id, None if user_id is None else {user_id}):
            subscription.offer(None)

    def count(self, room_id: uuid.UUID) -> int:
        """How many streams the Room has open."""
        return len(self._rooms.get(room_id, ()))


broker = Broker()
