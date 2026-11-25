"""Rebuild the bundled fallback faces from the official Nerd Fonts v3.5.1 SymbolsOnly archive.

Run with fonttools[woff]==4.68.0 and brotli==1.2.0, passing SymbolsNerdFontMono-Regular.ttf.
The generated assets are checked in. Application builds do not need Python.
"""
import argparse
import hashlib
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

SOURCE_SHA256 = "fe471e538392f51910faab985fa8e192a39dd3426125edd15b71b3680df0e749"
OUTPUT = Path(__file__).resolve().parents[1] / "src/assets/fonts/terminal-symbols"
CORE = {"cod", "custom", "dev", "fa", "fae", "oct", "pl", "ple", "seti", "weather"}


def build_face(source, name, sets, first, last, expected):
    font = TTFont(source, recalcTimestamp=False)
    points = [code for code, glyph in font.getBestCmap().items()
              if first <= code <= last and glyph.partition("-")[0] in sets]
    if len(points) != expected:
        raise ValueError(f"Unexpected number of mappings for {name}")
    options = subset.Options()
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.glyph_names = True
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=points)
    subsetter.subset(font)
    names = font["name"]
    family = f"Stratum Terminal Symbols {name.title()}"
    for record in names.names:
        values = {1: family, 3: family + " 3.5.1", 4: family, 6: family.replace(" ", ""),
                  16: family}
        if record.nameID in values:
            record.string = values[record.nameID].encode(record.getEncoding())
    font.flavor = "woff2"
    font.save(OUTPUT / f"{name}.woff2")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    source = parser.parse_args().source
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_SHA256:
        parser.error("Expected Symbols Nerd Font Mono from Nerd Fonts v3.5.1")
    build_face(source, "core", CORE, 0xE000, 0xF8FF, 3556)
    build_face(source, "material", {"md"}, 0xF0001, 0xF1AF0, 6896)
