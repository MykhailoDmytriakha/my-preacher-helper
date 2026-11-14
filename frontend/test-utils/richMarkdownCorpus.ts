export const listBlockFixtures = [
  ['bullet code', 'codeBlock', '- ```\n  # Code in item\n  ```'],
  ['ordered code', 'codeBlock', '3. ```js\n   const a = 1;\n   ```'],
  ['quote', 'blockquote', '- > Quoted words'],
  ['heading', 'heading', '- # Heading'],
  ['nested list', 'bulletList', '- - Nested item'],
  ['horizontal rule', 'horizontalRule', '-\n  ---'],
  ['code in quoted list', 'codeBlock', '> - ```\n>   code\n>   ```'],
  ['code in nested list', 'codeBlock', '- Parent\n  - ```\n    code\n    ```'],
  ['code before another item', 'codeBlock', '- ```\n  code\n  ```\n- Next'],
  ['nested rule', 'horizontalRule', '- Parent\n\n  -\n    ---'],
  ['long fence', 'codeBlock', '- ````\n  ```\n  # Still code\n  ```\n  ````'],
] as const;

export const richMarkdownCorpus: [string, string][] = [
  ...listBlockFixtures.map(([name, , source]): [string, string] => [name, source]),
  ...[
    '', 'Words.', '# Heading', '**Bold** and *italic* and ~~struck~~.',
    '- First\n- Second', '- Words  with   spacing', '2. First\n3. Second',
    '- First paragraph\n\n  Second paragraph', '- Intro\n\n  ```\n  code\n  ```',
    '- Empty sibling follows\n- ', '- Before\n\n```\nOutside code\n```',
    '````\n```\n# Inside code\n```\n````', '`````js\nconst a = "````";\n`````',
    '```\nconst a = 1;\n```', 'Type `` ` `` to quote and ```` ``` ```` to fence.',
    '~~~foo`bar\n# Inside code\n~~~', '```\nx\n\n\n```', '```\n\n```',
    '| Person | Words |\n| --- | --- |\n| Paul | Grace |',
    'Before\n\n| Person | Words |\n| --- | --- |\n| Paul | **Grace** |\n\nAfter',
    '<table><tr><th>A</th><th>B</th></tr><tr><td colspan="2">Together</td></tr></table>',
    '> Quote\n\n---', '<p>One<br>Two</p>', '[Link](https://example.test) and `code`',
  ].map((source, index): [string, string] => [`base ${index}`, source]),
];

