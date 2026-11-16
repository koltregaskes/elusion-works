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


class References(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.references = []
        self.base = None
        self.raw_kind = None
        self.raw_parts = []

    def handle_starttag(self, tag, _):
        raw = self.get_starttag_text()
        raw = raw[re.match(r"<\s*[^\s/>]+", raw).end():]
        attrs = {}
        for match in ATTRIBUTE.finditer(raw):
            name = match[1].lower()
            if name not in attrs:  # HTML uses the first duplicate attribute.
                attrs[name] = decode_attribute(next((v for v in match.groups()[1:] if v is not None), ""))
        if tag == "base" and self.base is None and "href" in attrs:
            self.base = attrs["href"]
        for name, value in attrs.items():
            if name in URL_ATTRIBUTES:
                self.references.append({"kind": ("navigation" if tag in {"a", "area"} and name == "href" else "mention" if tag == "link" and attrs.get("rel", "").lower() in {"canonical", "alternate"} else "url"), "value": value})
            elif name in {"srcset", "imagesrcset"}:
                self.references.append({"kind": "srcset", "value": value})
            elif name == "ping":
                self.references.extend({"kind": "url", "value": v} for v in re.split(r"[\t\n\f\r ]+", value.strip()) if v)
            elif name == "style":
                self.references.append({"kind": "css", "value": value})
            elif name == "srcdoc":
                self.references.append({"kind": "html", "value": value})
            elif name.startswith("on"):
                self.references.append({"kind": "js", "value": value})
        if tag == "meta" and attrs.get("property", attrs.get("name", "")).lower() in {"og:url", "og:image", "twitter:image", "twitter:url"}:
            self.references.append({"kind": "url", "value": attrs.get("content", "")})
        if tag == "meta" and attrs.get("http-equiv", "").lower() == "refresh":
            self.references.append({"kind": "url", "value": refresh_destination(attrs.get("content", ""))})
        if tag in {"script", "style"}:
            self.raw_kind = "mention" if tag == "script" and attrs.get("type", "").lower() in {"application/ld+json", "text/babel", "text/jsx"} else "js" if tag == "script" else "css"
            self.raw_parts = []

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag in {"script", "style"}:
            self.handle_endtag(tag)

    def handle_data(self, data):
        if self.raw_kind:
            self.raw_parts.append(data)

    def handle_endtag(self, tag):
        if self.raw_kind and tag in {"script", "style"}:
            self.references.append({"kind": self.raw_kind, "value": "".join(self.raw_parts)})
            self.raw_kind = None
            self.raw_parts = []


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
        print(json.dumps({"base": parser.base, "references": parser.references, "decodedText": decoded}))
    else:
        raise ValueError("Unknown helper mode")
except Exception:
    # No parser exception or input value may disclose a URL or credentials.
    print("Cannot extract HTML references", file=sys.stderr)
    sys.exit(1)
