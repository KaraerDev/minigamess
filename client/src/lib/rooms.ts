import {
  get,
  onValue,
  ref,
  runTransaction,
  update,
  type DataSnapshot,
} from "firebase/database";
import {
  AVATARS,
  CATEGORIES,
  GAME_TITLES,
  MAX_PLAYERS,
  MEMORY_HIDE_AFTER,
  MIN_PLAYERS,
  RECAP_DURATION,
  VALID_ROUNDS,
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
  type GameId,
  type Recap,
  type RoundData,
  type Stroke,
} from "@shared/game";
import { ensurePlayerUid, getDb } from "./firebase";

// ---------------------------------------------------------------------------
// Tipler (arayüzün kullandığı oda durumu)
// ---------------------------------------------------------------------------

export type RoomPlayer = {
  id: string;
  nickname: string;
  avatar: string;
  score: number;
  ready: boolean;
  isOwner: boolean;
  hasAnswered: boolean;
};

export type RoomRound = {
  gameId: GameId;
  title: string;
  number: number;
  totalRounds: number;
  endsAt: number | null;
  prompt: string | null;
  drawerId?: string | null;
  drawerName?: string | null;
  isDrawer?: boolean;
  word?: string;
  strokes?: Stroke[];
  letter?: string;
  categories?: string[];
  wordAnswers?: string | Record<string, string> | null;
  wordAnswered?: boolean;
  inkName?: string;
  inkHex?: string;
  colorOptions?: { name: string; hex: string }[];
  memoryHidden?: boolean;
  hasAnswered?: boolean;
  correctCount?: number;
  answerCount?: number;
  totalPlayers?: number;
  myAnswer?: string;
  myDrawResult?: { correct: boolean } | null;
};

export type RoomState = {
  code: string;
  status: "lobby" | "playing" | "finished";
  phase: "lobby" | "round" | "recap" | "finished";
  ownerId: string;
  gameId: GameId;
  gameTitle: string;
  rounds: number;
  currentRound: number;
  players: RoomPlayer[];
  me: { id: string; nickname: string; avatar: string } | null;
  round: RoomRound | null;
  recap: Recap | null;
  canStart: boolean;
};

export type Profile = { nickname: string; avatar: string };

// ---------------------------------------------------------------------------
// RTDB şeması:
//
//   oyunoda/rooms/{kod}/{meta, players, round, recap} (giriş yapmış herkes okur)
//   oyunoda/secrets/{kod}                             (tur sırrı; kuralla korumalı)
// ---------------------------------------------------------------------------

type DbRoom = {
  meta?: {
    gameId?: GameId;
    rounds?: number;
    status?: RoomState["status"];
    phase?: RoomState["phase"];
    round?: number;
    ownerId?: string;
    createdAt?: number;
    endsAt?: number | null;
  };
  players?: Record<string, { nickname?: string; avatar?: string; score?: number; ready?: boolean }>;
  round?: (Omit<RoundData, "target" | "word"> & {
    number?: number;
    totalRounds?: number;
    endsAt?: number | null;
    guesses?: Record<string, { text?: string; at?: number }>;
    results?: Record<string, { correct?: boolean; at?: number }>;
  }) | null;
  recap?: Recap | null;
};

type DbSecret = { word?: string; target?: string } | null;

const roomRef = (code: string) => ref(getDb(), `oyunoda/rooms/${code}`);
const secretRef = (code: string) => ref(getDb(), `oyunoda/secrets/${code}`);

/** Kök referansa çok-yollu yazım (rooms/* + secrets/* atomik güncellenir). */
function rootUpdate(patch: Record<string, unknown>): Promise<void> {
  return update(ref(getDb()), patch);
}

/** {a,b} -> {"round/a":..., "round/b":...} (kurallar alan bazında çalışır). */
function prefixed(base: string, value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, val]) => [`${base}/${key}`, val === undefined ? null : val]),
  );
}

