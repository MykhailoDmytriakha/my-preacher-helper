#!/usr/bin/env python3
"""Replay and deletion-shrink every reported oracle/validation witness across mappings.

Raw observations remain intact. Certificates include all tested deletions, invalid
preconditions, and final single-deletion controls. Minima are over deletions of a
seed's actions, not over the infinite space of possible authored strings.
"""
import argparse
import concurrent.futures
import json
from pathlib import Path
import os
import subprocess
import sys
sys.dont_write_bytecode = True

from runNoteChoiceMatrix import ARCHIVE, RETAINED, FRONTEND, TEST, VERSIONS, ORACLES, compare, rows, settled_verdicts


def violated(row, oracle):
    return row['valid'] and row['verdicts'][oracle] == 'violation'


def pre_capture_gap(row, index):
    answer = row['answers'][index]
    if index == 0 or answer['surface'] != 'notice' or row['answers'][index - 1]['surface'] != 'notice':
        return False
    if row['actions'][answer['event']]['kind'] != 'pauseKeep' or not answer.get('replacementEditorId'):
        return False
    observed = answer.get('rejectionWitness')
    if not observed:
        return False
    if 'pauseArmed' in observed:
        return observed['pauseArmed'] and not observed.get('replacementCaptured')
    # Older raw observations can prove the phase when an explicit Resume occurs
    # strictly after the recorded wrong-version observation. Terminal auto-resume
    # alone is ambiguous and is never accepted as a pre-capture certificate.
    resume = next((event for event in range(answer['event'] + 1, len(row['actions']))
                   if row['actions'][event]['kind'] == 'resume'), None)
    return resume is not None and answer['event'] <= observed['event'] < resume


def validation(row, key):
    if not row['valid']:
        return False
    answers = row['answers']
    if key in ['take', 'delayedTake']:
        return (violated(row, 'C2') and answers and answers[-1]['kind'] == 'take'
                and answers[-1]['collectionHeldAtChoice'] == (key == 'delayedTake')
                and row['terminal']['editor'] != answers[-1]['remote'])
    if key in ['rendered', 'unrendered'] and any(action['kind'] == 'done' for action in row['actions']):
        return False
    if key == 'rendered' and any(action['kind'] == 'holdCollection' for action in row['actions']):
        return False
    return violated(row, 'C1') and any(
        index > 0 and pre_capture_gap(row, index) and answer['kind'] == 'keep' and answer['rejectedShown']
        and answers[index - 1]['kind'] == 'keep' and answers[index - 1].get('replacement') == 'refused'
        and answer['noRenderRefusal'] == (key == 'unrendered')
        for index, answer in enumerate(answers))


def task_candidates(data):
    tasks = {}
    for version, records in data.items():
        for oracle in ORACLES:
            failures = [row for row in records if violated(row, oracle)]
            if failures:
                tasks[f'{version}:{oracle}'] = min(failures, key=lambda row: len(row['actions']))
        for key in ['take', 'delayedTake', 'rendered', 'unrendered']:
            failures = [row for row in records if validation(row, key)]
            if failures:
                tasks[f'{version}:{key}'] = min(failures, key=lambda row: len(row['actions']))
    return tasks


def matches(row, key):
    name = key.split(':')[1]
    return violated(row, name) if name in ORACLES else validation(row, name)


def replay_batch(label, records):
    corpus = ARCHIVE / f'{label}-corpus.json'
    corpus.write_text(json.dumps(records))

    def run(version):
        output = ARCHIVE / f'{version}-{label}.ndjson'
        output.write_text('')
        env = {**os.environ, 'NOTE_CHOICE_HUNT': 'reduced', 'NOTE_CHOICE_COUNT': str(len(records)),
               'NOTE_CHOICE_CORPUS': str(corpus), 'NOTE_CHOICE_SHRINK': '0',
               'NOTE_CHOICE_OUTPUT': str(output), 'NOTE_CHOICE_SUMMARY': str(ARCHIVE / f'{version}-{label}.json')}
        command = ['npx', '--no-install', 'jest', '--runInBand', '--config', str(ARCHIVE / f'jest-{version}.config.ts'),
                   '--runTestsByPath', TEST, '--testNamePattern', 'measures randomized']
        with (ARCHIVE / f'{version}-{label}.log').open('w') as log:
            subprocess.run(command, cwd=FRONTEND, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get('NOTE_CHOICE_REPLAY_WORKERS', '3'))) as pool:
        list(pool.map(run, VERSIONS))
    compare(label, len(records))
    return {version: {row['id']: row for row in [json.loads(line) for line in
            (ARCHIVE / f'{version}-{label}-paired.ndjson').read_text().splitlines()]} for version in VERSIONS}


