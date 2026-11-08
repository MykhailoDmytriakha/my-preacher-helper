#!/usr/bin/env python3
'''Build corpus-filtered, sense-reviewed word-family links for the three Bible editions.'''
import argparse
import collections
import gzip
import hashlib
import itertools
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

from bible_family_native import native_ukrainian_edges

FRONTEND = Path(__file__).resolve().parents[1]
PUBLIC = FRONTEND / 'public'
DATA = FRONTEND / 'app/utils/bibleSearch/wordFormsData'
INPUTS = {
    'DerivBaseRU.tsv': 'a8f1aefd8a7b6152e59bd4d7677664872ebc5caec13dbe80b45fec312e4f5e48',
    'kaikki-ru.jsonl.gz': '86a781a5685d614efd439e326eed0bf0ad9cda9f67b854f8b6c93212c5345b3e',
    'kaikki-uk.jsonl.gz': '2b8074025c192314a3906b6bb33587ff1c97f06b398f422308001561124b9586',
    'ukwiktionary.xml.bz2': 'a30f0650ac21fa1081b2fc4af772889905f408194ab981b6b177fd6bced6eac0',
    'english-wordnet-2025-json.zip': '7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51',
}
marks = re.compile(r"[’ʼ'\u0300\u0301]")
templates = {'af', 'affix', 'prefix', 'suffix', 'circumfix', 'surf', 'surface analysis',
             'univerbation', 'back-form', 'back formation'}

# Direct lexical links and additional shared families reviewed against the Bible.
# Exclusions include historical or different-sense links which do not describe
# a contemporary word family in the translation, such as salvation / eye salve.
REVIEWED = {
    'ru': [
        'бог божий божество божественный',
        'любовь любить любовный',
        'грех грешник грешить грешный',
        'молитва молиться молить молитвенный',
        'дело делать',
        'правда праведный праведник праведность',
        'святость святой святыня',
        'крест крестить крещение креститель',
        'ложь лгать лжец лживый',
        'свет светильник светило светлый светлеть светлый',
        'вера верить верующий верный верность неверие неверный',
        'суд судить судилище судья',
        'утешение утешить утешать утешительный утешитель',
        'весь весьма',
        'дух духовный духовно духовность',
        'душа душевный',
        'небо небесный',
        'мир мирный мирской',
        'рад радость радоваться',
        'спасти спасение спаситель спасать спасенный',
        'царство царь царский царствовать',
        'вес весить взвесить взвешивать',
    ],
    'uk': [
        'молитва молитися молити молитовний',
        'спасіння спасти спасати',
        'любов любити',
        'цар царство',
        'бог божий',
        'світло світильник',
        'хрест хрищення христити христитися',
        'правда праведний праведник праведність',
        'святість святий святиня',
        'брехня брехливий брехати',
        'гріх грішний грішник грішити',
    ],
    'en': [
        'weigh weight weighty',
        'save salvation saviour savior',
        'love loving lovely',
        'faith faithful faithfulness faithless',
        'mercy merciful merciless',
    ],
}
EXCLUDED = {
    'ru': [
        'вес весь', 'вес весьма', 'весь весить', 'бог богатство', 'бог богатый', 'бог богатеть', 'бог богач',
        'рад лихорадка', 'суд сосуд', 'предать дать', 'душ душить', 'душа душить', 'душа душистый', 'душа дышать', 'благодать дать', 'благодать благо',
        'гора город', 'гора горький', 'гора горько', 'вера верблюд',
        'вера верх', 'мир мирра', 'дело делить',
        # The historical relation does not make the Synodal adverb "around" a cross result.
        'крест окрест',
    ],
    'uk': ['гріх грім', 'мир мирра', 'гора город', 'діло ділити'],
    'en': ['earn earnest', 'peter pet', 'save savage', 'love lovage', 'sin since', 'salvation salve'],
}

def norm(word):
    return marks.sub('', word.strip().lower().replace('ё','е'))

def valid(a,b):
    return a.isalpha() and b.isalpha() and a != b

def pair(a,b):
    return tuple(sorted((a,b)))

def derivbase(data):
    rows = {}
    with (data / 'DerivBaseRU.tsv').open(encoding='utf-8') as source:
        for line in source:
            if not line.strip():
                continue
            key, _, lemma, _, _, _, parent, *_ = line.rstrip('\n').split('\t', 9)
            rows[key] = (norm(lemma), parent)
    return {pair(lemma, rows[parent][0]) for lemma, parent in rows.values()
            if parent in rows and valid(lemma, rows[parent][0])}


def wiktionary(data, language):
    direct = set()
    related = set()
    with gzip.open(data / f'kaikki-{language}.jsonl.gz', 'rt', encoding='utf-8') as source:
        for line in source:
            row = json.loads(line)
            lemma = norm(row.get('word', ''))
            if row.get('lang_code') != language or row.get('pos') == 'name' or not lemma.isalpha():
                continue
            senses = [sense for sense in row.get('senses', [])
                      if not (sense.get('form_of') or sense.get('alt_of'))]
            if not senses:
                continue
            for node in (row, *senses):
                for label, bucket in [('derived', direct), ('related', related)]:
                    for link in node.get(label, []):
                        word = norm(link.get('word', ''))
                        if valid(lemma, word):
                            bucket.add((lemma, word))
            for template in row.get('etymology_templates', []):
                args = template.get('args', {})
                if template.get('name', '') not in templates or args.get('1') != language:
                    continue
                bases = [norm(value) for number, value in args.items()
                         if number.isnumeric() and int(number) >= 2 and norm(value).isalpha()]
                if len(bases) == 1 and valid(lemma, bases[0]):
                    direct.add((lemma, bases[0]))
    return {pair(*edge) for edge in direct}, {pair(a, b) for a, b in related if (b, a) in related}


