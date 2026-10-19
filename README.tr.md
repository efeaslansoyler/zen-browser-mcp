# zen-mcp

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![Türkçe](https://img.shields.io/badge/dil-Türkçe-red)](README.tr.md)
[![Lisans: MIT](https://img.shields.io/badge/lisans-MIT-green)](LICENSE)

AI ajanları **kendi Zen tarayıcını** kullansın: senin sekmelerin, senin oturumların, gerçek fare
ve klavye girdisi ve pencerenin üstünde Claude'un ne yaptığını gösteren küçük bir ada.
Claude Code, Codex ve diğer MCP istemcileriyle çalışır. Firefox ve diğer Firefox tabanlı
tarayıcılarda da çalışır.

[![zen-mcp demosu: Claude arka plandaki sekmede alışveriş yapıyor, işlemden önce izin istiyor, ödemeyi sana bırakıyor ve gösterdiğin öğeyi alıyor](docs/demo.gif)](docs/demo.mp4)

## Neden

- **Gerçek girdi.** Tıklama, yazma ve kaydırma sayfaya tarayıcının içinden, gerçek
  (`isTrusted`) olaylar olarak ulaşır. WebDriver yok, uzaktan hata ayıklama portu yok,
  `navigator.webdriver` `false` kalır; siteler bot görmez.
- **Senin tarayıcın, senin pencerendesin.** Claude sekmelerini zaten kullandığın pencerede,
  arka planda, senin oturumlarınla açar. Odağı çalmaz; yalnız kendi sekmelerine ve senin
  verdiklerine dokunur.
- **Görür ve durdurursun.** Dynamic Island benzeri bir hap Claude'un ne yaptığını gösterir,
  üzerine gelince canlı önizleme açılır. Tek tıkla ya da <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Esc</kbd>
  ile durdurursun.
- **Tarif etme, göster.** Herhangi bir sayfada bir öğe seç, ne istediğini yaz; seçici,
  stiller, ekran görüntüsü ve React/Vue bileşen zinciriyle Claude Code oturumuna düşer.
- **Token dostu.** Kısa, tek satırlık cevaplar ve toplu çağrı aracı. Aynı form görevini yan
  yana denediğimizde Claude in Chrome'dan yaklaşık %25 daha az token harcadı.

## Gereksinimler

- Linux ya da macOS (Windows henüz desteklenmiyor)
- Node.js 22 ya da daha yenisi
- Normal kurulmuş Zen, Firefox, LibreWolf, Floorp ya da Waterfox. **Flatpak ve Snap
  sürümleri desteklenemez**: kurulum klasörleri salt okunur.
- Claude Code ya da başka bir MCP istemcisi

## Kurulum

```sh
npx zen-mcp install
```

Tarayıcını bulur, kurulum klasörüne küçük bir yükleyici ekler (klasör root'unsa `sudo`
ister) ve tarayıcı tarafı dosyalarını `~/.local/share/zen-mcp` klasörüne kopyalar.
Tarayıcında zaten bir autoconfig dosyası varsa (ör. Sine ya da fx-autoconfig) yükleyici ona
işaretli bir blok olarak eklenir; başka hiçbir şey değişmez.

Sonra tarayıcıyı yeniden başlat ve sunucuyu Claude Code'a ekle:

```sh
claude mcp add --scope user zen -- npx -y zen-mcp
```

Her şeyi `npx zen-mcp doctor` ile kontrol edebilirsin. Yeni sürümler, Claude Code sunucuyu
başlattığında tarayıcı tarafını kendiliğinden günceller; sudo ya da tarayıcıyı yeniden
başlatmak gerekmez.

> Bazı tarayıcı güncellemeleri kurulum klasörünü değiştirir (macOS uygulama güncellemeleri,
> tarball kurulumları). `doctor` yükleyicinin gittiğini söylerse `npx zen-mcp install`'ı
> yeniden çalıştır.

## Codex ve diğer MCP istemcileri

Standart tarayıcı araçları stdio MCP üzerinden çalışır. Yerel geliştirme kurulumu:

```sh
codex mcp add zen -- node /tam/yol/zen-mcp/src/server.ts
```

Diğer MCP istemcileri de aynı komutu veya derlenmiş `dist/cli.js` dosyasını başlatabilir.
Fare koordinatları istemci uyumluluğu için iki sayılık standart dizilerdir (`[x, y]`).

MCP bağlantısındaki istemci adı görünümü otomatik seçer: **Claude turuncu**, **Codex mint**,
diğer ajanlar kendi istemci adıyla mavi. Ada, sekme şeridi, imleç, tıklama halkası ve kullanıcıya
bırakılan adımın çerçevesi işlemi yapan ajanı izler. Sekme rengi tarayıcı yeniden açılınca korunur;
başka ajan aynı sekmeyi kullanırsa güncellenir. Aracı yazılım istemci adını gizliyorsa sunucunun
ortamına `ZEN_MCP_AGENT=codex` veya `ZEN_MCP_AGENT=claude` eklenebilir.

Kimlik yalnız görünüm içindir; kimlik doğrulama veya oturuma özel sekme yalıtımı sağlamaz.
İşlemler ortak kuyrukta yürür; Durdur/Devam ve otomatik/onaylı mod bütün ajanlar için ortaktır.
Kimlik bilgisi kullanıcının vermediği sekmeye erişim sağlamaz. Öğeyi sohbete gönderme Claude channels veya Codex queue ile çalışır;
diğer istemcilerde pano kullanılabilir.

## Kullanım

Claude'dan tarayıcıda bir şey yapmasını iste: *"seaskablo.com'u aç, fiyat listesini bul"*.
Claude arka planda kendi sekmesini açar; sekmede ajanın renginde bir çizgi belirir, ada ne olduğunu
gösterir. Sekmeye gitmek için adaya tıkla.

### Ada

- siteyi ve o anki işlemi gösterir (*tıklıyor*, *yazıyor*…); üzerine gelince canlı önizleme
- **■** Claude'u durdurur, **Devam et** sürdürür. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Esc</kbd> da çalışır
- Claude'un sana ihtiyacı olduğunda (ödeme onayı, captcha, giriş) adada sorar ve sayfadaki
  öğeyi çerçeveler; tarayıcı odakta değilse masaüstü bildirimi gelir
- sayfa diyalogları (`alert`, `confirm`) da orada görünür

### Sekme vermek

Sekmeye sağ tıkla → **Ajana ver**: ajan kaldığın yerden devam eder. **Ajandan geri
al** ile istediğin an bitirirsin.

### Ajana bir öğe göstermek

<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> ya da sağ tık → **Ajana göster…** ile öğeyi seç,
isteğini yaz ve adadaki listeden hedef oturumu seç. Sayfa adresi, seçici, erişilebilir ad,
stiller, metin, kısaltılmış HTML, öğenin görüntü yolu ve geliştirme sürümündeki bileşen zinciri gönderilir.

- **Claude Code:** `claude --dangerously-load-development-channels server:zen` ile channels'ı
  aç; oturum kendiliğinden bağlanır.
- **Codex:** bir kez `node dist/cli.js codex-hooks install` çalıştır (kurulu pakette
  `npx zen-mcp codex-hooks install`), sonra Codex'te `/hooks` ekranından üç Zen hook'una güven.
  SessionStart, Codex'in verdiği gerçek sohbet UUID'siyle alıcıyı başlatır;
  UserPromptSubmit bağlantıyı yeniler; SessionEnd kapatır. Sohbet açılınca/devam ettirilince
  ilk tarayıcı aracı çağrısından önce otomatik bağlanır. Aynı sohbet için ikinci alıcı
  açılmaz; MCP yeniden bağlansa da alıcı sürer, Zen kapanıp açılınca yeniden bağlanır.
  `connect_session` elle bağlantı için yedek kalır. Kaldırmak için `codex-hooks uninstall`.
  Ada ancak queue komutu kabul edilince **kuyruğa alındı** der; bu, ajanın okuması veya
  tamamlaması değildir. Denediğimiz aktif sohbette mesaj mevcut tur bitince geldi.
- **Diğer istemciler / bağlantı yok:** **Pano** seçeneğiyle kopyala ve ajana yapıştır.

Listede ajan, proje ve kısa oturum kimliği görünür. Yazma kutusu açılınca hedefler sabitlenir;
başka bir oturum etkinleşse de gönderim seçtiğin hedefe gider. Hedef koparsa veya gönderim
başarısız olursa bağlam panoya kopyalanır; başka sohbete sessizce yönlendirilmez.
Gönder'e iki kez basmak aynı seçimi iki kez göndermez.

Öğe seçmek sekmeyi ajana vermez. Canlı erişim gerekirse ajan `request_tab` ile sorar;
adadan onaylar veya reddedersin.

## Modlar ve hassas siteler

| | |
|---|---|
| **auto / otomatik** (varsayılan) | Claude sormadan işlem yapar |
| **ask / onaylı** | Claude her işlemden önce adada sorar: *button "Gönder": tıklamak*, *"merhaba" yazmak* |
| **hassas siteler** | mod ne olursa olsun her işlemde sorulur. Hazır liste yok, kendin eklersin |

İşlemler: tıklama, sürükleme, yazma, tuşa basma, form doldurma, dosya yükleme, JavaScript
çalıştırma, diyalog cevaplama ve onaylı modda başka adrese gitme. Okuma, ekran görüntüsü,
kaydırma ve bekleme her zaman serbest. Toplu işlemler tek soruyla onaylanır.

Modu adadan (Claude çalışırken), sekme sağ tık menüsünden (**Claude her işlemde izin
istesin**) ya da komutla değiştir:

```sh
npx zen-mcp config mode ask
npx zen-mcp config sensitive add bankam.com accounts.google.com
```

Ayarlar `~/.config/zen-mcp/config.json` dosyasında durur ve hemen geçerli olur.

Her tool çağrısı `~/.local/state/zen-mcp/activity.jsonl` dosyasına yazılır (zaman, site, ne
yapıldığı). Claude'a *"dün tarayıcıda ne yaptın?"* diye sorabilirsin.

## Tool'lar

Adlar ve parametreler Claude in Chrome ile aynı; yazdığın komutlar aynen çalışır.

| Tool | |
|---|---|
| `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp` | Claude'un sekmeleri |
| `navigate` | adrese gitme, geri, ileri |
| `computer` | ekran görüntüsü (`scale` ile), tıklamalar, hover, sürükleme, kaydırma, yazma, tuşlar, bekleme; koordinat ya da öğe ref'iyle |
| `read_page`, `find`, `get_page_text` | ref'li erişilebilirlik ağacı, kelimeyle arama, okunabilir metin. iframe'ler dahil, farklı sitedekiler de |
| `form_input`, `file_upload` | form değerleri; dosya seçme penceresi açmadan dosya yükleme |
| `wait_for` | metin ya da öğe görünene ya da kaybolana, ağ durulana kadar bekleme |
| `browser_batch` | yukarıdakilerden birkaçı tek çağrıda |
| `read_console_messages`, `read_network_requests` | konsol çıktısı; başlık ve gövdeleriyle istekler (çerez ve yetki bilgisi gizli) |
| `javascript_tool`, `handle_dialog` | sayfada JS çalıştırma; `alert`/`confirm`/`prompt` cevaplama |
| `connect_session` | Codex sohbetini tarayıcıdan seçim alacak şekilde bağlama |
| `ask_user`, `request_tab` | bir adımı sana bırakma; sekmene erişim isteme |

## Güvenlik

Kurmadan önce lütfen oku.

- **Tarayıcı tarafı tarayıcının tam yetkisiyle çalışır.** Gerçek girdiyi mümkün kılan bu;
  autoconfig de böyle çalışır. Kod [`browser/`](browser) klasöründe; `~/.local/share/zen-mcp`
  klasöründen yüklenir.
- **Onunla yalnız sen konuşabilirsin.** Köprü, çalışma klasöründe `0600` izinli bir Unix
  soketini dinler; ağ portu yok. Senin kullanıcınla çalışan başka programlar bağlanabilir;
  zaten tarayıcı profilini de değiştirebilirler.
- **Claude yalnız kendi sekmelerine** ve senin verdiklerine dokunur. Diğer sekmelerin
  listelenmez, kimliği bilinse de kullanılamaz.
- **Sayfalar Claude'u kandırmaya çalışabilir** (prompt injection) ve Claude senin
  oturumlarınla işlem yapar. Önemli işler için onaylı modu ya da hassas siteleri kullan,
  adayı takip et.
- **Ağ ayrıntılarında çerez ve yetkilendirme başlıkları gizlenir.**
- Her şeyi `npx zen-mcp uninstall` ile kaldırırsın.

## Nasıl çalışır

```
Claude Code ──stdio MCP──▶ npx zen-mcp ──Unix soket──▶ tarayıcı köprüsü (yetkili, tarayıcının içinde)
                                                        ├─ tarayıcı penceresinde ada ve menüler
                                                        └─ her çerçevede sayfa actor'ı: girdi, sayfa ağacı, seçici
```

Yükleyici birkaç satırlık bir [autoconfig](https://support.mozilla.org/kb/customizing-firefox-using-autoconfig).
Girdi, sayfanın sürecinde tarayıcının kendi `EventUtils`'iyle üretilir: Firefox'un WebDriver'ı
da böyle yapar, ama uzaktan kontrol açılmaz.

## Sorun giderme

- `npx zen-mcp doctor` her parçayı kontrol eder ve ne yapacağını söyler.
- Köprünün hataları `$XDG_RUNTIME_DIR/zen-mcp.log` dosyasına gider (macOS'ta `$TMPDIR`).
- Kurduktan sonra tarayıcıyı bir kez yeniden başlat; yükleyici yalnız açılışta çalışır.

## Geliştirme

```sh
git clone https://github.com/efeaslansoyler/zen-mcp && cd zen-mcp
npm install && npm run build
ln -s "$PWD/browser" ~/.local/share/zen-mcp   # tarayıcı tarafı doğrudan repodan
node dist/cli.js install                         # yükleyiciyi tarayıcına ekler
claude mcp add --scope user zen -- node "$PWD/src/server.ts"
node scripts/zenctl.ts reload                    # değişiklikten sonra köprüyü yeniden yükle
```

Mimari notlar ve karşılaştığımız Gecko tuzakları [`docs/DEVAM.md`](docs/DEVAM.md) dosyasında.

## Lisans

[MIT](LICENSE)
