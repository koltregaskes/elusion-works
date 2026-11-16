"""Extract complete HTML reference values using the standard-library HTML5 table."""
import html
from html.entities import html5
from html.parser import HTMLParser
import json
import re
import sys

ENTITY = re.compile(r"&(#(?:[xX][0-9a-fA-F]+|[0-9]+);?|[A-Za-z][A-Za-z0-9]*;?)")
ATTRIBUTE = re.compile(r'''([^\s/=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?''')
URL_ATTRIBUTES = {"href", "src", "action", "formaction", "poster", "data", "cite", "background", "longdesc", "manifest", "xlink:href"}
ASCII_SPACE = "\t\n\f\r "


def refresh_destination(content):
    # Accept the supported declarative-refresh grammar explicitly. A syntax we
    # cannot classify must fail, never leave an active URL to a mention exception.
    delay = re.match(r"^[\t\n\f\r ]*[0-9]+(?:\.[0-9]+)?", content)
    if not delay:
        raise ValueError("Unsupported refresh delay")
    remainder = content[delay.end():].strip(ASCII_SPACE)
    if not remainder:
        return ""  # Delay-only refresh reloads the current document.
    if remainder[0] not in ";,":
        raise ValueError("Unsupported refresh separator")
    destination = remainder[1:].strip(ASCII_SPACE)
    if destination.startswith((";", ",")):
        raise ValueError("Unsupported refresh separator")
    if destination[:3].lower() == "url":
        marker = re.match(r"url[\t\n\f\r ]*=[\t\n\f\r ]*", destination, re.I)
        if not marker:
            raise ValueError("Unsupported refresh URL marker")
        destination = destination[marker.end():]
    if destination.startswith(('"', "'")):
        end = destination.find(destination[0], 1)
        if end < 0 or destination[end + 1:].strip(ASCII_SPACE):
            raise ValueError("Unsupported quoted refresh destination")
        destination = destination[1:end]
    return destination


def decode_attribute(value):
    # Longest HTML5 named match, in attribute context. Decode exactly once:
    # semicolonless names followed by ASCII alphanumeric or '=' stay literal.
    def replace(match):
        token = match[1]
        if token.startswith("#"):
            return html.unescape(match[0])
        for length in range(len(token), 0, -1):
            name = token[:length]
            if name not in html5:
                continue
            following = token[length:length + 1] or value[match.end():match.end() + 1]
            if not name.endswith(";") and following and (following in "=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"):
                return match[0]
            return html5[name] + token[length:]
        return match[0]
    return ENTITY.sub(replace, value)


def is_data_url(value):
    return re.match(r"^[\x00-\x20]*data:", re.sub(r"[\t\r\n]", "", value), re.I)


def reference_kind(tag, name, attrs):
    if tag in {"iframe", "frame", "embed"} and name == "src" or tag == "object" and name == "data":
        return "document"
    if name in {"href", "xlink:href"} and tag in {"a", "area"} or name in {"action", "formaction"}:
        return "navigation"
    if tag == "base" or tag == "link" and name == "href" and attrs.get("rel") and set(attrs["rel"].lower().split()) <= {"canonical", "alternate"}:
        return "mention"
    return "url"


