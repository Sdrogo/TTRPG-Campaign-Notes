"""The in-process broker behind the Session 0 live updates (spec 46_2).

Each open stream subscribes a queue, tagged with its Room and its user. A
write publishes, once its transaction has committed, a content-free event to
every queue of the Room, or to one user's queues only (a draft's writes, so
other members never learn it exists). One backend process serves each
environment, so an in-process broker reaches every stream; more processes
would need Postgres `LISTEN/NOTIFY` (architecture.md -> Storage Model)."""

import asyncio
import uuid
from dataclasses import dataclass, field

# A stream that falls this far behind is closed rather than buffered: the
# client reconnects and re-reads the board, which is all an event asks of it.
QUEUE_SIZE = 64


@dataclass(frozen=True)
class Event:
    """What changed, never what it says (Decision 3): the Session 0's
    `revision` after the write, the kind of object (`start`, `card`,
    `reaction`, `column`, `round`, `timer`) and its id when it has one."""

    revision: int
    kind: str
    id: uuid.UUID | None = None


@dataclass(eq=False)
class Subscription:
    """One open stream. `None` in the queue closes it."""

    room_id: uuid.UUID
    user_id: uuid.UUID
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

    def subscribe(self, room_id: uuid.UUID, user_id: uuid.UUID) -> Subscription:
        """Opens a stream's queue."""
        subscription = Subscription(room_id, user_id)
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

    def _streams(self, room_id: uuid.UUID, user_id: uuid.UUID | None) -> list[Subscription]:
        return [s for s in self._rooms.get(room_id, ()) if user_id is None or s.user_id == user_id]

    def publish(
        self, room_id: uuid.UUID, event: Event, *, user_id: uuid.UUID | None = None
    ) -> None:
        """Sends `event` to the Room's streams, or to `user_id`'s only."""
        for subscription in self._streams(room_id, user_id):
            subscription.offer(event)

    def disconnect(self, room_id: uuid.UUID, user_id: uuid.UUID | None = None) -> None:
        """Closes the Room's streams, or `user_id`'s: they left the Room, or
        it is gone."""
        for subscription in self._streams(room_id, user_id):
            subscription.offer(None)

    def count(self, room_id: uuid.UUID) -> int:
        """How many streams the Room has open."""
        return len(self._rooms.get(room_id, ()))


broker = Broker()
