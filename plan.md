# Oyun Odası — Ürün ve tasarım planı

## Ürün özeti

Türkçe, arkadaş gruplarının takma adla hızlıca katıldığı; özel oda kodu, ortak bekleme lobisi ve canlı puan tablosu etrafında çalışan bir mini oyun salonu. Dört oyun: **Çiz Bakalım**, **Harf Kapmaca**, **Renk Refleksi** ve **Sayı Avı**. Akış: lobi kur → kodu paylaş → arkadaşlar katılsın ve hazır olsun → sunucu tarafından eşzamanlanan turlar → sıralama ve aynı grupla rövanş.

## Uygulama yaklaşımı

- **İstemci:** Mevcut React + Vite + TypeScript başlangıç uygulaması. Tek ana oyun salonu arayüzü; başlangıç, oda lobisi, ortak oyun ekranı ve sonuç durumu.
- **Sunucu:** Mevcut Express sunucusunda `/api/game` REST uçları ve Server-Sent Events (SSE). Oda, oyuncu, tur sayacı, yanıtlar ve skorlar tek sunucu sürecinde bellekte tutulur; değişiklikler odadaki oyunculara yayımlanır. Oyun durumunun doğrusu sunucudur.
- **Veri saklama:** Hesap veya kalıcı içerik gerekmediğinden veritabanı açılmaz. Odalar geçicidir ve sunucu yeniden başladığında sıfırlanır.
- **Girdi kuralları:** Oda kodu, oyuncu üyeliği ve oyun aşaması sunucuda doğrulanır. Çizim/cevap uzunlukları sınırlandırılır; çizilecek özel kelime yalnızca çizerin oda görünümünde döner.
- **Dosya sorumlulukları:** `client/src/pages/Home.tsx` salon/lobi/oyun/sonuç arayüzü; `client/src/index.css` tasarım sistemi ve responsive kurallar; `server/gameRooms.ts` oda yaşam döngüsü, dört oyunun kuralları, tur/süre/skor ve oyuncuya göre filtrelenmiş SSE; `server/_core/index.ts` Express API yönlendirmesi; `client/index.html` Türkçe başlık, favicon ve metadata; `client/public/manus-routes.json` sayfa yolları; `client/public/brand-mark.svg` site simgesi.

## Görsel tasarım

- **Tasarım akımı:** Piksel detaylarıyla modernleştirilmiş retro açık hava/masa oyunu pikniği; **Piksel Piknik**.
- **Temel ilkeler:** Sıcak ve kolay yaklaşılabilir; puan/sıra/zaman her turda anlaşılır; el yapımı oyun parçaları hissi fakat okunaklı; klavye, dokunmatik ekran ve fareyle kullanılabilir.
- **Renk felsefesi:** Krem kâğıt (#FFF8E8) ferah piknik örtüsü; orman yeşili (#386641) ana etkileşim ve imza rengi; domates kırmızısı (#E94F37) rekabet vurgusu; hardal ve mürekkep tonları küçük bilgi vurguları. Uzun metinlerde yüksek kontrast korunur.
- **Yerleşim paradigması:** Tekdüze merkezi ızgara yerine hafif asimetrik editoryal düzen: büyük duyuru/oda formu yanında eğik oyun çıkartmaları; lobide oyuncu alanı ve ayar paneli; oyun ekranında geniş sahne ile ayrı skor şeridi. Dar ekranlarda tek sütun.
- **İmza öğeleri:** Piksel/dikiş kenarlı kart ve rozetler; çıkartma gibi eğik oyun simgeleri; tur/skor yanında ölçülü piknik örtüsü noktaları.
- **Etkileşim felsefesi:** Her ana eylem belirgin tek dokunma hedefi; oda kodunu tek dokunuşla kopyalama; hazır/doğru cevaba anında geri bildirim; kısa oyun açıklaması ve anlaşılır girdi.
- **Animasyon:** Oyuncu/puan için 140–220 ms yumuşak yükselme; kartlarda hafif eğilme; tur geçişinde kısa kâğıt kayması; azalan sürede ölçülü renk vurgusu. `prefers-reduced-motion` etkinse hareket azaltılır; cevap metinleri animasyon beklemez.
- **Tipografi:** Seçilen **Press Start 2P** wordmark, küçük etiket, oda kodu ve kısa başlıklarda; Türkçe gövde ve arayüz metinlerinde **Nunito**.
- **Marka özü:** Arkadaş grubunu saniyeler içinde aynı masaya çağıran Türkçe oyun salonu; **sıcak, muzip, çevik**.
- **Marka sesi:** Kısa, arkadaşça, hafif oyunbaz; talimatlar açık. Örnekler: “Kodu gruba at, masa dolsun.” / “Sıra kimde? Kalem sende!”
- **Wordmark/logo:** Kesik piksel köşeli piknik örtüsü karesi ve üzerindeki oyun pulu; yanında iki satırda “OYUN / ODASI”.
- **İmza marka rengi:** Orman yeşili **#386641**.

## Proje yapısı

- `client/src/pages/Home.tsx` — kimlik/avatarlı başlangıç, oda oluşturma/koda katılma, ortak bekleme lobisi, oyun ekranları, puan ve rövanş/sonuç.
- `client/src/index.css` — tema değişkenleri, tipografi, masaüstü/mobil kuralları, oyun tahtaları ve erişilebilir hareket azaltma.
- `server/gameRooms.ts` — geçici oda deposu, dört oyun türü, süre/tur yönetimi, sunucu taraflı doğrulama, SSE durumu.
- `server/_core/index.ts` — mini oyun API'sini mevcut Express uçlarına bağlama.
- `client/index.html` — `lang="tr"`, sayfa başlığı, açıklama, web fontları ve favicon.
- `client/public/manus-routes.json` — `/` ve `/404` sayfa tanımları.
- `client/public/brand-mark.svg` — özel Oyun Odası site simgesi.

## Oyun kuralları

- **Çiz Bakalım:** Çizer her tur değişir; gizli kelime yalnızca çizerde görünür, diğer oyuncular tahmin yazar. İlk doğru tahmin, kalan süreye göre daha fazla puan alır.
- **Harf Kapmaca:** Sunucu bir harf seçer; oyuncular Şehir, Hayvan, Yemek ve Eşya kategorilerine süre içinde cevap verir. Harfle başlayan benzersiz cevaplar puan getirir.
- **Renk Refleksi:** Renk adı ile yazının mürekkebi çelişir; oyuncu yazılan kelimeyi değil mürekkep rengini seçer. Doğru cevaplar sunucuya ulaşma sırasıyla puanlanır.
- **Sayı Avı:** Beş haneli dizi kısa süre görünür, ardından gizlenir; oyuncu diziyi hatırlayıp yazar.
- Sunucu tur sonunu belirler. Sonuçlar canlı yayımlanır; finalde kazanan, sıralama ve tur özeti görünür. Oda sahibi aynı ekiple rövanş başlatabilir.