function toRoomState(code: string, uid: string, db: DbRoom | null, secret: DbSecret): RoomState | null {
  if (!db?.meta) return null;
  const meta = db.meta;
  const gameId: GameId = validGame(meta.gameId) ? meta.gameId : "draw";
  const rawPlayers = db.players ?? {};
  const round = db.round ?? null;

  const players: RoomPlayer[] = Object.entries(rawPlayers).map(([id, p]) => ({
    id,
    nickname: p.nickname ?? "Oyuncu",
    avatar: p.avatar ?? AVATARS[0],
    score: p.score ?? 0,
    ready: Boolean(p.ready),
    isOwner: id === meta.ownerId,
    hasAnswered: Boolean(
      (round?.submissions as Record<string, unknown> | undefined)?.[id] ??
        (round?.correctOrder as string[] | undefined)?.includes(id),
    ),
  }));
  players.sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, "tr"));

  const meRaw = rawPlayers[uid];
  const me = meRaw ? { id: uid, nickname: meRaw.nickname ?? "", avatar: meRaw.avatar ?? AVATARS[0] } : null;
  const isDrawer = Boolean(round && (round.drawerId ?? null) === uid);
  const mySubmission = (round?.submissions as Record<string, { value?: unknown }> | undefined)?.[uid];

  let roomRound: RoomRound | null = null;
  if (meta.status === "playing" && round) {
    roomRound = {
      gameId,
      title: round.title ?? GAME_TITLES[gameId],
      number: round.number ?? meta.round ?? 0,
      totalRounds: round.totalRounds ?? meta.rounds ?? 3,
      endsAt: round.endsAt ?? meta.endsAt ?? null,
      prompt: gameId === "memory" && round.memoryHidden ? null : (round.prompt ?? null),
      drawerId: round.drawerId ?? null,
      drawerName: round.drawerId ? (rawPlayers[round.drawerId]?.nickname ?? "Oyuncu") : null,
      isDrawer,
      word: gameId === "draw" && isDrawer ? secret?.word : undefined,
      strokes: round.strokes ?? [],
      letter: round.letter,
      categories: gameId === "words" ? CATEGORIES : undefined,
      wordAnswers: (mySubmission?.value as RoomRound["wordAnswers"]) ?? null,
      wordAnswered: Boolean(mySubmission),
      inkName: round.inkHex ? round.inkName : round.inkName,
      inkHex: round.inkHex,
      colorOptions: round.colorOptions,
      memoryHidden: round.memoryHidden ?? false,
      hasAnswered: Boolean(mySubmission) || Boolean((round.correctOrder ?? []).includes(uid)),
      correctCount: (round.correctOrder ?? []).length || Object.keys(round.submissions ?? {}).length,
      answerCount: Object.keys(round.submissions ?? {}).length,
      totalPlayers: players.length,
      myAnswer: typeof mySubmission?.value === "string" ? (mySubmission.value as string) : undefined,
      myDrawResult: round.results?.[uid] ? { correct: Boolean(round.results[uid].correct) } : null,
    };
  }

  return {
    code,
    status: meta.status ?? "lobby",
    phase: meta.phase ?? "lobby",
    ownerId: meta.ownerId ?? "",
    gameId,
    gameTitle: GAME_TITLES[gameId],
    rounds: meta.rounds ?? 3,
    currentRound: meta.round ?? 0,
    players,
    me,
    round: roomRound,
    recap: db.recap ?? null,
    canStart: meta.status === "lobby" && players.length >= MIN_PLAYERS && players.every((p) => p.ready),
  };
}

// ---------------------------------------------------------------------------
// Oda işlemleri
// ---------------------------------------------------------------------------

function normalizeProfile(profile: Profile): { nickname: string; avatar: string } {
  const nickname = cleanText(profile.nickname, 18);
  if (!nickname) throw new Error("Önce kendine bir takma ad seç.");
  const avatar = AVATARS.includes(profile.avatar) ? profile.avatar : AVATARS[0];
  return { nickname, avatar };
}

export async function ensurePlayerUidSafe(): Promise<string> {
  return ensurePlayerUid();
}

