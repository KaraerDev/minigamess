// Oyun mantığının saf (side-effect'siz) hali.
// Hem Firebase istemci-sürücüsü hem de birim testleri burayı kullanır.
// Sunucu/istemci bağımlılığı yoktur: tarayıcıda ve Node'da çalışır.

export type GameId = "draw" | "words" | "colors" | "memory";
export type RoomStatus = "lobby" | "playing" | "finished";
export type GamePhase = "lobby" | "round" | "recap" | "finished";

export type Player = {
  id: string;
  nickname: string;
  avatar: string;
  score: number;
  ready: boolean;
};

export type Point = { x: number; y: number };
export type Stroke = { points: Point[]; color: string; width: number };
export type WordAnswers = { [category: string]: string };
export type Submission = { value: string | WordAnswers; at: number; correct?: boolean };

export type RoundData = {
  title: string;
  prompt?: string;
  target?: string;
  letter?: string;
  drawerId?: string;
  strokes: Stroke[];
  submissions: Record<string, Submission>;
  correctOrder: string[];
  memoryHidden?: boolean;
  word?: string;
  inkName?: string;
  inkHex?: string;
  colorOptions?: { name: string; hex: string }[];
};

export type Recap = { title: string; message: string; details: string[] };

export const AVATARS = ["🐸", "🦊", "🐻", "🐼", "🐙", "🐧", "🦝", "🐝"];

export const GAME_TITLES: Record<GameId, string> = {
  draw: "Çiz Bakalım",
  words: "Harf Kapmaca",
  colors: "Renk Refleksi",
  memory: "Sayı Avı",
};

export const DRAW_WORDS = [
  "karpuz", "uzaylı", "bisiklet", "kaplumbağa", "dondurma", "gökkuşağı",
  "uçurtma", "penguen", "kamp ateşi", "patlamış mısır", "robot", "çadır",
  "deniz feneri", "kurabiye", "balon",
];

export const LETTERS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "İ", "K", "L", "M",
  "N", "O", "P", "R", "S", "Ş", "T", "U", "Y", "Z",
];

export const CATEGORIES = ["Şehir", "Hayvan", "Yemek", "Eşya"];

export const COLORS = [
  { name: "Kırmızı", hex: "#df5942" },
  { name: "Yeşil", hex: "#386641" },
  { name: "Sarı", hex: "#e1aa3a" },
  { name: "Mavi", hex: "#557b9d" },
];

export const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROUND_DURATIONS: Record<GameId, number> = {
  draw: 65_000,
  words: 60_000,
  colors: 40_000,
  memory: 45_000,
};
export const RECAP_DURATION = 5_000;
export const MEMORY_HIDE_AFTER = 3_200;
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const VALID_ROUNDS = [3, 5, 8];

export type PickFn = (max: number) => number;
const defaultPick: PickFn = (max) => Math.floor(Math.random() * max);

export const cleanText = (value: unknown, max = 32): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export const normalized = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");

export const validGame = (value: unknown): value is GameId =>
  value === "draw" || value === "words" || value === "colors" || value === "memory";

export const safeCode = (value: unknown): string =>
  typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) : "";

export function randomCode(existing: (code: string) => boolean, pick: PickFn = defaultPick): string {
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[pick(CODE_CHARS.length)]).join("");
  } while (existing(code));
  return code;
}

/** Tur verisini kurar. `secret` alanı herkese açık düğüme yazılmamalıdır. */
export function createRound(
  gameId: GameId,
  roundNumber: number,
  players: Player[],
  pick: PickFn = defaultPick,
): { data: RoundData; secret: { word?: string; target?: string }; durationMs: number } {
  const submissions: Record<string, Submission> = {};
  const base: RoundData = { title: GAME_TITLES[gameId], strokes: [], submissions, correctOrder: [] };
  const secret: { word?: string; target?: string } = {};
  let durationMs = ROUND_DURATIONS[gameId];

  if (gameId === "draw") {
    const drawer = players[(roundNumber - 1) % players.length];
    base.drawerId = drawer.id;
    secret.word = DRAW_WORDS[pick(DRAW_WORDS.length)];
    base.prompt = `${drawer.nickname} çiziyor! Kelimeyi tahmin et.`;
  } else if (gameId === "words") {
    base.letter = LETTERS[pick(LETTERS.length)];
    base.prompt = "Harfi kap, kategorileri doldur!";
  } else if (gameId === "colors") {
    const wordIndex = pick(COLORS.length);
    let inkIndex = pick(COLORS.length);
    while (inkIndex === wordIndex) inkIndex = pick(COLORS.length);
    base.word = COLORS[wordIndex].name.toLocaleUpperCase("tr-TR");
    base.inkName = COLORS[inkIndex].name;
    base.inkHex = COLORS[inkIndex].hex;
    secret.target = COLORS[inkIndex].hex;
    base.colorOptions = COLORS.map((color) => ({ ...color }));
    base.prompt = "Kelimeye değil, mürekkebin rengine bas!";
  } else {
    secret.target = Array.from({ length: 5 }, () => String(pick(10))).join("");
    base.prompt = secret.target;
    base.memoryHidden = false;
  }

  return { data: base, secret, durationMs };
}

