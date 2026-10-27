"""Class-name helpers for the AI assistant.

WHY THIS EXISTS
Class lookups used to be done in several places with *substring* / *prefix* matching, so a request for
class "1" also matched 10 A, 11 A, 12 A ... (and "10" could never be told apart from "1" + "0").
Everything that has to turn the user's words into a class now goes through the functions below, which
compare the class NAME as a whole value (numbers are compared as numbers) and the SECTION separately.

    parse_class_ref("class 10")   -> ClassRef(name="10", section="")      all sections of class 10
    parse_class_ref("10th B")     -> ClassRef(name="10", section="B")
    parse_class_ref("5b")         -> ClassRef(name="5",  section="B")
    parse_class_ref("X-A")        -> ClassRef(name="10", section="A")     roman numerals
    parse_class_ref("tenth")      -> ClassRef(name="10", section="")
    parse_class_ref("Nursery A")  -> ClassRef(name="nursery", section="A")

    match_classes(rows, "10")     -> every section of class 10 (never 1, 11, 12, 21 ...)
    match_classes(rows, "10 B")   -> just 10 B
    label_matches("10 B", "10")   -> True;  label_matches("10 B", "1") -> False
"""
import re
from collections import namedtuple

ClassRef = namedtuple("ClassRef", "name section")

_WORD_NUM = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12,
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9,
    "tenth": 10, "eleventh": 11, "twelfth": 12,
}
_ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10, "xi": 11, "xii": 12}
_PREFIX = re.compile(r"^(?:class|std|standard|grade|cls|cl)\b\.?\s*", re.I)
_SUFFIX = re.compile(r"\s*\b(?:section|sec|division|div)\b\.?\s*", re.I)


def _norm(s):
    return re.sub(r"\s+", " ", str(s or "").lower()).strip()


def _name_token(tok):
    """One word of the class NAME -> canonical text (numbers as plain digits)."""
    t = tok.strip().lower()
    m = re.fullmatch(r"0*(\d+)(?:st|nd|rd|th)?", t)
    if m:
        return str(int(m.group(1)))
    if t in _WORD_NUM:
        return str(_WORD_NUM[t])
    if t in _ROMAN:
        return str(_ROMAN[t])
    return t


def canon_name(name):
    """Canonical form of a stored class name: '10', ' 10 ', '010', 'Tenth', 'X' -> '10'; 'Nursery' -> 'nursery'."""
    parts = re.split(r"[\s\-_/]+", _norm(_PREFIX.sub("", _norm(name))))     # stored "Class 10" / "Std 10" == "10"
    return " ".join(_name_token(p) for p in parts if p)


def parse_class_ref(text):
    """The user's words -> ClassRef(name, section). Never raises; empty text gives ClassRef('', '')."""
    s = _norm(text)
    s = _PREFIX.sub("", s)
    s = _SUFFIX.sub(" ", s)
    s = re.sub(r"[()\[\],.]", " ", s)
    s = re.sub(r"[\-_/]+", " ", s).strip()
    s = re.sub(r"\s+", " ", s)
    if not s:
        return ClassRef("", "")
    # "10b", "5a", "10th b", "12c"  (digits then optional ordinal then optional one-letter section)
    m = re.fullmatch(r"0*(\d+)(?:st|nd|rd|th)?\s*([a-z])?", s)
    if m:
        return ClassRef(str(int(m.group(1))), (m.group(2) or "").upper())
    toks = s.split(" ")
    # "ten b", "x a", "fifth", "nursery a", "pre nursery"
    sec = ""
    if len(toks) > 1 and len(toks[-1]) == 1 and toks[-1].isalpha():
        sec = toks[-1].upper()
        toks = toks[:-1]
    return ClassRef(" ".join(_name_token(t) for t in toks), sec)


def row_ref(row):
    """A class row ({'name','section'} or {'label'} or just a label string) -> ClassRef."""
    if isinstance(row, str):
        return parse_class_ref(row)
    if row.get("name") not in (None, ""):
        sec = str(row.get("section") or "").strip().upper()
        ref = ClassRef(canon_name(row["name"]), sec)
        if not sec:                                    # a class stored as name "5 A" with no separate section
            p = parse_class_ref(row["name"])
            if p.section:
                return p
        return ref
    return parse_class_ref(row.get("label") or "")


def ref_matches(ref, want):
    """Does class `ref` (ClassRef) answer the request `want` (ClassRef)? Name must be equal as a whole value."""
    if not want.name or ref.name != want.name:
        return False
    return not want.section or ref.section == want.section


def label_matches(label, want):
    """Does a printed class label ('10 B') answer the request ('10', 'class 10', '10b')?"""
    return ref_matches(parse_class_ref(label), parse_class_ref(want) if isinstance(want, str) else want)


def match_classes(rows, want):
    """All class rows that answer the request: 'class 10' -> every section of 10, '10 B' -> only 10 B."""
    w = parse_class_ref(want) if isinstance(want, str) else want
    return [c for c in rows if ref_matches(row_ref(c), w)]


def canon_label(ref):
    return (ref.name + (" " + ref.section if ref.section else "")).strip()


def clean_stored_name(raw):
    """How a NEW class is stored: without the word "Class" (the screens add it) - 'Class 10' / '10th' -> '10'."""
    t = re.sub(r"\s+", " ", str(raw or "").strip())
    t = re.sub(r"^[\-:]\s*", "", _PREFIX.sub("", t)).strip()
    m = re.fullmatch(r"0*(\d+)(?:st|nd|rd|th)?", t, re.I)
    return str(int(m.group(1))) if m else t


def clean_stored_section(raw):
    t = re.sub(r"^(?:section|sec|division|div)\b\.?\s*", "", str(raw or "").strip(), flags=re.I).strip()
    return t.upper() if len(t) == 1 else t
