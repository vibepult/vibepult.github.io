from ingest import admit


def test_short_label_fits_and_is_unique():
    assert admit.short_label("Mayhem", set()) == "Mayhem"
    assert admit.short_label("Wolves in the Throne Room", set()) == "Wolves"
    assert admit.short_label("Wolves in the Throne Room", {"Wolves"}) == "Throne"
    assert admit.short_label("Black Witchery", set()) == "Witchery"
    assert admit.short_label("Anaal Nathrakh", set()) == "Nathrakh"
    assert admit.short_label("Extreme Noise Terror", {"Extreme", "Terror", "Noise"}) == "ENT"
    assert admit.short_label("Thergothonian", set()) == "Thergoth."
    assert admit.short_label("Thergothonian", {"Thergoth."}) == "Thergoth2"
    assert all(len(admit.short_label(n, set())) <= 9 for n in ["Holocausto Canibal", "Liquid Tension Experiment"])
