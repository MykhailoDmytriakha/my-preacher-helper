#!/usr/bin/env python3
"""Measure retained or fresh public histories on live or frozen source mappings.

Run from any directory: python3 frontend/test-utils/runNoteChoiceMatrix.py --versions worktree --label my-run --size reduced
Outputs stay in research/127-probes; research/125-probes is read only. No Git mutations or network.
"""
import argparse
import collections
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / 'frontend'
RETAINED = ROOT / '.cases/2026-11-12-dvizhok-dannyh-do-ideala/research/125-probes'
ARCHIVE = RETAINED.parent / '127-probes'
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
               str(ARCHIVE / f'jest-{version}.config.ts'), '--runTestsByPath', TEST, '--testNamePattern', 'measures randomized']
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


def read_rows(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]


def pair_records(records, baseline):
    for row in records:
        settled_verdicts(row)
        other = baseline.get(row['id'])
        if not row['valid']:
            row['verdicts'] = {oracle: 'not applicable' for oracle in ORACLES}
        row['verdicts']['C5'] = 'not applicable'
        if row['valid'] and other and other['valid'] and row['actions'] == other['actions']:
            if len(row['checkpoints']) != len(other['checkpoints']):
                raise ValueError(f"Checkpoint count differs: {row['id']}")
            excess = row['terminal']['sends'] > other['terminal']['sends'] or any(
                step['sends'] > reference['sends'] for step, reference in zip(row['checkpoints'], other['checkpoints']))
            row['verdicts']['C5'] = 'violation' if excess else 'pass'
    return records


def validation_witnesses():
    minima = json.loads((RETAINED / 'full-minima.json').read_text())
    keys = ['production:take', 'candidate:rendered', 'candidate:unrendered', 'head:unrendered', 'production:delayedTake']
    return [{'id': str(minima[key]['seed']), 'actions': minima[key]['actions']} for key in keys]