def minimize(label, tasks):
    seed_ids = {key: row.get('seed', row['id']) for key, row in tasks.items()}
    controls = {key: [] for key in tasks}
    round_number = 0
    stable = set()
    while True:
        proposals = {}
        active = set(tasks) - stable
        for key, row in tasks.items():
            if key in stable:
                continue
            actions = row['actions']
            # Enumerate every shorter prefix and every single deletion. Removing
            # larger contiguous chunks avoids a pair of mutually enabling actions.
            candidates = [actions] + [actions[:length] for length in range(len(actions))]
            # Remove a control lifetime as a unit; deleting only Hold can leave an
            # impossible Release and block an otherwise valid smaller history.
            families = [
                {'holdTransport', 'releaseTransport'}, {'holdCollection', 'deliverLatest', 'deliverAll'},
                {'done', 'edit'}, {'offline', 'online'},
                {'openNotice', 'keep', 'pauseKeep', 'take', 'confirmTake', 'resume', 'inlineKeep', 'inlineTake'},
                {'type', 'dictate'}, {'phoneOther', 'phoneLive', 'phoneBase'}, {'timer'},
            ]
            candidates += [[action for action in actions if action['kind'] not in family] for family in families]
            candidates += [[action for action in actions if action['kind'] in family] for family in families]
            pending = {}
            closes = {'releaseTransport': 'holdTransport', 'deliverLatest': 'holdCollection',
                      'deliverAll': 'holdCollection', 'online': 'offline', 'edit': 'done', 'confirmTake': 'take'}
            for index, action in enumerate(actions):
                kind = action['kind']
                if kind in closes and closes[kind] in pending:
                    opening = pending.pop(closes[kind])
                    candidates.append([event for i, event in enumerate(actions) if i not in [opening, index]])
                pending[kind] = index
            candidates += [actions[:index] + actions[index + width:]
                           for width in sorted({1, max(1, len(actions) // 2)}, reverse=True)
                           for index in range(len(actions) - width + 1)]
            seen = set()
            for actions in candidates:
                token = json.dumps(actions, sort_keys=True)
                if token not in seen:
                    seen.add(token)
                    proposals.setdefault(token, {'id': f'd{len(proposals)}', 'actions': actions, 'tasks': []})['tasks'].append(key)
        records = [{'id': value['id'], 'actions': value['actions']} for value in proposals.values()]
        if not records:
            break
        batch_label = f'{label}-shrink-{round_number}'
        print(f'{batch_label}: {len(records)} proposals', flush=True)
        result = replay_batch(batch_label, records)
        replacements = {}
        for value in proposals.values():
            for key in value['tasks']:
                version = key.split(':')[0]
                row = result[version][value['id']]
                bad = matches(row, key)
                controls[key].append({'round': round_number, 'id': value['id'], 'actions': value['actions'],
                                      'valid': row['valid'], 'fails': bad, 'invalid': row.get('invalid')})
                if bad and len(row['actions']) < len(tasks[key]['actions']) and (
                        key not in replacements or len(row['actions']) < len(replacements[key]['actions'])):
                    replacements[key] = row
        # Recheck the base itself: warm evidence may have been produced before
        # a fixture correction. A non-reproducing warm row is never a finding.
        for key, original in list(tasks.items()):
            token = json.dumps(original['actions'], sort_keys=True)
            if token not in proposals:
                continue
            base = proposals[token]
            tasks[key] = result[key.split(':')[0]][base['id']]
        # A deletion proposed for one oracle can expose a different violation.
        # Harvest every such result; do not hide it because it was not the target.
        discovered = task_candidates({version: list(records.values()) for version, records in result.items()})
        new_keys = []
        proposal_by_id = {value['id']: value for value in proposals.values()}
        for key, row in discovered.items():
            if key in tasks and matches(tasks[key], key) and len(row['actions']) >= len(tasks[key]['actions']):
                continue
            origin = proposal_by_id[row['id']]['tasks'][0]
            if key not in tasks:
                new_keys.append(key)
                controls[key] = []
                tasks[key] = row
            else:
                replacements[key] = row
            seed_ids[key] = seed_ids[origin]
        if new_keys:
            print('Additional violations in deletion replays: ' + ', '.join(new_keys), flush=True)
        stable.update(active - set(replacements))
        stable.difference_update(replacements)
        stable.difference_update(new_keys)
        for key, row in replacements.items():
            tasks[key] = row
        (ARCHIVE / f'{label}-shrink-progress.json').write_text(json.dumps({key: {**row, 'seed': seed_ids[key]} for key, row in tasks.items()}, indent=2))
        round_number += 1
        print({key: len(row['actions']) for key, row in tasks.items()}, flush=True)
        if not replacements and not new_keys:
            break
    output = {key: {**row, 'seed': seed_ids[key], 'controls': controls[key],
                    'confirmed': matches(row, key),
                    'minimum': 'shortest tested prefix; no single deletion or tested half-chunk still reproduces'}
              for key, row in tasks.items()}
    (ARCHIVE / f'{label}-minima.json').write_text(json.dumps(output, indent=2))
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--label', default='full')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--warm-labels', nargs='*', default=[])
    parser.add_argument('--warm-minima', type=Path)
    parser.add_argument('--keys', nargs='*')
    args = parser.parse_args()
    source = ARCHIVE if (ARCHIVE / f'head-{args.label}-paired.ndjson').exists() else RETAINED
    data = {version: [json.loads(line) for line in (source / f'{version}-{args.label}-paired.ndjson').read_text().splitlines()]
            for version in VERSIONS}
    if args.limit:
        data = {version: records[:args.limit] for version, records in data.items()}
    originals = {version: list(records) for version, records in data.items()}
    for label in args.warm_labels:
        for version in VERSIONS:
            path = ARCHIVE / f'{version}-{label}-paired.ndjson'
            if path.exists():
                data[version].extend(json.loads(line) for line in path.read_text().splitlines())
    if args.warm_minima:
        for key, row in json.loads(args.warm_minima.read_text()).items():
            data[key.split(':')[0]].append(row)
    for records in data.values():
        for row in records:
            settled_verdicts(row)
    tasks = task_candidates(data)
    if args.keys:
        tasks = {key: row for key, row in tasks.items() if key in args.keys}
    for key, row in tasks.items():
        if row['id'].isdigit():
            continue
        for source in originals[key.split(':')[0]]:
            index = 0
            for action in source['actions']:
                if index < len(row['actions']) and action == row['actions'][index]:
                    index += 1
            if index == len(row['actions']):
                row['seed'] = source['id']
                break
    print({key: len(row['actions']) for key, row in tasks.items()}, flush=True)
    minimize(args.label, tasks)


if __name__ == '__main__':
    main()
