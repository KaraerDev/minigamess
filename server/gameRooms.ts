import { randomInt, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";

type GameId = "draw" | "words" | "colors" | "memory";
type RoomStatus = "lobby" | "playing" | "finished";
type GamePhase = "lobby" | "round" | "recap" | "finished";
type Player = { id: string; nickname: string; avatar: string; score: number; ready: boolean };
type Point = { x: number; y: number };
type Stroke = { points: Point[]; color: string; width: number };
type WordAnswers = { [category: string]: string };
type Submission = { value: string | WordAnswers; at: number; correct?: boolean };
type RoundData = {
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
type Room = {
  code: string;
  ownerId: string;
  gameId: GameId;
  rounds: number;
  status: RoomStatus;
  phase: GamePhase;
  round: number;
  players: Player[];
  data: RoundData | null;
  recap: { title: string; message: string; details: string[] } | null;
  endsAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
};
type SseClient = { res: Response; playerId: string };

const rooms = new Map<string, Room>();
const listeners = new Map<string, Set<SseClient>>();
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const AVATARS = ["🐸", "🦊", "🐻", "🐼", "🐙", "🐧", "🦝", "🐝"];
const GAME_TITLES: Record<GameId, string> = {
  draw: "Çiz Bakalım",
  words: "Harf Kapmaca",
  colors: "Renk Refleksi",
  memory: "Sayı Avı",
};
const DRAW_WORDS = ["karpuz", "uzaylı", "bisiklet", "kaplumbağa", "dondurma", "gökkuşağı", "uçurtma", "penguen", "kamp ateşi", "patlamış mısır", "robot", "çadır", "deniz feneri", "kurabiye", "balon"];
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "İ", "K", "L", "M", "N", "O", "P", "R", "S", "Ş", "T", "U", "Y", "Z"];
const CATEGORIES = ["Şehir", "Hayvan", "Yemek", "Eşya"];
const COLORS = [
  { name: "Kırmızı", hex: "#df5942" },
  { name: "Yeşil", hex: "#386641" },
  { name: "Sarı", hex: "#e1aa3a" },
  { name: "Mavi", hex: "#557b9d" },
];
const cleanText = (value: unknown, max = 32) => typeof value === "string" ? value.trim().slice(0, max) : "";
const normalized = (value: string) => value.trim().toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
const validGame = (value: unknown): value is GameId => value === "draw" || value === "words" || value === "colors" || value === "memory";
const safeCode = (value: unknown) => typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) : "";

function getRoom(code: unknown) {
  return rooms.get(safeCode(code));
}
function getPlayer(room: Room, value: unknown) {
  return room.players.find(player => player.id === value);
}
function fail(res: Response, status: number, error: string) {
  res.status(status).json({ error });
}
function randomCode() {
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}
function clearTimer(room: Room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
}