async function claimCode(uid: string, metaBase: Record<string, unknown>): Promise<string> {
  const db = getDb();
  for (let attempt = 0; attempt < 12; attempt++) {
    const existing = await get(ref(db, "oyunoda/rooms"));
    const taken = (code: string) => Boolean((existing.val() as Record<string, unknown> | null)?.[code]);
    const code = randomCode(taken);
    // Talebi ve ilk meta yazımını tek transaction'da yapar (kurallar tam metayı ister).
    const result = await runTransaction(ref(db, `oyunoda/rooms/${code}/meta`), (current) => {
      if (current) return undefined; // başkası kapmış, vazgeç
      return { ...metaBase, ownerId: uid };
    });
    if (result.committed) return code;
  }
  throw new Error("Oda kodu üretilemedi, yeniden dene.");
}

export async function createRoom(
  profile: Profile,
  gameId: GameId,
  rounds: number,
): Promise<{ code: string; uid: string }> {
  const { nickname, avatar } = normalizeProfile(profile);
  const uid = await ensurePlayerUid();
  const safeGame: GameId = validGame(gameId) ? gameId : "draw";
  const safeRounds = VALID_ROUNDS.includes(rounds) ? rounds : 3;
  const code = await claimCode(uid, {
    gameId: safeGame,
    rounds: safeRounds,
    status: "lobby",
    phase: "lobby",
    round: 0,
    createdAt: Date.now(),
  });
  await rootUpdate({
    [`oyunoda/rooms/${code}/players/${uid}`]: { nickname, avatar, score: 0, ready: true },
  });
  return { code, uid };
}

export async function joinRoom(code: string, profile: Profile): Promise<{ code: string; uid: string }> {
  const clean = safeCode(code);
  if (clean.length < 4) throw new Error("Oda kodu dört harf veya rakam olmalı.");
  const { nickname, avatar } = normalizeProfile(profile);
  const uid = await ensurePlayerUid();
  // Önce oku (izinli yol), sonra yalnızca kendi oyuncu düğümüne transaction yap.
  // ($code seviyesinde yazma kuralı yoktur; kapasite kontrolü burada + kurallar
  // lobide-katılımı zorlar. Aynı anda dolan odada 1 kişi fazla girebilir; prototip payı.)
  const snap = await get(roomRef(clean));
  const room = snap.val() as DbRoom | null;
  if (!room?.meta) throw new Error("Bu oda kodunu bulamadım. Kodu yeniden kontrol et.");
  if (room.meta.status !== "lobby") throw new Error("Bu oyun çoktan başlamış. Yeni bir oda açın.");
  const count = Object.keys(room.players ?? {}).length;
  if (!room.players?.[uid] && count >= MAX_PLAYERS) {
    throw new Error("Bu masa doldu; en fazla 8 kişi oynayabilir.");
  }
  const playerPath = ref(getDb(), `oyunoda/rooms/${clean}/players/${uid}`);
  const result = await runTransaction(playerPath, (current) => {
    if (current) return undefined; // zaten listede (yeniden katılım)
    return { nickname, avatar, score: 0, ready: false };
  });
  if (!result.committed) {
    const rejoin = await get(playerPath);
    if (!rejoin.val()) throw new Error("Odaya katılınamadı, yeniden dene.");
  }
  return { code: clean, uid };
}

export function subscribeRoom(code: string, uid: string, cb: (room: RoomState | null) => void): () => void {
  let roomSnap: DbRoom | null = null;
  let secretSnap: DbSecret = null;
  let roomReady = false;
  let secretReady = false;
  const emit = () => {
    if (!roomReady || !secretReady) return;
    cb(roomSnap ? toRoomState(code, uid, roomSnap, secretSnap) : null);
  };
  const offRoom = onValue(roomRef(code), (snap: DataSnapshot) => {
    roomSnap = snap.val() as DbRoom | null;
    roomReady = true;
    emit();
  });
  const offSecret = onValue(
    secretRef(code),
    (snap: DataSnapshot) => {
      secretSnap = snap.val() as DbSecret;
      secretReady = true;
      emit();
    },
    () => {
      // Sır okuma izni yoksa (tur sırrı) sırsız devam et.
      secretSnap = null;
      secretReady = true;
      emit();
    },
  );
  return () => {
    offRoom();
    offSecret();
  };
}

