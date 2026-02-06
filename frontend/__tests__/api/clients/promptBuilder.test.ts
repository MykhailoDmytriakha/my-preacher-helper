import {
  buildPromptBlueprint,
  buildSimplePromptBlueprint,
  detectDominantLanguage,
} from "@clients/promptBuilder";

describe("promptBuilder", () => {
  it("builds prompt blueprint from modular blocks", () => {
    const blueprint = buildPromptBlueprint({
      promptName: "test_prompt",
      promptVersion: "v2",
      expectedLanguage: "ru",
      context: { sermonId: "sermon-1" },
      systemBlocks: [
        {
          blockId: "system.role",
          category: "role",
          content: "You are a theology assistant.",
        },
        {
          blockId: "system.language",
          category: "language",
          content: "Respond in the same language as input.",
        },
      ],
      userBlocks: [
        {
          blockId: "user.context",
          category: "context",
          content: "Sermon title: Grace",
        },
      ],
    });

    expect(blueprint.promptName).toBe("test_prompt");
    expect(blueprint.promptVersion).toBe("v2");
    expect(blueprint.expectedLanguage).toBe("ru");
    expect(blueprint.systemPrompt).toContain("You are a theology assistant.");
    expect(blueprint.systemPrompt).toContain("Respond in the same language as input.");
    expect(blueprint.userMessage).toBe("Sermon title: Grace");
    expect(blueprint.blocks).toHaveLength(3);
    expect(blueprint.blocks[0].source).toBe("system");
    expect(blueprint.blocks[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("builds simple blueprint with default ids and categories", () => {
    const blueprint = buildSimplePromptBlueprint({
      promptName: "simple_prompt",
      systemPrompt: "System text",
      userMessage: "User text",
    });

    expect(blueprint.promptVersion).toBe("v1");
    expect(blueprint.blocks[0].blockId).toBe("simple_prompt.system.base");
    expect(blueprint.blocks[1].blockId).toBe("simple_prompt.user.base");
    expect(blueprint.blocks[0].category).toBe("task");
    expect(blueprint.blocks[1].category).toBe("context");
  });

  it("detects dominant language", () => {
    expect(detectDominantLanguage("This is a test")).toBe("en");
    expect(detectDominantLanguage("Це український текст із літерою ї")).toBe("uk");
    expect(detectDominantLanguage("Это русский текст с буквой ы")).toBe("ru");
    expect(detectDominantLanguage("")).toBe("unknown");
  });
});

