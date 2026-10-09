#!/usr/bin/env python3
"""Sum the tokens of every model request in ~/.claude/projects into hooks/history.ts.

Safe to re-run: the mod restarts its live global count from the new cutoff.
"""
import datetime
import json
import pathlib

FIELDS = ('input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens')


def history(root, cutoff):
    """{request id: tokens} for requests before `cutoff`; a request is logged once per content
    block and again in resumed sessions, early copies with partial counts, so keep the largest."""
    requests = {}
    for path in root.rglob('*.jsonl'):
        with open(path, encoding='utf-8', errors='replace') as f:
            for line in f:
                if '"usage"' not in line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                msg = row.get('message') if isinstance(row, dict) else None
                if not isinstance(msg, dict) or not isinstance(msg.get('usage'), dict):
                    continue
                key = msg.get('id') or row.get('requestId')
                if not key or row.get('timestamp', '') >= cutoff:
                    continue
                tokens = sum(msg['usage'].get(k) or 0 for k in FIELDS)
                requests[key] = max(tokens, requests.get(key, 0))
    return requests


def selfcheck(tmp):
    rows = [
        {'timestamp': '2026-01-01T00:00:00.000Z', 'message': {'id': 'a', 'usage': {'input_tokens': 1, 'output_tokens': 2}}},
        {'timestamp': '2026-01-01T00:00:00.000Z', 'message': {'id': 'a', 'usage': {'input_tokens': 1, 'output_tokens': 9}}},
        {'timestamp': '2026-01-01T00:00:01.000Z', 'message': {'id': 'b', 'usage': {'cache_read_input_tokens': 100}}},
        {'timestamp': '2026-01-02T00:00:00.000Z', 'message': {'id': 'c', 'usage': {'input_tokens': 5}}},
    ]
    (tmp / 'x.jsonl').write_text('\n'.join(map(json.dumps, rows)) + '\nnot json\n')
    assert history(tmp, '2026-01-02T00:00:00.000Z') == {'a': 10, 'b': 100}


if __name__ == '__main__':
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        selfcheck(pathlib.Path(tmp))

    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff = now.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    requests = history(pathlib.Path.home() / '.claude' / 'projects', cutoff)
    tokens = sum(requests.values())

    out = pathlib.Path(__file__).resolve().parent / 'hooks' / 'history.ts'
    out.write_text(
        '// Written by import_history.py: the tokens of every request before `through`.\n'
        f"export const HISTORY = {{ tokens: {tokens}, through: '{cutoff}' }}\n"
    )
    print(f'{tokens:,} tokens in {len(requests):,} requests before {cutoff} -> {out}')
