when: commit only my changes · another session edited the same file · BUGS.md has someone else's entry · parallel sessions · shared working tree · hash-object · update-index --cacheinfo · file emptied by a script · truncated file · open(p,'w') before read · restore another session's edit · закоммитить только своё · чужая правка в том же файле · параллельные сессии · файл обнулился · скрипт стёр файл · восстановить чужую правку

# Edit a file another session is also editing

Build what you commit from HEAD plus your own edits, never by subtracting someone else's lines from the working copy. Let the working copy keep both.

## How

- Your commit version: `git show HEAD:BUGS.md > scratch/head.md`, apply only your edits to that copy, then `H=$(git hash-object -w scratch/mine.md) && git update-index --cacheinfo 100644,$H,BUGS.md`. The working tree is not touched, and someone else's lines cannot leak into your commit.
- The working copy gets the same edits applied to it, so the other session's lines stay where they are.
- Check both before committing. `diff <(git show HEAD:BUGS.md) scratch/mine.md` should show only your lines. `diff scratch/mine.md BUGS.md` should show only theirs, with nothing of yours missing.
- A script that rewrites a file reads it whole first, then writes: `with open(p) as f: s = f.read()`, then compute the result, then `with open(p, 'w') as f: f.write(result)`. Better still, write to a new path and `cp` it over after the diff check. Python evaluates `open(dst, 'w')` before the argument of `.write(...)`, so `open(p, 'w').write(edit(open(p).read()))` empties the file before reading it.

## When someone else's edit was lost

- Their text usually survives in their session transcript: `~/.claude/projects/<project>/<session>.jsonl`. Find the session with `grep -l "<a unique word of their entry>" ~/.claude/projects/<project>/*.jsonl`. Then replay its `Edit` calls on that file (`old_string` → `new_string`) in order, onto HEAD.
- An anchor may have moved because your commits changed the file meanwhile. Insert their block next to the same neighbour it had before, and check that every later anchor matches exactly once.
- Confirm the result: the added line count should equal what `git diff --stat` showed for their change before the damage.

## Why

- 2026-10-13: a loop that handled a scratch copy and `BUGS.md` alike emptied the real file. The other session's uncommitted psalm entry was gone from disk. It came back whole, 36 lines as before, from four `Edit` calls in that session's transcript.

See also: `.howto/get-a-deploy-through-vercel.md`
