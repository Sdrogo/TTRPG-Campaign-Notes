"""Markdown in descriptions and Notes (spec 48): the tree the PDF prints, the
plain words of search excerpts, and where a name is never linked."""

from app.domain.markdown import (
    Node,
    markdown_plain,
    markdown_tree,
    placeholder,
    protected_ranges,
    safe_url,
    split_placeholders,
    without_placeholder_marks,
)

# Explicit, so mypy needn't infer a nested literal's leaf type.
N = Node[str]

DOC = "00000000-0000-4000-8000-000000000001"
TOKEN = f"#[Il Cancello](doc:{DOC})"


def _tree(source: str, top_heading: int = 1) -> list[N]:
    return markdown_tree(
        source, leaf=str, mention=lambda index: f"<{index}>", top_heading=top_heading
    )


def test_placeholders_split_back_out() -> None:
    assert split_placeholders(f"a{placeholder(0)}b{placeholder(12)}") == ["a", 0, "b", 12]
    assert split_placeholders(placeholder(3)) == [3]


def test_only_web_and_mail_addresses_are_safe() -> None:
    assert safe_url(" https://a.b ") == "https://a.b"
    assert safe_url("HTTP://a.b") == "HTTP://a.b"
    assert safe_url("mailto:x@y.z") == "mailto:x@y.z"
    assert safe_url("javascript:alert(1)") is None
    assert safe_url("/rooms/1") is None


def test_blocks_and_inline_elements() -> None:
    blocks = _tree(
        "# One\n\n**b** *i* ~~s~~ `c`\nnext\n\n- x\n- y\n\n1. z\n\n> q\n\n---\n\n"
        "| h |\n| - |\n| d |\n\n```\nfenced\n```\n\n    indented"
    )

    assert blocks == [
        N("h1", ("One",)),
        N(
            "p",
            (
                N("strong", ("b",)),
                " ",
                N("em", ("i",)),
                " ",
                N("s", ("s",)),
                " ",
                N("code", ("c",)),
                N("br"),
                "next",
            ),
        ),
        N("ul", (N("li", ("x",)), N("li", ("y",)))),
        N("ol", (N("li", ("z",)),)),
        N("blockquote", (N("p", ("q",)),)),
        N("hr"),
        N(
            "table",
            (
                N("thead", (N("tr", (N("th", ("h",)),)),)),
                N("tbody", (N("tr", (N("td", ("d",)),)),)),
            ),
        ),
        N("pre", (N("code", ("fenced",)),)),
        N("pre", (N("code", ("indented",)),)),
    ]


def test_headings_step_down_from_the_top_level_and_stop_at_h6() -> None:
    assert [b.tag for b in _tree("# a\n\n## b\n\n###### c", top_heading=4)] == ["h4", "h5", "h6"]


def test_placeholders_become_mentions_except_in_code() -> None:
    mention = placeholder(0)
    assert _tree(f"see {mention} and `{mention}`") == [
        N("p", ("see ", "<0>", " and ", N("code", (mention,)))),
    ]


def test_raw_html_is_text() -> None:
    assert _tree("<script>x</script>\n\na <b>b</b>") == [
        N("p", ("<script>x</script>",)),
        N("p", ("a <b>b</b>",)),
    ]


def test_a_script_address_is_never_a_link() -> None:
    # markdown-it itself refuses it: the whole thing stays text.
    assert _tree("[bad](javascript:alert(1))") == [N("p", ("[bad](javascript:alert(1))",))]


def test_links_and_images() -> None:
    (paragraph,) = _tree(
        "[web](https://a.b) [bad](/rooms/1) ![map](https://a.b/m.png) ![](https://a.b/n.png) ![x](ftp://y)"
    )

    assert paragraph.children == (
        N("a", ("web",), "https://a.b"),
        " ",
        N("span", ("bad",)),
        " ",
        N("a", ("map",), "https://a.b/m.png"),
        " ",
        N("a", ("https://a.b/n.png",), "https://a.b/n.png"),
        " ",
        N("span", ("x",)),
    )


def test_plain_words_keep_mention_tokens() -> None:
    assert markdown_plain(f"## Who\n\n**{TOKEN}** and `{TOKEN}`\n\n- [web](https://a.b)\n- x") == (
        f"Who {TOKEN} and {TOKEN} web x"
    )
    assert markdown_plain("one\ntwo") == "one two"
    assert markdown_plain("| a | b |\n| - | - |\n| 1 | 2 |\n\n---") == "a b 1 2"


def test_protected_ranges_cover_code_links_and_addresses() -> None:
    text = (
        "see `Drakon` [Drakon](https://x.y/Drakon) https://Drakon.com Drakon\n"
        "```\nDrakon\n```\nDrakon"
    )
    assert [text[start:end] for start, end in protected_ranges(text)] == [
        "`Drakon`",
        "[Drakon](https://x.y/Drakon)",
        "https://Drakon.com",
        "```\nDrakon\n```\n",
    ]


def test_an_unclosed_fence_runs_to_the_end_and_ranges_merge() -> None:
    text = "a\n~~~\nDrakon `x`"
    assert protected_ranges(text) == [(2, len(text))]


def test_a_pasted_placeholder_is_not_a_mention() -> None:
    """Private-use characters typed or pasted in the text (an icon font)
    are dropped before lifting, so they never stand for a mention."""
    pasted = f"{placeholder(7)} {TOKEN}"
    assert without_placeholder_marks(pasted) == f"7 {TOKEN}"
    assert markdown_plain(pasted) == f"7 {TOKEN}"


def test_an_address_with_brackets_is_protected_whole() -> None:
    text = "[il drago](https://it.wikipedia.org/wiki/Drago_(mitologia)) vola"
    assert protected_ranges(text) == [(0, text.index(" vola"))]
