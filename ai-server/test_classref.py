"""Class-name matching: "1" must never mean 10 / 11 / 12.  Run: python -m unittest test_classref (from ai-server/)"""
import unittest
import agent, classref
from classref import ClassRef, parse_class_ref as P

ROWS = [{"name": n, "section": s} for n in ("1", "2", "5", "10", "11", "12", "21") for s in ("A", "B")]
ROWS.append({"name": "Nursery", "section": "A"})


def labels(want):
    return [agent.class_label(c) for c in classref.match_classes(ROWS, want)]


class Parse(unittest.TestCase):
    def test_forms(self):
        for text, want in {"10": ("10", ""), "class 10": ("10", ""), "Class 10 B": ("10", "B"), "10b": ("10", "B"), "10 B": ("10", "B"),
                           "10th": ("10", ""), "10th-b": ("10", "B"), "5/B": ("5", "B"), "05 a": ("5", "A"), "tenth": ("10", ""),
                           "ten b": ("10", "B"), "X": ("10", ""), "X A": ("10", "A"), "xii": ("12", ""), "1st": ("1", ""),
                           "Nursery A": ("nursery", "A"), "std 12 section c": ("12", "C"), "": ("", "")}.items():
            self.assertEqual(tuple(P(text)), want, text)


class Match(unittest.TestCase):
    def test_one_never_matches_ten_eleven_twelve(self):
        self.assertEqual(labels("1"), ["1 A", "1 B"])
        self.assertEqual(labels("class 1"), ["1 A", "1 B"])
        self.assertEqual(labels("1a"), ["1 A"])
        self.assertEqual(labels("1st"), ["1 A", "1 B"])

    def test_ten_eleven_twelve(self):
        self.assertEqual(labels("10"), ["10 A", "10 B"])
        self.assertEqual(labels("10th"), ["10 A", "10 B"])
        self.assertEqual(labels("tenth b"), ["10 B"])
        self.assertEqual(labels("11"), ["11 A", "11 B"])
        self.assertEqual(labels("12 b"), ["12 B"])
        self.assertEqual(labels("2"), ["2 A", "2 B"])               # not 12 / 21
        self.assertEqual(labels("5 b"), ["5 B"])

    def test_missing(self):
        self.assertEqual(labels("13"), [])
        self.assertEqual(labels("10 C"), [])

    def test_label_matches(self):
        self.assertTrue(classref.label_matches("10 B", "10")); self.assertFalse(classref.label_matches("10 B", "1"))
        self.assertFalse(classref.label_matches("21 A", "1")); self.assertFalse(classref.label_matches("11 A", "1a"))
        self.assertTrue(agent.class_like("10 A", "class 10"))

    def test_picking_one(self):
        self.assertEqual(agent.class_label(agent.pick_one_class(ROWS, "10 b")), "10 B")
        with self.assertRaises(agent.ErpError) as e:
            agent.pick_one_class(ROWS, "10")
        self.assertIn("10 A, 10 B", str(e.exception)); self.assertNotIn("1 A", str(e.exception).replace("10 A", ""))
        with self.assertRaises(agent.ErpError):
            agent.pick_one_class(ROWS, "13")


class StoredWithPrefix(unittest.TestCase):
    def test_class_word_in_stored_name(self):
        rows = [{"name": f"Class {n}", "section": "A"} for n in (1, 10, 11, 12)]
        for want in ("10", "class 10", "10th", "tenth", "10 A"):
            self.assertEqual([c["name"] for c in classref.match_classes(rows, want)], ["Class 10"], want)
        self.assertEqual([c["name"] for c in classref.match_classes(rows, "1")], ["Class 1"])
        g = [{"name": f"Class {n}", "sections": ["A"]} for n in (1, 10, 11, 12)]
        self.assertEqual(agent.fee_group(None, None, "10th", g)[0]["name"], "Class 10")


