import json
import re
import unittest
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = ROOT / "site"
PUBLIC_SITE = "https://dvoineu.github.io/VPNSentinel/"
PUBLIC_REPO = "https://github.com/dvoineu/VPNSentinel"
RELEASE = PUBLIC_REPO + "/releases/download/v0.1.0-build.1/"


class SemanticHTMLInspector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.headings = []
        self.images = []
        self.details_names = []
        self.meta_tags = []
        self.link_tags = []
        self.anchors = []
        self.local_resources = []
        self.in_json_ld = False
        self.json_ld_blocks = []
        self._current_json_ld = []

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)
        if tag == "a":
            self.anchors.append(attr_dict)
        if attr_dict.get("src"):
            self.local_resources.append(attr_dict["src"])
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self.headings.append(int(tag[1]))
        elif tag == "img":
            self.images.append(attr_dict)
        elif tag == "details":
            self.details_names.append(attr_dict.get("name"))
        elif tag == "meta":
            self.meta_tags.append(attr_dict)
        elif tag == "link":
            self.link_tags.append(attr_dict)
        elif tag == "script" and attr_dict.get("type") == "application/ld+json":
            self.in_json_ld = True
            self._current_json_ld = []

    def handle_endtag(self, tag):
        if tag == "script" and self.in_json_ld:
            self.in_json_ld = False
            self.json_ld_blocks.append("".join(self._current_json_ld).strip())

    def handle_data(self, data):
        if self.in_json_ld:
            self._current_json_ld.append(data)


class I18nTextCollector(HTMLParser):
    """Collects the English fallback text of leaf elements marked with data-i18n."""

    def __init__(self):
        super().__init__()
        self.keys = {"text": [], "html": [], "aria": []}
        self.texts = {}
        self._stack = []

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)
        if "data-i18n" in attr_dict:
            self.keys["text"].append(attr_dict["data-i18n"])
        if "data-i18n-html" in attr_dict:
            self.keys["html"].append(attr_dict["data-i18n-html"])
        if "data-i18n-aria-label" in attr_dict:
            self.keys["aria"].append(attr_dict["data-i18n-aria-label"])
        if tag in {"img", "meta", "link", "source", "br", "input"}:
            return
        self._stack.append([attr_dict.get("data-i18n"), ""])

    def handle_endtag(self, tag):
        if not self._stack:
            return
        key, text = self._stack.pop()
        if key:
            self.texts.setdefault(key, set()).add(" ".join(text.split()))
        if self._stack:
            self._stack[-1][1] += text

    def handle_data(self, data):
        if self._stack:
            self._stack[-1][1] += data


def load_dictionary():
    source = (SITE_DIR / "js" / "i18n.js").read_text(encoding="utf-8")
    english, russian = source.split("\n  ru: {", 1)
    pattern = re.compile(r"^    (\w+): '((?:[^'\\]|\\.)*)',$", re.MULTILINE)
    return {
        "en": dict(pattern.findall(english)),
        "ru": dict(pattern.findall(russian)),
    }


