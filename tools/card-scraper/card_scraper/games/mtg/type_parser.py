"""MTG type line parser.

Scryfall returns a combined `type_line` string like:
  "Legendary Creature — Elf Warrior"
  "Artifact Creature — Construct"
  "Basic Land — Island"

This module splits it into supertypes, types, and subtypes arrays.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List


# Known supertypes per MTG comprehensive rules
KNOWN_SUPERTYPES = frozenset({
    "Basic", "Legendary", "Snow", "World", "Ongoing", "Host",
})

# Known card types per MTG comprehensive rules
KNOWN_TYPES = frozenset({
    # Primary types
    "Artifact", "Battle", "Creature", "Enchantment", "Instant",
    "Kindred", "Land", "Planeswalker", "Sorcery",
    # Supplemental types (un-sets, supplemental products)
    "Conspiracy", "Dungeon", "Emblem", "Phenomenon", "Plane", "Scheme", "Vanguard",
})


@dataclass
class TypeLineResult:
    """Parsed components of an MTG type line."""

    supertypes: List[str] = field(default_factory=list)
    types: List[str] = field(default_factory=list)
    subtypes: List[str] = field(default_factory=list)


def parse_type_line(type_line: str) -> TypeLineResult:
    """Parse an MTG type line into supertypes, types, and subtypes.

    Handles the `—` (em dash) or `—` separator between types and subtypes.
    Multi-face type lines (separated by ` // `) return the front face only.

    Args:
        type_line: The full type line string from Scryfall.

    Returns:
        TypeLineResult with separated supertypes, types, and subtypes.
    """
    if not type_line or not type_line.strip():
        return TypeLineResult()

    # Multi-face: only parse the front face
    if " // " in type_line:
        type_line = type_line.split(" // ")[0]

    # Split on em dash (—) to separate type part from subtype part
    # Scryfall uses the em dash character
    parts = type_line.split("—", 1)
    type_part = parts[0].strip()
    subtype_part = parts[1].strip() if len(parts) > 1 else ""

    # Parse the type part: supertypes come before card types
    supertypes: List[str] = []
    types: List[str] = []

    for word in type_part.split():
        if word in KNOWN_SUPERTYPES:
            supertypes.append(word)
        elif word in KNOWN_TYPES:
            types.append(word)
        else:
            # Unknown word in type position — treat as a type
            # This handles future card types gracefully
            types.append(word)

    # Parse subtypes (everything after the dash, space-separated)
    subtypes: List[str] = []
    if subtype_part:
        subtypes = [s.strip() for s in subtype_part.split() if s.strip()]

    return TypeLineResult(
        supertypes=supertypes,
        types=types,
        subtypes=subtypes,
    )


def parse_multi_face_type_lines(type_line: str) -> List[TypeLineResult]:
    """Parse a multi-face type line, returning results for each face.

    Args:
        type_line: Full type line, possibly with ` // ` separator.

    Returns:
        List of TypeLineResult, one per face.
    """
    if not type_line or not type_line.strip():
        return [TypeLineResult()]

    faces = type_line.split(" // ")
    return [parse_type_line(face.strip()) for face in faces]
