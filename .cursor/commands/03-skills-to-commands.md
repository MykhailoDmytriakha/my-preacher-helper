---
name: 03-skills-to-commands
description: "[03] Convert skills from .codex/skills/ to cursor commands in .cursor/commands/. Takes each SKILL.md file from skill directories and copies it as .md file to commands folder with proper naming. Use when you need to convert skill definitions into executable cursor commands."
---

# Skills to Commands Converter

**Purpose:** Convert skill definitions from `.codex/skills/` directory into executable cursor commands in `.cursor/commands/` directory.

## What This Command Does

This command transforms skill documentation into cursor command format:
- **Source:** `.codex/skills/*/SKILL.md` files
- **Target:** `.cursor/commands/[skill-name].md` files
- **Process:** Direct copy with extension change only
- **Result:** Skills become available as cursor commands

## Directory Structure

```
.codex/skills/
├── 00-meta-chain-flow-150/
│   └── SKILL.md
├── 01-meta-chain-of-skills-150/
│   └── SKILL.md
└── [other skill directories...]

↓ CONVERTS TO ↓

.cursor/commands/
├── 00-meta-chain-flow-150.md
├── 01-meta-chain-of-skills-150.md
└── [other command files...]
```

## Execution Steps

### Step 1: Verify Source Directory
```bash
# Check that skills directory exists and has content
ls -la .codex/skills/
```

### Step 2: Create Target Directory (if needed)
```bash
# Ensure commands directory exists
mkdir -p .cursor/commands/
```

### Step 3: Convert All Skills
```bash
# Copy each SKILL.md to corresponding .md file
for dir in .codex/skills/*/; do
  name=$(basename "$dir")
  cp "$dir/SKILL.md" ".cursor/commands/$name.md"
done
```

### Step 4: Verify Conversion
```bash
# Check that all files were converted
ls -la .cursor/commands/*.md | wc -l
echo "Files converted:"
ls .cursor/commands/*.md
```

## File Format Requirements

### Source Files (.codex/skills/*/SKILL.md)
- Must be markdown format
- Should have YAML frontmatter with `name` and `description`
- Content should be skill documentation

### Target Files (.cursor/commands/*.md)
- Same content as source files
- Extension changed from `.md` to `.md`
- Filename matches skill directory name
- No content modifications

## Example Usage

### Basic Conversion
```bash
# Convert all skills to commands
for dir in .codex/skills/*/; do
  name=$(basename "$dir")
  cp "$dir/SKILL.md" ".cursor/commands/$name.md"
done

# Verify result
ls .cursor/commands/
```

### Single Skill Conversion
```bash
# Convert specific skill
cp .codex/skills/00-meta-chain-flow-150/SKILL.md .cursor/commands/00-meta-chain-flow-150.md
```

### Batch Verification
```bash
# Check all conversions completed
echo "Source skills:"
ls .codex/skills/ | wc -l

echo "Converted commands:"
ls .cursor/commands/*.md | wc -l

echo "Files match:"
diff <(ls .codex/skills/) <(ls .cursor/commands/*.md | sed 's/\.md$//')
```

## Success Criteria

✅ **Conversion Complete** when:
- All `.codex/skills/*/SKILL.md` files have corresponding `.cursor/commands/*.md` files
- File count matches between source and target directories
- Content of files is identical (only extension differs)
- No errors during copy operations

## Common Issues & Solutions

### Issue: Source directory doesn't exist
```
Error: .codex/skills/ not found
```
**Solution:** Create skills directory or check path
```bash
mkdir -p .codex/skills/
```

### Issue: Target directory doesn't exist
```
Error: .cursor/commands/ not found
```
**Solution:** Create commands directory
```bash
mkdir -p .cursor/commands/
```

### Issue: Permission denied
```
Error: cp: permission denied
```
**Solution:** Check file permissions
```bash
chmod +r .codex/skills/*/SKILL.md
```

### Issue: Files not copied
**Solution:** Verify source files exist
```bash
find .codex/skills/ -name "SKILL.md" -type f
```

## Integration Notes

- **No Content Changes:** This command only changes file extension and location
- **Preserves Structure:** Original skill files remain unchanged
- **Naming Convention:** Target filename matches source directory name
- **Cursor Integration:** Converted files become available as cursor commands

## Related Commands

- **02-meta-skill-forge-150:** Creates new skills
- **00-meta-chain-flow-150:** Orchestrates multiple skills
- **72-close-session-150:** Saves session state

---

**Remember:** This command is a simple converter - it takes skill documentation and makes it available as cursor commands by changing the file extension and location. No content modification occurs.