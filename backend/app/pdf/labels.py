"""The fixed texts of the Room PDF in the requester's language (spec 23b
Frontend): "Contents", "Glossary", "Other"… come from the backend's message
files, like every text the API produces (`architecture.md` → Backend Message
Localization)."""

from app.domain.manual import ManualLabels
from app.i18n.translator import translate


def manual_labels(locale: str) -> ManualLabels:
    """The labels for `locale`, falling back to English like `translate`."""
    return ManualLabels(
        contents=translate("pdf.contents", locale),
        glossary=translate("pdf.glossary", locale),
        other=translate("pdf.other", locale),
        documents=translate("pdf.documents", locale),
        comments=translate("pdf.comments", locale),
        unknown_member=translate("pdf.unknownMember", locale),
        deleted_comment=translate("pdf.deletedComment", locale),
        # Left as a template: `{character}` and `{player}` are filled per Comment.
        played_by=translate("pdf.playedBy", locale),
        page_abbreviation=translate("pdf.pageAbbreviation", locale),
    )
