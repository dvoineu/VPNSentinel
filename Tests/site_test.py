import colorsys
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
DEMO_SHA = "150192ca7fa601065c6e46b00ae08fee937ccc014157360573c06b396846ebba"
EXPERIMENT_SHA = "681a17d9767d69a58fac391a7f6604d5f451568c882e1767cfb6d497e79180eb"


def read(relative):
    return (SITE_DIR / relative).read_text(encoding="utf-8")


class PageInspector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.headings = []
        self.details_names = []
        self.summaries = []
        self.meta_tags = []
        self.link_tags = []
        self.anchors = []
        self.sources = []
        self.json_ld_blocks = []
        self._json_ld = None
        self._summary = None
        self._details = None

    def handle_starttag(self, tag, attrs):
        attr = dict(attrs)
        if attr.get("src"):
            self.sources.append(attr["src"])
        if tag == "a":
            self.anchors.append(attr)
        elif tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self.headings.append(int(tag[1]))
        elif tag == "details":
            self.details_names.append(attr.get("name"))
            self._details = attr.get("name")
        elif tag == "summary" and self._details == "faq":
            self._summary = ""
        elif tag == "meta":
            self.meta_tags.append(attr)
        elif tag == "link":
            self.link_tags.append(attr)
        elif tag == "script" and attr.get("type") == "application/ld+json":
            self._json_ld = []

    def handle_endtag(self, tag):
        if tag == "script" and self._json_ld is not None:
            self.json_ld_blocks.append("".join(self._json_ld).strip())
            self._json_ld = None
        elif tag == "summary" and self._summary is not None:
            self.summaries.append(" ".join(self._summary.split()))
            self._summary = None

    def handle_data(self, data):
        if self._json_ld is not None:
            self._json_ld.append(data)
        if self._summary is not None:
            self._summary += data


class I18nCollector(HTMLParser):
    """Collects the English fallback text of elements marked with data-i18n / data-i18n-html."""

    def __init__(self):
        super().__init__()
        self.keys = {"text": [], "html": [], "aria": []}
        self.texts = {}
        self._stack = []

    def handle_starttag(self, tag, attrs):
        attr = dict(attrs)
        if "data-i18n" in attr:
            self.keys["text"].append(attr["data-i18n"])
        if "data-i18n-html" in attr:
            self.keys["html"].append(attr["data-i18n-html"])
        if "data-i18n-aria-label" in attr:
            self.keys["aria"].append(attr["data-i18n-aria-label"])
        if tag in {"img", "meta", "link", "source", "br", "input", "path", "rect", "circle", "ellipse"}:
            return
        self._stack.append([attr.get("data-i18n") or attr.get("data-i18n-html"), ""])

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag in {"path", "rect", "circle", "ellipse"} or not self._stack:
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
    source = read("js/i18n.js")
    english, russian = source.split("\n  ru: {", 1)
    pattern = re.compile(r"^    (\w+): '((?:[^'\\]|\\.)*)',$", re.MULTILINE)
    return {"en": dict(pattern.findall(english)), "ru": dict(pattern.findall(russian))}


def plain(value):
    return " ".join(re.sub(r"<[^>]+>", "", value).replace("&amp;", "&").split())


def page():
    inspector = PageInspector()
    inspector.feed(read("index.html"))
    return inspector


