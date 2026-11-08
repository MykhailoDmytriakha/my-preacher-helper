'''Extract explicit related-word sections for Ukrainian only from the native Wiktionary dump.'''
import bz2
from collections import defaultdict
import re
import xml.etree.ElementTree as ET

HEADING = re.compile(r'^\s*(={1,6})\s*(.*?)\s*\1\s*$')
LANGUAGE = re.compile(r'^\s*=?\s*\{\{\s*([=-])([a-z][a-z0-9-]{0,15})\1\s*\}\}\s*=?\s*$', re.I)
RELATED_SECTION = re.compile(r'^споріднені слова:?$', re.I)
PARAMS = {'іменники','прикметники','дієслова','прислівники','дієприкметники','змп','згруб'}
TEMPLATE = re.compile(r'\{\{[ \t]*спорідн\b(.*?)(?<!\})\}\}', re.S|re.I)
FIELD = re.compile(r'^\s*\|[ \t]*([^={}\n|]+?)[ \t]*=[ \t]*([^\n]*)', re.M)
LINK = re.compile(r'\[\[([^]|#]+)(?:#[^]|]+)?(?:\|[^]]+)?\]\]')
MARKS = re.compile(r"[\u0300\u0301’ʼ']")
def normalize(word):
    return MARKS.sub('',word.casefold().strip())

def related_sections(article):
    language = None
    related = False
    section = []
    for line in article.splitlines():
        match = LANGUAGE.fullmatch(line)
        heading = HEADING.fullmatch(line)
        if match or heading:
            if section:
                yield '\n'.join(section)
                section.clear()
            if match:
                language = match.group(2).lower()
            elif len(heading.group(1)) < 3:
                language = None
            related = bool(language == 'uk' and heading and RELATED_SECTION.fullmatch(heading.group(2)))
        elif related:
            section.append(line)
    if section:
        yield '\n'.join(section)

def terms(section):
    result = set()
    for template in TEMPLATE.finditer(section):
        for field in FIELD.finditer(template.group(1)):
            name, body = field.groups()
            if name.strip().lower() not in PARAMS:
                continue
            for token in LINK.sub(lambda match:match.group(1),body).split(','):
                candidate = normalize(token)
                if candidate.isalpha():
                    result.add(candidate)
    # A language-marked section may list editorial links without the related template.
    for line in section.splitlines():
        if line.lstrip().startswith('*'):
            result.update(candidate for candidate in map(normalize,LINK.findall(line)) if candidate.isalpha())
    return result

def relationship(a,b):
    return tuple(sorted((a,b)))

def native_ukrainian_edges(path):
    directed = defaultdict(set)
    with bz2.open(path, 'rb') as source:
        _, root = next(events := ET.iterparse(source, events=('start', 'end')))
        for event, node in events:
            if event != 'end' or not node.tag.endswith('}page'):
                continue
            lemma = normalize(node.findtext('{*}title', ''))
            if node.findtext('{*}ns', '') == '0' and lemma.isalpha():
                article = node.findtext('{*}revision/{*}text', '')
                for section in related_sections(article):
                    directed[lemma].update(terms(section) - {lemma})
            root.clear()
    return {relationship(lemma, relative) for lemma, relatives in directed.items() for relative in relatives}
