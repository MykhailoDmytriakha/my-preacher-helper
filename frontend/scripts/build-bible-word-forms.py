#!/usr/bin/env python3
"""Build compact known-only lexical forms from checked-in Bible text.

The vocabulary is walked by the app's TypeScript wordsOfText and verseWords
functions. Inputs are the public bible-text/rst and bible-text/ubio book files,
a pinned Russian PyMorphy3/OpenCorpora install, and the pinned decoded official
Morfologik Ukrainian search dictionary. See wordFormsData/THIRD_PARTY_NOTICES.md.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'frontend/app/utils/bibleSearch/wordFormsData'
EXPECTED_UK_SHA256 = 'e0de0f91de8d8f46a00a36497b08cbc537b0386808fb5f39a18313725692a9e0'
EXPECTED_UK_JAR_SHA256 = '463d9054b8d4cfacb9cd69566395826a6fe32fb6e7da91dbf79d37ddf7d56ba0'
UK_POM_SHA256 = '6a66d8efe6a5c774932401b04411a8feca7d6628631e4ef80819cfafa133dc38'
RU_PYMORPHY_WHEEL_SHA256 = '0254317c02ce3ea17e080b7fc9d675e44662b3a5296bae68605b7a41d25b36c3'
RU_DICT_WHEEL_SHA256 = '718bac64c73c10c16073a199402657283d9b64c04188b694f6d3e9b0d85440f4'
EXPECTED_NORMALIZER_SHA256 = 'e37e50c9b93bf5dbb03f5b8e46e5b42b10aad95a134fd8612b4693be7355f38b'
TOKEN_FILTER = "complete single search tokens: raw form starts/ends with Unicode letter; internal Unicode letters or apostrophes only; no digits, hyphens, compounds, or truncated leading-apostrophe forms"
APOSTROPHES = ""


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def norm(word: str) -> str:
    return re.sub("[" + re.escape(APOSTROPHES) + r"\u0300\u0301]", '', word.lower().replace('ё', 'е'))


def one_token(word: str) -> bool:
    return bool(word) and word[0].isalpha() and word[-1].isalpha() and all(c.isalpha() or c in APOSTROPHES for c in word)


def compact(language: str, groups: dict[str, set[str]]) -> tuple[bytes, dict]:
    paradigms: list[str] = []
    paradigm_ids: dict[tuple[str, ...], int] = {}
    entries = []
    total_forms = 0
    for lemma, forms_set in sorted(groups.items()):
        forms = sorted(w for w in forms_set if one_token(w))
        if not forms:
            continue
        prefix = os.path.commonprefix(forms)
        suffixes = tuple(w[len(prefix):] for w in forms)
        total_forms += len(forms)
        if suffixes not in paradigm_ids:
            paradigm_ids[suffixes] = len(paradigms)
            paradigms.append(' '.join(suffixes))
        entries.append([lemma, prefix, paradigm_ids[suffixes]])
        rebuilt = sorted(prefix + suffix for suffix in paradigms[paradigm_ids[suffixes]].split(' '))
        if rebuilt != forms:
            raise AssertionError(f'lossy compact round trip for {language}:{lemma}')
    data = json.dumps({'schema': 1, 'language': language, 'paradigms': paradigms, 'entries': entries}, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return data, {'entries': len(entries), 'paradigms': len(paradigms), 'formCount': total_forms, 'bytes': len(data)}


def build_ru(vocab: set[str]) -> tuple[bytes, dict]:
    try:
        import pymorphy3
    except ImportError as e:
        raise SystemExit('Install frontend/scripts/bible-word-forms-requirements.txt in a development venv') from e
    from importlib.metadata import version
    expected = {'pymorphy3': '2.0.6', 'pymorphy3-dicts-ru': '2.4.417150.4580142', 'DAWG2-Python': '0.9.0'}
    got = {name: version(name) for name in expected}
    if got != expected:
        raise SystemExit(f'Russian generator package pins mismatch: {got!r}')
    morph = pymorphy3.MorphAnalyzer(lang='ru')
    groups: dict[str, set[str]] = {}
    known = unknown = 0
    for token in sorted(vocab):
        parses = [p for p in morph.parse(token) if p.is_known]
        if not parses:
            unknown += 1
            continue
        known += 1
        for parse in parses:
            lemma = norm(parse.normal_form)
            if not one_token(lemma):
                continue
            # Filter raw orthography before normalization: an apostrophe-truncated
            # dictionary form must not turn into an apparently complete token.
            forms = {norm(item.word) for item in parse.lexeme if one_token(item.word)}
            if forms:
                groups.setdefault(lemma, set()).update(forms)
    data, info = compact('ru', groups)
    info.update({'knownVocabularyTokens': known, 'unknownVocabularyTokens': unknown, 'packageVersions': got})
    return data, info


def build_uk(vocab: set[str], table: Path, jar: Path | None) -> tuple[bytes, dict]:
    actual = sha(table)
    if actual != EXPECTED_UK_SHA256:
        raise SystemExit(f'Unexpected decoded Ukrainian table SHA-256: {actual}')
    jar_sha = None
    if jar is not None:
        jar_sha = sha(jar)
        if jar_sha != EXPECTED_UK_JAR_SHA256:
            raise SystemExit(f'Unexpected official Ukrainian Maven jar SHA-256: {jar_sha}')
    selected: set[str] = set()
    covered: set[str] = set()
    row_count = seen_ghe = 0
    with table.open(encoding='utf-8') as source:
        for line in source:
            fields = line.rstrip('\n').split('+', 2)
            if len(fields) < 2:
                raise ValueError(f'Malformed decoded Ukrainian source row {row_count + 1}')
            lemma, form = fields[:2]
            row_count += 1
            if 'ґ' in form:
                seen_ghe += 1
            if not one_token(form):
                continue
            key = norm(form)
            if key in vocab:
                selected.add(norm(lemma))
                covered.add(key)
    groups = {lemma: set() for lemma in selected}
    with table.open(encoding='utf-8') as source:
        for line in source:
            lemma, form, *_ = line.rstrip('\n').split('+', 2)
            key = norm(lemma)
            if key in groups and one_token(form):
                groups[key].add(norm(form))
    data, info = compact('uk', groups)
    info.update({'decodedRows': row_count, 'knownVocabularyTokens': len(covered), 'unknownVocabularyTokens': len(vocab - covered), 'sourceFormsContainingҐ': seen_ghe, 'decodedTableSha256': actual, 'mavenJarSha256': jar_sha or EXPECTED_UK_JAR_SHA256, 'jarWasProvidedForVerification': jar is not None, 'filter': TOKEN_FILTER})
    return data, info


def extract_vocabulary() -> tuple[dict[str, set[str]], dict]:
    """Walk live checked-in Bible files with the exact TypeScript search cleaners."""
    ts_node = ROOT / 'frontend/node_modules/ts-node/register/transpile-only.js'
    if not ts_node.exists():
        raise SystemExit('Install frontend development dependencies (`cd frontend && npm ci`) to run the TypeScript text cleaners')
    js = r'''
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const original = Module._load;
const stubs = {
  '@/utils/bibleBooks': require(path.join(process.argv[3], 'frontend/app/utils/bibleBooks.ts')),
  '@/utils/bibles': { BIBLES: {} },
  '@/utils/bibleTextCache': { BIBLE_TEXT_CACHE: 'unused', isBookShaped: () => false },
  '@/utils/versification': { chapterCount: () => 0 },
};
Module._load = function(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return original.call(this, request, parent, isMain);
};
const { wordsOfText } = require(process.argv[1]);
const { verseWords } = require(process.argv[2]);
const root = process.argv[3];
const out = process.argv[4];
const result = { schema: 1, vocabularies: { ru: new Set(), uk: new Set() }, corpus: {}, sourceHashes: {} };
const apostrophes = stubs['@/utils/bibleBooks'].APOSTROPHES;
result.apostrophes = Array.from({ length: 65536 }, (_, code) => String.fromCharCode(code)).filter(char => { apostrophes.lastIndex = 0; return apostrophes.test(char); }).join('');
for (const [bible, language] of [['rst', 'ru'], ['ubio', 'uk']]) {
  const dir = path.join(root, 'frontend/public/bible-text', bible, 'v1');
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort();
  result.corpus[bible] = [];
  for (const name of files) {
    const relativePath = `frontend/public/bible-text/${bible}/v1/${name}`;
    const bytes = fs.readFileSync(path.join(dir, name));
    const book = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(book.chapters)) throw new Error(`Malformed chapters in ${relativePath}`);
    let verses = 0;
    for (const chapter of book.chapters) {
      if (!Array.isArray(chapter)) throw new Error(`Malformed chapter in ${relativePath}`);
      for (const raw of chapter) {
        if (typeof raw !== 'string') throw new Error(`Malformed verse in ${relativePath}`);
        for (const word of wordsOfText(verseWords(raw))) result.vocabularies[language].add(word);
        verses += 1;
      }
    }
    result.corpus[bible].push({ path: relativePath, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), verses });
  }
  result.vocabularies[language] = [...result.vocabularies[language]].sort();
}
result.sourceHashes.bibleBooksTs = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'frontend/app/utils/bibleBooks.ts'))).digest('hex');
result.sourceHashes.wordsTs = crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex');
result.sourceHashes.bibleTextTs = crypto.createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex');
fs.writeFileSync(out, JSON.stringify(result));
console.log(JSON.stringify({ counts: Object.fromEntries(Object.entries(result.vocabularies).map(([k, v]) => [k, v.length])), books: Object.fromEntries(Object.entries(result.corpus).map(([k, v]) => [k, v.length])), sourceHashes: result.sourceHashes }));
'''
    with tempfile.NamedTemporaryFile(prefix='bible-word-vocabulary-', suffix='.json', delete=False) as temporary:
        vocab_path = Path(temporary.name)
    env = os.environ.copy()
    env['TS_NODE_COMPILER_OPTIONS'] = '{"module":"CommonJS","moduleResolution":"Node"}'
    command = ['node', '-r', str(ts_node), '-e', js,
               str(ROOT / 'frontend/app/utils/bibleSearch/words.ts'),
               str(ROOT / 'frontend/app/utils/bibleText.ts'), str(ROOT), str(vocab_path)]
    try:
        result = subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=True)
        if result.returncode:
            raise SystemExit('Live Bible vocabulary extraction failed: ' + result.stderr)
        print(result.stdout.strip())
        doc = json.loads(vocab_path.read_text(encoding='utf-8'))
    finally:
        vocab_path.unlink(missing_ok=True)
    global APOSTROPHES
    APOSTROPHES = doc['apostrophes']
    if not APOSTROPHES:
        raise SystemExit('Canonical apostrophe extraction is empty')
    if doc['sourceHashes']['wordsTs'] != EXPECTED_NORMALIZER_SHA256:
        raise SystemExit('words.ts changed from the pinned normalizer reviewed for this data')
    return {lang: set(tokens) for lang, tokens in doc['vocabularies'].items()}, {
        'sourceHashes': doc['sourceHashes'], 'corpus': doc['corpus'],
        'counts': {lang: len(tokens) for lang, tokens in doc['vocabularies'].items()},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--uk-table', type=Path, required=True, help='Decoded Morfologik search dictionary; exact source hash is enforced')
    parser.add_argument('--uk-jar', type=Path, help='Optional original Maven jar; if supplied, its pinned SHA-256 is checked')
    parser.add_argument('--output-dir', type=Path, default=DATA)
    args = parser.parse_args()

    vocab, corpus_meta = extract_vocabulary()
    if set(vocab) != {'ru', 'uk'}:
        raise SystemExit('Expected exactly Russian and Ukrainian vocabularies')
    args.output_dir.mkdir(parents=True, exist_ok=True)
    ru_bytes, ru_stats = build_ru(vocab['ru'])
    uk_bytes, uk_stats = build_uk(vocab['uk'], args.uk_table.resolve(), args.uk_jar.resolve() if args.uk_jar else None)
    (args.output_dir / 'ru.json').write_bytes(ru_bytes)
    (args.output_dir / 'uk.json').write_bytes(uk_bytes)
    source_meta = {
        'schema': 1,
        'corpus': corpus_meta,
        'russian': {'source': 'PyMorphy3 known parses and OpenCorpora Russian dictionary', 'dictionaryRevision': '417150',
                    'sourcePackages': {'pymorphy3': {'version': '2.0.6', 'wheelSha256': RU_PYMORPHY_WHEEL_SHA256},
                                       'pymorphy3-dicts-ru': {'version': '2.4.417150.4580142', 'wheelSha256': RU_DICT_WHEEL_SHA256}},
                    'statistics': ru_stats},
        'ukrainian': {'source': 'Morfologik Ukrainian search dictionary', 'version': '4.9.1', 'license': 'Apache-2.0',
                      'mavenSource': {'jarUrl': 'https://repo.maven.apache.org/maven2/ua/net/nlp/morfologik-ukrainian-search/4.9.1/morfologik-ukrainian-search-4.9.1.jar', 'jarSha256': EXPECTED_UK_JAR_SHA256,
                                      'pomUrl': 'https://repo.maven.apache.org/maven2/ua/net/nlp/morfologik-ukrainian-search/4.9.1/morfologik-ukrainian-search-4.9.1.pom', 'pomSha256': UK_POM_SHA256},
                      'statistics': uk_stats},
        'tokenFilter': TOKEN_FILTER,
        'compactFormat': 'schema 1; sorted lemma entries [lemma, commonPrefix, paradigmId]; sorted suffix sets in space-separated paradigm strings; empty suffixes retained; exact reconstruction asserted',
    }
    for lang, data in [('ru', ru_bytes), ('uk', uk_bytes)]:
        source_meta[lang] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    (args.output_dir / 'sources.json').write_text(json.dumps(source_meta, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(json.dumps({'ru': ru_stats, 'uk': uk_stats, 'outputHashes': {k: source_meta[k]['sha256'] for k in ('ru', 'uk')}}, ensure_ascii=False, sort_keys=True))


if __name__ == '__main__':
    main()
