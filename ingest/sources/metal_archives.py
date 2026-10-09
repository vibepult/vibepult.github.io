"""Metal Archives band page and discography. Fetched through curl (see http.py)."""
import re

from bs4 import BeautifulSoup

from . import http
from .titles import match, normalise_title

SITE = "https://www.metal-archives.com"


def _members(soup, tab):
    div = soup.find(id=tab)
    return len(div.select("tr.lineupRow")) if div else 0


def parse_band(html):
    soup = BeautifulSoup(html, "html.parser")
    stats = {dt.get_text(strip=True).rstrip(":"): dd
             for dt, dd in zip(soup.select("#band_stats dt"), soup.select("#band_stats dd"))}
    country = stats["Country of origin"].find("a")["href"].rsplit("/", 1)[1]
    status = stats["Status"].get_text(strip=True).lower()
    years = [int(y) for y in re.findall(r"\b(1[96]\d\d|20\d\d)\b", stats["Years active"].get_text())]
    return {
        "genre": stats["Genre"].get_text(strip=True),
        "country": country,
        "formed": int(f) if (f := stats["Formed in"].get_text(strip=True)).isdigit() else None,  # "N/A" happens
        "split": max(years) if status == "split-up" and years else None,  # on hold, unknown: not split
        "status": status,
        "members": _members(soup, "band_tab_members_current"),
        "past_members": _members(soup, "band_tab_members_past"),
        "themes": stats["Themes"].get_text(strip=True) if "Themes" in stats else "",
    }


def parse_discography(html):
    soup = BeautifulSoup(html, "html.parser")
    return [{"title": tds[0].get_text(strip=True), "type": tds[1].get_text(strip=True),
             "year": int(tds[2].get_text(strip=True))}
            for tds in (tr.find_all("td") for tr in soup.select("table.discog tbody tr")) if len(tds) >= 3]


def band(path):
    """path like 'Mayhem/67'. Returns metadata plus the discography list under 'albums'."""
    meta = parse_band(http.get(f"{SITE}/bands/{path}").decode())
    band_id = path.rsplit("/", 1)[1]
    meta["albums"] = parse_discography(http.get(f"{SITE}/band/discography/id/{band_id}/tab/all").decode())
    if meta["formed"] is None:  # unknown formation year: the first release stands in for it
        meta["formed"] = min(a["year"] for a in meta["albums"])
    return fix_split(meta)


def fix_split(meta):
    """A band splits no earlier than its last studio album ("Years active" can end in a bare start year)."""
    if meta["status"] != "split-up":
        meta["split"] = None
    else:
        meta["split"] = max([meta["split"] or 0] + [a["year"] for a in meta["albums"] if a["type"] == "Full-length"]) or None
    return meta


def albums_with_years(itunes_albums, ma_albums, year_source="metal-archives"):
    """Keep iTunes albums that match a full-length by normalised title (D4) and attach its original year.
    Returns (albums sorted by year, titles of unmatched iTunes albums). Unmatched albums are dropped:
    in practice they are EPs, singles, compilations and remix sets the iTunes title filter missed."""
    by_title = {}
    for a in ma_albums:  # bilingual titles ("Чем холоднее ночь / The Colder the Night") match either side
        for t in [a["title"], *a["title"].split(" / ")]:
            by_title.setdefault(normalise_title(t), a)
    out, unmatched = [], []
    for a in itunes_albums:
        m = match(a["title"], by_title)
        if m is None:
            unmatched.append(a["title"])
        elif m["type"] == "Full-length":
            out.append({**a, "itunes_year": a["year"], "year": m["year"], "year_source": year_source})
    return sorted(out, key=lambda a: a["year"]), unmatched