class VPNSentinelSiteTests(unittest.TestCase):
    def test_site_files_exist(self):
        required = [
            SITE_DIR / ".nojekyll",
            SITE_DIR / "index.html",
            SITE_DIR / "css" / "styles.css",
            SITE_DIR / "js" / "app.js",
            SITE_DIR / "js" / "i18n.js",
            SITE_DIR / "js" / "scene3d.js",
            SITE_DIR / "vendor" / "three.module.min.js",
            SITE_DIR / "vendor" / "LICENSE.txt",
            SITE_DIR / "robots.txt",
            SITE_DIR / "sitemap.xml",
            SITE_DIR / "site.webmanifest",
            SITE_DIR / "assets" / "favicon.svg",
            SITE_DIR / "assets" / "icon-192.png",
            SITE_DIR / "assets" / "icon-512.png",
            SITE_DIR / "assets" / "og-poster.png",
        ]
        for path in required:
            self.assertTrue(path.is_file(), f"Missing required site file: {path}")

    def test_html_semantics_and_seo_metadata(self):
        html_text = (SITE_DIR / "index.html").read_text(encoding="utf-8")
        self.assertTrue(html_text.startswith("<!DOCTYPE html>"))

        inspector = SemanticHTMLInspector()
        inspector.feed(html_text)

        h1_count = sum(1 for level in inspector.headings if level == 1)
        self.assertEqual(h1_count, 1, "Page must have exactly one <h1>")
        for prev, curr in zip(inspector.headings, inspector.headings[1:]):
            self.assertLessEqual(
                curr - prev,
                1,
                f"Heading hierarchy skipped from h{prev} to h{curr}",
            )

        self.assertGreaterEqual(len(inspector.images), 2)
        for img in inspector.images:
            self.assertIn("width", img)
            self.assertIn("height", img)
            self.assertIn("alt", img)

        self.assertGreaterEqual(len(inspector.details_names), 5)
        for name in inspector.details_names:
            self.assertEqual(name, "faq")

        rels = [link.get("rel") for link in inspector.link_tags]
        self.assertIn("canonical", rels)
        hreflangs = {
            link.get("hreflang")
            for link in inspector.link_tags
            if link.get("rel") == "alternate"
        }
        self.assertEqual(hreflangs, {"ru", "en", "x-default"})

        self.assertEqual(len(inspector.json_ld_blocks), 1)
        ld_data = json.loads(inspector.json_ld_blocks[0])
        self.assertEqual(ld_data.get("@context"), "https://schema.org")
        graph_types = {item.get("@type") for item in ld_data.get("@graph", [])}
        self.assertIn("SoftwareApplication", graph_types)
        self.assertIn("FAQPage", graph_types)
        self.assertIn("WebSite", graph_types)

    def test_css_supports_dark_mode_reduced_motion_and_small_screens(self):
        css_text = (SITE_DIR / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn("color-scheme: light dark", css_text)
        self.assertIn("prefers-color-scheme: dark", css_text)
        self.assertIn("prefers-reduced-motion: reduce", css_text)
        self.assertIn("max-width: 640px", css_text)
        app_js = (SITE_DIR / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("prefers-reduced-motion: reduce", app_js)

    def test_no_third_party_scripts(self):
        inspector = SemanticHTMLInspector()
        inspector.feed((SITE_DIR / "index.html").read_text(encoding="utf-8"))
        for resource in inspector.local_resources:
            self.assertFalse(urlparse(resource).netloc, resource)
        self.assertEqual(
            sorted(p.name for p in (SITE_DIR / "vendor").iterdir()),
            ["LICENSE.txt", "three.module.min.js"],
        )

    def test_download_links_follow_latest_release(self):
        html = (SITE_DIR / "index.html").read_text(encoding="utf-8")
        for kind in ["dmg", "zip", "install", "checksums", "label"]:
            self.assertIn(f'data-release="{kind}"', html)
        app_js = (SITE_DIR / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("api.github.com/repos/${REPO}/releases/latest", app_js)
        self.assertIn("const REPO = 'dvoineu/VPNSentinel';", app_js)

    def test_hero_scene_is_optional_and_respects_motion_settings(self):
        app_js = (SITE_DIR / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("import('./scene3d.js')", app_js)
        self.assertIn("supportsWebGL()", app_js)
        scene_js = (SITE_DIR / "js" / "scene3d.js").read_text(encoding="utf-8")
        self.assertIn("from '../vendor/three.module.min.js'", scene_js)
        self.assertIn("prefers-reduced-motion: reduce", scene_js)
        self.assertIn("IntersectionObserver", scene_js)
        self.assertIn("visibilitychange", scene_js)
        html = (SITE_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="hero-canvas" aria-hidden="true"', html)

    def test_every_translation_key_exists_in_both_languages(self):
        dictionary = load_dictionary()
        self.assertGreater(len(dictionary["en"]), 100)
        self.assertEqual(set(dictionary["en"]), set(dictionary["ru"]))
        collector = I18nTextCollector()
        collector.feed((SITE_DIR / "index.html").read_text(encoding="utf-8"))
        used = set(collector.keys["text"] + collector.keys["html"] + collector.keys["aria"])
        missing = used - set(dictionary["en"])
        self.assertFalse(missing, f"Keys used in HTML but missing from i18n.js: {sorted(missing)}")
        for key in collector.keys["text"] + collector.keys["html"]:
            self.assertTrue(dictionary["en"][key] and dictionary["ru"][key], key)

    def test_english_html_fallback_matches_dictionary(self):
        dictionary = load_dictionary()["en"]
        collector = I18nTextCollector()
        collector.feed((SITE_DIR / "index.html").read_text(encoding="utf-8"))
        for key, texts in collector.texts.items():
            value = dictionary[key].replace("{version}", "0.1.0").replace("{build}", "1")
            expected = " ".join(value.replace("&amp;", "&").split())
            for text in texts:
                self.assertEqual(text, expected, key)

    def test_interactive_ledger_and_workbench_controls(self):
        html = (SITE_DIR / "index.html").read_text(encoding="utf-8")
        seeks = [int(value) for value in re.findall(r'data-seek="(\d+)"', html)]
        self.assertEqual(seeks, [0, 1, 2, 3, 4, 5])
        states = re.findall(r'data-demo-state="(\w+)"', html)
        self.assertEqual(states, ["active", "blocked", "unknown", "paused"])
        app_js = (SITE_DIR / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("150192ca7fa601065c6e46b00ae08fee937ccc014157360573c06b396846ebba", app_js)
        self.assertIn("681a17d9767d69a58fac391a7f6604d5f451568c882e1767cfb6d497e79180eb", app_js)

    def test_sitemap_and_manifest_valid(self):
        manifest = json.loads((SITE_DIR / "site.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["short_name"], "VPN Sentinel")
        self.assertGreaterEqual(len(manifest["icons"]), 3)

        tree = ET.fromstring((SITE_DIR / "sitemap.xml").read_text(encoding="utf-8"))
        self.assertTrue(tree.tag.endswith("urlset"))

    def test_public_downloads_and_project_site_urls(self):
        inspector = SemanticHTMLInspector()
        html = (SITE_DIR / "index.html").read_text(encoding="utf-8")
        inspector.feed(html)
        buttons = {a.get("data-i18n"): a for a in inspector.anchors}
        for key, filename in {
            "dlBtnDmg": "VPN-Sentinel-Demo.zip",
            "dlBtnZip": "VPN-Sentinel-Experiment.zip",
            "dlInstall": "INSTALL.txt",
            "dlChecksums": "SHA256SUMS",
        }.items():
            self.assertEqual(buttons[key]["href"], RELEASE + filename)
        for anchor in inspector.anchors:
            href = anchor.get("href", "")
            if href.startswith("https://github.com/"):
                self.assertTrue(href == PUBLIC_REPO or href.startswith(PUBLIC_REPO + "/"), href)
        canonical = next(link["href"] for link in inspector.link_tags if link.get("rel") == "canonical")
        self.assertEqual(canonical, PUBLIC_SITE)
        for link in inspector.link_tags:
            if link.get("rel") == "alternate":
                self.assertTrue(link["href"].startswith(PUBLIC_SITE))
        graph = json.loads(inspector.json_ld_blocks[0])["@graph"]
        software = next(item for item in graph if item["@type"] == "SoftwareApplication")
        self.assertEqual(software["downloadUrl"], buttons["dlBtnDmg"]["href"])
        for meta in inspector.meta_tags:
            if meta.get("property") in {"og:url", "og:image"} or meta.get("name") == "twitter:image":
                self.assertTrue(meta["content"].startswith(PUBLIC_SITE))
        sitemap = ET.fromstring((SITE_DIR / "sitemap.xml").read_text(encoding="utf-8"))
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        self.assertEqual(sitemap.find("s:url/s:loc", ns).text, PUBLIC_SITE)
        self.assertIn("Sitemap: " + PUBLIC_SITE + "sitemap.xml", (SITE_DIR / "robots.txt").read_text(encoding="utf-8"))

    def test_local_assets_resolve_under_pages_project_path(self):
        inspector = SemanticHTMLInspector()
        inspector.feed((SITE_DIR / "index.html").read_text(encoding="utf-8"))
        resources = inspector.local_resources + [
            link["href"] for link in inspector.link_tags
            if link.get("rel") in {"stylesheet", "icon", "apple-touch-icon", "manifest"}
        ]
        manifest = json.loads((SITE_DIR / "site.webmanifest").read_text(encoding="utf-8"))
        resources.extend(icon["src"] for icon in manifest["icons"])
        for resource in resources:
            resolved = urljoin(PUBLIC_SITE, resource)
            self.assertTrue(resolved.startswith(PUBLIC_SITE), resolved)
            relative = urlparse(resolved).path.removeprefix(urlparse(PUBLIC_SITE).path)
            self.assertTrue((SITE_DIR / relative).is_file(), relative)

    def test_english_html_fallback_and_language_links(self):
        html = (SITE_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn('<html lang="en">', html)
        self.assertIn(">Install VPN Sentinel on your Mac</h2>", html)
        inspector = SemanticHTMLInspector()
        inspector.feed(html)
        languages = {a["data-language"]: a for a in inspector.anchors if "data-language" in a}
        self.assertEqual(set(languages), {"en", "ru"})
        for language, link in languages.items():
            self.assertEqual(link["href"], "?lang=" + language)
            self.assertEqual(link["lang"], language)
        self.assertEqual(languages["en"]["aria-current"], "true")
        self.assertNotIn("aria-current", languages["ru"])
        self.assertEqual(json.loads((SITE_DIR / "site.webmanifest").read_text(encoding="utf-8"))["lang"], "en")
        website = json.loads(inspector.json_ld_blocks[0])["@graph"][0]
        self.assertEqual(website["inLanguage"], ["en", "ru"])

    def test_current_release_has_visible_bilingual_change_list(self):
        html = (SITE_DIR / "index.html").read_text(encoding="utf-8")
        dictionary = (SITE_DIR / "js/i18n.js").read_text(encoding="utf-8")
        self.assertIn('id="whats-new"', html)
        self.assertIn(">What’s new in VPN Sentinel</h2>", html)
        for key in [
            "newKicker", "newTitle", "newSubtitle", "newSetupTitle", "newSetupBody",
            "newTrialTitle", "newTrialBody", "newModelTitle", "newModelBody", "newPreserved", "newFullNotes",
        ]:
            self.assertIn('data-i18n="' + key + '"', html)
            self.assertEqual(len(re.findall(r"\b" + key + r":\s*[\'\"][^\'\"]+", dictionary)), 2, key)
        self.assertIn(PUBLIC_REPO + "/releases/tag/v0.1.0-build.1", html)
        self.assertIn('VPN Sentinel <span data-release="label">0.1.0 (1)</span>', html)


if __name__ == "__main__":
    unittest.main()
