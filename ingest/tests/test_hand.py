import pytest

from ingest import hand

POOL = """bands:
  - {slug: mayhem, name: Mayhem, hand: {persona: 0.8, camp: 0.2}}
  # corner: black
  - {deezer: 1, ma: _/2, name: Behemoth, short: Behemoth, slug: behemoth, spotify: x}
  - {deezer: 3, ma: _/4, name: Behemoth Jr, short: Jr, slug: behemoth-jr, spotify: y}
  - {deezer: 5, ma: _/6, name: '1349', short: '1349', slug: '1349', spotify: z}
"""


def test_merge_writes_into_the_right_line_once(tmp_path):
    p = tmp_path / "pool.yaml"
    p.write_text(POOL)
    assert hand.merge({"behemoth": {"persona": 0.9, "camp": 0.3}, "mayhem": {"persona": 0, "camp": 0}}, p) == 1
    text = p.read_text()
    assert "slug: behemoth, spotify: x, hand: {persona: 0.9, camp: 0.3}}" in text
    assert "slug: behemoth-jr, spotify: y}" in text  # a slug that merely starts the same is untouched
    assert "mayhem, name: Mayhem, hand: {persona: 0.8, camp: 0.2}}" in text  # existing scores never change
    assert hand.merge({"behemoth": {"persona": 0.1, "camp": 0.1}}, p) == 0
    assert hand.merge({"1349": {"persona": 0.7, "camp": 0.1}}, p) == 1  # YAML quotes numeric slugs


def test_merge_rejects_out_of_range(tmp_path):
    p = tmp_path / "pool.yaml"
    p.write_text(POOL)
    with pytest.raises(ValueError):
        hand.merge({"behemoth": {"persona": 1.4, "camp": 0}}, p)