class StoreNew(unittest.TestCase):
    def test_new_classes_are_stored_plain(self):
        for raw, want in (("Class 10", "10"), ("10th", "10"), ("class-5", "5"), ("10", "10"), ("Nursery", "Nursery"), ("Std 1", "1")):
            self.assertEqual(classref.clean_stored_name(raw), want, raw)
        self.assertEqual(classref.clean_stored_section("b"), "B")
        self.assertEqual(classref.clean_stored_section("Section C"), "C")

    def test_create_class_tool_uses_it(self):
        old = agent.api
        agent.api = lambda *a, **k: []
        try:
            ctx = {"token": "t", "user": {"id": "uid-create", "role": "school_admin", "features": ["edit_user"]}, "cache": {}, "cards": [], "pending": {}}
            out = agent.t_create_class({"name": "Class 10", "section": "b"}, ctx)
            self.assertIn("Add class 10 B", str(out) + str(ctx["cards"]))
            self.assertNotIn("Class Class", str(out) + str(ctx["cards"]))
        finally:
            agent.api = old


class FeeGroups(unittest.TestCase):
    G = [{"name": n, "sections": ["A", "B"]} for n in ("1", "5", "10", "11", "12")]

    def test_fee_group(self):
        for text in ("10", "class 10", "10th", "10 B", "10b", "tenth"):
            self.assertEqual(agent.fee_group(None, None, text, self.G)[0]["name"], "10", text)
        self.assertEqual(agent.fee_group(None, None, "1", self.G)[0]["name"], "1")
        with self.assertRaises(agent.ErpError):
            agent.fee_group(None, None, "10 C", self.G)
        with self.assertRaises(agent.ErpError):
            agent.fee_group(None, None, "13", self.G)


if __name__ == "__main__":
    unittest.main()


class ToolsEndToEnd(unittest.TestCase):
    """The tools themselves, with the portal calls faked: 'fee structure of class 10' / 'who is in 10 B'."""
    def setUp(self):
        self.old = agent.api
        structure = {"session": {"name": "2026-27"}, "classes": [
            {"name": "1", "sections": ["A"], "students": 1, "total": 100, "items": [{"id": "i1", "name": "Tuition", "amount": 100, "frequency": "yearly"}]},
            {"name": "10", "sections": ["A", "B"], "students": 2, "total": 900, "items": [{"id": "i2", "name": "Tuition", "amount": 900, "frequency": "yearly"}]}]}
        classes = [{"id": "c1", "name": "1", "section": "A", "school_id": "s"}, {"id": "c10a", "name": "10", "section": "A", "school_id": "s"}, {"id": "c10b", "name": "10", "section": "B", "school_id": "s"}]
        users = [{"user_id": f"u{i}", "login_id": f"l{i}", "role": "student", "is_active": True, "profile": {"full_name": n, "class_id": c}} for i, (n, c) in enumerate([("Amit", "c1"), ("Bina", "c10a"), ("Chetan", "c10b")])]

        def fake(method, path, token, body=None):
            p = path.split("?")[0]
            return {"/fees/structure": structure, "/classes": classes, "/users": users}.get(p, {})
        agent.api = fake
        self.ctx = {"token": "t", "user": {"id": "uid-classref", "role": "school_admin", "features": ["get_all_users_school", "view_fees"]}, "cache": {}}

    def tearDown(self):
        agent.api = self.old

    def test_fee_structure_of_ten_is_not_one(self):
        for text in ("10", "class 10", "10th", "10 B"):
            out = agent.t_fee_structure({"class_name": text}, self.ctx)
            self.assertEqual([c["class"] for c in out["classes"]], ["10"], text)
        self.assertEqual([c["class"] for c in agent.t_fee_structure({"class_name": "1"}, self.ctx)["classes"]], ["1"])

    def test_who_is_in_ten(self):
        out = agent.t_list_users({"class_name": "10"}, self.ctx)
        self.assertEqual(sorted(u["name"] for u in out["people"]), ["Bina", "Chetan"]) if "people" in out else self.assertIn("Bina", str(out))
        self.assertNotIn("Amit", str(out))
        self.assertNotIn("Chetan", str(agent.t_list_users({"class_name": "10 A"}, self.ctx)))
