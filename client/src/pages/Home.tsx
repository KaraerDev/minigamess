import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from "react";
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, Clock3, Copy, Crown,
  DoorOpen, Gamepad2, HelpCircle, Link2, Medal, Pencil, Play, RefreshCw,
  Send, Sparkles, Star, Users, Volume2, X,
} from "lucide-react";
import { isFirebaseConfigured } from "@/lib/firebase";
import {
  clearBoard,
  createRoom as apiCreateRoom,
  joinRoom as apiJoinRoom,
  nextRound,
  playAgain,
  pushStroke,
  startDriver,
  startGame,
  submitColor as apiSubmitColor,
  submitDrawGuess as apiSubmitDrawGuess,
  submitMemory as apiSubmitMemory,
  submitWords as apiSubmitWords,
  subscribeRoom,
  toggleReady,
  updateSettings as apiUpdateSettings,
  ensurePlayerUidSafe,
  type Profile,
  type RoomState,
} from "@/lib/rooms";
import type { GameId, Stroke } from "@shared/game";

const avatars = ["🐸", "🦊", "🐻", "🐼", "🐙", "🐧", "🦝", "🐝"];
const games: { id: GameId; title: string; description: string; icon: string; tag: string; color: string; time: string }[] = [
  { id: "draw", title: "Çiz Bakalım", description: "Kalemi kap, gizli kelimeyi çiz; arkadaşların süre dolmadan bulsun.", icon: "✎", tag: "ÇİZ & TAHMİN ET", color: "tomato", time: "65 sn" },
  { id: "words", title: "Harf Kapmaca", description: "Aynı harfle başlayan şehir, hayvan, yemek ve eşya kapışması.", icon: "Aa", tag: "KELİME YARIŞI", color: "leaf", time: "60 sn" },
  { id: "colors", title: "Renk Refleksi", description: "Kelimeye aldanma: yazının mürekkep rengini ışık hızında seç.", icon: "◉", tag: "REFLEKS TURU", color: "sun", time: "40 sn" },
  { id: "memory", title: "Sayı Avı", description: "Sayılar uçup gitmeden aklında tut; diziyi eksiksiz yaz.", icon: "123", tag: "HAFIZANI YOKLA", color: "sky", time: "45 sn" },
];
const gameDuration: Record<GameId, number> = { draw: 65, words: 60, colors: 40, memory: 45 };

function Brand() {
  return (
    <a className="brand" href="/" aria-label="Oyun Odası ana sayfa">
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /><b>✦</b></span>
      <span className="brand-word"><span>OYUN</span><span>ODASI</span></span>
    </a>
  );
}

function AvatarPicker({ selected, onSelect }: { selected: string; onSelect: (avatar: string) => void }) {
  return (
    <div className="avatar-picker" role="group" aria-label="Avatarını seç">
      {avatars.map((avatar, index) => (
        <button key={avatar} type="button" className={`avatar-choice ${selected === avatar ? "is-selected" : ""}`} onClick={() => onSelect(avatar)} aria-label={`Avatar ${index + 1}: ${avatar}`} aria-pressed={selected === avatar}>{avatar}</button>
      ))}
    </div>
  );
}

function GameTile({ game, selected, onClick, compact = false }: { game: (typeof games)[number]; selected: boolean; onClick: () => void; compact?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`game-tile game-tile--${game.color} ${selected ? "is-selected" : ""} ${compact ? "game-tile--compact" : ""}`} aria-pressed={selected}>
      <span className="game-tile__icon" aria-hidden="true">{game.icon}</span>
      <span className="game-tile__text"><span className="pixel-tag">{game.tag}</span><strong>{game.title}</strong>{!compact && <small>{game.description}</small>}</span>
      {!compact && <span className="game-tile__time"><Clock3 size={13} /> {game.time}</span>}
      {selected && <span className="game-tile__check"><Check size={14} /></span>}
    </button>
  );
}