function publicState(room: Room, playerId: string) {
  const data = room.data;
  const current = getPlayer(room, playerId);
  const players = room.players.map(player => ({
    id: player.id,
    nickname: player.nickname,
    avatar: player.avatar,
    score: player.score,
    ready: player.ready,
    isOwner: player.id === room.ownerId,
    hasAnswered: Boolean(data?.submissions[player.id]) || Boolean(data?.correctOrder.includes(player.id)),
  })).sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, "tr"));

  let round: Record<string, unknown> | null = null;
  if (room.status === "playing" && data) {
    const isDrawer = data.drawerId === playerId;
    round = {
      gameId: room.gameId,
      title: data.title,
      number: room.round,
      totalRounds: room.rounds,
      endsAt: room.endsAt,
      prompt: room.gameId === "memory" && data.memoryHidden ? null : data.prompt,
      drawerId: data.drawerId,
      drawerName: data.drawerId ? getPlayer(room, data.drawerId)?.nickname ?? "Oyuncu" : null,
      isDrawer,
      word: room.gameId === "draw" && isDrawer ? data.word : undefined,
      strokes: data.strokes,
      letter: data.letter,
      categories: room.gameId === "words" ? CATEGORIES : undefined,
      wordAnswers: data.submissions[playerId]?.value ?? null,
      wordAnswered: Boolean(data.submissions[playerId]),
      inkName: data.inkName,
      inkHex: data.inkHex,
      colorOptions: data.colorOptions,
      memoryHidden: data.memoryHidden ?? false,
      hasAnswered: Boolean(data.submissions[playerId]) || Boolean(data.correctOrder.includes(playerId)),
      correctCount: data.correctOrder.length,
      answerCount: Object.keys(data.submissions).length,
      totalPlayers: room.players.length,
      myAnswer: typeof data.submissions[playerId]?.value === "string" ? data.submissions[playerId]?.value : undefined,
    };
  }

  return {
    code: room.code,
    status: room.status,
    phase: room.phase,
    ownerId: room.ownerId,
    gameId: room.gameId,
    gameTitle: GAME_TITLES[room.gameId],
    rounds: room.rounds,
    currentRound: room.round,
    players,
    me: current ? { id: current.id, nickname: current.nickname, avatar: current.avatar } : null,
    round,
    recap: room.recap,
    canStart: room.status === "lobby" && room.players.length >= 2 && room.players.every(player => player.ready),
  };
}
function publish(room: Room) {
  const clients = listeners.get(room.code);
  if (!clients) return;
  for (const client of clients) {
    if (client.res.destroyed || client.res.writableEnded) continue;
    client.res.write(`event: state\ndata: ${JSON.stringify(publicState(room, client.playerId))}\n\n`);
  }
}
function member(room: Room, req: Request, res: Response) {
  const id = cleanText(req.body?.playerId ?? req.query.playerId, 64);
  const player = getPlayer(room, id);
  if (!player) {
    fail(res, 403, "Bu odada oyuncu olarak görünmüyorsun. Oda kodunu kullanarak yeniden katıl.");
    return null;
  }
  return player;
}

function finishRound(room: Room, message = "Süre doldu!") {
  if (room.status !== "playing" || room.phase !== "round" || !room.data) return;
  clearTimer(room);
  const data = room.data;
  const details: string[] = [];

  if (room.gameId === "words") {
    const answers = data.submissions;
    const totals = new Map<string, number>();
    for (const category of CATEGORIES) {
      const entries = Object.entries(answers).map(([playerId, submission]) => ({
        playerId,
        value: cleanText((submission.value as WordAnswers)?.[category], 32),
        at: submission.at,
      })).filter(entry => entry.value && normalized(entry.value).startsWith(normalized(data.letter ?? "")));
      const duplicateCounts = new Map<string, number>();
      for (const entry of entries) duplicateCounts.set(normalized(entry.value), (duplicateCounts.get(normalized(entry.value)) ?? 0) + 1);
      for (const entry of entries) {
        const duplicate = (duplicateCounts.get(normalized(entry.value)) ?? 0) > 1;
        totals.set(entry.playerId, (totals.get(entry.playerId) ?? 0) + (duplicate ? 25 : 60));
      }
      if (entries.length) details.push(`${category}: ${entries.map(entry => `${getPlayer(room, entry.playerId)?.nickname} — ${entry.value}`).join(" · ")}`);
    }
    for (const [id, score] of totals) {
      const player = getPlayer(room, id);
      if (player) player.score += score;
    }
    if (details.length === 0) details.push(`“${data.letter}” harfiyle başlayan geçerli bir cevap yoktu.`);
  } else if (room.gameId === "colors") {
    const correct = Object.entries(data.submissions)
      .filter(([, submission]) => submission.correct)
      .sort((a, b) => a[1].at - b[1].at);
    const points = [90, 60, 35];
    correct.forEach(([id], index) => {
      const player = getPlayer(room, id);
      if (player) player.score += points[index] ?? 20;
    });
    details.push(`Doğru mürekkep rengi: ${data.colorOptions?.find(color => color.hex === data.target)?.name ?? "—"}`);
    details.push(correct.length ? `En hızlı: ${correct.slice(0, 3).map(([id]) => getPlayer(room, id)?.nickname).join(" · ")}` : "Bu turda doğru rengi bulan olmadı.");
  } else if (room.gameId === "memory") {
    const correct = Object.entries(data.submissions).filter(([, submission]) => submission.correct).sort((a, b) => a[1].at - b[1].at);
    const points = [80, 55, 35];
    correct.forEach(([id], index) => {
      const player = getPlayer(room, id);
      if (player) player.score += points[index] ?? 20;
    });
    details.push(`Sayı dizisi: ${data.target ?? "—"}`);
    details.push(correct.length ? `Doğru hatırlayanlar: ${correct.map(([id]) => getPlayer(room, id)?.nickname).join(" · ")}` : "Diziyi doğru hatırlayan olmadı.");
  } else {
    const drawer = getPlayer(room, data.drawerId);
    details.push(`Çizilen kelime: ${data.word ?? "—"}${drawer ? ` · Çizen: ${drawer.nickname}` : ""}`);
    details.push(data.correctOrder.length ? `Doğru tahmin edenler: ${data.correctOrder.map(id => getPlayer(room, id)?.nickname).join(" · ")}` : "Bu turda kelime bulunamadı.");
  }

  room.phase = "recap";
  room.recap = { title: `${room.round}. turun özeti`, message, details };
  room.endsAt = Date.now() + 5000;
  publish(room);
  room.timer = setTimeout(() => advanceRound(room), 5000);
}