class VPNSentinelSiteTests(unittest.TestCase):
    def test_site_files_exist(self):
        for relative in [
            ".nojekyll", "index.html", "css/tokens.css", "css/styles.css", "js/app.js", "js/i18n.js",
            "robots.txt", "sitemap.xml", "site.webmanifest", "fonts/LICENSE.txt",
            "fonts/onest-latin-wght-normal.woff2", "fonts/onest-cyrillic-wght-normal.woff2",
            "fonts/jetbrains-mono-latin-wght-normal.woff2", "fonts/jetbrains-mono-cyrillic-wght-normal.woff2",
            "assets/favicon.svg", "assets/icon-192.png", "assets/icon-512.png", "assets/og-poster.png",
        ]:
            self.assertTrue((SITE_DIR / relative).is_file(), f"Missing required site file: {relative}")

    def test_html_semantics_and_seo_metadata(self):
        html = read("index.html")
        self.assertTrue(html.startswith("<!DOCTYPE html>"))
        inspector = page()
        self.assertEqual(inspector.headings.count(1), 1, "Page must have exactly one <h1>")
        for prev, curr in zip(inspector.headings, inspector.headings[1:]):
            self.assertLessEqual(curr - prev, 1, f"Heading hierarchy skipped from h{prev} to h{curr}")
        self.assertGreaterEqual(inspector.details_names.count("faq"), 5)
        rels = [link.get("rel") for link in inspector.link_tags]
        self.assertIn("canonical", rels)
        hreflangs = {link.get("hreflang") for link in inspector.link_tags if link.get("rel") == "alternate"}
        self.assertEqual(hreflangs, {"ru", "en", "x-default"})
        self.assertEqual(len(inspector.json_ld_blocks), 1)
        ld = json.loads(inspector.json_ld_blocks[0])
        self.assertEqual(ld["@context"], "https://schema.org")
        types = {item["@type"] for item in ld["@graph"]}
        self.assertEqual(types, {"WebSite", "SoftwareApplication", "FAQPage"})

    def test_structured_faq_matches_visible_questions(self):
        inspector = page()
        graph = json.loads(inspector.json_ld_blocks[0])["@graph"]
        faq = next(item for item in graph if item["@type"] == "FAQPage")
        self.assertEqual([q["name"] for q in faq["mainEntity"]], inspector.summaries)

    def test_no_third_party_resources(self):
        inspector = page()
        loaded = inspector.sources + [
            link["href"] for link in inspector.link_tags
            if link.get("rel") in {"stylesheet", "preload", "icon", "apple-touch-icon", "manifest", "preconnect"}
        ]
        for resource in loaded:
            self.assertFalse(urlparse(resource).netloc, resource)
        css = read("css/tokens.css") + read("css/styles.css")
        for url in re.findall(r"url\(([^)]+)\)", css):
            self.assertFalse(urlparse(url.strip("\"'")).netloc, url)
        self.assertNotIn("fonts.googleapis.com", read("index.html") + css)
        self.assertFalse((SITE_DIR / "vendor").exists())

    def test_css_supports_dark_mode_reduced_motion_and_small_screens(self):
        tokens = read("css/tokens.css")
        styles = read("css/styles.css")
        self.assertIn("prefers-color-scheme: dark", tokens)
        self.assertIn(':root[data-theme="dark"]', tokens)
        self.assertIn("prefers-reduced-motion: reduce", styles)
        self.assertIn("max-width: 520px", styles)
        self.assertIn("prefers-reduced-motion: reduce", read("js/app.js"))

    def test_design_tokens_define_state_colours_in_both_themes(self):
        tokens = read("css/tokens.css")
        for token in ["--tunnel", "--leak", "--pause", "--paper", "--ink"]:
            self.assertGreaterEqual(len(re.findall(re.escape(token) + r":", tokens)), 3, token)

    def test_no_green_anywhere(self):
        """Design rule: a green checkmark proves nothing, so the site has no green."""
        sources = read("css/tokens.css") + read("css/styles.css") + read("index.html") + read("js/app.js")
        for hex_value in re.findall(r"#([0-9a-fA-F]{6})\b", sources):
            r, g, b = (int(hex_value[i:i + 2], 16) / 255 for i in (0, 2, 4))
            hue, lightness, saturation = colorsys.rgb_to_hls(r, g, b)
            is_green = 80 <= hue * 360 <= 175 and saturation > 0.25 and 0.12 < lightness < 0.92
            self.assertFalse(is_green, f"Green colour #{hex_value} is not part of the design system")

    def test_every_translation_key_exists_in_both_languages(self):
        dictionary = load_dictionary()
        self.assertGreater(len(dictionary["en"]), 150)
        self.assertEqual(set(dictionary["en"]), set(dictionary["ru"]))
        for language in ("en", "ru"):
            for key, value in dictionary[language].items():
                self.assertTrue(value, f"{language}.{key} is empty")
        collector = I18nCollector()
        collector.feed(read("index.html"))
        used = set(collector.keys["text"] + collector.keys["html"] + collector.keys["aria"])
        missing = used - set(dictionary["en"])
        self.assertFalse(missing, f"Keys used in HTML but missing from i18n.js: {sorted(missing)}")

    def test_keys_used_by_scripts_exist(self):
        dictionary = load_dictionary()
        app = read("js/app.js")
        keys = set(re.findall(r"\bt\('(\w+)'\)", app))
        for scene in ("Ok", "Leak", "Hold", "Pause"):
            self.assertIn(f"key: '{scene}'", app)
            keys |= {f"scn{scene}Chip", f"scn{scene}Title", f"scn{scene}Body"}
        steps = [int(i) for i in re.findall(r'class="step" data-i="(\d+)"', read("index.html"))]
        self.assertEqual(steps, list(range(7)))
        self.assertEqual(len(re.findall(r"\{ glyph: '\w+', clock: '\d\d:\d\d'", app)), len(steps))
        for i in steps:
            keys |= {f"pop{i}Title", f"pop{i}Sub", f"pop{i}Rows", f"pop{i}Btn"}
        for language in ("en", "ru"):
            missing = keys - set(dictionary[language])
            self.assertFalse(missing, f"{language}: {sorted(missing)}")
            for i in steps:
                for row in dictionary[language][f"pop{i}Rows"].split("|"):
                    self.assertEqual(row.count("="), 1, f"{language}.pop{i}Rows")
            self.assertIn("{t}", dictionary[language]["scnPauseBubble"])

    def test_english_html_fallback_matches_dictionary(self):
        dictionary = load_dictionary()["en"]
        collector = I18nCollector()
        collector.feed(read("index.html"))
        for key, texts in collector.texts.items():
            for text in texts:
                self.assertEqual(text, plain(dictionary[key]), key)

    def test_language_links_and_default_language(self):
        html = read("index.html")
        self.assertIn('<html lang="en"', html)
        languages = {a["data-language"]: a for a in page().anchors if "data-language" in a}
        self.assertEqual(set(languages), {"en", "ru"})
        for language, link in languages.items():
            self.assertEqual(link["href"], "?lang=" + language)
            self.assertEqual(link["lang"], language)
        self.assertEqual(languages["en"].get("aria-current"), "true")
        self.assertNotIn("aria-current", languages["ru"])
        app = read("js/app.js")
        self.assertIn("new URLSearchParams(location.search).get('lang')", app)
        self.assertIn("'vpnsentinel-language'", app)
        website = json.loads(page().json_ld_blocks[0])["@graph"][0]
        self.assertEqual(website["inLanguage"], ["en", "ru"])

    def test_honest_status_is_visible(self):
        html = read("index.html")
        hero = html.split('id="hero"', 1)[1].split('<figure', 1)[0]
        self.assertIn('data-i18n-html="statusText"', hero)
        self.assertIn('data-i18n="sceneNote"', html)
        try_section = html.split('id="try"', 1)[1]
        self.assertLess(try_section.index('data-release="demo"'), try_section.index('data-i18n="tryWarn"'))
        dictionary = load_dictionary()
        self.assertIn("doesn’t work yet", dictionary["en"]["statusText"])
        self.assertIn("пока не работает", dictionary["ru"]["statusText"])

    def test_traffic_scene_controls(self):
        html = read("index.html")
        self.assertEqual(re.findall(r'data-scn="(\w+)"', html), ["ok", "leak", "hold", "pause"])
        for element_id in ["r-tunnel", "r-direct", "r-blocked", "r-lan", "gate", "pipe", "toast", "verdict-title"]:
            self.assertIn(f'id="{element_id}"', html)

    def test_download_links_follow_latest_release(self):
        inspector = page()
        by_kind = {a["data-release"]: a for a in inspector.anchors if "data-release" in a}
        for kind, filename in {
            "demo": "VPN-Sentinel-Demo.zip",
            "experiment": "VPN-Sentinel-Experiment.zip",
            "install": "INSTALL.txt",
            "checksums": "SHA256SUMS",
        }.items():
            self.assertEqual(by_kind[kind]["href"], RELEASE + filename)
        html = read("index.html")
        self.assertIn('<span data-release="label">0.1.0 (1)</span>', html)
        self.assertIn(DEMO_SHA, html)
        self.assertIn(EXPERIMENT_SHA, html)
        app = read("js/app.js")
        self.assertIn("const REPO = 'dvoineu/VPNSentinel';", app)
        self.assertIn("api.github.com/repos/${REPO}/releases/latest", app)
        graph = json.loads(inspector.json_ld_blocks[0])["@graph"]
        software = next(item for item in graph if item["@type"] == "SoftwareApplication")
        self.assertEqual(software["downloadUrl"], by_kind["demo"]["href"])

    def test_public_project_urls(self):
        inspector = page()
        for anchor in inspector.anchors:
            href = anchor.get("href", "")
            if href.startswith("https://github.com/"):
                self.assertTrue(href == PUBLIC_REPO or href.startswith(PUBLIC_REPO + "/"), href)
        canonical = next(link["href"] for link in inspector.link_tags if link.get("rel") == "canonical")
        self.assertEqual(canonical, PUBLIC_SITE)
        for link in inspector.link_tags:
            if link.get("rel") == "alternate":
                self.assertTrue(link["href"].startswith(PUBLIC_SITE))
        for meta in inspector.meta_tags:
            if meta.get("property") in {"og:url", "og:image"} or meta.get("name") == "twitter:image":
                self.assertTrue(meta["content"].startswith(PUBLIC_SITE))
        sitemap = ET.fromstring(read("sitemap.xml"))
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        self.assertEqual(sitemap.find("s:url/s:loc", ns).text, PUBLIC_SITE)
        self.assertIn("Sitemap: " + PUBLIC_SITE + "sitemap.xml", read("robots.txt"))

    def test_manifest_valid(self):
        manifest = json.loads(read("site.webmanifest"))
        self.assertEqual(manifest["short_name"], "VPN Sentinel")
        self.assertEqual(manifest["lang"], "en")
        self.assertGreaterEqual(len(manifest["icons"]), 3)

    def test_local_assets_resolve_under_pages_project_path(self):
        inspector = page()
        resources = inspector.sources + [
            link["href"] for link in inspector.link_tags
            if link.get("rel") in {"stylesheet", "preload", "icon", "apple-touch-icon", "manifest"}
        ]
        resources.extend(icon["src"] for icon in json.loads(read("site.webmanifest"))["icons"])
        for resource in resources:
            resolved = urljoin(PUBLIC_SITE, resource)
            self.assertTrue(resolved.startswith(PUBLIC_SITE), resolved)
            relative = urlparse(resolved).path.removeprefix(urlparse(PUBLIC_SITE).path)
            self.assertTrue((SITE_DIR / relative).is_file(), relative)
        css_dir = SITE_DIR / "css"
        for url in re.findall(r'url\("([^"]+)"\)', read("css/tokens.css")):
            self.assertTrue((css_dir / url).resolve().is_file(), url)
        self.assertRegex(read("js/app.js"), r"import \{ I18N, SUPPORTED_LANGUAGES \} from './i18n\.js(\?v=\d+)?';")


if __name__ == "__main__":
    unittest.main()