export async function toggleReady(code: string, uid: string): Promise<void> {
  const snap = await get(roomRef(code));
  const room = snap.val() as DbRoom | null;
  if (room?.meta?.status !== "lobby" || !room.players?.[uid]) {
    throw new Error("Hazırlık lobisi artık açık değil.");
  }
  await rootUpdate({ [`oyunoda/rooms/${code}/players/${uid}/ready`]: !room.players[uid].ready });
}

export async function updateSettings(
  code: string,
  uid: string,
  values: { gameId?: GameId; rounds?: number },
): Promise<void> {
  const snap = await get(ref(getDb(), `oyunoda/rooms/${code}/meta`));
  const meta = snap.val() as DbRoom["meta"];
  if (!meta || meta.status !== "lobby") throw new Error("Oyun ayarları yalnızca lobide değiştirilebilir.");
  if (meta.ownerId !== uid) throw new Error("Oyun ayarlarını yalnızca oda sahibi değiştirebilir.");
  const patch: Record<string, unknown> = {};
  if (values.gameId !== undefined) {
    if (!validGame(values.gameId)) throw new Error("Geçerli bir oyun seç.");
    patch[`oyunoda/rooms/${code}/meta/gameId`] = values.gameId;
  }
  if (values.rounds !== undefined) {
    if (!VALID_ROUNDS.includes(values.rounds)) throw new Error("Tur sayısı 3, 5 veya 8 olabilir.");
    patch[`oyunoda/rooms/${code}/meta/rounds`] = values.rounds;
  }
  if (Object.keys(patch).length) await rootUpdate(patch);
}

/** Faz geçişini transaction ile tek-kazananlı yapar. */
async function claimPhase(code: string, from: string, to: string): Promise<boolean> {
  const result = await runTransaction(ref(getDb(), `oyunoda/rooms/${code}/meta`), (meta) => {
    const m = meta as DbRoom["meta"] | null;
    if (!m || m.phase !== from) return undefined;
    return { ...m, phase: to };
  });
  return result.committed;
}

export async function startGame(code: string, uid: string): Promise<void> {
  const snap = await get(roomRef(code));
  const room = snap.val() as DbRoom | null;
  if (!room?.meta || room.meta.status !== "lobby") throw new Error("Bu oda şu an başlatılamıyor.");
  if (room.meta.ownerId !== uid) throw new Error("Oyunu yalnızca oda sahibi başlatabilir.");
  const players = Object.entries(room.players ?? {}).map(([id, p]) => ({
    id,
    nickname: p.nickname ?? "Oyuncu",
    avatar: p.avatar ?? AVATARS[0],
    score: 0,
    ready: false,
  }));
  if (players.length < MIN_PLAYERS) throw new Error("Başlamak için en az iki oyuncu lazım.");
  if (!Object.values(room.players ?? {}).every((p) => p.ready)) {
    throw new Error("Herkes hazır olduğunda oyun başlar.");
  }
  const gameId = validGame(room.meta.gameId) ? room.meta.gameId : "draw";
  const { data, secret, durationMs } = createRound(gameId, 1, players);
  if (!(await claimPhase(code, "lobby", "round"))) throw new Error("Oyun zaten başlatılmış.");
  const endsAt = Date.now() + durationMs;
  await rootUpdate({
    ...Object.fromEntries(players.map((p) => [`oyunoda/rooms/${code}/players/${p.id}/score`, 0])),
    ...Object.fromEntries(players.map((p) => [`oyunoda/rooms/${code}/players/${p.id}/ready`, false])),
    [`oyunoda/rooms/${code}/meta/status`]: "playing",
    [`oyunoda/rooms/${code}/meta/round`]: 1,
    [`oyunoda/rooms/${code}/meta/endsAt`]: endsAt,
    ...roundPatch(code, data, { number: 1, totalRounds: room.meta.rounds ?? 3, endsAt }),
    [`oyunoda/secrets/${code}`]: secret,
    [`oyunoda/rooms/${code}/recap`]: null,
  });
}

/** Herkese açık tur düğümünden sırları çıkarır. */
function stripSecrets(data: RoundData) {
  const { target: _t, word: _w, ...rest } = data;
  void _t;
  void _w;
  return rest;
}

