# Plan: ajanlarla Zen içinde birlikte çalışma

## Güncel öncelik — 2026-10-20

Önce [DEVAM.md](DEVAM.md) başındaki güncel devir özetini oku. Çoklu ajan teması,
Codex standart MCP araçları ve queue gönderimi tamamlandı. Otomatik Codex hook
alıcısı kuruldu; Efe’nin `/hooks` güven onayı ve yeni sohbette gerçekten otomatik
bağlanma doğrulaması bekleniyor. Sonraki geliştirme planı Efe ile birlikte belirlenecek.

Gerçek Durdur/Devam iptali tamamlandı. Modül yolu regresyonu dahil 25 otomatik test
ve Efe'nin terminalindeki canlı Zen testi geçti: reload, batch/bekleme iptali,
hızlı Durdur/Devam ve gerçek yazmanın 240/50000 karakterde kesilmesi doğrulandı.
Ayrıntılar DEVAM.md'de.

Öncelik adayları: batch/site değişiminde izinler, gerçek iptal, çoklu oturum sekme
sahipliği, örtülü öğe kontrolü, çıktı/diff verimliliği ve CLI+skill ölçümü.
Aşağıdaki bölümler önceki planın tarihçesidir.


Efe compact mode kullanıyor; sekmedeki turuncu çizgiyi görmüyor. Çözüm: Zen penceresinin
üst ortasında, sayfanın üzerinde duran bir "ada" (Dynamic Island gibi). Claude'un ne
yaptığını gösterir, durdurma düğmesi ve kullanıcıdan istenenler orada. Sekme hiçbir zaman
kendiliğinden öne getirilmez.

## Kararlar (2026-10-19, Efe)

