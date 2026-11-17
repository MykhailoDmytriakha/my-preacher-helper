#!/usr/bin/env python3
"""Measure the same generated public histories on three read-only source mappings.

Run from any directory: python3 frontend/test-utils/runNoteChoiceMatrix.py --size full
Outputs stay in the ignored research/125-probes archive. No Git mutations or network.
"""
import argparse
import collections
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / 'frontend'
ARCHIVE = ROOT / '.cases/2026-11-12-dvizhok-dannyh-do-ideala/research/125-probes'
TEST = 'app/(pages)/(private)/studies/[id]/__tests__/noteChoice.hunt.test.tsx'
ORACLES = ['I1', 'I2', 'I3', 'I4', 'C1', 'C2', 'C3', 'C4', 'C5']
VERSIONS = ['head', 'production', 'candidate']


def launch(version, label, extra):
    env = {**os.environ, 'NOTE_CHOICE_HUNT': 'full', 'NOTE_CHOICE_SHRINK': '0',
           'NOTE_CHOICE_OUTPUT': str(ARCHIVE / f'{version}-{label}.ndjson'),
           'NOTE_CHOICE_SUMMARY': str(ARCHIVE / f'{version}-{label}.json'), **extra}
    output = Path(env['NOTE_CHOICE_OUTPUT'])
    output.write_text('')
    log = (ARCHIVE / f'{version}-{label}.log').open('w')
    command = ['npx', '--no-install', 'jest', '--runInBand', '--config',
               str(ARCHIVE / f'jest-{version}.config.ts'), '--runTestsByPath', TEST]
    process = subprocess.Popen(command, cwd=FRONTEND, env=env, stdout=log, stderr=subprocess.STDOUT)
    return process, log


def rows(version, label):
    return [json.loads(line) for line in (ARCHIVE / f'{version}-{label}.ndjson').read_text().splitlines()]


def settled_verdicts(row):
    # C2/C3 require the full terminal drain, not an intermediate empty queue.
    # The real continuation exists exactly when the terminal choice's capture,
    # input and remote-epoch preconditions held. It preserves the raw actual text.
    answer = row['answers'][-1] if row['answers'] else None
    final, continuation = row['terminal'], row.get('continuation')
    verdict = lambda failed: 'violation' if failed else 'pass'
    result = row['verdicts']
    result['C2'] = result['C3'] = 'not applicable'
    if answer and continuation and final['editorMounted']:
        if answer['kind'] == 'take':
            result['C2'] = verdict(final['editor'] != answer['remote'] or final['question'] or not continuation['nextSaved'])
        else:
            result['C3'] = verdict(final['stored'] != final['editor'] or not continuation['nextSaved'] or continuation.get('cleanArrival') is not True)
    protected = set()
    if answer and answer.get('captureSequence') is not None:
        protected.update(answer['newer'])
        protected.update(action['word'] for action in row['actions'][answer['event'] + 1:]
                         if action['kind'] in ['type', 'dictate'])
    result['C4'] = verdict(any(word not in final['editor'] or (
        word not in final['stored'] and word not in final['coveredWords']) for word in protected)) if protected and final['editorMounted'] else 'not applicable'
    for step in row.get('checkpoints', []):
        for oracle in ['C2', 'C3', 'C4']:
            step['verdicts'][oracle] = 'not applicable'
    for oracle in ['C2', 'C3', 'C4']:
        row.get('violatedAtSteps', {}).pop(oracle, None)