/**
 * Tur oluşturma yaması: boş koleksiyonlar (strokes/submissions/correctOrder) yazılmaz.
 * Kurallar alan bazında çalıştığı için boş nesne/dizi yazmak reddedilebilir;
 * bu alanlar ilk kullanımda kendi kurallarıyla oluşur.
 */
function roundPatch(code: string, data: RoundData, extra: Record<string, unknown>): Record<string, unknown> {
  const { submissions, correctOrder, strokes, ...rest } = stripSecrets(data);
  void submissions;
  void correctOrder;
  const patch = prefixed(`oyunoda/rooms/${code}/round`, { ...rest, ...extra });
  if (strokes.length) patch[`oyunoda/rooms/${code}/round/strokes`] = strokes;
  return patch;
}

export async function nextRound(code: string, uid: string): Promise<void> {
  const snap = await get(roomRef(code));
  const room = snap.val() as DbRoom | null;
  if (!room?.meta || room.meta.status !== "playing" || room.meta.phase !== "recap") {
    throw new Error("Bir sonraki tura geçiş zamanı değil.");
  }
  if (room.meta.ownerId !== uid) throw new Error("Bir sonraki turu oda sahibi başlatabilir.");
  if (!(await claimPhase(code, "recap", "advancing"))) {
    throw new Error("Bir sonraki tura geçiş zamanı değil.");
  }
  const fresh = await get(roomRef(code));
  const freshRoom = fresh.val() as DbRoom | null;
  if (!freshRoom) throw new Error("Bir sonraki tura geçiş zamanı değil.");
  await advanceFrom(freshRoom, code);
}

export async function playAgain(code: string, uid: string): Promise<void> {
  const snap = await get(roomRef(code));
  const room = snap.val() as DbRoom | null;
  if (!room?.meta || room.meta.status !== "finished") {
    throw new Error("Rövanş için önce oyunun bitmesi gerekiyor.");
  }
  if (room.meta.ownerId !== uid) throw new Error("Rövanşı oda sahibi başlatabilir.");
  await rootUpdate({
    ...Object.fromEntries(
      Object.keys(room.players ?? {}).map((id) => [
        `oyunoda/rooms/${code}/players/${id}`,
        {
          nickname: room.players?.[id]?.nickname ?? "Oyuncu",
          avatar: room.players?.[id]?.avatar ?? AVATARS[0],
          score: 0,
          ready: id === room.meta?.ownerId,
        },
      ]),
    ),
    [`oyunoda/rooms/${code}/meta/status`]: "lobby",
    [`oyunoda/rooms/${code}/meta/phase`]: "lobby",
    [`oyunoda/rooms/${code}/meta/round`]: 0,
    [`oyunoda/rooms/${code}/meta/endsAt`]: null,
    [`oyunoda/rooms/${code}/round`]: null,
    [`oyunoda/rooms/${code}/recap`]: null,
    [`oyunoda/secrets/${code}`]: null,
  });
}

// ---------------------------------------------------------------------------
// Tur içi gönderimler
// ---------------------------------------------------------------------------

export async function pushStroke(code: string, uid: string, stroke: Stroke): Promise<void> {
  const snap = await get(roomRef(code));
  const room = snap.val() as DbRoom | null;
  const round = room?.round;
  if (!room || room.meta?.status !== "playing" || room.meta?.phase !== "round" || !round) {
    throw new Error("Şu anda çizim turu yok.");
  }
  if (round.drawerId !== uid) throw new Error("Bu turda kalem çizerde.");
  const strokes = [...(round.strokes ?? []), stroke].slice(-80);
  await rootUpdate({ [`oyunoda/rooms/${code}/round/strokes`]: strokes });
}

export async function clearBoard(code: string, uid: string): Promise<void> {
  const snap = await get(roomRef(code));
  const room = snap.val() as DbRoom | null;
  if (room?.round?.drawerId !== uid) throw new Error("Tahtayı bu turdaki çizer temizleyebilir.");
  await rootUpdate({ [`oyunoda/rooms/${code}/round/strokes`]: [] });
}

