# Oyun Odası

Arkadaşlarını takma ad ve avatarla masaya çağır; oda kodunu paylaş ve kısa mini oyunlarda kapış. Hesap yok, tek kullanımlık oda kodu var.

## Oyunlar

- **Çiz Bakalım:** Çizer gizli kelimeyi ortak tahtaya çizer; diğerleri süre içinde tahmin eder.
- **Harf Kapmaca:** Şehir, hayvan, yemek ve eşya için aynı harfle başlayan cevaplar yazılır; benzersiz geçerli cevaplar puan kazandırır.
- **Renk Refleksi:** Yazının mürekkep rengini bul; doğru ve hızlı seçim puan getirir.
- **Sayı Avı:** Kısa süre gösterilen sayı dizisini aklında tut ve gizlendikten sonra sırayla yaz.

## Oyun akışı

1. Bir oyuncu takma ad/karakter seçip oda kurar.
2. Oda kodu veya `/?oda=KOD` davet bağlantısı gruba gönderilir.
3. Arkadaşlar katılır, hazır durumunu seçer; oda sahibi oyunu ve 3/5/8 turu belirler.
4. Oda sahibi oyunu başlatır. Oyun durumu ve tur sonuçları aynı odadaki herkese anlık iletilir.
5. Final sıralaması çıkar; oda sahibi aynı ekiple rövanş açabilir.

Her odada 2–8 kişi oynar. Odalar ve puanlar sunucu belleğinde tutulur; sunucu yeniden başladığında aktif oyun oturumları temizlenir. Bu prototip hesap, kalıcı profil veya veritabanı kullanmaz.

## Gereksinimler

- Node.js 20+ (önerilen: 22 LTS)
- pnpm 10 (`corepack enable` ile gelir veya `npm i -g pnpm`)

## Kurulum

```bash
pnpm install
cp .env.example .env   # Windows: copy .env.example .env
```

`.env` zorunlu değil; `PORT` belirtilmezse 3000 kullanılır. Veritabanı gerekmez.

## Geliştirme

```bash
pnpm dev      # Express + Vite: http://localhost:3000
pnpm check    # TypeScript tip denetimi
pnpm test     # Vitest ile birim testleri
pnpm build    # Üretim derlemesi (client + server -> dist/)
pnpm start    # Üretim sunucusunu çalıştırır (önce build gerekir)
```

Express, geliştirme sırasında Vite arayüzünü ve `/api/game` uçlarını sunar. Oda yayınları Server-Sent Events ile eşitlenir.

## Proje yapısı

- `client/src/pages/Home.tsx` — giriş, lobi, oyun ekranları, sonuç ve rövanş arayüzü
- `client/src/index.css` — tema, tipografi ve mobil/masaüstü kuralları
- `server/gameRooms.ts` — oda yaşam döngüsü, dört oyunun kuralları, tur/süre/skor, SSE yayını
- `server/gameRooms.test.ts` — lobi akışı ve doğrulama testleri
- `server/_core/index.ts` — Express giriş noktası (`/api/game`, `/api/trpc`, statik sunum)
- `server/routers.ts` — tRPC yönlendiricisi (şablon artığı; oyun için gerekli değil)
- `drizzle/` + `server/db.ts` — şablon artığı; oyun veritabanı kullanmaz

## Üretimde çalıştırma

```bash
pnpm install --frozen-lockfile
pnpm build
PORT=3000 pnpm start
```

### Docker

```bash
docker build -t oyunoda .
docker run -p 3000:3000 -e PORT=3000 oyunoda
```

`Dockerfile` çok aşamalı değildir; `pnpm build` imaj içinde çalışır ve `node dist/index.js` ile servis edilir.

### Render / Railway / VPS notları

- Başlangıç komutu: `pnpm start` (öncesinde `pnpm build` çalışmış olmalı)
- Ortam değişkeni: `PORT` (sağlayıcının verdiği porta ayarlayın)
- Kalıcı disk / veritabanı gerekmez; odalar bellek içidir
- SSE kullanıldığı için yanıtları tamponlayan bir proxy varsa `X-Accel-Buffering: no` ve uzun bağlantılara izin verildiğinden emin olun

## GitHub'a yükleme

```bash
git init
git add .
git commit -m "Oyun Odası ilk sürüm"
git branch -M main
git remote add origin https://github.com/KULLANICI/oyunoda.git
git push -u origin main
```

`main` dalına her push/PR'de `pnpm check`, `pnpm test` ve `pnpm build` otomatik çalışır (`.github/workflows/ci.yml`).

## Lisans

MIT — ayrıntılar için `LICENSE` dosyasına bakın.
