import { capitalizeFirstLetter, normalizeCapitalizedTitle } from "../textNormalization";

describe("textNormalization", () => {
  it("capitalizes the first letter", () => {
    expect(capitalizeFirstLetter("хочется спать")).toBe("Хочется спать");
    expect(capitalizeFirstLetter("  бодрствуйте")).toBe("  Бодрствуйте");
  });

  it("skips leading punctuation when capitalizing the first letter", () => {
    expect(capitalizeFirstLetter('"впереди развитие')).toBe('"Впереди развитие');
    expect(capitalizeFirstLetter("«впереди развитие»")).toBe("«Впереди развитие»");
    expect(capitalizeFirstLetter("— бодрствуйте")).toBe("— Бодрствуйте");
    expect(capitalizeFirstLetter("123 проблема")).toBe("123 Проблема");
  });

  it("leaves already-capitalized and blank values stable", () => {
    expect(capitalizeFirstLetter("Проблема последних дней")).toBe("Проблема последних дней");
    expect(capitalizeFirstLetter("   ")).toBe("   ");
    expect(capitalizeFirstLetter('"')).toBe('"');
  });

  it("trims after capitalization for persisted titles", () => {
    expect(normalizeCapitalizedTitle('  "хочется спать  ')).toBe('"Хочется спать');
  });
});
