# Zen MCP / agent-browser karşılaştırması

2026-10-20. Referans: [agent-browser komutları](https://agent-browser.dev/commands).
Amaç günlük Zen penceresinde kullanıcıyla birlikte çalışmak; ayrı tarayıcı açmak değil.
Aşağıdaki karşılıklar birebir API/engine eşitliği anlamına gelmez.

| Alan | Zen MCP durumu |
|---|---|
| Snapshot, refs, etkileşimli ağaç | Mevcut: read_page; find ve form_input |
| Sayfa metni ve metin diff | Mevcut: get_page_text, diff/since |
| Gezinme, sekmeler, iframe, diyalog | Mevcut; oturuma özel sahiplik |
| Hover, tıklama, drag, scroll | Mevcut; gerçek girdi, örtülü hedef kontrolü |
| Keydown / keyup | Eklendi: computer key_down/key_up; tek tuş, ayrı modifier tutma |
| Fare move / down / up | Eklendi: computer mouse_move/mouse_down/mouse_up |
| Değişken yazma hızı | Eklendi: typing: human, delay_ms, seed; varsayılan hızlı |
| Gerçek yumuşak/eğri fare yolu | Eklendi: movement: smooth/human, duration_ms, steps, seed |
| Viewport / cihaz | Eklendi: browser_settings; sekmeye özel boyut, native DPR/touch-event/UA |
| Renk teması | Eklendi: browser_settings media; dark/light/no-preference |
| Screenshot tekrarını azaltma | Eklendi: if_changed; tam görüntü eşitliği, oturum/belge/seçenek kapsamı |
| Screenshot etiketleri | Eklendi: annotate; üst çerçevede en fazla 80 görünür kontrolün ref'i |
| Clipboard | Mevcut: her işlem ve standart kısayol için ayrı island onayı |
| Dosya yükleme | Mevcut: file_upload |
| İndirme başlatma/tamamlama/dosya yolu | Aday; özel MCP aracı henüz yok |
| Konsol ve ağ inceleme | Mevcut: konsol, istek/cevap başlık ve gövdeleri |
| Ağ route/mock/HAR/throttling | Aday; mevcut araç yalnız gözlem odaklı |
| React props/render/suspense | Aday; öğe seçiminde bileşen zinciri mevcut |
| axe erişilebilirlik denetimi | Aday; read_page ağacı bir denetim değildir |
| Tam sayfa screenshot / PDF | Aday; mevcut screenshot viewport kapsamlı |
| Web Vitals | Aday |
| Cookie/storage/session export | Şimdilik aday değil; kullanıcının günlük oturumları zaten mevcut |
| CDP / headless / yeni tarayıcı başlatma | Bu ürünün hedefi değil; günlük Zen, mevcut pencere/oturumlar |
| Proxy/geolocation/TLS ayarları | Ayrı tasarım gerekli; global profil ayarı otomatik değiştirilmez |
| Kayıt/streaming/profiling/WebMCP | Aday; Gecko uygunluğu ve kullanım ihtiyacı ayrıca değerlendirilmeli |
| Kullanıcıyla öğe gönderme, ada, Durdur, görev devri | Zen MCP'nin kendi odak alanı; mevcut |
| Kurulu eklenti panelleri | Mevcut: extensions; sekme geçişi auto modda da onaylı |

## Kullanım ve sınırlar

- İnsan benzeri modlar isteğe bağlıdır. Gerçek, trusted olaylar üretir; bot tespitini
  aşma garantisi değildir. Varsayılan girdi hızı korunur, ajan ihtiyaç olursa seçer.
- Key/mouse hold oturum ve çerçeveye aittir. Tuşu bırak, Durdur, hata, gezinme,
  devir/geri alma, disconnect ve reload temizliği vardır. En geç son key_down/mouse_down
  sonrası 30 saniyede otomatik bırakılır (`hold_ms` ile daha kısa seçilebilir).
  Basılı fare çerçeveler arasında taşınmaz; bu durumda bırakılır ve hata döner.
- Native `browser_settings` pencereyi boyutlandırmaz ve global pref değiştirmez.
  Her değişiklik/reset auto modda da island onayı ister; sekme seçilecekse soruda belirtilir.
  Önceki inline CSS/native override değerleri saklanır. Reset, devir, geri alma,
  disconnect ve köprü kapanışında geri yüklenir; sonradan yapılan manuel düzenlemeler korunur.
- Mobile/tablet/desktop genel Gecko görünüm preset'leridir. Safari/iPhone motoru veya
  tam bir donanım parmak izi taklidi değildir. UA yalnız açıkça verilirse değişir;
  maxTouchPoints spoof edilmez. `requested` hedef ayarları, diğer alanlar sayfanın
  gerçekten gördüğü değerleri verir. Native ölçek/mahremiyet davranışı nedeniyle
  piksel ölçüleri kesirli ve etkin DPR istenenden farklı olabilir. Sunucunun UA'ya göre
  yanıt vermesi için ajan gerektiğinde açıkça gezinme/yenileme yapmalıdır.
- `if_changed` piksel toleransı değil, aynı kodlanmış görüntü eşitliğidir. Önbellek
  8 MB / 32 öğe ile sınırlıdır. `annotate` iframe içeriğini etiketlemez; geçici
  etiketler çekimden sonra kaldırılır. Normal screenshot davranışı değişmez.

Doğrulama: `npm test`; gerçek MCP ile `node scripts/check-input.ts`.
Script yalnız kendi geçici sekmesini kullanır; görünüm ayarlarını ve eski seçili sekmeyi
sonunda geri yükler. Pano doğrulaması ayrıca `check-clipboard.ts` içindedir.