function advanceRound(room: Room) {
  if (room.status !== "playing" || room.phase !== "recap") return;
  clearTimer(room);
  if (room.round >= room.rounds) {
    room.status = "finished";
    room.phase = "finished";
    room.endsAt = null;
    room.recap = { title: "Son düdük!", message: "Piknik örtüsünde günün yıldızı belli oldu.", details: room.recap?.details ?? [] };
    publish(room);
    return;
  }
  startRound(room);
}

function startRound(room: Room) {
  clearTimer(room);
  room.round += 1;
  room.status = "playing";
  room.phase = "round";
  room.recap = null;
  const submissions: Record<string, Submission> = {};
  const base: RoundData = { title: GAME_TITLES[room.gameId], strokes: [], submissions, correctOrder: [] };
  let duration = 60_000;

  if (room.gameId === "draw") {
    const drawer = room.players[(room.round - 1) % room.players.length];
    base.drawerId = drawer.id;
    base.word = DRAW_WORDS[randomInt(DRAW_WORDS.length)];
    base.prompt = `${drawer.nickname} çiziyor! Kelimeyi tahmin et.`;
    duration = 65_000;
  } else if (room.gameId === "words") {
    base.letter = LETTERS[randomInt(LETTERS.length)];
    base.prompt = "Harfi kap, kategorileri doldur!";
  } else if (room.gameId === "colors") {
    const wordIndex = randomInt(COLORS.length);
    let inkIndex = randomInt(COLORS.length);
    while (inkIndex === wordIndex) inkIndex = randomInt(COLORS.length);
    base.word = COLORS[wordIndex].name.toLocaleUpperCase("tr-TR");
    base.inkName = COLORS[inkIndex].name;
    base.inkHex = COLORS[inkIndex].hex;
    base.target = COLORS[inkIndex].hex;
    base.colorOptions = COLORS.map(color => ({ ...color }));
    base.prompt = "Kelimeye değil, mürekkebin rengine bas!";
    duration = 40_000;
  } else {
    const sequence = Array.from({ length: 5 }, () => String(randomInt(10))).join("");
    base.target = sequence;
    base.prompt = sequence;
    base.memoryHidden = false;
    duration = 45_000;
  }

  room.data = base;
  room.endsAt = Date.now() + duration;
  publish(room);
  room.timer = setTimeout(() => finishRound(room), duration);
  if (room.gameId === "memory") {
    setTimeout(() => {
      if (room.status === "playing" && room.phase === "round" && room.data === base) {
        base.memoryHidden = true;
        publish(room);
      }
    }, 3_200);
  }
}