def english(data):
    links = set()
    with zipfile.ZipFile(data / 'english-wordnet-2025-json.zip') as source:
        for member in source.namelist():
            if not member.startswith('entries-'):
                continue
            for lemma, variants in json.loads(source.read(member)).items():
                lemma = norm(lemma)
                for variant in variants.values():
                    for sense in variant['sense']:
                        for target in sense.get('derivation', []):
                            word = norm(target.split('%')[0])
                            if valid(lemma, word):
                                links.add(pair(lemma, word))
    return links


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def english_corpus():
    directory = PUBLIC / 'bible-text/kjv/v1'
    books = sorted(directory.glob('*.json'))
    script = r'''
const fs = require('node:fs');
const { verseWords } = require('./app/utils/bibleText.ts');
const { wordsOfText } = require('./app/utils/bibleSearch/words.ts');
const words = new Set();
for (const file of process.argv.slice(1)) {
  for (const chapter of JSON.parse(fs.readFileSync(file, 'utf8')).chapters) {
    for (const verse of chapter) {
      for (const word of wordsOfText(verseWords(verse))) words.add(word);
    }
  }
}
process.stdout.write(JSON.stringify([...words]));
'''
    env = {**os.environ, 'TS_NODE_COMPILER_OPTIONS': '{"module":"CommonJS","moduleResolution":"Node"}'}
    result = subprocess.run(['node', '-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register',
                             '-e', script, *map(str, books)], cwd=FRONTEND, env=env,
                            check=True, capture_output=True, text=True)
    return set(json.loads(result.stdout)), {book.name: sha(book) for book in books}


def sources_for(data, language):
    if language == 'en':
        return {'wordnet-derivations': english(data)}
    direct, reciprocal = wiktionary(data, language)
    sources = {'wiktionary-direct': direct}
    if language == 'ru':
        sources['derivbase-confirmed-by-wiktionary'] = derivbase(data) & reciprocal
    else:
        sources['ukrainian-wiktionary-editorial'] = native_ukrainian_edges(data / 'ukwiktionary.xml.bz2')
    return sources


def compile_language(data, language, words):
    vocabulary = set(words)
    sources = sources_for(data, language)
    sources['reviewed'] = {
        pair(a, b) for row in REVIEWED[language] for a, b in itertools.combinations(set(row.split()), 2)
    }
    excluded = {pair(*row.split()) for row in EXCLUDED[language]}
    accepted = {name: {edge for edge in pairs if all(word in vocabulary for word in edge)} - excluded
                for name, pairs in sources.items()}
    pairs = set().union(*accepted.values())
    if language == 'en':
        words = sorted({word for edge in pairs for word in edge})
    ids = {word: index for index, word in enumerate(words)}
    edges = sorted(tuple(sorted((ids[a], ids[b]))) for a, b in pairs)
    return words, edges, {name: len(edges) for name, edges in accepted.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', required=True, type=Path)
    parser.add_argument('--output-dir', type=Path, default=DATA)
    args = parser.parse_args()
    for filename, expected in INPUTS.items():
        if sha(args.source_dir / filename) != expected:
            raise SystemExit(f'Unexpected family source checksum: {filename}')
    assets = json.loads((DATA / 'assets.json').read_bytes())['languages']
    english_words, english_books = english_corpus()
    graphs = {'schema': 1}
    source_meta = {
        'schema': 1, 'inputs': INPUTS, 'kjvBooks': english_books,
        'tokenizers': {path: sha(FRONTEND / path) for path in
                       ['app/utils/bibleText.ts', 'app/utils/bibleSearch/words.ts']},
        'languages': {},
    }
    for language in ('ru', 'uk', 'en'):
        if language == 'en':
            words = english_words
            binding = {}
        else:
            asset = assets[language]
            file = PUBLIC / 'bible-word-forms' / asset['file']
            if sha(file) != asset['sha256']:
                raise SystemExit(f'Word-form asset checksum mismatch: {language}')
            words = [entry[0] for entry in json.loads(file.read_bytes())['entries']]
            binding = {'wordFormsSha256': asset['sha256']}
        words, edges, provenance = compile_language(args.source_dir, language, words)
        if language == 'en':
            binding['lexemes'] = words
        graphs[language] = {**binding, 'edges': edges}
        source_meta['languages'][language] = {'edgeCount': len(edges), 'sources': provenance}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    target = args.output_dir / 'families.json'
    target.write_text(json.dumps(graphs, separators=(',', ':')) + '\n', encoding='utf-8')
    source_meta['sha256'] = sha(target)
    (args.output_dir / 'familySources.json').write_text(
        json.dumps(source_meta, indent=2, sort_keys=True) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