- Boştayken tamamen gizli; Claude çalışınca belirir, son işlemden birkaç saniye sonra kaybolur.
- Konum üst orta (Zen'in kendi bildirimleri sağ üstte, çakışmasın).
- Durdur → Claude "Devam et"e basılana kadar hiçbir sekmede işlem yapamaz; süren işlem kesilir,
  tool'lar "kullanıcı durdurdu" döner.
- Zen penceresi odakta değilken ask_user gelirse masaüstü bildirimi de gider.
- Stil Zen'in toast'ıyla aynı dil (14px yuvarlak köşe, gölge), ama arka plan tema renginin
  koyu tonu: Efe'nin teması açık gri (#bebebe) ve toast gibi beyaz yazı okunmuyordu.

## Ada durumları

- Çalışıyor: `● Claude · site — "İletişim"e tıklıyor  [■ Durdur]`; noktası yanıp söner,
  hapa tıklayınca sekmeye gidilir.
- Senden istiyor (ask_user): genişler, mesaj + `[Sekmeye git] [Vazgeç]`; sayfadaki çerçeve
  ve baloncuk sekmede hazır bekler.
- Sayfa diyalog açtı: "Sayfa onay istiyor: …" + `[Sekmeye git]`.
- Durduruldu: `Claude durduruldu  [Devam et]`.

## Fazlar

1. ✅ (2026-10-19) Ada altyapısı: her pencereye ekleme (yeni pencereler, reload'da temizlik), Zen temasıyla
   stil; canlı durum metni; Durdur/Devam ve kısayol.
2. ✅ (2026-10-19) ask_user ve diyaloglar adaya taşınır (sekme öne getirilmez); sayfada tıklanan noktada
   kısa turuncu halka; Zen odakta değilse masaüstü bildirimi.
3. ✅ (2026-10-19) "Claude'a ver / Geri al" sekme sağ tık menüsünde; ada hangi sekmenin Claude'da olduğunu
   gösterir.
4. ✅ (2026-10-19) Güvenilirlik: iframe desteği (read_page/tıklama/yazma alt çerçevelerde), `wait_for`
   (metin/öğe görünene, ağ durulana kadar).
5. ✅ (2026-10-19) Geliştirici ve güvenlik: ağ isteği ayrıntıları (başlıklar, gövdeler),
   etkinlik günlüğü, otomatik/onaylı mod ve hassas siteler (Efe: hazır liste yok, hassas
   sitede her işlemde izin; onaylı modda her yerde).

İsteğe bağlı, sonra: Quickshell barında Claude göstergesi.

## Zen'den öğe seçip Claude'a iş verme (Efe'nin fikri, 2026-10-19) ✅ (birden fazla öğe seçme hariç)

Yapıldı: Ctrl+Shift+F (Ctrl+Shift+E Zen'de ağ izleyicisi) ve sayfa sağ tık menüsü, adada not,
kanal yoksa pano. Gerçek bir `claude-zen` oturumuyla uçtan uca deneme Efe'de (aşağıda).

Faz 4'ten önce yapılacak. Kullanıcı "ana sayfadaki şu kısmı düzelt" diye tarif etmek yerine
Zen'de öğeyi seçer, notunu yazar, istek Claude Code oturumuna kendiliğinden düşer.

- **Taşıma, Claude Code channels** (araştırma önizlemesi;
  https://code.claude.com/docs/en/channels-reference.md):
  - `src/server.ts` `capabilities.experimental['claude/channel'] = {}` ve `instructions` bildirir,
    olayı `notifications/claude/channel` ile gönderir (`{ content, meta }`). Claude'a
    `<channel source="zen" …>` olarak ulaşır.
  - McpServer'da alttaki Server: `server.server.notification(...)`.
  - Özel kanal izin listesinde değil: Claude Code
    `claude --dangerously-load-development-channels server:zen` ile açılmalı (her açılışta
    uyarı). Bunun için `claude-zen` alias'ı.
- **Zen → Node itme:** şu an bağlantı başına tek istek var. Node, köprüye kalıcı bir
  "subscribe" bağlantısı açar, Zen olayları bu bağlantıya satır satır yazar. Birden fazla
  oturum varsa olay, Zen'i en son kullanan oturuma gider.
- **Yedek:** kanal açık değilse (abone yoksa) seçim ve not panoya kopyalanır (`wl-copy`),
  bildirim gelir: "Claude Code'a yapıştır".
- **Seçim arayüzü:**
  - Sayfa sağ tık menüsünde "Claude'a göster…" (tıklanan öğe).
  - Seçici modu (kısayol, ör. Ctrl+Shift+E): fareyle gezdikçe turuncu çerçeve, tıklayınca
    seçim, ok tuşlarıyla üst/alt öğe, Esc iptal.
  - Seçimden sonra ada "Ne yapılsın?" metin kutusunu açar; Enter gönderir, ada "gönderildi ✓"
    der.
  - Sonra: birden fazla öğe seçme.
- **Gönderilen bağlam:**
  - not, sayfa URL'si, CSS seçici yolu, rol, ad, metin
  - kısaltılmış outerHTML (~1500 karakter)
  - önemli hesaplanmış stiller (yazı tipi ve boyutu, renkler, padding/margin, display, boyut)
  - öğenin kırpılmış ekran görüntüsü (dosya yolu; Claude `Read` ile bakar)
  - React/Next.js dev'de bileşen zinciri (fiber `_debugOwner` adları, ör.
    `HeroSection > CTAButton`): repoda doğru dosyayı bulmak için

## Fikirler (vercel-labs/agent-browser'dan, 2026-10-19)

agent-browser Chromium/Safari için CDP/WebDriver tabanlı ajan CLI'si; Firefox/Zen yok, kullanıcıyla
birlikte çalışma (ada, durdurma, sekme verme) yok. Bizim konum: kendi Firefox/Zen tarayıcında
Claude ile birlikte çalışma. Alınabilecekler:

- Örtülü öğe kontrolü: tıklama noktasında başka öğe varsa (çerez bandı, modal) tıklamadan hata
  ve örten öğeyi bildir.
- İzinli alan adları: Claude yalnız belirli sitelere gidebilsin (hassas sitelerin tersi).
- CLI + skill modu: MCP tool tanımları her turda bağlamda; CLI'yi skill ile kullanmak daha az
  token harcayabilir, ölçülmeli.
- React araçları (bileşen ağacı, props) ve erişilebilirlik denetimi (axe-core).