/** Çiz-tahmin: tahmin yazılır; sonucu çizer-istemci hakem olarak işler. */
export async function submitDrawGuess(code: string, uid: string, guess: string): Promise<void> {
  const text = cleanText(guess, 48);
  if (!text) throw new Error("Bir tahmin yaz.");
  const snap = await get(roomRef(code));
  const room = snap.val() as DbRoom | null;
  const round = room?.round;
  if (!room || room.meta?.phase !== "round" || !round || room.meta?.gameId !== "draw") {
    throw new Error("Tahmin turu şu anda açık değil.");
  }
  if (round.drawerId === uid) throw new Error("Çizer bu turda kelimeyi biliyor zaten.");
  if ((round.correctOrder ?? []).includes(uid)) throw new Error("Kelimeyi zaten buldun!");
  await rootUpdate({ [`oyunoda/rooms/${code}/round/guesses/${uid}`]: { text, at: Date.now() } });
}

export async function submitWords(code: string, uid: string, answers: Record<string, string>): Promise<void> {
  const values = Object.fromEntries(CATEGORIES.map((c) => [c, cleanText(answers[c], 32)]));
  if (!Object.values(values).some(Boolean)) throw new Error("En az bir kategoriye cevap yaz.");
  await submitOnce(code, uid, "words", values);
}

export async function submitColor(code: string, uid: string, answerName: string): Promise<void> {
  const snap = await get(roomRef(code));
  const room = snap.val() as DbRoom | null;
  const options = (room?.round?.colorOptions ?? []) as { name: string; hex: string }[];
  if (!options.some((c) => c.name === answerName)) throw new Error("Ekrandaki renklerden birini seç.");
  await submitOnce(code, uid, "colors", answerName);
}

export async function submitMemory(code: string, uid: string, answer: string): Promise<void> {
  const text = cleanText(answer, 20).replace(/\s+/g, "");
  if (!text) throw new Error("Hatırladığın sayı dizisini yaz.");
  await submitOnce(code, uid, "memory", text);
}

async function submitOnce(code: string, uid: string, gameId: GameId, value: unknown): Promise<void> {
  const snap = await get(roomRef(code));
  const room = snap.val() as DbRoom | null;
  const round = room?.round;
  if (!room || room.meta?.status !== "playing" || room.meta?.phase !== "round" || !round) {
    throw new Error("Bu tur cevap kabul etmiyor.");
  }
  if (room.meta?.gameId !== gameId) throw new Error("Bu tur cevap kabul etmiyor.");
  if (gameId === "memory" && !round.memoryHidden) throw new Error("Sayılar henüz saklanmadı.");
  if ((round.submissions as Record<string, unknown> | undefined)?.[uid]) {
    throw new Error("Cevabın bu tur için kaydedildi.");
  }
  const result = await runTransaction(ref(getDb(), `oyunoda/rooms/${code}/round/submissions/${uid}`), (current) => {
    if (current) return undefined;
    return { value, at: Date.now() };
  });
  if (!result.committed) throw new Error("Cevabın bu tur için kaydedildi.");
  // Herkes verdiyse turu bitirmeyi dene (tek kazananlı).
  const after = await get(roomRef(code));
  const r = after.val() as DbRoom | null;
  const playerCount = Object.keys(r?.players ?? {}).length;
  const answerCount = Object.keys((r?.round?.submissions as Record<string, unknown> | undefined) ?? {}).length;
  if (playerCount > 0 && answerCount >= playerCount) {
    await finishRound(code, "Herkes cevabını verdi!");
  }
}

// ---------------------------------------------------------------------------
// Sürücü: süre bitimi, özet ve tur ilerletme (tüm istemciler çalıştırır,
// kritik geçişler transaction ile tek-kazananlıdır)
// ---------------------------------------------------------------------------