function createRoom(req: Request, res: Response) {
  const nickname = cleanText(req.body?.nickname, 18);
  if (!nickname) return fail(res, 400, "Önce kendine bir takma ad seç.");
  const avatar = AVATARS.includes(req.body?.avatar) ? req.body.avatar : AVATARS[0];
  const gameId: GameId = validGame(req.body?.gameId) ? req.body.gameId : "draw";
  const roundCount = Number(req.body?.rounds);
  const rounds = [3, 5, 8].includes(roundCount) ? roundCount : 3;
  const owner: Player = { id: randomUUID(), nickname, avatar, score: 0, ready: true };
  const room: Room = {
    code: randomCode(), ownerId: owner.id, gameId, rounds, status: "lobby", phase: "lobby", round: 0,
    players: [owner], data: null, recap: null, endsAt: null, timer: null,
  };
  rooms.set(room.code, room);
  res.status(201).json(publicState(room, owner.id));
}
function joinRoom(req: Request, res: Response) {
  const room = getRoom(req.params.code);
  if (!room) return fail(res, 404, "Bu oda kodunu bulamadım. Kodu yeniden kontrol et.");
  if (room.status !== "lobby") return fail(res, 409, "Bu oyun çoktan başlamış. Yeni bir oda açın.");
  if (room.players.length >= 8) return fail(res, 409, "Bu masa doldu; en fazla 8 kişi oynayabilir.");
  const nickname = cleanText(req.body?.nickname, 18);
  if (!nickname) return fail(res, 400, "Önce kendine bir takma ad seç.");
  const avatar = AVATARS.includes(req.body?.avatar) ? req.body.avatar : AVATARS[0];
  const player: Player = { id: randomUUID(), nickname, avatar, score: 0, ready: false };
  room.players.push(player);
  publish(room);
  res.status(201).json(publicState(room, player.id));
}

