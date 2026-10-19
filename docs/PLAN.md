# Plan: Claude adası ve sonrası

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
2. ask_user ve diyaloglar adaya taşınır (sekme öne getirilmez); sayfada tıklanan noktada
   kısa turuncu halka; Zen odakta değilse masaüstü bildirimi.
3. "Claude'a ver / Geri al" sekme sağ tık menüsünde; ada hangi sekmenin Claude'da olduğunu
   gösterir.
4. Güvenilirlik: iframe desteği (read_page/tıklama/yazma alt çerçevelerde), `wait_for`
   (metin/öğe görünene, ağ durulana kadar).
5. Geliştirici ve güvenlik: ağ isteği ayrıntıları (başlıklar, cevap gövdesi), etkinlik
   günlüğü, hassas siteler listesi (yalnız okuma, tıklamada ask_user zorunlu).

İsteğe bağlı, sonra: Quickshell barında Claude göstergesi.