// Raw HTML, escaped pipes, containers and saved forms from richMarkdownTable.test.ts.
richMarkdownCorpus.push(...[
  [
    "table corpus 0",
    "| Person | Words |\n| --- | --- |\n| Paul | Grace |"
  ],
  [
    "table corpus 1",
    "<table><thead><tr><th>Person</th><th>Words</th></tr></thead><tbody><tr><td>Paul</td><td><strong>Grace</strong></td></tr></tbody></table>"
  ],
  [
    "table corpus 2",
    "Before\n\n| Person | Words |\n| --- | --- |\n| Paul | Grace! |\n\nAfter"
  ],
  [
    "table corpus 3",
    "Paul\tGrace\nPeter\tHope"
  ],
  [
    "table corpus 4",
    "<table><tbody><tr><td>Paul</td><td>Grace</td></tr><tr><td>Peter</td><td>Hope</td></tr></tbody></table>"
  ],
  [
    "table corpus 5",
    "- First\n- Second"
  ],
  [
    "table corpus 6",
    "```\n| literal | pipe |\n```"
  ],
  [
    "table corpus 7",
    "| Key | Note |\n| --- | --- |\n| A\\|B | **Grace** and [John](https://example.com) |"
  ],
  [
    "table corpus 8",
    "<table><tbody><tr><td colspan=\"2\"><p>Alpha</p><p>Beta</p></td></tr><tr><td>Left</td><td>Right</td></tr></tbody></table>"
  ],
  [
    "table corpus 9",
    "\n"
  ],
  [
    "table corpus 10",
    "| Person | Words |"
  ],
  [
    "table corpus 11",
    "| Key | Note |\n| --- | --- |\n| Paul | `A\\|B` |"
  ],
  [
    "table corpus 12",
    "<table><tbody><tr><td colspan=\"2\"><p>Alpha</p><p><strong>Beta</strong></p></td></tr><tr><td>Left<br>Below</td><td>Right</td></tr></tbody></table>"
  ],
  [
    "table corpus 13",
    "| | Note |\n| --- | --- |\n| Paul | |"
  ],
  [
    "table corpus 14",
    "| --- | --- |"
  ],
  [
    "table corpus 15",
    "<table><thead><tr><th>Key</th><th>Note</th></tr></thead><tbody><tr><td>Paul</td><td><a href=\"https://example.com/a|b\">Grace</a></td></tr></tbody></table>"
  ],
  [
    "table corpus 16",
    "<table><thead><tr><th>Who</th><th>What</th></tr></thead><tbody><tr><td>Paul</td><td><ul><li>Grace</li><li>and peace</li></ul></td></tr></tbody></table>"
  ],
  [
    "table corpus 17",
    "<table><thead><tr><th>Person</th><th>Words</th></tr></thead><tbody><tr><td rowspan=\"2\">Paul</td><td>Grace</td></tr><tr><td>Hope</td></tr></tbody></table>"
  ],
  [
    "table corpus 18",
    "<table><thead><tr><th>Who</th><th>What</th></tr></thead><tbody><tr><td><p>Paul<br>apostle</p><p>sent to teach</p></td><td><p>Grace</p><p>and peace</p></td></tr></tbody></table>"
  ],
  [
    "table corpus 19",
    "<table><thead><tr><th>Link</th><th>Underlined</th><th>Words</th></tr></thead><tbody><tr><td><a href=\"https://example.com/a|b\" title=\"Grace\\|mercy\">https://example.com/a|b</a></td><td><u>c|d</u></td><td>Important words</td></tr></tbody></table>"
  ],
  [
    "table corpus 20",
    "<table><thead><tr><th>Cell</th><th>Words</th></tr></thead><tbody><tr><td><code>a||||||b</code><strong>Grace</strong> <em>and</em> <s>peace</s></td><td>Important words</td></tr></tbody></table>"
  ],
  [
    "table corpus 21",
    "Before\n\n| Person | Words |\n| --- | --- |\n| Paul | Grace |\n\nAfter"
  ],
  [
    "table corpus 22",
    "> | Person | Words |\n> | --- | --- |\n> | Paul | Grace |"
  ],
  [
    "table corpus 23",
    "<ul><li><table><tbody><tr><td colspan=\"2\"><p>Alpha</p><p>Beta</p></td></tr><tr><td>Left</td><td>Right</td></tr></tbody></table></li></ul>"
  ],
  [
    "table corpus 24",
    "<blockquote><table><tbody><tr><td colspan=\"2\"><p>Alpha</p><p>Beta</p></td></tr><tr><td>Left</td><td>Right</td></tr></tbody></table></blockquote>"
  ],
  [
    "table corpus 25",
    "<ul><li><table><tbody><tr><td colspan=\"2\"><p>Alpha</p><p><strong>Beta</strong></p></td></tr><tr><td>Left<br>Below</td><td>Right</td></tr></tbody></table></li></ul>"
  ],
  [
    "table corpus 26",
    "<blockquote><table><tbody><tr><td colspan=\"2\"><p>Alpha</p><p><strong>Beta</strong></p></td></tr><tr><td>Left<br>Below</td><td>Right</td></tr></tbody></table></blockquote>"
  ],
  [
    "table corpus 27",
    "Before\n\n<table><thead><tr><th>Cell</th></tr></thead><tbody><tr><td>grace | mercy</td></tr></tbody></table>\n\nAfter"
  ],
  [
    "table corpus 28",
    "Before\n\n<table><thead><tr><th>Cell</th></tr></thead><tbody><tr><td>a\\|b</td></tr></tbody></table>\n\nAfter"
  ],
  [
    "table corpus 29",
    "Before\n\n<table><thead><tr><th>Cell</th></tr></thead><tbody><tr><td>a\\\\|b</td></tr></tbody></table>\n\nAfter"
  ]
] as [string, string][]);