export function createGameRouter() {
  const router = Router();
  router.post("/rooms", createRoom);
  router.post("/rooms/:code/join", joinRoom);
  router.get("/rooms/:code", (req, res) => {
    const room = getRoom(req.params.code);
    if (!room) return fail(res, 404, "Oda bulunamadı.");
    const player = member(room, req, res);
    if (!player) return;
    res.json(publicState(room, player.id));
  });
  router.get("/rooms/:code/events", (req, res) => {
    const room = getRoom(req.params.code);
    if (!room) return fail(res, 404, "Oda bulunamadı.");
    const playerId = cleanText(req.query.playerId, 64);
    if (!getPlayer(room, playerId)) return fail(res, 403, "Bu odada görünmüyorsun.");
    res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const client: SseClient = { res, playerId };
    const group = listeners.get(room.code) ?? new Set<SseClient>();
    group.add(client);
    listeners.set(room.code, group);
    res.write(`event: state\ndata: ${JSON.stringify(publicState(room, playerId))}\n\n`);
    const heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n"); }, 20_000);
    res.on("close", () => {
      clearInterval(heartbeat);
      group.delete(client);
      if (group.size === 0) listeners.delete(room.code);
    });
  });
  router.post("/rooms/:code/ready", (req, res) => {
    const room = getRoom(req.params.code);
    if (!room || room.status !== "lobby") return fail(res, 404, "Hazırlık lobisi artık açık değil.");
    const player = member(room, req, res);
    if (!player) return;
    player.ready = !player.ready;
    publish(room);
    res.json(publicState(room, player.id));
  });
  router.post("/rooms/:code/settings", (req, res) => {
    const room = getRoom(req.params.code);
    if (!room || room.status !== "lobby") return fail(res, 409, "Oyun ayarları yalnızca lobide değiştirilebilir.");
    const player = member(room, req, res);
    if (!player) return;
    if (player.id !== room.ownerId) return fail(res, 403, "Oyun ayarlarını yalnızca oda sahibi değiştirebilir.");
    if (req.body?.gameId !== undefined) {
      if (!validGame(req.body.gameId)) return fail(res, 400, "Geçerli bir oyun seç.");
      room.gameId = req.body.gameId;
    }
    if (req.body?.rounds !== undefined) {
      const rounds = Number(req.body.rounds);
      if (![3, 5, 8].includes(rounds)) return fail(res, 400, "Tur sayısı 3, 5 veya 8 olabilir.");
      room.rounds = rounds;
    }
    publish(room);
    res.json(publicState(room, player.id));
  });
  router.post("/rooms/:code/start", (req, res) => {
    const room = getRoom(req.params.code);
    if (!room || room.status !== "lobby") return fail(res, 409, "Bu oda şu an başlatılamıyor.");
    const player = member(room, req, res);
    if (!player) return;
    if (player.id !== room.ownerId) return fail(res, 403, "Oyunu yalnızca oda sahibi başlatabilir.");
    if (room.players.length < 2) return fail(res, 409, "Başlamak için en az iki oyuncu lazım.");
    if (!room.players.every(item => item.ready)) return fail(res, 409, "Herkes hazır olduğunda oyun başlar.");
    room.round = 0;
    room.players.forEach(item => { item.score = 0; item.ready = false; });
    startRound(room);
    res.json(publicState(room, player.id));
  });
  router.post("/rooms/:code/draw", (req, res) => {
    const room = getRoom(req.params.code);
    if (!room || room.status !== "playing" || room.phase !== "round" || room.gameId !== "draw" || !room.data) return fail(res, 409, "Şu anda çizim turu yok.");
    const player = member(room, req, res);
    if (!player) return;
    if (player.id !== room.data.drawerId) return fail(res, 403, "Bu turda kalem çizerde.");
    if (!Array.isArray(req.body?.points) || req.body.points.length === 0) return fail(res, 400, "Bir çizgi noktası gönder.");
    if (room.data.strokes.length >= 80) return fail(res, 429, "Tahta doldu; yeni bir çizgi için turu bekle.");
    const points: Point[] = req.body.points.slice(0, 300).map((point: any) => ({
      x: Math.max(0, Math.min(1000, Number(point?.x) || 0)),
      y: Math.max(0, Math.min(1000, Number(point?.y) || 0)),
    }));
    const allowed = ["#386641", "#df5942", "#e1aa3a", "#557b9d", "#29271e"];
    const color = allowed.includes(req.body?.color) ? req.body.color : allowed[0];
    const width = Math.max(4, Math.min(32, Number(req.body?.width) || 11));
    room.data.strokes.push({ points, color, width });
    publish(room);
    res.json({ ok: true });
  });
  router.post("/rooms/:code/clear", (req, res) => {
    const room = getRoom(req.params.code);
    if (!room || room.status !== "playing" || room.phase !== "round" || room.gameId !== "draw" || !room.data) return fail(res, 409, "Tahta şu anda açık değil.");
    const player = member(room, req, res);
    if (!player) return;
    if (player.id !== room.data.drawerId) return fail(res, 403, "Tahtayı bu turdaki çizer temizleyebilir.");
    room.data.strokes = [];
    publish(room);
    res.json({ ok: true });
  });
  router.post("/rooms/:code/guess", (req, res) => {
    const room = getRoom(req.params.code);
    if (!room || room.status !== "playing" || room.phase !== "round" || room.gameId !== "draw" || !room.data) return fail(res, 409, "Tahmin turu şu anda açık değil.");
    const player = member(room, req, res);
    if (!player) return;
    if (player.id === room.data.drawerId) return fail(res, 403, "Çizer bu turda kelimeyi biliyor zaten.");
    if (room.data.correctOrder.includes(player.id)) return fail(res, 409, "Kelimeyi zaten buldun!");
    const guess = cleanText(req.body?.guess, 48);
    if (!guess) return fail(res, 400, "Bir tahmin yaz.");
    if (normalized(guess) === normalized(room.data.word ?? "")) {
      room.data.correctOrder.push(player.id);
      player.score += 90 + Math.max(0, Math.floor(((room.endsAt ?? Date.now()) - Date.now()) / 1_000));
      const guessers = room.players.filter(item => item.id !== room.data?.drawerId);
      publish(room);
      if (room.data.correctOrder.length >= guessers.length) finishRound(room, "Herkes kelimeyi kapmış!");
      return res.json({ correct: true, message: "Bildin! Puan senin." });
    }
    res.json({ correct: false, message: "Daha değil, başka bir şey dene." });
  });
  router.post("/rooms/:code/answer", (req, res) => {
    const room = getRoom(req.params.code);
    if (!room || room.status !== "playing" || room.phase !== "round" || !room.data || !["words", "colors", "memory"].includes(room.gameId)) return fail(res, 409, "Bu tur cevap kabul etmiyor.");
    const player = member(room, req, res);
    if (!player) return;
    if (room.gameId === "memory" && !room.data.memoryHidden) return fail(res, 409, "Sayılar henüz saklanmadı.");
    if (room.data.submissions[player.id]) return fail(res, 409, "Cevabın bu tur için kaydedildi.");
    const at = Date.now();
    let submission: Submission;
    if (room.gameId === "words") {
      const raw = req.body?.answers && typeof req.body.answers === "object" ? req.body.answers : {};
      const values: WordAnswers = Object.fromEntries(CATEGORIES.map(category => [category, cleanText(raw[category], 32)]));
      if (!Object.values(values).some(Boolean)) return fail(res, 400, "En az bir kategoriye cevap yaz.");
      submission = { value: values, at };
    } else if (room.gameId === "colors") {
      const answer = cleanText(req.body?.answer, 18);
      const color = room.data.colorOptions?.find(item => item.name === answer);
      if (!color) return fail(res, 400, "Ekrandaki renklerden birini seç.");
      submission = { value: answer, at, correct: color.hex === room.data.target };
    } else {
      const answer = cleanText(req.body?.answer, 20).replace(/\s+/g, "");
      if (!answer) return fail(res, 400, "Hatırladığın sayı dizisini yaz.");
      submission = { value: answer, at, correct: normalized(answer) === normalized(room.data.target ?? "") };
    }
    room.data.submissions[player.id] = submission;
    publish(room);
    if (Object.keys(room.data.submissions).length >= room.players.length) finishRound(room, "Herkes cevabını verdi!");
    res.json({ ok: true, correct: submission.correct ?? null, message: submission.correct ? "Doğru bildin!" : "Cevabın kaydedildi." });
  });
  router.post("/rooms/:code/next", (req, res) => {
    const room = getRoom(req.params.code);
    if (!room || room.status !== "playing" || room.phase !== "recap") return fail(res, 409, "Bir sonraki tura geçiş zamanı değil.");
    const player = member(room, req, res);
    if (!player) return;
    if (player.id !== room.ownerId) return fail(res, 403, "Bir sonraki turu oda sahibi başlatabilir.");
    advanceRound(room);
    res.json(publicState(room, player.id));
  });
  router.post("/rooms/:code/play-again", (req, res) => {
    const room = getRoom(req.params.code);
    if (!room || room.status !== "finished") return fail(res, 409, "Rövanş için önce oyunun bitmesi gerekiyor.");
    const player = member(room, req, res);
    if (!player) return;
    if (player.id !== room.ownerId) return fail(res, 403, "Rövanşı oda sahibi başlatabilir.");
    clearTimer(room);
    room.status = "lobby";
    room.phase = "lobby";
    room.round = 0;
    room.recap = null;
    room.data = null;
    room.endsAt = null;
    room.players.forEach(item => { item.score = 0; item.ready = item.id === room.ownerId; });
    publish(room);
    res.json(publicState(room, player.id));
  });
  return router;
}
