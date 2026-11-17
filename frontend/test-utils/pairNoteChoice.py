#!/usr/bin/env python3
"""Print raw paired oracle sets and retain every asymmetric row, without exemptions."""
import argparse
import json
from pathlib import Path

ORACLES = ['I1', 'I2', 'I3', 'I4', 'C1', 'C2', 'C3', 'C4', 'C5']
FIELDS = ['verdicts', 'terminal', 'answers', 'violatedAtSteps', 'checkpoints']


def read_rows(path):
    result = {}
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row['id'] in result:
            raise ValueError(f"Duplicate id: {row['id']}")
        result[row['id']] = row
    return result


def pair(measured, production):
    if measured.keys() != production.keys():
        raise ValueError('The paired files must contain the same IDs')
    for key, row in measured.items():
        if row['actions'] != production[key]['actions']:
            raise ValueError(f'Actions differ: {key}')
    tables, differences = {}, {}
    for oracle in ORACLES:
        left = {key for key, row in measured.items() if row['verdicts'][oracle] == 'violation'}
        right = {key for key, row in production.items() if row['verdicts'][oracle] == 'violation'}
        tables[oracle] = {'measured': len(left), 'production': len(right), 'measuredOnly': len(left - right),
                          'productionOnly': len(right - left), 'both': len(left & right),
                          'measuredNA': sum(row['verdicts'][oracle] == 'not applicable' for row in measured.values()),
                          'productionNA': sum(row['verdicts'][oracle] == 'not applicable' for row in production.values())}
        differences[oracle] = {}
        for name, ids in [('measuredOnly', left - right), ('productionOnly', right - left)]:
            differences[oracle][name] = [
                {'id': key, 'actions': measured[key]['actions'],
                 'measured': {field: measured[key].get(field, {} if field == 'violatedAtSteps' else None) for field in FIELDS},
                 'production': {field: production[key].get(field, {} if field == 'violatedAtSteps' else None) for field in FIELDS}}
                for key in measured if key in ids]
    return {'histories': len(measured), 'tables': tables, 'differences': differences}


def table_markdown(tables):
    lines = ['| Oracle | Measured | Production | Measured only | Production only | Both | Measured N/A | Production N/A |',
             '|---|---:|---:|---:|---:|---:|---:|---:|']
    lines.extend('| ' + name + ' | ' + ' | '.join(str(value) for value in row.values()) + ' |' for name, row in tables.items())
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--measured', type=Path, required=True)
    parser.add_argument('--production', type=Path, required=True)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    retained = Path(__file__).resolve().parents[2] / '.cases/2026-11-12-dvizhok-dannyh-do-ideala/research/125-probes'
    output = args.out or retained.parent / '127-probes' / f'{args.measured.stem}-vs-{args.production.stem}.json'
    if output.resolve().is_relative_to(retained.resolve()):
        parser.error('125-probes is retained read-only evidence; select --out elsewhere')
    result = pair(read_rows(args.measured), read_rows(args.production))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(table_markdown(result['tables']))
    print(f"Histories: {result['histories']}; asymmetric rows: {output}")


if __name__ == '__main__':
    main()
