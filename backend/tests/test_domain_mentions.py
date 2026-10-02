"""Mention tokens (spec 19c Decision 2, spec 20 Decision 1): what reads as a
token, and how `@` mentions of non-members are turned back into text."""

import uuid

import pytest

from app.domain.mentions import Mention, MentionKind, find_mentions, unlink_non_members

ALICE = uuid.UUID("11111111-1111-4111-8111-111111111111")
BOB = uuid.UUID("22222222-2222-4222-8222-222222222222")
DOC = uuid.UUID("33333333-3333-4333-8333-333333333333")


def test_finds_each_kind_with_its_position() -> None:
    text = f"Ask @[Alice](user:{ALICE}) about #[Ravenloft](doc:{DOC}) and #[NPC](tag:{BOB})."
    found = find_mentions(text)

    assert [(m.kind, m.target_id, m.name) for m in found] == [
        (MentionKind.USER, ALICE, "Alice"),
        (MentionKind.DOCUMENT, DOC, "Ravenloft"),
        (MentionKind.TAG, BOB, "NPC"),
    ]
    assert text[found[0].start : found[0].end] == f"@[Alice](user:{ALICE})"


def test_a_name_may_hold_brackets_parentheses_and_escapes() -> None:
    text = f"@[Sir (the) [Bold\\] \\\\ One](user:{ALICE})"

    assert find_mentions(text) == [
        Mention(MentionKind.USER, ALICE, "Sir (the) [Bold] \\ One", 0, len(text))
    ]


def test_an_empty_name_still_reads_as_a_token() -> None:
    assert find_mentions(f"@[](user:{ALICE})")[0].name == ""


@pytest.mark.parametrize(
    "text",
    [
        "plain @Alice and #Ravenloft",
        f"@[Alice](person:{ALICE})",  # unknown kind
        f"#[Alice](user:{ALICE})",  # `#` doesn't name people
        f"@[Ravenloft](doc:{DOC})",  # `@` doesn't name content
        "@[Alice](user:not-a-uuid)",
        f"@[Alice](user:{ALICE}",  # no closing parenthesis
        f"@[Alice (user:{ALICE})",  # the bracket is never closed
        f"@[Alice] (user:{ALICE})",  # space before the target
        "trailing @",
        "trailing \\",
        f"@[Alice\\](user:{ALICE})",  # the escaped `]` doesn't close it
    ],
)
def test_anything_else_is_plain_text(text: str) -> None:
    assert find_mentions(text) == []


def test_an_unclosed_bracket_reads_up_to_the_next_closing_one() -> None:
    # `[` needs no escape, so the first `[` opens a name that runs to the
    # first unescaped `]`: one token, not two.
    text = f"@[broken @[Alice](user:{ALICE})"

    assert [m.name for m in find_mentions(text)] == ["broken @[Alice"]


def test_tokens_next_to_each_other_are_both_found() -> None:
    text = f"@[A](user:{ALICE})@[B](user:{BOB})"

    assert [m.target_id for m in find_mentions(text)] == [ALICE, BOB]


def test_members_stay_linked_and_others_become_plain_text() -> None:
    text = f"@[Alice](user:{ALICE}), @[Sir \\] Bob](user:{BOB}) and #[Doc](doc:{DOC})"

    assert unlink_non_members(text, {ALICE}) == (
        f"@[Alice](user:{ALICE}), @Sir ] Bob and #[Doc](doc:{DOC})"
    )


def test_text_without_tokens_is_returned_as_is() -> None:
    assert unlink_non_members("Nothing to see @here", {ALICE}) == "Nothing to see @here"
