"""Comprehensive tests for the MTG type line parser."""

import pytest

from card_scraper.games.mtg.type_parser import (
    TypeLineResult,
    parse_type_line,
    parse_multi_face_type_lines,
)


class TestParseTypeLine:
    """Test parse_type_line with 20+ edge cases."""

    def test_simple_instant(self):
        result = parse_type_line("Instant")
        assert result.supertypes == []
        assert result.types == ["Instant"]
        assert result.subtypes == []

    def test_simple_sorcery(self):
        result = parse_type_line("Sorcery")
        assert result.types == ["Sorcery"]
        assert result.subtypes == []

    def test_creature_with_subtypes(self):
        result = parse_type_line("Creature \u2014 Elf Warrior")
        assert result.supertypes == []
        assert result.types == ["Creature"]
        assert result.subtypes == ["Elf", "Warrior"]

    def test_legendary_creature(self):
        result = parse_type_line("Legendary Creature \u2014 Elf Warrior")
        assert result.supertypes == ["Legendary"]
        assert result.types == ["Creature"]
        assert result.subtypes == ["Elf", "Warrior"]

    def test_artifact_creature(self):
        result = parse_type_line("Artifact Creature \u2014 Construct")
        assert result.supertypes == []
        assert result.types == ["Artifact", "Creature"]
        assert result.subtypes == ["Construct"]

    def test_legendary_planeswalker(self):
        result = parse_type_line("Legendary Planeswalker \u2014 Jace")
        assert result.supertypes == ["Legendary"]
        assert result.types == ["Planeswalker"]
        assert result.subtypes == ["Jace"]

    def test_basic_land(self):
        result = parse_type_line("Basic Land \u2014 Island")
        assert result.supertypes == ["Basic"]
        assert result.types == ["Land"]
        assert result.subtypes == ["Island"]

    def test_legendary_snow_creature(self):
        result = parse_type_line("Legendary Snow Creature \u2014 Giant Berserker")
        assert result.supertypes == ["Legendary", "Snow"]
        assert result.types == ["Creature"]
        assert result.subtypes == ["Giant", "Berserker"]

    def test_enchantment_no_subtypes(self):
        result = parse_type_line("Enchantment")
        assert result.types == ["Enchantment"]
        assert result.subtypes == []

    def test_artifact_no_subtypes(self):
        result = parse_type_line("Artifact")
        assert result.types == ["Artifact"]
        assert result.subtypes == []

    def test_legendary_artifact(self):
        result = parse_type_line("Legendary Artifact")
        assert result.supertypes == ["Legendary"]
        assert result.types == ["Artifact"]
        assert result.subtypes == []

    def test_enchantment_creature(self):
        result = parse_type_line("Enchantment Creature \u2014 God")
        assert result.types == ["Enchantment", "Creature"]
        assert result.subtypes == ["God"]

    def test_land_no_subtypes(self):
        result = parse_type_line("Land")
        assert result.types == ["Land"]
        assert result.subtypes == []

    def test_legendary_land(self):
        result = parse_type_line("Legendary Land")
        assert result.supertypes == ["Legendary"]
        assert result.types == ["Land"]
        assert result.subtypes == []

    def test_legendary_enchantment_artifact(self):
        result = parse_type_line("Legendary Enchantment Artifact")
        assert result.supertypes == ["Legendary"]
        assert result.types == ["Enchantment", "Artifact"]

    def test_kindred_instant(self):
        """Test the 'Kindred' type (renamed from 'Tribal')."""
        result = parse_type_line("Kindred Instant \u2014 Elf")
        assert result.types == ["Kindred", "Instant"]
        assert result.subtypes == ["Elf"]

    def test_world_enchantment(self):
        result = parse_type_line("World Enchantment")
        assert result.supertypes == ["World"]
        assert result.types == ["Enchantment"]

    def test_snow_land(self):
        result = parse_type_line("Snow Land \u2014 Island")
        assert result.supertypes == ["Snow"]
        assert result.types == ["Land"]
        assert result.subtypes == ["Island"]

    def test_battle(self):
        result = parse_type_line("Battle \u2014 Siege")
        assert result.types == ["Battle"]
        assert result.subtypes == ["Siege"]

    def test_multi_face_takes_front(self):
        """Multi-face type lines return only the front face."""
        result = parse_type_line("Creature \u2014 Human Scout // Creature \u2014 Human Rogue")
        assert result.types == ["Creature"]
        assert result.subtypes == ["Human", "Scout"]

    def test_empty_string(self):
        result = parse_type_line("")
        assert result == TypeLineResult()

    def test_whitespace_only(self):
        result = parse_type_line("   ")
        assert result == TypeLineResult()

    def test_legendary_creature_many_subtypes(self):
        result = parse_type_line("Legendary Creature \u2014 Human Cleric Advisor")
        assert result.supertypes == ["Legendary"]
        assert result.types == ["Creature"]
        assert result.subtypes == ["Human", "Cleric", "Advisor"]

    def test_conspiracy(self):
        """Supplemental card type."""
        result = parse_type_line("Conspiracy")
        assert result.types == ["Conspiracy"]

    def test_plane(self):
        """Planechase type."""
        result = parse_type_line("Plane \u2014 Ravnica")
        assert result.types == ["Plane"]
        assert result.subtypes == ["Ravnica"]


class TestParseMultiFaceTypeLines:
    """Test multi-face type line parsing."""

    def test_dfc(self):
        results = parse_multi_face_type_lines(
            "Creature \u2014 Human Scout // Creature \u2014 Human Rogue"
        )
        assert len(results) == 2
        assert results[0].types == ["Creature"]
        assert results[0].subtypes == ["Human", "Scout"]
        assert results[1].types == ["Creature"]
        assert results[1].subtypes == ["Human", "Rogue"]

    def test_mdfc(self):
        results = parse_multi_face_type_lines(
            "Legendary Planeswalker \u2014 Jace // Legendary Creature \u2014 Human Wizard"
        )
        assert len(results) == 2
        assert results[0].supertypes == ["Legendary"]
        assert results[0].types == ["Planeswalker"]
        assert results[0].subtypes == ["Jace"]
        assert results[1].supertypes == ["Legendary"]
        assert results[1].types == ["Creature"]
        assert results[1].subtypes == ["Human", "Wizard"]

    def test_single_face(self):
        results = parse_multi_face_type_lines("Instant")
        assert len(results) == 1
        assert results[0].types == ["Instant"]

    def test_empty(self):
        results = parse_multi_face_type_lines("")
        assert len(results) == 1
        assert results[0] == TypeLineResult()