def compare(label, count):
    data = {version: rows(version, label) for version in VERSIONS}
    baseline = {row['id']: row for row in data['production']}
    for version, records in data.items():
        for row in records:
            settled_verdicts(row)
            other = baseline.get(row['id'])
            if not row['valid']:
                row['verdicts'] = {oracle: 'not applicable' for oracle in ORACLES}
            row['verdicts']['C5'] = 'not applicable'
            if row['valid'] and other and other['valid'] and row['actions'] == other['actions']:
                extra_sends = row['terminal']['sends'] > other['terminal']['sends'] or any(
                    step['sends'] > other['checkpoints'][index]['sends'] for index, step in enumerate(row['checkpoints']))
                row['verdicts']['C5'] = 'violation' if extra_sends else 'pass'
        (ARCHIVE / f'{version}-{label}-paired.ndjson').write_text(''.join(json.dumps(row) + '\n' for row in records))
    result = {}
    for size in sorted({min(256, count), count}):
        result[str(size)] = {}
        for version, records in data.items():
            selected = records[:size]
            result[str(size)][version] = {
                'histories': len(selected), 'completed': sum(row['valid'] for row in selected),
                'invalid': dict(collections.Counter(row.get('invalid') for row in selected if not row['valid'])),
                'oracles': {oracle: {
                    'violations': sum(row['valid'] and row['verdicts'][oracle] == 'violation' for row in selected),
                    'notApplicable': sum(not row['valid'] or row['verdicts'][oracle] == 'not applicable' for row in selected),
                    'histories': len(selected),
                } for oracle in ORACLES},
            }
    (ARCHIVE / f'matrix-{label}.json').write_text(json.dumps(result, indent=2))
    for version, row in result[str(count)].items():
        summary_path = ARCHIVE / f'{version}-{label}.json'
        summary = json.loads(summary_path.read_text()) if summary_path.exists() else {}
        summary.update({'count': count, 'invalid': count - row['completed'], 'completed': row['completed'],
                        'totals': row['oracles'], 'paired': True,
                        'oraclePhase': 'C2/C3/C4 after terminal drain; C5 matched action checkpoints and terminal'})
        summary_path.write_text(json.dumps(summary, indent=2))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--size', choices=['reduced', 'full'], default='reduced')
    parser.add_argument('--label')
    parser.add_argument('--seeds-file', type=Path, help='Generate an explicit list of independent seeds')
    parser.add_argument('--witness', help='Replay an exact shortest witness key from full-minima.json')
    parser.add_argument('--seed', type=int, help='Generate and replay one seed on all three mappings')
    args = parser.parse_args()
    label = args.label or (f'witness-{args.witness.replace(chr(58), chr(45))}' if args.witness else f'seed-{args.seed}' if args.seed is not None else 'selected-seeds' if args.seeds_file else args.size)
    count = 1 if args.witness else len(json.loads(args.seeds_file.read_text())) if args.seeds_file else 1 if args.seed is not None else 4096 if args.size == 'full' else 256
    subprocess.run([sys.executable, str(FRONTEND / 'test-utils/prepareNoteChoiceVersions.py')], check=True, cwd=ROOT)
    stream = ARCHIVE / f'corpus-{label}.ndjson'
    stream.write_text('')
    extra = {'NOTE_CHOICE_COUNT': str(count)}
    if args.seed is not None and not args.witness:
        extra['NOTE_CHOICE_SEED'] = str(args.seed)
    if args.seeds_file:
        extra['NOTE_CHOICE_SEEDS'] = str(args.seeds_file.resolve())
    if args.witness:
        witness = json.loads((ARCHIVE / 'full-minima.json').read_text())[args.witness]
        if args.seed is not None and str(args.seed) != str(witness['seed']):
            raise ValueError('The requested seed is not the origin of this witness')
        witness_corpus = ARCHIVE / f'{label}-input.json'
        witness_corpus.write_text(json.dumps([{'id': str(witness['seed']), 'actions': witness['actions']}]))
        extra['NOTE_CHOICE_CORPUS'] = str(witness_corpus)
    running = {}
    running['head'] = launch('head', label, {**extra, 'NOTE_CHOICE_SAVE_STREAM': str(stream),
        'NOTE_CHOICE_SAVE_CORPUS': str(ARCHIVE / f'corpus-{label}.json')})
    for version in ['production', 'candidate']:
        running[version] = launch(version, label, {**extra, 'NOTE_CHOICE_STREAM': str(stream)})
    last_report = 0
    try:
        while any(process.poll() is None for process, _ in running.values()):
            for version, (process, _) in running.items():
                if process.poll() not in [None, 0]:
                    raise RuntimeError(f'{version} failed; inspect {version}-{label}.log')
            if time.monotonic() - last_report >= 30:
                print({version: len((ARCHIVE / f'{version}-{label}.ndjson').read_text().splitlines())
                       for version in VERSIONS}, flush=True)
                last_report = time.monotonic()
            time.sleep(1)
        if any(process.returncode for process, _ in running.values()):
            raise RuntimeError('A version failed; inspect the archived logs')
    finally:
        for process, log in running.values():
            if process.poll() is None:
                process.terminate()
                process.wait()
            log.close()
    print(json.dumps(compare(label, count), indent=2))


if __name__ == '__main__':
    main()