export default function Home() {
  const [profile, setProfile] = useState<Profile>(() => {
    try {
      const raw = localStorage.getItem("oyunoda-profile");
      if (raw) {
        const parsed = JSON.parse(raw) as Profile;
        if (parsed.nickname) return { nickname: parsed.nickname, avatar: parsed.avatar || avatars[0] };
      }
    } catch { /* yok say */ }
    return { nickname: "", avatar: avatars[0] };
  });
  const [selectedGame, setSelectedGame] = useState<GameId>("draw");
  const [roundCount, setRoundCount] = useState(3);
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(window.location.search).get("oda")?.toUpperCase() ?? "");
  const [uid, setUid] = useState<string | null>(null);
  const [authError, setAuthError] = useState("");
  const [code, setCode] = useState<string | null>(() => {
    try { return (JSON.parse(localStorage.getItem("oyunoda-room") ?? "null") as { code?: string } | null)?.code ?? null; }
    catch { return null; }
  });
  const [room, setRoom] = useState<RoomState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  const [guess, setGuess] = useState("");
  const [wordInputs, setWordInputs] = useState<Record<string, string>>({});
  const [memoryAnswer, setMemoryAnswer] = useState("");
  const [localDraft, setLocalDraft] = useState<{ x: number; y: number }[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [ink, setInk] = useState("#386641");
  const [copyDone, setCopyDone] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const notifyTimer = useRef<number | undefined>(undefined);
  const round = room?.round ?? null;
  const game = games.find(item => item.id === (room?.gameId ?? selectedGame)) ?? games[0];
  const amHost = Boolean(room && uid && room.ownerId === uid);
  const sortedPlayers = useMemo(() => [...(room?.players ?? [])].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, "tr")), [room?.players]);
  const timeLeft = round?.endsAt ? Math.max(0, Math.ceil((round.endsAt - now) / 1000)) : 0;
  const timePercent = round?.endsAt ? Math.max(0, Math.min(100, (timeLeft / gameDuration[round.gameId]) * 100)) : 0;
  const inviteCode = new URLSearchParams(window.location.search).get("oda")?.toUpperCase();

  const notify = useCallback((message: string) => {
    setNotice(message);
    if (notifyTimer.current) window.clearTimeout(notifyTimer.current);
    notifyTimer.current = window.setTimeout(() => setNotice(""), 2700);
  }, []);

  // Anonim kimlik (kalıcı): tüm oda işlemleri bu uid ile yapılır.
  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setAuthError("Firebase yapılandırması eksik. .env dosyasına VITE_FIREBASE_* değerlerini yazın.");
      return;
    }
    ensurePlayerUidSafe().then(setUid).catch((error: unknown) => {
      setAuthError(error instanceof Error ? error.message : "Firebase bağlantısı kurulamadı.");
    });
  }, []);

  const enterRoom = useCallback((roomCode: string) => {
    localStorage.setItem("oyunoda-room", JSON.stringify({ code: roomCode }));
    localStorage.setItem("oyunoda-profile", JSON.stringify(profile));
    setCode(roomCode);
    window.history.replaceState({}, "", `/?oda=${roomCode}`);
  }, [profile]);

  // Davet bağlantısındaki kod, kayıtlı odadan farklıysa forma doldur.
  useEffect(() => {
    const linkCode = new URLSearchParams(window.location.search).get("oda")?.toUpperCase();
    if (linkCode && linkCode !== code) setJoinCode(linkCode);
  }, [code]);

  // Oda aboneliği (Realtime Database).
  useEffect(() => {
    if (!code || !uid) return;
    return subscribeRoom(code, uid, (state) => {
      if (!state || !state.me) {
        // Oda silinmiş ya da oyuncu listede yok.
        localStorage.removeItem("oyunoda-room");
        setCode(null);
        setRoom(null);
        return;
      }
      setRoom(state);
    });
  }, [code, uid]);

  // Tur sürücüsü: süre bitimi, özet ve ilerletme tüm istemcilerde çalışır.
  useEffect(() => {
    if (!code || !uid || !room?.me) return;
    return startDriver(code, uid);
  }, [code, uid, room?.me?.id]);

  useEffect(() => {
    if (!round?.endsAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [round?.endsAt]);

  // Doğru tahmin gelince kutuyu temizle.
  useEffect(() => {
    if (round?.myDrawResult?.correct) setGuess("");
  }, [round?.myDrawResult]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || round?.gameId !== "draw") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const paint = (stroke: Stroke) => {
      if (!stroke.points.length) return;
      ctx.beginPath();
      ctx.lineWidth = stroke.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = stroke.color;
      const first = stroke.points[0];
      ctx.moveTo(first.x, first.y);
      if (stroke.points.length === 1) {
        ctx.lineTo(first.x + 0.1, first.y + 0.1);
      } else {
        for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
    };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fffdf8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    (round.strokes ?? []).forEach(paint);
    if (localDraft.length) paint({ points: localDraft, color: ink, width: 12 });
  }, [round?.gameId, round?.strokes, localDraft, ink]);

  const withFeedback = useCallback(async (fn: () => Promise<unknown>, success?: string) => {
    try {
      const result = await fn();
      if (success) notify(success);
      return result;
    } catch (error) {
      notify(error instanceof Error ? error.message : "İstek tamamlanamadı.");
      return null;
    }
  }, [notify]);

  const createRoom = async () => {
    if (!profile.nickname.trim()) return notify("Takma adını da yaz ki arkadaşların seni tanısın!");
    setBusy(true);
    try {
      const { code: roomCode } = await apiCreateRoom(profile, selectedGame, roundCount);
      enterRoom(roomCode);
    } catch (error) { notify(error instanceof Error ? error.message : "Oda açılamadı."); }
    finally { setBusy(false); }
  };

  const joinRoom = async (event?: FormEvent) => {
    event?.preventDefault();
    const clean = joinCode.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
    if (!profile.nickname.trim()) return notify("Önce takma adını yaz.");
    if (clean.length < 4) return notify("Oda kodu dört harf veya rakam olmalı.");
    setBusy(true);
    try {
      const { code: roomCode } = await apiJoinRoom(clean, profile);
      enterRoom(roomCode);
    } catch (error) { notify(error instanceof Error ? error.message : "Odaya katılınamadı."); }
    finally { setBusy(false); }
  };

  const copyInvite = async () => {
    if (!room) return;
    const link = `${window.location.origin}/?oda=${room.code}`;
    try { await navigator.clipboard.writeText(link); }
    catch { await navigator.clipboard.writeText(room.code).catch(() => undefined); }
    setCopyDone(true);
    window.setTimeout(() => setCopyDone(false), 1600);
    notify("Davet bağlantısı panoda. Gruba yolla!");
  };

  const leaveRoom = () => {
    localStorage.removeItem("oyunoda-room");
    setCode(null);
    setRoom(null);
    setGuess("");
    setWordInputs({});
    setMemoryAnswer("");
    window.history.replaceState({}, "", "/");
  };

  const pointerPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1000, Math.round(((event.clientX - rect.left) / rect.width) * 1000))),
      y: Math.max(0, Math.min(600, Math.round(((event.clientY - rect.top) / rect.height) * 600))),
    };
  };
  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!round?.isDrawer) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDrawing(true);
    setLocalDraft([pointerPoint(event)]);
  };
  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !round?.isDrawer) return;
    const point = pointerPoint(event);
    setLocalDraft(previous => [...previous, point].slice(-300));
  };
  const pointerUp = async (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !room || !uid || !round?.isDrawer) return;
    const points = [...localDraft, pointerPoint(event)].slice(0, 300);
    setIsDrawing(false);
    setLocalDraft([]);
    if (points.length) await withFeedback(() => pushStroke(room.code, uid, { points, color: ink, width: 12 }));
  };

  const submitGuess = async (event: FormEvent) => {
    event.preventDefault();
    if (!room || !uid || !guess.trim()) return;
    await withFeedback(() => apiSubmitDrawGuess(room.code, uid, guess.trim()));
  };
  const submitWords = async (event: FormEvent) => {
    event.preventDefault();
    if (!room || !uid || !Object.values(wordInputs).some(value => value.trim())) return notify("En az bir kutuya cevap yaz.");
    await withFeedback(() => apiSubmitWords(room.code, uid, wordInputs), "Cevapların masaya geldi. Şimdi diğerlerini bekle!");
  };
  const submitColorAnswer = async (colorName: string) => {
    if (!room || !uid || round?.hasAnswered) return;
    await withFeedback(() => apiSubmitColor(room.code, uid, colorName), "Cevabın kaydedildi. Sonuç tur özetinde!");
  };
  const submitMemory = async (event: FormEvent) => {
    event.preventDefault();
    if (!room || !uid || !memoryAnswer.trim()) return;
    const result = await withFeedback(() => apiSubmitMemory(room.code, uid, memoryAnswer), "Tahminin kaydedildi!");
    if (result !== null) setMemoryAnswer("");
  };

  const changeSettings = (values: { gameId?: GameId; rounds?: number }) => {
    if (!room || !uid) return;
    void withFeedback(() => apiUpdateSettings(room.code, uid, values));
  };

  const drawResult = round?.myDrawResult ?? null;

  return (
    <div className="app-shell">
      {!room ? (
        <>
          <header className="site-header page-width">
            <Brand />
            <div className="header-note"><span className="status-dot" /> HESAPSIZ · ÜCRETSİZ · BİRLİKTE DAHA GÜZEL</div>
            <a className="header-link" href="#oyunlar">Oyunlara göz at <ArrowRight size={15} /></a>
          </header>
          <main className="home page-width">
            {authError && (
              <div className="invite-banner" role="alert" style={{ marginBottom: 16 }}>
                <Volume2 size={15} />
                <span>{authError}</span>
              </div>
            )}
            <section className="hero-layout">
              <div className="hero-copy">
                <div className="eyebrow"><Sparkles size={15} /> ARKADAŞLARLA, TUR TUR</div>
                <h1>Bir oda kur.<br /><span>Ortalık şenlensin.</span></h1>
                <p className="hero-lede">Kodu gruba at, arkadaşları topla. Çiz, tahmin et, kapış — kahkaha zaten kendiliğinden geliyor.</p>
                <div className="hero-micro"><span><Users size={15} /> 2–8 kişi</span><i /> <span><Clock3 size={15} /> 3–8 tur</span><i /> <span>🔐 Hesap yok</span></div>
                <div className="hero-doodles" aria-hidden="true"><span className="doodle-sun">✳</span><span className="doodle-note">oyun<br />başlasın!</span></div>
              </div>
              <div className="hero-art" aria-label="Dört mini oyun masası">
                <div className="hero-art__stamp"><span>✿</span><small>BUGÜNÜN<br />PLANI</small><strong>Bolca<br />rövanş.</strong></div>
                <div className="floating-card floating-card--draw"><span className="float-icon float-icon--tomato">✎</span><div><small>EN ÇOK GÜLDÜREN</small><strong>Çiz Bakalım</strong></div><span className="float-star">✦</span></div>
                <div className="floating-card floating-card--words"><span className="float-icon float-icon--leaf">Aa</span><div><small>HIZLI DÜŞÜN</small><strong>Harf Kapmaca</strong></div><span className="float-star">✦</span></div>
                <div className="hero-art__scribble">hep birlikte<br />oynayalım <span>↙</span></div>
                <div className="hero-art__spark">✷</div>
                <div className="hero-art__badge"><span>✿</span><b>4<br />oyun</b></div>
              </div>
            </section>

            <section className="entry-board" aria-label="Oyuncu bilgisi ve oyun odası">
              <div className="entry-profile">
                <div className="section-kicker"><span>01</span> ÖNCE MERHABA DE</div>
                <label className="field-label" htmlFor="nickname">Masadaki adın</label>
                <input id="nickname" className="text-input" maxLength={18} placeholder="Örn. Piknik Kralı" value={profile.nickname} onChange={event => setProfile(current => ({ ...current, nickname: event.target.value }))} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} />
                <span className="field-hint">18 karaktere kadar, istediğin gibi.</span>
                <span className="field-label avatar-label">Bir minik karakter kap</span>
                <AvatarPicker selected={profile.avatar} onSelect={avatar => setProfile(current => ({ ...current, avatar }))} />
              </div>
              <div className="entry-actions">
                <div className="section-kicker"><span>02</span> MASAYI KUR</div>
                {inviteCode && <div className="invite-banner"><Link2 size={15} /><span>Sana bir davet var: <b>{inviteCode}</b></span><button type="button" onClick={() => setJoinCode(inviteCode)} aria-label="Davet kodunu kullan"><ArrowRight size={17} /></button></div>}
                <div className="game-pick-heading"><strong>İlk oyun hangisi olsun?</strong><span>Sonra değiştirilebilir</span></div>
                <div className="game-pick-grid">
                  {games.map(item => <GameTile key={item.id} game={item} selected={selectedGame === item.id} onClick={() => setSelectedGame(item.id)} compact />)}
                </div>
                <div className="round-pick-row"><span><Clock3 size={15} /> Kaç tur oynayalım?</span><div className="round-options">{[3, 5, 8].map(count => <button key={count} type="button" onClick={() => setRoundCount(count)} className={roundCount === count ? "is-selected" : ""} aria-pressed={roundCount === count}>{count}</button>)}</div></div>
                <button type="button" className="button button--primary button--wide" onClick={createRoom} disabled={busy || !uid}><span>{busy ? "Masa hazırlanıyor..." : "Yeni oda kur"}</span><ArrowRight size={18} /></button>
                <div className="entry-divider"><span>YA DA DAVETE KATIL</span></div>
                <form className="join-form" onSubmit={joinRoom}>
                  <label className="sr-only" htmlFor="room-code">Arkadaşının oda kodu</label>
                  <input id="room-code" className="text-input code-input" maxLength={6} placeholder="ODA KODU" value={joinCode} onChange={event => setJoinCode(event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase())} />
                  <button type="submit" className="button button--outline" disabled={busy || !uid}><span>{busy ? "Katılıyor..." : "Odaya gir"}</span><DoorOpen size={17} /></button>
                </form>
              </div>
            </section>

            <section className="game-shelf" id="oyunlar">
              <div className="shelf-heading"><div><span className="eyebrow"><span className="eyebrow-dot" /> PİKNİK SEPETİNDE</span><h2>Dört oyun. Sıfır sıkılma.</h2></div><span className="shelf-note">Kısa turlar, uzun kahkahalar <span>↘</span></span></div>
              <div className="game-shelf-grid">
                {games.map((item, index) => <button type="button" className={`shelf-card shelf-card--${item.color}`} key={item.id} onClick={() => { setSelectedGame(item.id); document.getElementById("nickname")?.focus(); }}>
                  <span className="shelf-card__top"><span>{String(index + 1).padStart(2, "0")} / 04</span><span>{item.time}</span></span>
                  <span className="shelf-card__icon">{item.icon}</span><strong>{item.title}</strong><small>{item.description}</small><span className="shelf-card__arrow"><ArrowRight size={17} /></span>
                </button>)}
              </div>
            </section>
            <footer className="site-footer"><Brand /><span>Örtüyü ser, ekibi topla. <b>Gerisi oyun.</b></span><span className="footer-pixel">✦ 386641 / ODA NO. 01</span></footer>
          </main>
        </>
      ) : room.status === "lobby" ? (
        <>
          <header className="room-header page-width"><Brand /><div className="room-header__center"><span className="status-dot" /> OYUN ODASI <b>/{room.code}</b></div><button type="button" className="back-link" onClick={leaveRoom}><ArrowLeft size={15} /> Çıkış</button></header>
          <main className="room-page page-width lobby-page">
            <div className="room-page__heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> MASA KURULUYOR</div><h1>Ekibi topla<span className="heading-period">.</span></h1><p>Kodu paylaş. Herkes otursun, hazır olan el kaldırsın.</p></div><button type="button" className={`invite-code ${copyDone ? "is-copied" : ""}`} onClick={copyInvite} aria-label="Davet bağlantısını kopyala"><span><small>ODA KODU · PAYLAŞ</small><strong>{room.code.split("").join(" ")}</strong></span><span className="invite-copy-icon">{copyDone ? <Check size={18} /> : <Copy size={18} />}</span></button></div>
            <div className="lobby-grid">
              <section className="panel players-panel">
                <div className="panel-heading"><div><span className="panel-kicker"><Users size={14} /> PİKNİK EKİBİ</span><h2>Kimler geldi? <span className="count-pill">{room.players.length}/8</span></h2></div><span className="live-tag"><i /> CANLI</span></div>
                <div className="player-grid">
                  {room.players.map((player, index) => <article className={`player-card ${player.ready ? "is-ready" : ""}`} key={player.id}>
                    <span className={`player-avatar player-avatar--${index % 4}`}>{player.avatar}</span><span className="player-info"><strong>{player.nickname}{player.id === room.ownerId && <Crown className="owner-crown" size={13} />}</strong><small>{player.id === uid ? "sen" : player.id === room.ownerId ? "masa sahibi" : player.ready ? "hazır, bekliyor" : "birazdan hazır"}</small></span><span className={`ready-pill ${player.ready ? "ready-pill--yes" : ""}`}>{player.ready ? <><Check size={13} /> Hazır</> : "Bekliyor"}</span>
                  </article>)}
                  {Array.from({ length: Math.max(0, Math.min(4, 8 - room.players.length)) }, (_, index) => <div className="empty-seat" key={`empty-${index}`}><span>＋</span><small>Yer var · davet et</small></div>)}
                </div>
                <div className="lobby-footnote"><Sparkles size={14} /><span>Oda bağlantın hazır. Arkadaşların aynı kodu girince burada belirecek.</span></div>
              </section>
              <aside className="panel settings-panel">
                <div className="panel-heading"><div><span className="panel-kicker"><Gamepad2 size={14} /> OYUN PLANI</span><h2>Masanın menüsü</h2></div><span className="settings-emoji">✿</span></div>
                <p className="settings-hint">{amHost ? "Oda sahibi olarak oyunu ve tur sayısını seç." : "Oda sahibi oyunu seçiyor; az sonra başlıyoruz."}</p>
                <div className={`lobby-game-list ${!amHost ? "is-locked" : ""}`}>
                  {games.map(item => <GameTile key={item.id} game={item} selected={room.gameId === item.id} onClick={() => amHost && changeSettings({ gameId: item.id })} compact />)}
                </div>
                <div className="lobby-rounds"><span>Tur sayısı</span>{[3, 5, 8].map(count => <button key={count} type="button" disabled={!amHost} className={room.rounds === count ? "is-selected" : ""} onClick={() => changeSettings({ rounds: count })}>{count}</button>)}</div>
                <div className="lobby-actions">
                  {amHost ? <button type="button" className="button button--primary button--wide" disabled={!room.canStart || busy} onClick={async () => { setBusy(true); try { if (uid) await startGame(room.code, uid); } catch (error) { notify(error instanceof Error ? error.message : "Oyun başlatılamadı."); } finally { setBusy(false); } }}><Play size={17} fill="currentColor" /><span>{room.canStart ? "Hadi başlayalım" : room.players.length < 2 ? "Arkadaşlarını bekle" : "Herkes hazır olsun"}</span><ArrowRight size={17} /></button> : <button type="button" className={`button button--wide ${room.players.find(player => player.id === uid)?.ready ? "button--soft" : "button--primary"}`} onClick={async () => { setBusy(true); try { if (uid) await toggleReady(room.code, uid); } catch (error) { notify(error instanceof Error ? error.message : "Hazır durumu değişmedi."); } finally { setBusy(false); } }}><CheckCircle2 size={17} /><span>{room.players.find(player => player.id === uid)?.ready ? "Hazırsın — bekle" : "Ben hazırım!"}</span></button>}
                  <button type="button" className="share-text-button" onClick={copyInvite}><Copy size={14} /> Davet bağlantısını kopyala</button>
                </div>
              </aside>
            </div>
            <div className="lobby-note"><span className="pixel-flower">✿</span><p><b>Minik hatırlatma:</b> Herkes hazır olduğunda oda sahibi başlatabilir. Maksimum 8 kişi, minimum kahkaha sınırı yok.</p></div>
          </main>
        </>
      ) : room.status === "playing" ? (
        <>
          <header className="room-header game-header page-width"><Brand /><div className="game-header__center"><span className="live-tag"><i /> CANLI TUR</span><span className="game-header__name">{game.title}</span><span className="game-header__round">TUR {String(room.currentRound).padStart(2, "0")} <small>/ {room.rounds}</small></span></div><button type="button" className="code-chip" onClick={copyInvite}><Users size={14} /> {room.code} <Copy size={12} /></button></header>
          <main className="game-page page-width">
            <div className="game-title-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> {room.phase === "recap" ? "TUR TAMAMLANDI" : game.tag}</div><h1>{room.phase === "recap" ? "Nefes al." : game.title}<span className="heading-period">.</span></h1><p>{room.phase === "recap" ? "Bir sonraki tur başlamak üzere." : round?.prompt}</p></div><div className={`timer-card ${timeLeft <= 10 && room.phase === "round" ? "timer-card--urgent" : ""}`}><Clock3 size={17} /><span><small>KALAN SÜRE</small><strong>{room.phase === "recap" ? "↗" : `0:${String(timeLeft).padStart(2, "0")}`}</strong></span></div></div>
            <div className="timer-track"><span style={{ width: `${room.phase === "recap" ? 0 : timePercent}%` }} /></div>
            {room.phase === "recap" ? (
              <section className="round-recap"><div className="recap-confetti">✷ <span>✦</span> ✿</div><span className="panel-kicker"><Sparkles size={14} /> TUR ÖZETİ</span><h2>{room.recap?.title ?? "Güzel tur!"}</h2><p>{room.recap?.message}</p><ul>{room.recap?.details.map(detail => <li key={detail}>{detail}</li>)}</ul><div className="recap-scoreline">{sortedPlayers.slice(0, 3).map((player, index) => <span key={player.id}>{index === 0 ? "✦ " : ""}{player.avatar} {player.nickname} <b>{player.score}</b></span>)}</div>{amHost && <button type="button" className="button button--outline" onClick={() => uid && void withFeedback(() => nextRound(room.code, uid))}>Sonraki turu başlat <ArrowRight size={16} /></button>}</section>
            ) : (
              <div className="game-layout">
                <section className={`game-board game-board--${room.gameId}`}>
                  {room.gameId === "draw" && <>
                    <div className="board-topline"><span className="panel-kicker"><Pencil size={14} /> {round?.isDrawer ? "KALEM SENDE" : `${round?.drawerName ?? "Çizer"} ÇİZİYOR`}</span><span className="board-subtle">{round?.isDrawer ? "Gizli kelimeyi çiz. Harf ve rakam yok!" : `${round?.correctCount ?? 0} / ${Math.max(1, (round?.totalPlayers ?? 1) - 1)} doğru tahmin`}</span></div>
                    <div className={`draw-canvas-wrap ${round?.isDrawer ? "is-drawable" : ""}`}>
                      <canvas ref={canvasRef} width={1000} height={600} className="draw-canvas" aria-label="Ortak çizim tahtası" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} />
                      {!round?.strokes?.length && !localDraft.length && <div className="canvas-empty"><span>☁</span><strong>{round?.isDrawer ? "Buraya çiz!" : "Bir çizim geliyor…"}</strong><small>{round?.isDrawer ? `Tahta senin, ${round?.word ?? "kelimeyi"} anlat.` : "Kalemin ucunu takip et."}</small></div>}
                    </div>
                    <div className="board-bottomline"><div className="draw-palette">{["#386641", "#df5942", "#e1aa3a", "#557b9d", "#29271e"].map(color => <button key={color} type="button" className={ink === color ? "is-selected" : ""} style={{ backgroundColor: color }} onClick={() => setInk(color)} aria-label={`Kalem rengi ${color}`} disabled={!round?.isDrawer} />)}</div>{round?.isDrawer ? <><span className="secret-word"><small>SENİN KELİMEN</small><b>{round.word}</b></span><button type="button" className="icon-button" onClick={() => uid && void withFeedback(() => clearBoard(room.code, uid))} aria-label="Tahtayı temizle"><RefreshCw size={16} /></button></> : <form className="guess-form" onSubmit={submitGuess}><input className="text-input" maxLength={48} placeholder="Tahminini buraya yaz…" value={guess} onChange={event => setGuess(event.target.value)} disabled={Boolean(drawResult?.correct)} /><button type="submit" className="button button--primary" disabled={Boolean(drawResult?.correct || !guess.trim())}>{drawResult?.correct ? <><Check size={17} /> Bildin!</> : <><Send size={16} /> Gönder</>}</button></form>}</div>
                    {drawResult && !drawResult.correct && <p className="board-footnote"><X size={14} /> Daha değil, başka bir şey dene.</p>}
                  </>}

                  {room.gameId === "words" && <>
                    <div className="word-round-hero"><span className="word-round-label">BU TURUN HARFİ</span><strong>{round?.letter ?? "?"}</strong><p>Harfe dikkat et — benzersiz cevap daha çok puan.</p></div>
                    <form className="word-form" onSubmit={submitWords}>
                      {(round?.categories ?? ["Şehir", "Hayvan", "Yemek", "Eşya"]).map((category, index) => <label className="word-field" key={category}><span className="word-field__index">0{index + 1}</span><span className="word-field__name">{category}</span><input className="text-input" value={wordInputs[category] ?? (typeof round?.wordAnswers === "object" && round.wordAnswers ? round.wordAnswers[category] : "") ?? ""} onChange={event => setWordInputs(previous => ({ ...previous, [category]: event.target.value }))} placeholder={`${round?.letter ?? "?"} ile başlayan…`} maxLength={32} disabled={Boolean(round?.wordAnswered)} /></label>)}
                      <button type="submit" className="button button--primary button--wide" disabled={Boolean(round?.wordAnswered)}>{round?.wordAnswered ? <><Check size={17} /> Cevapların teslim edildi</> : <>Cevapları yolla <ArrowRight size={17} /></>}</button>
                    </form><p className="board-footnote"><HelpCircle size={14} /> Doğru harfle başlayan, farklı cevaplar puan toplar.</p>
                  </>}

                  {room.gameId === "colors" && <>
                    <div className="color-instruction"><span className="panel-kicker"><Sparkles size={14} /> GÖZÜNÜ KANDIRMA</span><h2>Yazıya değil,<br />mürekkebe bak.</h2><p>Görünen <b>yazı rengini</b> seç. En hızlı doğru parmak puanı kapar.</p></div>
                    <div className="color-word" style={{ color: round?.inkHex }}>{round?.word ?? "HAZIR"}</div>
                    <div className="color-options">{round?.colorOptions?.map(color => <button key={color.name} type="button" className={`color-option ${round.hasAnswered ? "is-disabled" : ""}`} onClick={() => void submitColorAnswer(color.name)} disabled={Boolean(round.hasAnswered)}><span style={{ backgroundColor: color.hex }} /><b>{color.name}</b></button>)}</div>
                    {round?.hasAnswered && <p className="answer-confirm"><CheckCircle2 size={15} /> Cevabın kaydedildi: <b>{round.myAnswer}</b> — doğru renk tur özetinde açıklanır.</p>}
                  </>}

                  {room.gameId === "memory" && <>
                    <div className="memory-instruction"><span className="panel-kicker"><Star size={14} /> BAK · HATIRLA · YAZ</span><h2>{round?.memoryHidden ? "Diziyi hatırlıyor musun?" : "Gözlerini dört aç!"}</h2><p>{round?.memoryHidden ? "Sayıları sırayla, boşluksuz yaz." : "Dizi birazdan kaybolacak…"}</p></div>
                    <div className={`number-sequence ${round?.memoryHidden ? "number-sequence--hidden" : ""}`} aria-live="polite">{round?.memoryHidden ? <span>• • • • •</span> : (round?.prompt ?? "·····").split("").map((digit, index) => <b key={`${index}-${digit}`}>{digit}</b>)}</div>
                    <form className="memory-form" onSubmit={submitMemory}><label className="sr-only" htmlFor="memory-answer">Sayı dizisini sırayla yaz</label><input id="memory-answer" className="text-input memory-input" maxLength={5} inputMode="numeric" placeholder="DİZİYİ YAZ" value={memoryAnswer} onChange={event => setMemoryAnswer(event.target.value.replace(/\D/g, ""))} disabled={Boolean(round?.hasAnswered || !round?.memoryHidden)} /><button type="submit" className="button button--primary" disabled={Boolean(round?.hasAnswered || !round?.memoryHidden || memoryAnswer.length < 5)}>{round?.hasAnswered ? <><Check size={17} /> Gönderildi</> : <>Kontrol et <ArrowRight size={16} /></>}</button></form><p className="board-footnote"><Clock3 size={14} /> Her oyuncunun tek tahmin hakkı var.</p>
                  </>}
                </section>
                <aside className="score-panel"><div className="panel-heading"><div><span className="panel-kicker"><Medal size={14} /> ANLIK SKOR</span><h2>Kim önde?</h2></div><span className="score-stars">✦ ✦ ✦</span></div><div className="score-list">{sortedPlayers.map((player, index) => <div className={`score-row ${player.id === uid ? "is-me" : ""}`} key={player.id}><span className="score-place">{index === 0 && player.score > 0 ? <Crown size={15} /> : String(index + 1).padStart(2, "0")}</span><span className="score-avatar">{player.avatar}</span><span className="score-name">{player.nickname}<small>{player.id === uid ? "sen" : player.hasAnswered ? "✦ cevapladı" : room.gameId === "draw" && round?.drawerId === player.id ? "✎ çiziyor" : "oyunda…"}</small></span><b className="score-points">{player.score}</b></div>)}</div><div className="score-panel__foot"><span className="status-dot" /> Skorlar anlık güncelleniyor</div><div className="next-game-note"><span>✿</span><small>Her tur yeni bir şans.<br /><b>Rövanş hakkı saklı.</b></small></div></aside>
              </div>
            )}
            <div className="game-bottom"><span><span className="status-dot" /> ODA {room.code} · {room.players.length} OYUNCU</span><button type="button" onClick={copyInvite}><Copy size={14} /> Arkadaş çağır</button></div>
          </main>
        </>
      ) : (
        <>
          <header className="room-header page-width"><Brand /><div className="room-header__center"><span className="status-dot" /> FİNAL TURU TAMAMLANDI</div><button type="button" className="back-link" onClick={leaveRoom}><ArrowLeft size={15} /> Ana sayfa</button></header>
          <main className="room-page results-page page-width"><div className="results-hero"><span className="results-flower">✿</span><div className="eyebrow"><span className="eyebrow-dot" /> ÖRTÜYÜ TOPLAMADAN</div><h1>Günün yıldızı<br /><em>{sortedPlayers[0]?.nickname ?? ""}</em><span className="heading-period">!</span></h1><p>Bu grubun elinden kalem düşmemiş. Yeni tur mu?</p><span className="winner-crown"><Crown size={22} /></span></div>
            <section className="results-board"><div className="results-board__heading"><span className="panel-kicker"><Medal size={14} /> PİKNİK SKORU</span><span>{room.gameTitle} · {room.rounds} tur</span></div>{sortedPlayers.map((player, index) => <div className={`result-row ${index === 0 ? "result-row--winner" : ""}`} key={player.id}><span className="result-rank">{index === 0 ? <Crown size={18} /> : `${index + 1}.`}</span><span className="result-avatar">{player.avatar}</span><strong>{player.nickname}{player.id === uid && <small> SEN</small>}</strong><span className="result-points">{player.score}<small> PUAN</small></span></div>)}<div className="results-board__summary"><Sparkles size={15} /><span>{room.recap?.message ?? "Aynı ekiple bir tur daha atmaya ne dersiniz?"}</span></div></section>
            <div className="results-actions">{amHost ? <button type="button" className="button button--primary" onClick={() => uid && void withFeedback(() => playAgain(room.code, uid), "Rövanş masası kuruldu!")}><RefreshCw size={17} /> Aynı ekiple rövanş <ArrowRight size={17} /></button> : <span className="waiting-rematch"><Clock3 size={15} /> Oda sahibinden rövanş bekleniyor…</span>}<button type="button" className="button button--outline" onClick={copyInvite}><Copy size={16} /> Odayı paylaş</button><button type="button" className="text-button" onClick={leaveRoom}>Ana sayfaya dön</button></div>
          </main>
        </>
      )}
      {notice && <div className="toast-note" role="status"><Sparkles size={16} /> {notice}<button type="button" onClick={() => setNotice("")} aria-label="Bildirimi kapat"><X size={14} /></button></div>}
    </div>
  );
}