def execute(version, label, corpus=None, seeds=None):
    extra = {'NOTE_CHOICE_COUNT': str(len(corpus if corpus is not None else seeds))}
    if corpus is not None:
        path = ARCHIVE / f'{version}-{label}-input.json'
        path.write_text(json.dumps(corpus))
        extra['NOTE_CHOICE_CORPUS'] = str(path)
    else:
        path = ARCHIVE / f'{version}-{label}-seeds.json'
        path.write_text(json.dumps(seeds))
        extra['NOTE_CHOICE_SEEDS'] = str(path)
    extra['NOTE_CHOICE_SAVE_CORPUS'] = str(ARCHIVE / f'{version}-{label}-corpus.json')
    process, log = launch(version, label, extra)
    try:
        process.wait()
        if process.returncode:
            raise RuntimeError(f'{version} failed; inspect {version}-{label}.log (rerun alone if timed out)')
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait()
        log.close()
    return rows(version, label)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--versions', nargs='+', choices=VERSIONS + ['worktree'], default=VERSIONS)
    parser.add_argument('--size', choices=['reduced', 'full'], default='reduced')
    parser.add_argument('--label', required=True)
    parser.add_argument('--corpus', type=Path, default=RETAINED / 'corpus-full.json')
    parser.add_argument('--production', type=Path, help='Paired production rows for the exact input corpus')
    parser.add_argument('--head', type=Path, default=RETAINED / 'head-full-paired.ndjson')
    parser.add_argument('--shards', type=int, default=1)
    parser.add_argument('--subset', choices=['choice'])
    parser.add_argument('--witnesses', action='store_true')
    parser.add_argument('--witness', help='One exact key from retained full-minima.json')
    parser.add_argument('--seed-base', type=int)
    parser.add_argument('--count', type=int)
    parser.add_argument('--seed', type=int)
    parser.add_argument('--seeds-file', type=Path)
    args = parser.parse_args()
    if not args.label or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in args.label):
        parser.error('--label must contain only letters, digits, hyphens and underscores')
    if args.shards < 1 or (args.count is not None and args.count < 1):
        parser.error('shards/count must be positive')
    fresh = args.seed_base is not None or args.seed is not None or args.seeds_file is not None
    if fresh and (args.witnesses or args.witness or args.subset):
        parser.error('fresh generation cannot select retained witnesses or choices')
    started = time.monotonic()
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    manifest = ARCHIVE / f'run-{args.label}.json'
    if manifest.exists():
        parser.error(f'label already used: {args.label}')
    manifest.write_text(json.dumps({'status': 'running', 'arguments': vars(args)}, default=str, indent=2))
    subprocess.run([sys.executable, str(FRONTEND / 'test-utils/prepareNoteChoiceVersions.py')], check=True, cwd=ROOT)
    count = args.count or (4096 if args.size == 'full' else 256)
    if fresh:
        seeds = json.loads(args.seeds_file.read_text()) if args.seeds_file else [args.seed] if args.seed is not None else list(range(args.seed_base, args.seed_base + count))
        corpus = None
    elif args.witnesses:
        corpus = validation_witnesses()
    elif args.witness:
        item = json.loads((RETAINED / 'full-minima.json').read_text())[args.witness]
        corpus = [{'id': str(item['seed']), 'actions': item['actions']}]
    else:
        corpus = json.loads(args.corpus.read_text())[:count]
    if args.subset:
        choices = {row['id'] for row in read_rows(args.head) if row['answers']}
        corpus = [entry for entry in corpus if entry['id'] in choices]
    production_path = args.production or RETAINED / 'production-full-paired.ndjson'
    if not fresh and not args.production and args.corpus.resolve() != (RETAINED / 'corpus-full.json').resolve():
        parser.error('a custom corpus requires --production from that same corpus')
    # Witness reductions have different actions from their original full rows;
    # replay production for these five exact lists rather than inventing a budget.
    if args.witnesses or args.witness:
        baseline_rows = execute('production', args.label + '-baseline', corpus)
    elif not fresh:
        baseline_rows = read_rows(production_path)
        indexed = {row['id']: row for row in baseline_rows}
        for entry in corpus:
            if entry['id'] not in indexed or indexed[entry['id']]['actions'] != entry['actions']:
                raise ValueError(f"No exact retained production history: {entry['id']}")
    results = {}
    def measure(version, entries=None, seed_list=None):
        selected = entries if entries is not None else seed_list
        slices = [selected[index::args.shards] for index in range(min(args.shards, len(selected)))]
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.shards) as pool:
            futures = [pool.submit(execute, version, f'{args.label}-shard-{index}', part if entries is not None else None,
                                   part if seed_list is not None else None) for index, part in enumerate(slices)]
            records = [row for future in futures for row in future.result()]
        order = {str(entry['id'] if isinstance(entry, dict) else entry): index for index, entry in enumerate(selected)}
        records.sort(key=lambda row: order[row['id']])
        return records
    if fresh:
        generated = measure('worktree', seed_list=seeds)
        corpus = [{'id': row['id'], 'actions': row['actions']} for row in generated]
        baseline_rows = measure('production', entries=corpus)
        results['worktree'] = generated
    baseline = {row['id']: row for row in baseline_rows}
    for version in args.versions:
        if version not in results:
            results[version] = baseline_rows if version == 'production' and fresh else measure(version, entries=corpus)
    (ARCHIVE / f'corpus-{args.label}.json').write_text(json.dumps(corpus))
    selected_baseline = [baseline[entry['id']] for entry in corpus]
    for version, records in {**results, 'production-baseline': selected_baseline}.items():
        pair_records(records, baseline)
        (ARCHIVE / f'{version}-{args.label}-paired.ndjson').write_text(''.join(json.dumps(row) + '\n' for row in records))
    summary = {'wallSeconds': round(time.monotonic() - started, 3), 'count': len(corpus), 'shards': args.shards,
               'versions': {version: {'completed': sum(row['valid'] for row in records),
                  'oracles': {name: dict(collections.Counter(row['verdicts'][name] for row in records)) for name in ORACLES}}
                  for version, records in results.items()},
               'production': str(ARCHIVE / f'production-baseline-{args.label}-paired.ndjson'),
               'productionSource': 'fresh exact replay' if fresh else 'exact validation replay' if args.witnesses or args.witness else str(production_path)}
    manifest.write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
