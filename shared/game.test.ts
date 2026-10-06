import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  cleanText,
  createRound,
  drawGuessPoints,
  isCorrectColor,
  isCorrectMemory,
  normalized,
  randomCode,
  safeCode,
  scoreRound,
  validGame,
  type Player,
  type RoundData,
} from "./game";

const players: Player[] = [
  { id: "a", nickname: "Ali", avatar: "🐸", score: 0, ready: true },
  { id: "b", nickname: "Zeynep", avatar: "🦊", score: 0, ready: true },
  { id: "c", nickname: "Mert", avatar: "🐻", score: 0, ready: true },
];

/** Deterministic pick: always returns 0 (first element), second call variant via queue. */
function pickSeq(values: number[]) {
  let i = 0;
  return (max: number) => values[i++ % values.length] % max;
}

describe("game helpers", () => {
  it("cleans and normalizes Turkish text", () => {
    expect(cleanText("  Merhaba  ")).toBe("Merhaba");
    expect(cleanText("x".repeat(50), 32)).toHaveLength(32);
    expect(normalized("Şehir")).toBe(normalized("sehir"));
    expect(normalized("İstanbul")).toBe(normalized("istanbul"));
  });

  it("validates game ids and room codes", () => {
    expect(validGame("draw")).toBe(true);
    expect(validGame("satranç")).toBe(false);
    expect(safeCode("ab-12!?")).toBe("AB12");
    expect(randomCode(() => false)).toMatch(/^[A-Z0-9]{4}$/);
  });

  it("creates a draw round with drawer rotation and hidden word", () => {
    const { data, secret } = createRound("draw", 2, players, pickSeq([0]));
    expect(data.drawerId).toBe("b");
    expect(secret.word).toBeTruthy();
    expect(data.word).toBeUndefined();
    expect(data.prompt).toContain("Zeynep");
  });

  it("creates a colors round with distinct word and ink", () => {
    const { data, secret } = createRound("colors", 1, players, pickSeq([0, 1]));
    expect(secret.target).toBeTruthy();
    expect(data.target).toBeUndefined();
    expect(data.word).not.toContain(data.inkName ?? "IMPOSSIBLE");
    expect(data.colorOptions).toHaveLength(4);
  });

  it("creates a memory round with a 5-digit prompt", () => {
    const { data, secret } = createRound("memory", 1, players, pickSeq([1, 2, 3, 4, 5]));
    expect(secret.target).toBe("12345");
    expect(data.prompt).toBe("12345");
    expect(data.memoryHidden).toBe(false);
  });
});

describe("scoring", () => {
  it("scores unique word answers higher than duplicates", () => {
    const data: RoundData = {
      title: "Harf Kapmaca",
      letter: "A",
      strokes: [],
      correctOrder: [],
      submissions: {
        a: { value: { [CATEGORIES[0]]: "Ankara", [CATEGORIES[1]]: "", [CATEGORIES[2]]: "", [CATEGORIES[3]]: "" }, at: 1 },
        b: { value: { [CATEGORIES[0]]: "Ankara", [CATEGORIES[1]]: "", [CATEGORIES[2]]: "", [CATEGORIES[3]]: "" }, at: 2 },
        c: { value: { [CATEGORIES[0]]: "Adana", [CATEGORIES[1]]: "", [CATEGORIES[2]]: "", [CATEGORIES[3]]: "" }, at: 3 },
      },
    };
    const { gained } = scoreRound("words", data, players);
    expect(gained.c).toBe(60);
    expect(gained.a).toBe(25);
    expect(gained.b).toBe(25);
  });

  it("ignores word answers with the wrong letter", () => {
    const data: RoundData = {
      title: "Harf Kapmaca",
      letter: "B",
      strokes: [],
      correctOrder: [],
      submissions: {
        a: { value: { [CATEGORIES[0]]: "Ankara", [CATEGORIES[1]]: "", [CATEGORIES[2]]: "", [CATEGORIES[3]]: "" }, at: 1 },
      },
    };
    const { gained, details } = scoreRound("words", data, players);
    expect(gained.a).toBeUndefined();
    expect(details.join(" ")).toContain("B");
  });

  it("rewards faster correct color answers", () => {
    const data: RoundData = {
      title: "Renk Refleksi",
      target: "#386641",
      colorOptions: [{ name: "Yeşil", hex: "#386641" }],
      strokes: [],
      correctOrder: [],
      submissions: {
        b: { value: "Yeşil", at: 200, correct: true },
        a: { value: "Yeşil", at: 100, correct: true },
        c: { value: "Kırmızı", at: 50, correct: false },
      },
    };
    const { gained } = scoreRound("colors", data, players);
    expect(gained.a).toBe(90);
    expect(gained.b).toBe(60);
    expect(gained.c).toBeUndefined();
  });

  it("rewards correct memory answers in arrival order", () => {
    const data: RoundData = {
      title: "Sayı Avı",
      target: "12345",
      strokes: [],
      correctOrder: [],
      submissions: {
        a: { value: "12345", at: 5, correct: true },
        b: { value: "11111", at: 1, correct: false },
      },
    };
    const { gained } = scoreRound("memory", data, players);
    expect(gained.a).toBe(80);
    expect(gained.b).toBeUndefined();
  });

  it("computes draw guess points with remaining-time bonus", () => {
    expect(drawGuessPoints(10_000, 0)).toBe(100);
    expect(drawGuessPoints(0, 5_000)).toBe(90);
  });

  it("checks color and memory answers", () => {
    expect(isCorrectColor("#386641", "Yeşil")).toBe(true);
    expect(isCorrectColor("#386641", "Kırmızı")).toBe(false);
    expect(isCorrectMemory("12345", "12345")).toBe(true);
    expect(isCorrectMemory("12345", "12 345")).toBe(true);
    expect(isCorrectMemory("12345", "54321")).toBe(false);
  });
});