class References(HTMLParser):
    # Namespace/integration/breakout rules determine whether style/script is raw
    # text. HTMLParser alone treats foreign style/script as HTML raw text, which
    # hides browser-visible elements. Unknown source contexts remain fail-closed.
    VOID = set("area base br col embed hr img input link meta param source track wbr".split())
    BREAKOUT = set("b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var".split())

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.references = []
        self.contexts = []
        self.base = None
        self.raw_kind = None
        self.raw_parts = []
        self.stack = []

    def emit(self, kind, value):
        decoded = value
        for _ in range(16):
            following = html.unescape(decoded)
            if following == decoded:
                break
            decoded = following
        else:
            raise ValueError("Entity nesting exceeds the inspection limit")
        self.contexts.append({"kind": kind, "value": value, "decodedText": decoded})
        if kind not in {"inert", "unknown"}:
            self.references.append({"kind": kind, "value": value})

    def integration(self, node, child=""):
        if node["ns"] == "svg" and node["tag"] in {"foreignobject", "desc", "title"}:
            return True
        if node["ns"] == "math" and node["tag"] in {"mi", "mo", "mn", "ms", "mtext"}:
            return child not in {"mglyph", "malignmark"}
        return node["ns"] == "math" and node["tag"] == "annotation-xml" and (node["encoding"] in {"text/html", "application/xhtml+xml"} or child == "svg")

    def pop(self):
        node = self.stack.pop()
        if node["parts"]:
            self.emit("css" if node["tag"] == "style" else "js", "".join(node["parts"]))

    def set_cdata_mode(self, elem, **kwargs):
        if self.stack and self.stack[-1]["ns"] != "html":
            return  # Foreign style/script contents are tokenised as markup.
        super().set_cdata_mode(elem, **kwargs)

    def parse_marked_section(self, i, report=1):
        foreign = self.stack and self.stack[-1]["ns"] != "html"
        if foreign and self.rawdata.startswith("<![CDATA[", i):
            end = self.rawdata.find("]]>", i + 9)
            if end < 0:
                raise ValueError("Unclosed foreign CDATA")
            self.handle_data(self.rawdata[i + 9:end])
            return end + 3
        # In HTML, <![CDATA[ is a bogus comment ending at the FIRST >, not ]]>.
        end = self.rawdata.find(">", i + 2)
        if end < 0:
            raise ValueError("Unclosed bogus comment")
        self.emit("inert", self.rawdata[i + 2:end])
        return end + 1

    def parse_html_declaration(self, i):
        # Python versions differ in whether CDATA reaches parse_marked_section.
        # Decide from the HTML5 namespace state here on every supported version.
        if self.rawdata.startswith("<![CDATA[", i):
            return self.parse_marked_section(i)
        if self.rawdata.startswith("<!--", i):
            return self.parse_comment(i)
        if self.rawdata[i:i + 9].lower() == "<!doctype":
            return super().parse_html_declaration(i)
        return self.parse_bogus_comment(i)

    def parse_bogus_comment(self, i, report=1):
        end = self.rawdata.find(">", i + 2)
        if end < 0:
            end = len(self.rawdata)
        if report:
            self.emit("inert", self.rawdata[i + 2:end])
        return min(end + 1, len(self.rawdata))

    def parse_comment(self, i, report=True):
        start = i + 4
        if self.rawdata.startswith(">", start):
            end, following = start, start + 1
        elif self.rawdata.startswith("->", start):
            end, following = start, start + 2
        else:
            match = re.search(r"--!?>", self.rawdata[start:])
            end = start + match.start() if match else len(self.rawdata)
            following = start + match.end() if match else len(self.rawdata)
        if report:
            self.emit("inert", self.rawdata[start:end])
        return following

    def handle_starttag(self, tag, _):
        raw = self.get_starttag_text()
        raw = raw[re.match(r"<\s*[^\s/>]+", raw).end():]
        attrs = {}
        for match in ATTRIBUTE.finditer(raw):
            name = match[1].lower()
            value = decode_attribute(next((v for v in match.groups()[1:] if v is not None), ""))
            if name not in attrs:
                attrs[name] = value
            else:
                self.emit("inert", value)  # First duplicate wins in HTML.
        # Standalone SVG can use XML QName prefixes that HTML tokenisation does
        # not resolve. Unsupported prefixed active elements must not become inert.
        if ":" in tag and tag.rsplit(":", 1)[-1] in {"script", "style", "link", "image", "use", "set", "animate", "iframe", "object", "embed"}:
            raise ValueError("Unsupported prefixed active markup")
        parent = self.stack[-1] if self.stack else None
        foreign = parent and parent["ns"] != "html" and not self.integration(parent, tag)
        if foreign and (tag in self.BREAKOUT or tag == "font" and any(key in attrs for key in ["color", "face", "size"])):
            while self.stack and self.stack[-1]["ns"] != "html" and not self.integration(self.stack[-1]):
                self.pop()
            foreign = False
        ns = parent["ns"] if foreign else "svg" if tag == "svg" else "math" if tag == "math" else "html"
        # All script loading attributes are boundaries, including SVG href and
        # xlink:href. Classic scripts cannot be made safe by their data MIME.
        # Strip URL-parser-ignored tabs/newlines before checking the scheme.
        if tag == "script" and any(is_data_url(value) for name, value in attrs.items() if name.rsplit(":", 1)[-1] in {"src", "href"}):
            raise ValueError("Data scripts are forbidden")
        if tag == "link" and "stylesheet" in attrs.get("rel", "").lower().split() and is_data_url(attrs.get("href", "")):
            raise ValueError("Data stylesheets are forbidden")
        if tag == "base" and self.base is None and "href" in attrs:
            self.base = attrs["href"]
        for name, value in attrs.items():
            if name in URL_ATTRIBUTES:
                kind = reference_kind(tag, name, attrs)
                self.emit(kind, value)
            elif name in {"xmlns", "xmlns:xlink"}:
                self.emit("mention", value)
            elif name in {"srcset", "imagesrcset"}:
                self.emit("srcset", value)
            elif name == "ping":
                for item in re.split(r"[\t\n\f\r ]+", value.strip()):
                    if item:
                        self.emit("url", item)
            elif name == "style":
                self.emit("css", value)
            elif name == "srcdoc":
                self.emit("html", value)
            elif name.startswith("on"):
                self.emit("js", value)
            elif name not in {"content", "to", "from", "by", "values"}:
                self.emit("inert" if name in {"title", "alt", "aria-label"} else "unknown", value)
        prop = attrs.get("property", attrs.get("name", "")).lower()
        equiv = attrs.get("http-equiv", "").lower()
        if tag == "meta" and prop in {"og:url", "og:image", "twitter:image", "twitter:url"}:
            self.emit("url" if "image" in prop else "mention", attrs.get("content", ""))
        elif tag == "meta" and equiv == "refresh":
            self.emit("navigation", refresh_destination(attrs.get("content", "")))
        elif tag == "meta" and equiv == "content-security-policy":
            for token in re.split(r"[;\t\n\f\r ]+", attrs.get("content", "")):
                if re.match(r"https?://|//", token, re.I):
                    self.emit("mention", token)
        elif "content" in attrs:
            self.emit("inert" if tag == "meta" else "unknown", attrs["content"])
        animation = ns == "svg" and tag in {"set", "animate"} and attrs.get("attributename", "").lower() in {"href", "xlink:href"}
        for name in ["to", "from", "by", "values"]:
            if name in attrs:
                for value in attrs[name].split(";") if animation and name == "values" else [attrs[name]]:
                    self.emit("url" if animation else "unknown", value.strip())
        if not (ns == "html" and tag in self.VOID):
            self.stack.append({"tag": tag, "ns": ns, "encoding": attrs.get("encoding", "").lower(), "parts": []})
        if ns == "html" and tag in {"script", "style"}:
            self.raw_kind = "recipe" if tag == "script" and attrs.get("type", "").lower() in {"text/babel", "text/jsx"} else "metadata-js" if tag == "script" and attrs.get("type", "").lower() == "application/ld+json" else "js" if tag == "script" else "css"
            self.raw_parts = []

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if self.stack and self.stack[-1]["tag"] == tag and self.stack[-1]["ns"] != "html":
            self.pop()
        elif tag in {"script", "style"}:
            self.set_cdata_mode(tag)  # HTML ignores a non-void self-closing slash.

    def handle_data(self, data):
        if self.raw_kind:
            self.raw_parts.append(data)
        elif self.stack and self.stack[-1]["ns"] != "html" and self.stack[-1]["tag"] in {"style", "script"}:
            self.stack[-1]["parts"].append(data)
        else:
            self.emit("inert", data)

    def handle_entityref(self, name):
        self.handle_data(html.unescape("&" + name + ";"))

    def handle_charref(self, name):
        self.handle_data(html.unescape("&#" + name + ";"))

    def handle_endtag(self, tag):
        if self.raw_kind and tag in {"script", "style"}:
            self.emit(self.raw_kind, "".join(self.raw_parts))
            self.raw_kind = None
            self.raw_parts = []
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                while len(self.stack) > index:
                    self.pop()
                break

    def finish(self):
        if self.raw_kind:
            self.emit(self.raw_kind, "".join(self.raw_parts))
            self.raw_kind = None
        while self.stack:
            self.pop()


try:
    source = sys.stdin.buffer.read().decode("utf-8")
    # The backstop deliberately decodes entity-looking text in every context,
    # including comments and standalone CSS/JS. It is broader than request parsing.
    decoded = source
    for _ in range(16):
        following = html.unescape(decoded)
        if following == decoded:
            break
        decoded = following
    else:
        raise ValueError("Entity nesting exceeds the inspection limit")
    if sys.argv[1:] == ["--decode-text"]:
        print(json.dumps({"decodedText": decoded}))
    elif not sys.argv[1:]:
        parser = References()
        parser.feed(source)
        parser.close()
        parser.finish()
        print(json.dumps({"base": parser.base, "references": parser.references, "contexts": parser.contexts, "decodedText": decoded}))
    else:
        raise ValueError("Unknown helper mode")
except Exception:
    # No parser exception or input value may disclose a URL or credentials.
    print("Cannot extract HTML references", file=sys.stderr)
    sys.exit(1)