/**
 * Bitmiş turun skorlarını hesaplar (saf fonksiyon).
 * Döner: oyuncu başına kazanılan puan + özet detayları.
 */
export function scoreRound(
  gameId: GameId,
  data: RoundData,
  players: Player[],
): { gained: Record<string, number>; details: string[] } {
  const nickname = (id: string) => players.find((p) => p.id === id)?.nickname ?? "Oyuncu";
  const gained: Record<string, number> = {};
  const details: string[] = [];
  const add = (id: string, points: number) => {
    gained[id] = (gained[id] ?? 0) + points;
  };

  if (gameId === "words") {
    const totals = new Map<string, number>();
    for (const category of CATEGORIES) {
      const entries = Object.entries(data.submissions)
        .map(([playerId, submission]) => ({
          playerId,
          value: cleanText((submission.value as WordAnswers)?.[category], 32),
          at: submission.at,
        }))
        .filter((entry) => entry.value && normalized(entry.value).startsWith(normalized(data.letter ?? "")));
      const counts = new Map<string, number>();
      for (const entry of entries) {
        const key = normalized(entry.value);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const entry of entries) {
        const duplicate = (counts.get(normalized(entry.value)) ?? 0) > 1;
        totals.set(entry.playerId, (totals.get(entry.playerId) ?? 0) + (duplicate ? 25 : 60));
      }
      if (entries.length) {
        details.push(`${category}: ${entries.map((e) => `${nickname(e.playerId)} — ${e.value}`).join(" · ")}`);
      }
    }
    for (const [id, score] of totals) add(id, score);
    if (details.length === 0) details.push(`“${data.letter}” harfiyle başlayan geçerli bir cevap yoktu.`);
  } else if (gameId === "colors") {
    const correct = Object.entries(data.submissions)
      .filter(([, s]) => s.correct)
      .sort((a, b) => a[1].at - b[1].at);
    const points = [90, 60, 35];
    correct.forEach(([id], index) => add(id, points[index] ?? 20));
    details.push(`Doğru mürekkep rengi: ${data.colorOptions?.find((c) => c.hex === data.target)?.name ?? "—"}`);
    details.push(
      correct.length
        ? `En hızlı: ${correct.slice(0, 3).map(([id]) => nickname(id)).join(" · ")}`
        : "Bu turda doğru rengi bulan olmadı.",
    );
  } else if (gameId === "memory") {
    const correct = Object.entries(data.submissions)
      .filter(([, s]) => s.correct)
      .sort((a, b) => a[1].at - b[1].at);
    const points = [80, 55, 35];
    correct.forEach(([id], index) => add(id, points[index] ?? 20));
    details.push(`Sayı dizisi: ${data.target ?? "—"}`);
    details.push(
      correct.length
        ? `Doğru hatırlayanlar: ${correct.map(([id]) => nickname(id)).join(" · ")}`
        : "Diziyi doğru hatırlayan olmadı.",
    );
  } else {
    const drawerName = nickname(data.drawerId ?? "");
    details.push(`Çizilen kelime: ${data.word ?? "—"}${data.drawerId ? ` · Çizen: ${drawerName}` : ""}`);
    details.push(
      data.correctOrder.length
        ? `Doğru tahmin edenler: ${data.correctOrder.map(nickname).join(" · ")}`
        : "Bu turda kelime bulunamadı.",
    );
  }

  return { gained, details };
}

/** Çiz-tahmin turunda doğru tahminin kazandıracağı puan (kalan süre bonuslu). */
export function drawGuessPoints(endsAt: number, now = Date.now()): number {
  return 90 + Math.max(0, Math.floor((endsAt - now) / 1_000));
}

/** Renk turunda seçilen cevabın doğru olup olmadığı. */
export function isCorrectColor(target: string | undefined, answerName: string): boolean {
  return COLORS.find((c) => c.name === answerName)?.hex === target;
}

/** Hafıza turunda cevabın doğru olup olmadığı. */
export function isCorrectMemory(target: string | undefined, answer: string): boolean {
  return normalized(answer.replace(/\s+/g, "")) === normalized(target ?? "");
}
