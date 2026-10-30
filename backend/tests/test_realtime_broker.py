"""The in-process broker behind the live updates (spec 46_2, spec 52)."""

import uuid

from app.realtime.broker import MAP, QUEUE_SIZE, SESSION_ZERO, Broker, Event

ROOM = uuid.uuid4()
OTHER_ROOM = uuid.uuid4()
ALICE = uuid.uuid4()
BOB = uuid.uuid4()


async def test_events_reach_the_room_or_some_users_only() -> None:
    broker = Broker()
    alice = broker.subscribe(ROOM, ALICE)
    alice_tab = broker.subscribe(ROOM, ALICE)
    bob = broker.subscribe(ROOM, BOB)
    elsewhere = broker.subscribe(OTHER_ROOM, BOB)
    shared = Event(3, "card", uuid.uuid4())
    draft = Event(3, "card", uuid.uuid4())

    broker.publish(ROOM, shared)
    broker.publish(ROOM, draft, user_ids={ALICE})

    assert [alice.queue.get_nowait() for _ in range(2)] == [shared, draft]
    assert [alice_tab.queue.get_nowait() for _ in range(2)] == [shared, draft]
    assert bob.queue.get_nowait() == shared
    assert bob.queue.empty()
    assert elsewhere.queue.empty()
    # Nobody listening is fine.
    broker.publish(uuid.uuid4(), shared)


async def test_a_stream_hears_only_its_topics() -> None:
    """Spec 52 Decision 2: the Session 0 alias hears Session 0 events only."""
    broker = Broker()
    alias = broker.subscribe(ROOM, ALICE, frozenset({SESSION_ZERO}))
    room = broker.subscribe(ROOM, ALICE)
    board = Event(4, "card", uuid.uuid4())
    map_event = Event(7, "changed", uuid.uuid4(), MAP)

    broker.publish(ROOM, board)
    broker.publish(ROOM, map_event, user_ids={ALICE, BOB})

    assert alias.queue.get_nowait() == board
    assert alias.queue.empty()
    assert [room.queue.get_nowait() for _ in range(2)] == [board, map_event]


async def test_disconnect_closes_a_users_or_the_whole_rooms_streams() -> None:
    broker = Broker()
    alice = broker.subscribe(ROOM, ALICE)
    bob = broker.subscribe(ROOM, BOB)

    broker.disconnect(ROOM, ALICE)
    assert alice.queue.get_nowait() is None
    assert bob.queue.empty()
    broker.disconnect(ROOM)
    assert bob.queue.get_nowait() is None


async def test_a_stream_that_falls_behind_is_closed() -> None:
    broker = Broker()
    slow = broker.subscribe(ROOM, ALICE)
    for revision in range(QUEUE_SIZE + 1):
        broker.publish(ROOM, Event(revision, "timer"))

    assert slow.queue.get_nowait() is None
    assert slow.queue.empty()


async def test_unsubscribing_forgets_the_stream_and_the_empty_room() -> None:
    broker = Broker()
    alice = broker.subscribe(ROOM, ALICE)
    bob = broker.subscribe(ROOM, BOB)
    assert broker.count(ROOM) == 2

    broker.unsubscribe(alice)
    assert broker.count(ROOM) == 1
    broker.unsubscribe(bob)
    assert broker.count(ROOM) == 0
    # Twice is harmless.
    broker.unsubscribe(bob)
