# Bible search word-form data notices

The generated Russian and Ukrainian lexical payloads are published as content-addressed JSON files in `frontend/public/bible-word-forms/`; the small `assets.json` in this directory records their names, hashes, sizes, and counts. The application loads that manifest before requesting a language payload. Python, Java, and the lexical-analysis packages are build-time tools.

## Russian

The Russian forms derive from known analyses from PyMorphy3 2.0.6 and `pymorphy3-dicts-ru` 2.4.417150.4580142, based on OpenCorpora dictionary revision 417150. The underlying OpenCorpora data is distributed under Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0); its full license is in `licenses/CC-BY-SA-3.0.txt`. PyMorphy3 itself is MIT licensed; its full license is in `licenses/MIT.txt`. Upstream: [PyMorphy3](https://github.com/no-plagiarism/pymorphy3) and [pymorphy3-dicts-ru on PyPI](https://pypi.org/project/pymorphy3-dicts-ru/).

The generated selection is modified: it uses known analyses only (no prediction or analogy), selects forms from current Russian Bible vocabulary, normalizes with the app's search rules, filters complete single tokens, and serializes compact lemma/prefix/paradigm records. Exact pinned package versions and wheel hashes are recorded in `sources.json`.

## Ukrainian

The Ukrainian forms derive only from the official `ua.net.nlp:morfologik-ukrainian-search:4.9.1` Maven artifact. The [artifact POM](https://repo.maven.apache.org/maven2/ua/net/nlp/morfologik-ukrainian-search/4.9.1/morfologik-ukrainian-search-4.9.1.pom) identifies its metadata; the bundled README states Apache License 2.0. The full license is in `licenses/Apache-2.0.txt`. That README attributes its base to [dict_uk](https://github.com/brown-uk/dict_uk) and states that the source normalized `ґ` to `г`. The generated data does not invent or restore `ґ` forms. No PyMorphyUK dictionary data is used.

The generated selection is modified: it selects lemma groups intersecting current Ukrainian Bible vocabulary, applies app search normalization and the complete-single-token filter, and serializes compact lemma/prefix/paradigm records. `sources.json` records the pinned Maven artifact hashes and decoded-table hash.

## Short nouns

The same pinned sources generate the small `shortNouns.json` table. It selects common nouns with short dictionary stems, keeps single-meaning ordinary noun forms, and separates forms present in the Bible from aliases that may be typed. Proper-name collisions are audited against original spellings from the same books. Capitalized collisions outside the reviewed spellings require review before generation succeeds. The table is bundled with search and its exact bytes are checked against `sources.json`.

## Word families

`families.json` contains selected, modified lexical links and their lexeme indices. It includes no definitions, usage examples or Bible quotations. It uses word-formation links only, restricts the lexemes to the supported translations, and includes reviewed corpus-specific additions and exclusions. The Russian and Ukrainian indices bind to the exact inflection assets above. The English index binds to the exact King James text recorded in `familySources.json`.

- Russian direct evidence comes from [Wiktionary contributors](https://en.wiktionary.org/wiki/Wiktionary:Main_Page) via [Wiktextract](https://kaikki.org/dictionary/rawdata.html), under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The Russian index also includes corroborated links from Daniil Vodolazsky's DerivBase.Ru as distributed in [Universal Derivations 1.1](https://ufal.mff.cuni.cz/universal-derivations), under [Apache 2.0](licenses/Apache-2.0.txt).
- Ukrainian evidence comes from the [English edition of Wiktionary](https://en.wiktionary.org/wiki/Wiktionary:Main_Page) via Wiktextract and from the [Ukrainian Wiktionary contributors](https://uk.wiktionary.org/wiki/Головна_сторінка) via the [Ukrainian XML dump](https://dumps.wikimedia.org/ukwiktionary/latest/), under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- The English links come from the [Open English Wordnet Community's 2025 release](https://en-word.net/downloads), based on [Princeton WordNet](https://wordnet.princeton.edu/license-and-commercial-use), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

To reproduce the index, place the five exact input files listed in `familySources.json` in one directory. The DerivBase input is the decompressed `UDer-1.1/ru-DerivBaseRU/UDer-1.1-ru-DerivBaseRU.tsv.gz` member. The Kaikki inputs are the per-language JSONL gzip files. The generator checks the exact input bytes, so a newer dump at the same address requires a deliberate source update. Run `python3 frontend/scripts/build-bible-word-families.py --source-dir <directory>`. The frontend development dependencies supply the same tokenizer used at runtime.

## Regeneration from a fresh checkout

The generator derives its vocabulary directly from `frontend/public/bible-text/rst/v1/*.json` and `frontend/public/bible-text/ubio/v1/*.json`, calling the app's actual `verseWords` and `wordsOfText` TypeScript functions. It records every relative book path, content hash, and verse count in `sources.json`. It requires the repository's frontend development dependencies to be installed (`cd frontend && npm ci`) because it loads those TypeScript functions through the existing `ts-node` dependency. This is build tooling only; the app runtime has no Node, Python, Java, network, or morphology package dependency beyond its ordinary JavaScript app runtime.

1. Install pinned Russian build tools in an isolated Python environment: `python3 -m venv .venv-word-forms && .venv-word-forms/bin/python -m pip install -r frontend/scripts/bible-word-forms-requirements.txt`.
2. Download and verify the official Ukrainian source jar:

   ```sh
   tmp="$(mktemp -d)"
   curl -fL 'https://repo.maven.apache.org/maven2/ua/net/nlp/morfologik-ukrainian-search/4.9.1/morfologik-ukrainian-search-4.9.1.jar' -o "$tmp/morfologik-ukrainian-search-4.9.1.jar"
   printf '%s  %s\n' '463d9054b8d4cfacb9cd69566395826a6fe32fb6e7da91dbf79d37ddf7d56ba0' "$tmp/morfologik-ukrainian-search-4.9.1.jar" | shasum -a 256 -c -
   mkdir -p "$tmp/uk-source"
   (cd "$tmp/uk-source" && jar xf "$tmp/morfologik-ukrainian-search-4.9.1.jar" ua/net/nlp/ukrainian.dict ua/net/nlp/ukrainian.info)
   ```

3. Download the pinned Morfologik tools `2.2.0` runtime jars and verify each before use:

   ```sh
   mkdir -p "$tmp/tools"
   fetch_jar() {
     url="$1"; hash="$2"; file="$tmp/tools/${url##*/}"
     curl -fL "$url" -o "$file"
     printf '%s  %s\n' "$hash" "$file" | shasum -a 256 -c -
   }
   fetch_jar 'https://repo.maven.apache.org/maven2/org/carrot2/morfologik-tools/2.2.0/morfologik-tools-2.2.0.jar' '349c52ab683c4acfb8c74264d19232a2439441df4212412acbe42d04ee66ba31'
   fetch_jar 'https://repo.maven.apache.org/maven2/org/carrot2/morfologik-stemming/2.2.0/morfologik-stemming-2.2.0.jar' 'ed989f60c38918b5c3ae1c39b2aaacffffbb26031c5d37815faf1a98cf0e3e2b'
   fetch_jar 'https://repo.maven.apache.org/maven2/org/carrot2/morfologik-fsa/2.2.0/morfologik-fsa-2.2.0.jar' 'd41cb460e6754c507250077312b8f26c302a3e9343881b9d7d7c6cf3c5a6aa6f'
   fetch_jar 'https://repo.maven.apache.org/maven2/org/carrot2/morfologik-fsa-builders/2.2.0/morfologik-fsa-builders-2.2.0.jar' '225586a29fcc4861fa81813852fb71d9464d91fde737ed14ec8c826a8147ba81'
   fetch_jar 'https://repo.maven.apache.org/maven2/com/beust/jcommander/1.78/jcommander-1.78.jar' '7891debb84b5f83e9bd57593ebece3399abbe0fd938cf306b3534c57913b9615'
   java -cp "$tmp/tools/*" morfologik.tools.Launcher dict_decompile \
     -i "$tmp/uk-source/ua/net/nlp/ukrainian.dict" \
     -o "$tmp/decoded-ukrainian-search.txt"
   shasum -a 256 "$tmp/decoded-ukrainian-search.txt"
   ```

   The `.info` file must remain beside the dictionary. The pinned decoded UTF-8 table hash is `e0de0f91de8d8f46a00a36497b08cbc537b0386808fb5f39a18313725692a9e0`.

The generator reads no case artifacts or local QA-only files. The current checked-in Bible source corpus has 66 Russian and 66 Ukrainian book files; its live counts and hashes are emitted rather than enforced as fixed counts, so later checked-in text changes can regenerate corresponding data. By default, the canonical `--output-dir` writes metadata and `assets.json` here and the payloads to `frontend/public/bible-word-forms/`. Supplying a custom `--output-dir` routes payloads to that directory's `assets/` child; `--asset-dir` explicitly selects another payload destination.

The vocabulary extraction loads the canonical `bibleBooks.ts` apostrophe rule used by `words.ts`; `sources.json` records both modules and `bibleText.ts`. The dictionary-token filter and normalization derive their apostrophe set from that same runtime rule. A module-hash freshness regression prevents silently keeping data generated against a different tokenizer.