export function startDriver(code: string, uid: string): () => void {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const judged = new Set<string>();

  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      void fn();
    }, Math.max(0, ms));
    timers.add(t);
  };

  const unsubscribe = onValue(roomRef(code), (snap: DataSnapshot) => {
    const room = snap.val() as DbRoom | null;
    if (!room?.meta) return;
    const { meta, round } = room;

    if (meta.status === "playing" && meta.phase === "round" && round) {
      const endsAt = (round.endsAt ?? meta.endsAt ?? 0) as number;
      if (endsAt > 0) later(endsAt - Date.now(), () => void finishRound(code));
      if (meta.gameId === "memory" && !round.memoryHidden) {
        later(MEMORY_HIDE_AFTER, async () => {
          const cur = (await get(roomRef(code))).val() as DbRoom | null;
          if (cur?.meta?.phase === "round" && cur.round && !cur.round.memoryHidden) {
            await rootUpdate({ [`oyunoda/rooms/${code}/round/memoryHidden`]: true });
          }
        });
      }
      if (meta.gameId === "draw" && round.drawerId === uid) {
        void judgeDrawGuesses(code, uid, judged);
      }
    }
    if (meta.status === "playing" && meta.phase === "recap") {
      const endsAt = (meta.endsAt ?? 0) as number;
      if (endsAt > 0) later(endsAt - Date.now(), () => void advanceFromRemote(code));
    }
  });

  return () => {
    unsubscribe();
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}

/** Çizer-istemci: tahminleri kelimeyle karşılaştırıp sonuçları yazar. */
async function judgeDrawGuesses(code: string, uid: string, judged: Set<string>): Promise<void> {
  const snap = await get(roomRef(code));
  const room = snap.val() as DbRoom | null;
  const round = room?.round as
    | (NonNullable<DbRoom["round"]> & { guesses?: Record<string, { text?: string; at?: number }> })
    | null;
  const secretSnap = await get(secretRef(code)).catch(() => null);
  const secret = (secretSnap?.val() ?? null) as DbSecret;
  if (!room || room.meta?.phase !== "round" || !round || round.drawerId !== uid || !secret?.word) return;
  const guesses = round.guesses ?? {};
  const correctOrder = [...((round.correctOrder ?? []) as string[])];
  const playerIds = Object.keys(room.players ?? {}).filter((id) => id !== uid);

  for (const [pid, guess] of Object.entries(guesses)) {
    const key = `${round.number ?? 0}:${pid}:${guess.at ?? 0}`;
    if (judged.has(key)) continue;
    judged.add(key);
    if (correctOrder.includes(pid)) continue;
    const text = cleanText(guess.text, 48);
    if (!text) continue;
    if (normalized(text) === normalized(secret.word)) {
      correctOrder.push(pid);
      const endsAt = (round.endsAt ?? room.meta?.endsAt ?? Date.now()) as number;
      const points = drawGuessPoints(endsAt, guess.at ?? Date.now());
      await runTransaction(ref(getDb(), `oyunoda/rooms/${code}/players/${pid}/score`), (s) => ((s as number) ?? 0) + points);
      await rootUpdate({
        [`oyunoda/rooms/${code}/round/correctOrder`]: correctOrder,
        [`oyunoda/rooms/${code}/round/results/${pid}`]: { correct: true, at: Date.now() },
      });
    } else {
      await rootUpdate({ [`oyunoda/rooms/${code}/round/results/${pid}`]: { correct: false, at: Date.now() } });
    }
  }
  const current = (await get(roomRef(code))).val() as DbRoom | null;
  const order = ((current?.round?.correctOrder ?? []) as string[]).length;
  if (current?.meta?.phase === "round" && order >= playerIds.length && playerIds.length > 0) {
    await finishRound(code, "Herkes kelimeyi kapmış!");
  }
}

