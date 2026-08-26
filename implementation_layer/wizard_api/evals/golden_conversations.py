"""Golden conversations for the wizard agent quality eval suite (#121).

Each conversation is one or two scripted user turns from Phase 1 (Session
start / use-case classification), covering a different pattern from the
onboarding guide's use-case family list. Assertions check *structure*, not
exact wording — the agent's phrasing legitimately varies between runs.

Pattern vocabulary comes straight from solution_wizard/SKILL.md's own
classification list (Phase 1, Step 1.2):
    audio_to_structured, document_to_structured, rag, vision_extraction,
    classification, transcript_only, hybrid
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class GoldenConversation:
    id: str
    family: str
    turns: list[str]
    # Any one of these (case-insensitive substring) counts as a correct
    # classification for turn 0's reply. Includes both the raw pattern key
    # and natural-language phrasings the agent tends to use for it.
    expected_pattern_markers: list[str]
    # Free-form description shown in the report — what a human should look
    # for if the automated checks pass but the conversation still reads oddly.
    note: str = ""
    locale_hint: str = "fi"


GOLDEN_CONVERSATIONS: list[GoldenConversation] = [
    GoldenConversation(
        id="audio-maintenance-ticket",
        family="audio_to_structured",
        turns=[
            "Hei! Haluamme GenAI-ratkaisun: teknikot jättävät äänimuistion "
            "huoltokäynnin jälkeen, ja siitä pitäisi syntyä automaattisesti "
            "rakenteinen huoltotiketti esimiehelle.",
        ],
        expected_pattern_markers=[
            "audio_to_structured",
            "audio-to-structured",
            "äänestä",
            "äänitallenteesta",
            "ääni",
        ],
        note="Should classify as audio-to-structured-data, not e.g. RAG or document extraction.",
    ),
    GoldenConversation(
        id="rag-hr-policy-chatbot",
        family="rag",
        turns=[
            "Haluaisimme chatbotin, joka vastaa henkilöstön kysymyksiin HR-"
            "käsikirjan ja aiempien HR-päätösten perusteella. Meillä on n. "
            "50 PDF-dokumenttia joita vasten kysymyksiin pitäisi vastata.",
        ],
        expected_pattern_markers=[
            "rag",
            "retrieval",
            "tietokannasta",
            "hakuun perustuva",
            "dokumenttikokoelma",
        ],
        note="Should classify as RAG (document collection + Q&A), not plain document extraction.",
    ),
    GoldenConversation(
        id="vision-installation-inspection",
        family="vision_extraction",
        turns=[
            "Haluttaisiin ilmastointiputken asennuksesta automaattinen "
            "kuvallinen tarkistus kohteesta — asentaja lähettää kuvia "
            "asennuksesta ja järjestelmä tarkistaa täyttääkö se speksit.",
        ],
        expected_pattern_markers=[
            "vision_extraction",
            "vision extraction",
            "kuva-analyysi",
            "kuvista",
            "kuva-analyysin",
        ],
        note=(
            "Should classify as vision extraction (images -> structured "
            "check), not document_to_structured."
        ),
    ),
]
