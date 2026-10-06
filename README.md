# Oyun Odası

Arkadaşlarını takma ad ve avatarla masaya çağır; oda kodunu paylaş ve kısa mini oyunlarda kapış. Hesap yok, tek kullanımlık oda kodu var.

Bu sürüm **sunucusuzdur**: Express kaldırıldı. Odalar **Firebase Realtime Database** üzerinde tutulur, giriş **Anonymous Auth** ile yapılır, arayüz **Firebase Hosting**'de yayınlanır.

## Oyunlar

- **Çiz Bakalım:** Çizer gizli kelimeyi ortak tahtaya çizer; diğerleri süre içinde tahmin eder.
- **Harf Kapmaca:** Şehir, hayvan, yemek ve eşya için aynı harfle başlayan cevaplar yazılır; benzersiz geçerli cevaplar puan kazandırır.
- **Renk Refleksi:** Yazının mürekkep rengini bul; doğru ve hızlı seçim puan getirir.
- **Sayı Avı:** Kısa süre gösterilen sayı dizisini aklında tut ve gizlendikten sonra sırayla yaz.

## Oyun akışı

1. Bir oyuncu takma ad/karakter seçip oda kurar.
2. Oda kodu veya `/?oda=KOD` davet bağlantısı gruba gönderilir.
3. Arkadaşlar katılır, hazır durumunu seçer; oda sahibi oyunu ve 3/5/8 turu belirler.
4. Oda sahibi oyunu başlatır. Tur sayacı, cevaplar ve skorlar odadaki herkese anlık iletilir.
5. Final sıralaması çıkar; oda sahibi aynı ekiple rövanş açabilir.

Her odada 2–8 kişi oynar. Odalar Firebase'de tutulur; kalıcı profil veya hesap yoktur.

## Mimari

- **İstemci:** React + Vite + TypeScript (`client/`), statik derlenir → `dist/public/`
- **Veri:** Firebase Realtime Database — `rooms/{kod}/{meta, players, round, recap}` + `secrets/{kod}` (tur sırları)
- **Kimlik:** Firebase Anonymous Auth (her oyuncunun uid'si oyuncu kimliğidir)
- **Senkron:** RTDB dinleyicileri (`onValue`); kritik faz geçişleri transaction ile tek-kazananlı
- **Sürücü:** Süre bitimi, sayı gizleme, tur ilerletme ve çiz-hakemliği bağlı tüm istemcilerde çalışır (`startDriver`); yarışı kazanan transaction yazar
- **Kurallar:** `database.rules.json` — tur sırları yalnızca çizerde veya özet aşamasında okunur, skorlar yalnızca artabilir
- **Saf oyun mantığı:** `shared/game.ts` (tur kurma + puanlama; sunucusuz, testli)

Bilinen prototip sınırları: jüri/sürücü istemcide çalıştığı için kötü niyetli istemciye karşı tam koruma yoktur (hile önleme için 2. faz olarak Cloud Functions önerilir); 4 harfli oda kodları tahmin edilebilir.

## Gereksinimler

- Node.js 20+ (önerilen: 22 LTS)
- pnpm 10
- Bir Firebase projesi (ücretsiz Spark planı yeterli: Realtime Database + Hosting + Anonymous Auth)

## Kurulum

```bash
pnpm install
cp .env.example .env   # Windows: copy .env.example .env
```

`.env` dosyasına Firebase Console > Proje ayarları > Web uygulaması değerlerini yazın:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=....firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://....firebasedatabase.app
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```

Firebase Console'da şunları açın:

1. **Authentication > Sign-in method > Anonymous** → Etkinleştir
2. **Realtime Database > Create Database** → Bölge seçin, test modunda başlayabilirsiniz
3. **Realtime Database > Rules** sekmesine `database.rules.json` içeriğini yapıştırıp Yayınlayın

## Geliştirme

```bash
pnpm dev      # Vite: http://localhost:5173
pnpm check    # TypeScript tip denetimi
pnpm test     # Vitest (shared/game.test.ts)
pnpm build    # Statik derleme -> dist/public/
pnpm preview  # Derlemeyi yerelde önizle
```

Not: `pnpm dev`/`preview` gerçek Firebase projesine bağlanır (emülatör kurulu değil).

## Yayınlama (Firebase Hosting)

```bash
npm i -g firebase-tools
firebase login
cp .firebaserc.example .firebaserc   # Windows: copy ...
# .firebaserc içindeki OYUNODA-PROJE-ID-BURAYA yerine proje kimliğini yazın
pnpm build
firebase deploy --only database,hosting
```

`firebase.json`: `dist/public` klasörünü yayınlar, SPA yönlendirmesi (`**` → `/index.html`) içerir.

## GitHub'a yükleme

```bash
git add .
git commit -m "Firebase Realtime Database gecisi"
git branch -M main
git remote add origin https://github.com/KULLANICI/oyunoda.git
git push -u origin main
```

`.firebaserc` (gerçek proje kimliği) ve `.env` (API anahtarları) bilinçli olarak commit dışıdır. `main` dalına her push/PR'de `pnpm check`, `pnpm test` ve `pnpm build` otomatik çalışır (`.github/workflows/ci.yml`).

## Proje yapısı

- `client/src/pages/Home.tsx` — giriş, lobi, oyun ekranları, sonuç ve rövanş arayüzü
- `client/src/lib/rooms.ts` — RTDB oda işlemleri + tur sürücüsü
- `client/src/lib/firebase.ts` — Firebase başlatma + anonim giriş
- `shared/game.ts` — saf oyun kuralları ve puanlama (+ `shared/game.test.ts`)
- `database.rules.json` — Realtime Database güvenlik kuralları
- `firebase.json` — Hosting + database dağıtım yapılandırması

## Lisans

MIT — ayrıntılar için `LICENSE` dosyasına bakın.