/** Süre dolumu veya tüm-cevap durumunda turu bitirir (tek kazananlı). */
export async function finishRound(code: string, message = "Süre doldu!"): Promise<void> {
  if (!(await claimPhase(code, "round", "finishing"))) return;
  const snap = await get(roomRef(code));
  const room = snap.val() as DbRoom | null;
  if (!room?.meta || !room.round) return;
  const secretSnap = await get(secretRef(code)).catch(() => null);
  const secret = ((secretSnap?.val() ?? {}) as { word?: string; target?: string });
  const gameId = validGame(room.meta.gameId) ? room.meta.gameId : "draw";
  const players = Object.entries(room.players ?? {}).map(([id, p]) => ({
    id,
    nickname: p.nickname ?? "Oyuncu",
    avatar: p.avatar ?? AVATARS[0],
    score: p.score ?? 0,
    ready: Boolean(p.ready),
  }));
  const roundFull: RoundData = {
    ...(room.round as RoundData),
    word: secret.word ?? (room.round as { word?: string }).word,
    target: secret.target ?? (room.round as { target?: string }).target,
  };
  // Renk/hafıza cevaplarının doğruluğu bitişte netleşir (sır o ana kadar gizlidir).
  const submissions = { ...(roundFull.submissions ?? {}) };
  if (gameId === "colors") {
    for (const sub of Object.values(submissions)) {
      sub.correct = isCorrectColor(secret.target, String((sub.value as string) ?? ""));
    }
  } else if (gameId === "memory") {
    for (const sub of Object.values(submissions)) {
      sub.correct = isCorrectMemory(secret.target, String((sub.value as string) ?? ""));
    }
  }
  const { gained, details } = scoreRound(gameId, { ...roundFull, submissions }, players);
  const roundNumber = (room.round.number ?? room.meta.round ?? 1) as number;
  // Doğruluk bayrakları tek tek yazılır (toptan submissions yazımının kuralı yoktur).
  const correctPatch: Record<string, unknown> = {};
  if (gameId === "colors" || gameId === "memory") {
    for (const [pid, sub] of Object.entries(submissions)) {
      correctPatch[`oyunoda/rooms/${code}/round/submissions/${pid}/correct`] = Boolean(sub.correct);
    }
  }
  await rootUpdate({
    ...Object.fromEntries(
      players.map((p) => [`oyunoda/rooms/${code}/players/${p.id}/score`, p.score + (gained[p.id] ?? 0)]),
    ),
    [`oyunoda/rooms/${code}/meta/phase`]: "recap",
    [`oyunoda/rooms/${code}/meta/endsAt`]: Date.now() + RECAP_DURATION,
    ...correctPatch,
    [`oyunoda/rooms/${code}/recap`]: { title: `${roundNumber}. turun özeti`, message, details },
  });
}

async function advanceFromRemote(code: string): Promise<void> {
  if (!(await claimPhase(code, "recap", "advancing"))) return;
  const snap = await get(roomRef(code));
  const room = snap.val() as DbRoom | null;
  if (!room?.meta) return;
  await advanceFrom(room, code);
}

async function advanceFrom(room: DbRoom, code: string): Promise<void> {
  const meta = room.meta as NonNullable<DbRoom["meta"]>;
  if (meta.status !== "playing") return;
  const totalRounds = meta.rounds ?? 3;
  const current = meta.round ?? 0;
  if (current >= totalRounds) {
    await rootUpdate({
      [`oyunoda/rooms/${code}/meta/status`]: "finished",
      [`oyunoda/rooms/${code}/meta/phase`]: "finished",
      [`oyunoda/rooms/${code}/meta/endsAt`]: null,
      [`oyunoda/rooms/${code}/recap`]: {
        title: "Son düdük!",
        message: "Piknik örtüsünde günün yıldızı belli oldu.",
        details: (room.recap?.details ?? []) as string[],
      },
    });
    return;
  }
  const players = Object.entries(room.players ?? {}).map(([id, p]) => ({
    id,
    nickname: p.nickname ?? "Oyuncu",
    avatar: p.avatar ?? AVATARS[0],
    score: p.score ?? 0,
    ready: false,
  }));
  const gameId = validGame(meta.gameId) ? meta.gameId : "draw";
  const { data, secret, durationMs } = createRound(gameId, current + 1, players);
  const endsAt = Date.now() + durationMs;
  await rootUpdate({
    [`oyunoda/rooms/${code}/meta/phase`]: "round",
    [`oyunoda/rooms/${code}/meta/round`]: current + 1,
    [`oyunoda/rooms/${code}/meta/endsAt`]: endsAt,
    ...roundPatch(code, data, { number: current + 1, totalRounds, endsAt }),
    [`oyunoda/secrets/${code}`]: secret,
    [`oyunoda/rooms/${code}/recap`]: null,
  });
}
