import { beforeAll, afterAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";
import { createGameRouter } from "./gameRooms";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/game", createGameRouter());
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api/game`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function post(path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function createRoom(overrides: Record<string, unknown> = {}) {
  const { status, payload } = await post("/rooms", {
    nickname: "Ev Sahibi",
    avatar: "🐸",
    gameId: "draw",
    rounds: 3,
    ...overrides,
  });
  expect(status).toBe(201);
  return payload as { code: string; players: { id: string }[]; me: { id: string } };
}

describe("game rooms lobby flow", () => {
  it("rejects room creation without a nickname", async () => {
    const { status, payload } = await post("/rooms", { nickname: "   " });
    expect(status).toBe(400);
    expect(payload.error).toBeTruthy();
  });

  it("creates a lobby room with a 4-char code", async () => {
    const room = await createRoom();
    expect(room.code).toMatch(/^[A-Z0-9]{4}$/);
  });

  it("returns 404 for unknown room codes", async () => {
    const { status } = await post("/rooms/ZZZZ/join", { nickname: "Misafir" });
    expect(status).toBe(404);
  });

  it("rejects invalid settings values", async () => {
    const room = await createRoom();
    const ownerId = room.me.id;
    const badGame = await post(`/rooms/${room.code}/settings`, { playerId: ownerId, gameId: "satranç" });
    expect(badGame.status).toBe(400);
    const badRounds = await post(`/rooms/${room.code}/settings`, { playerId: ownerId, rounds: 7 });
    expect(badRounds.status).toBe(400);
  });

  it("blocks non-owners from changing settings", async () => {
    const room = await createRoom();
    const joined = await post(`/rooms/${room.code}/join`, { nickname: "Misafir", avatar: "🦊" });
    expect(joined.status).toBe(201);
    const guestId = (joined.payload as { me: { id: string } }).me.id;
    const { status } = await post(`/rooms/${room.code}/settings`, { playerId: guestId, gameId: "words" });
    expect(status).toBe(403);
  });

  it("rejects gameplay endpoints while still in the lobby", async () => {
    const room = await createRoom();
    const ownerId = room.me.id;
    const guess = await post(`/rooms/${room.code}/guess`, { playerId: ownerId, guess: "karpuz" });
    expect(guess.status).toBe(409);
    const answer = await post(`/rooms/${room.code}/answer`, { playerId: ownerId, answer: "Kırmızı" });
    expect(answer.status).toBe(409);
    const next = await post(`/rooms/${room.code}/next`, { playerId: ownerId });
    expect(next.status).toBe(409);
    const again = await post(`/rooms/${room.code}/play-again`, { playerId: ownerId });
    expect(again.status).toBe(409);
  });

  it("requires everyone ready, then starts and locks the lobby", async () => {
    const room = await createRoom();
    const ownerId = room.me.id;

    const joined = await post(`/rooms/${room.code}/join`, { nickname: "Misafir", avatar: "🦊" });
    expect(joined.status).toBe(201);
    const guestId = (joined.payload as { me: { id: string } }).me.id;

    // Owner is ready, guest is not -> start must fail.
    const early = await post(`/rooms/${room.code}/start`, { playerId: ownerId });
    expect(early.status).toBe(409);

    // Guest toggles ready, then owner can start.
    const ready = await post(`/rooms/${room.code}/ready`, { playerId: guestId });
    expect(ready.status).toBe(200);

    const guestStart = await post(`/rooms/${room.code}/start`, { playerId: guestId });
    expect(guestStart.status).toBe(403);

    const started = await post(`/rooms/${room.code}/start`, { playerId: ownerId });
    expect(started.status).toBe(200);
    expect(started.payload.status).toBe("playing");

    // Lobby is now closed for newcomers.
    const late = await post(`/rooms/${room.code}/join`, { nickname: "Geç Kalan" });
    expect(late.status).toBe(409);
  });
});
