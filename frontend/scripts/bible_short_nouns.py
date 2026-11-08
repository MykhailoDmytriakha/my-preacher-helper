"""Select attested short common nouns using the same tagged source dictionaries."""
from collections import defaultdict
import json

RU_NAMES = {'Name', 'Surn', 'Patr', 'Geox', 'Orgn', 'Trad'}
# Capitalized colliding forms audited in the shipped Synodal text. The two
# ordinary tokens are Isaiah 14:9 and Exodus 9:31. The others are names or places.
RU_COMMON_CAPITALS = {'Ад', 'Лен'}
RU_NAME_CAPITALS = {'Ада', 'Аду', 'Аны', 'Арам', 'Аре', 'Ару', 'Гае', 'Гаем',
                    'Гай', 'Гаю', 'Гая', 'Ир', 'Ира', 'Ирам', 'Иру', 'Юта'}


def russian_analyses(vocabulary, normalize):
    import pymorphy3
    dictionary = pymorphy3.MorphAnalyzer(lang='ru')
    for word in sorted(vocabulary):
        for reading in dictionary.parse(word):
            if not reading.is_known:
                continue
            tags = reading.tag.grammemes
            kind = ('name' if tags & RU_NAMES else
                    'noun' if reading.tag.POS == 'NOUN' and 'Abbr' not in tags else 'other')
            yield word, normalize(reading.normal_form), kind


def ukrainian_analyses(vocabulary, normalize, table):
    with table.open(encoding='utf-8') as source:
        for row in source:
            lemma, form, tags = row.rstrip('\n').split('+', 2)
            word = normalize(form)
            if word not in vocabulary:
                continue
            lemma = normalize(lemma)
            for analysis in tags.split('|'):
                flags = analysis.split(':')
                kind = ('name' if 'prop' in flags else
                        'noun' if flags[0] == 'noun' and 'abbr' not in flags else 'other')
                yield word, lemma, kind


def short_nouns(language, compact, vocabulary, surfaces, normalize, uk_table):
    data = json.loads(compact)
    # This is the gap in the spelling matcher, which requires a stem of at least
    # three letters. Ordinary longer words keep their existing matching rules.
    by_lemma = {lemma: {stem + ending for ending in data['paradigms'][paradigm].split(' ')}
                for lemma, stem, paradigm in data['entries'] if 2 <= len(lemma) <= 3 and len(stem) < 3}
    candidates = set(by_lemma).union(*by_lemma.values())
    reads = defaultdict(set)
    annotations = (russian_analyses(candidates, normalize) if language == 'ru'
                   else ukrainian_analyses(candidates, normalize, uk_table))
    for word, lemma, kind in annotations:
        reads[word].add((lemma, kind))

    def common_reading(word):
        return {reading for reading in reads[word] if reading[1] != 'name'}

    groups = {}
    unreviewed = set()
    for lemma, forms in by_lemma.items():
        if common_reading(lemma) != {(lemma, 'noun')}:
            continue
        accepted = []
        excluded = set()
        for word in sorted(forms & vocabulary):
            if common_reading(word) != {(lemma, 'noun')}:
                continue
            if any(kind == 'name' for _, kind in reads[word]):
                capitals = set(surfaces['upper'].get(word, []))
                audited_common = RU_COMMON_CAPITALS if language == 'ru' else set()
                audited_names = RU_NAME_CAPITALS if language == 'ru' else set()
                unknown = capitals - audited_common - audited_names
                unreviewed.update(unknown)
                if word not in surfaces['lower'] and not capitals & audited_common:
                    continue
                excluded.update(capitals & audited_names)
            accepted.append(word)
        if len(accepted) > 1:
            # A dictionary form absent from this translation can still be typed.
            aliases = [word for word in sorted(forms - vocabulary) if common_reading(word) == {(lemma, 'noun')}]
            groups[lemma] = {'forms': accepted, 'aliases': aliases, 'excluded': sorted(excluded)}
    if unreviewed:
        raise ValueError(f'{language}: review capitalized homographs {sorted(unreviewed)}')
    return groups
