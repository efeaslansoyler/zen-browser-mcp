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
bırakılan adımın çerçevesi işlemi yapan ajanı izler. Sekme rengi sahibi olan oturumu gösterir.
Tarayıcı yeniden açılınca geri yüklenen sekmeler yeniden açıkça verilmelidir; kayıtlı renk
erişim yetkisini geri getirmez. Aracı yazılım istemci adını gizliyorsa sunucunun
ortamına `ZEN_MCP_AGENT=codex` veya `ZEN_MCP_AGENT=claude` eklenebilir.

Ajan kimliği görünüm içindir. Sekme erişimi belirli bir MCP sunucu oturumuna aittir:
iki Codex istemcisinin sekme listeleri ayrıdır; birbirlerinin sekmelerini okuyamaz,
değiştiremez veya kapatamazlar. İşlemler ortak kuyrukta yürür; Durdur/Devam ve
otomatik/onaylı mod bütün ajanlar için ortaktır. Öğeyi sohbete gönderme Claude channels
veya Codex queue ile çalışır; diğer istemcilerde pano kullanılabilir.

Sahiplikteki MCP sunucu oturum kimliği, Codex sohbet UUID'sinden farklıdır. Ajan adı
veya proje klasöründen ilişki tahmin edilmez. Aynı MCP sunucu sürecini paylaşan sohbetler
tek sahiplik oturumudur; bu sohbetler arasında yalıtım sağlandığı iddia edilmez.

Ajanlar `tab_work` ile koordine olur: `list`/`status` ajanlara verilmiş sekmeleri,
yayınlanan görev özetlerini, çalışan işlem durumunu ve FIFO devir kuyruğunu gösterir.
Sayfa içeriği ve sohbet geçmişi paylaşılmaz. Sahip `start`, `update`, ardından devir
notuyla `finish` çağırır. Tek bir araç çağrısının bitmesi görevi bitirmez. Bekleyen
oturum varsa sahibin normal araç yanıtına kuyruk hatırlatması eklenir.

İkinci oturum `request` ile işi kesmeden sıraya girer. **Auto** modda görev açıkça
bitirildiğinde sekme devir notuyla ilk bağlı bekleyene geçer. **İzinli** modda ilk
bekleyen, görev hazır olunca `request_tab` çağırır; adada Ver/Verme onayı gerekir.
Bekleyen ajan `status` sorgular ve yalnız `ownedByCaller: true` olduğunda işlem yapar;
sohbeti kendiliğinden uyandırma yoktur. İstekler on dakikada sona erer, sıra kaybetmeden
yenilenebilir. On beş dakika görev güncellemesi gelmezse görev eski olarak işaretlenir,
bitmiş sayılmaz. Bağlantısı kopan veya takılan ajanın sekmesi sessizce devralınmaz;
kullanıcı sağ tık menüsünden devredebilir veya geri alabilir. Kullanıcının kendi
sekmesine erişim auto modda da seçilmiş `source_tab` ve açık `request_tab` onayı ister.

## Kullanım

Claude'dan tarayıcıda bir şey yapmasını iste: *"seaskablo.com'u aç, fiyat listesini bul"*.
Claude arka planda kendi sekmesini açar; sekmede ajanın renginde bir çizgi belirir, ada ne olduğunu
gösterir. Sekmeye gitmek için adaya tıkla.

### Birden çok öğe seç

Ctrl+Shift+F veya sayfa sağ tık menüsüyle seçiciyi aç. Shift+tık öğe ekler/çıkarır;
Enter seçilenleri bitirir. Aynı üst sayfadan en fazla sekiz öğe seçilebilir. Backspace
son seçimi çıkarır, Esc hepsini iptal eder; ok tuşları üst/alt öğeye geçmeyi sürdürür.
Normal tık eski tek öğe akışını korur. Numaralı çerçeveler öğeleri takip eder.
Adada tek not yazıp hedefi seç: her öğe kendi bağlamı ve varsa görünür alan görüntüsüyle
gider. Seçim sekmeye erişim vermez; göndermeden sayfa değişirse yeniden seçmek gerekir.

### Tekrarlanan okumalarda az çıktı

`read_page` ve `get_page_text`, `diff: true` alır. İlk yanıt `snapshot` kimliğiyle tam
çıktıyı verir. Sonraki çağrıda aynı araç/seçeneklerle bu kimliği `since` olarak gönder:
değişmediyse kısa yanıt, değiştiyse unified satır farkları ve yeni kimlik döner.
Farkları önceki yanıttaki metne uygula; metadata başlığını metne katma. Yalnız dönen
kapsam (kesilme dahil) karşılaştırılır; silinen satırlar eski durumdur, eski ref'lerini
kullanma. Snapshot metadata'sı sayfa içeriğinden ayrıdır.

Eksik/eski kimlik, farklı seçenek, gezinme, çerçeve belgesi veya sahiplik değişimi yeni
tam yanıta düşer. Pahalı/büyük farklarda da tam metin döner. Bellek sınırlıdır,
MCP oturumuna özeldir ve köprü reload'unda temizlenir. Varsayılan `diff: false`
düz metni korur ve toparlanmak için kullanılabilir. Mevcut istemcilerin yeni
parametreleri görmesi için MCP reconnect gerekir.

### Tıklama hedefi kontrolü

`computer` ref tıklamaları fare düğmesine basmadan önce seçilen noktayı kontrol eder;
üstünü kapatan öğenin ref'ini bildirir. İçteki simge kabul edilir, üst iframe'ler de
kontrol edilir. Hedef değişir veya örtülürse tıklama durur; ilk tıklamanın ardından başka
öğe açılırsa çoklu tıklamanın kalanı gönderilmez. Hover/scroll_to kullanılabilir;
örtü kendiliğinden kaldırılmaz. Koordinat, imleç hareketindeki değişimi yakalar fakat
çağrıdan önce örtülmüş amaçlanan kontrolü bilemez; ref tercih edilir. Çapraz süreç iframe
kontrolleri atomik değildir. Kontrol computer tıklamalarını kapsar; programatik JS/form
alanı değişikliklerine uygulanmaz.

### Ada

- siteyi ve o anki işlemi gösterir (*tıklıyor*, *yazıyor*…); üzerine gelince canlı önizleme
- **■** Claude'u durdurur, **Devam et** sürdürür. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Esc</kbd> da çalışır
- Claude'un sana ihtiyacı olduğunda (ödeme onayı, captcha, giriş) adada sorar ve sayfadaki
  öğeyi çerçeveler; tarayıcı odakta değilse masaüstü bildirimi gelir
- sayfa diyalogları (`alert`, `confirm`) da orada görünür

### Sekme vermek

Sekmeye sağ tıkla → **Oturuma ver…**, ardından ajan/proje/kısa oturum kimliğini seç.
**Oturuma devret…** sahibini değiştirir. **Ajandan geri al** erişimi ve çalışan işi hemen
keser. Sekme aynı oturuma geri verilse bile eski kuyruk istekleri yeniden çalışmaz.

MCP süreci kopunca çalışan iş hemen iptal edilir. Aynı sürecin yeniden bağlanabilmesi için
beş saniye sahiplik korunur; bağlanmazsa sekmeler açık kalarak kullanıcıya döner. Bu
güncellemeden sonra yaşam döngüsü takibi için MCP sunucusunu bir kez yeniden bağla.
Eski çalışan sunucular kullanılabilir; bağlantısı izlenemeyen oturumlar 24 saat etkinlik
olmazsa temizlenir.

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

## Girdi ve sekme benzetimi

Hover zaten `computer hover` ile çalışır. İsteğe bağlı `movement: "smooth" | "human"`
tıklama, hover, hareket ve drag sırasında gerçek ara fare olayları gönderir;
`duration_ms`, `steps`, `seed` ile yol ayarlanır. `typing: "human"` değişken gecikmelerle
karakter karakter yazar (`delay_ms`, `seed`). Varsayılan hızlı davranış korunur. Bunlar
etkileşim seçenekleridir; bot tespitini aşma garantisi değildir.

`computer key_down/key_up` tek tuşu tutar/bırakır (`text: "Shift"`, `"Control"`, `"a"`).
`mouse_move/mouse_down/mouse_up` ayrı fare kontrolü sağlar (`button: "left" | "middle" |
"right"`). Tutulan girdiler oturuma/çerçeveye özeldir. Hata, Durdur, gezinme, sahiplik
değişimi, kopma, reload ve en fazla 30 saniyelik süre sınırında bırakılır (`hold_ms`
daha kısa olabilir). Basılı Control/Meta üzerinden pano onayı atlanamaz.

Screenshot için `if_changed: true` aynı görüntüyü yeniden göndermez; `annotate: true`
üst çerçevedeki en fazla 80 görünür kontrolün ref'ini görüntüye ekler.

`browser_settings`: `get`, `devices`, `viewport`, `device`, `media`, `reset`.
Her değişiklik/reset auto modda da adadan izin ister; sekme değişecekse soruda belirtilir.
Viewport, DPR, touch-event, özel UA ve renk ayarları sekmeye özeldir; reset veya
sahiplik bırakılınca geri yüklenir. Pencere boyutu/global pref değiştirilmez.
Mobile/tablet/desktop genel Gecko preset'leridir. `requested` istenen ayarları, diğer
alanlar gerçekten görülen ölçüleri verir; native ölçek/mahremiyet nedeniyle fark olabilir.
Başka bir tarayıcı motoru veya fiziksel cihaz parmak izi taklidi değildir.

[Özellik karşılaştırması ve sınırlar](docs/FEATURE-COMPARISON.md).

## Sistem panosu

`clipboard` aracı `read`, `write`, `copy`, `paste` işlemlerini sunar. Her işlem auto
modda ve batch içinde de island üzerinden ayrı, tek kullanımlık onay ister.
Ctrl/Cmd+C/V/X ve Insert/Delete pano kısayolları da aynı onaydan geçer. Ret veya zaman
aşımında panoya erişilmez ve istenen işlem yapılmaz.

İstek bir ajana ait `tabId` ile tarayıcı bağlamına bağlanır. `read` düz metni
`untrusted`, `characters`, `truncated` bilgileriyle döndürür (`max_chars` varsayılan
20000, en fazla 100000). `write` panodaki metni değiştirir; metni cevaba veya etkinlik
günlüğüne yazmaz. `copy` mevcut seçimi kopyalar; `paste` bir düzenlenebilir `ref` veya
odaktaki alana yapıştırır. Yerel kopyalama/yapıştırma kullanılır, sayfaya sahte pano
olayı gönderilmez. Onay beklerken hedef değişirse istek geçersiz olur.

```json
{"action":"read","tabId":12,"max_chars":20000}
{"action":"write","tabId":12,"text":"Merhaba"}
{"action":"copy","tabId":12}
{"action":"paste","tabId":12,"ref":"ref_4"}
```

Açık eklenti panelinde copy/paste için `extensionId` ve panel ref'i verilir. Island
onayı beklenirken panelin kendiliğinden kapanması geçici olarak engellenir. Pano
işlemleri sekme değiştirmez. Site engelleme kuralları geçerlidir. Bu onay MCP pano
araçları ve standart kısayollar içindir; sitelerin/eklentilerin kendi bağımsız pano
yazımlarını genel olarak engellemez. Pano diğer uygulamalarla ortaktır; onaylı bir
yazım otomatik geri alınmaz. Yeni araç için MCP bağlantısını yenilemek gerekir.

## Tarayıcı eklentileri

Ajan kurulu eklentileri `tabs_context_mcp` cevabında veya `extensions list` ile görür.
Tek bir genel araçla eklentinin gerçek araç çubuğu panelini kullanır; eklentiye özel
API, kural veya entegrasyon yoktur.

```json
{"action":"open","tabId":12,"extensionId":"uBlock0@raymondhill.net"}
{"action":"read","tabId":12,"extensionId":"uBlock0@raymondhill.net"}
{"action":"computer","computerAction":"left_click","ref":"<read cevabındaki panel ref'i>","tabId":12,"extensionId":"uBlock0@raymondhill.net"}
{"action":"close","tabId":12,"extensionId":"uBlock0@raymondhill.net"}
```

`read`, `text`, `find`, `computer` (ekran görüntüsü, kaydırma, yazma ve tuşlar dahil) ve
`form_input` panel üzerinde çalışır. Panel ref'leri panel/belge kimliği taşır; sayfa
ref'leriyle karışmaz. Paneli olmayan ama araç çubuğu düğmesi olan eklenti de `open` ile
çalıştırılır; cevap panel olmadığını belirtir.

Hedef sekme seçili değilse, auto modda da sekme değiştirmeden önce adadan açık onay
istenir. Ret veya zaman aşımında sekme değişmez ve eklenti çalıştırılmaz. Hedef zaten
seçiliyse sekme geçiş onayı gerekmez; normal site/işlem izinleri geçerlidir. Eklenti
aktif sekmeyi kullandığından geçiş mevcut pencerede yapılır. Sekme çağıran oturuma ait olmalıdır. Site kuralları ve izinler kaynak siteye
uygulanır. Sekme değişimi, gezinme, sahiplik değişimi veya panelin kapatılması sonrası
yeniden açıp yeni ref almak gerekir. Durdur, oturum sonu ve köprü reload'u izlenen
panelleri kapatır.

Ajana geçici ayar değişikliklerini takip edip işi bitince arayüzden eski hâline döndürme
talimatı verilir. Oturum kesilirse otomatik geri alma garantisi yoktur. İlk sürüm araç
çubuğu panellerini kapsar; eklenti arka plan kodu, genel tarayıcı ayarları veya yalnız
kenar çubuğu sunan arayüzleri kapsamaz. Eklentinin açtığı yeni sekmeler normal sahiplik
kurallarına uyar; pano/indirme çıktıları mevcut host/dosya araçlarıyla alınır.

Yeni `extensions` aracının görünmesi için MCP istemcisinin bağlantısı yenilenmelidir;
yalnız tarayıcı köprüsünü reload etmek çalışan MCP sunucusunu yenilemez.

## Modlar ve site kuralları

Genel mod **auto / otomatik** (sormadan işlem) veya **ask / onaylı** (işlemden önce onay)
olabilir. Sekme sağ tık menüsü → **Ajan izinleri** → **Bu site** üzerinden siteye özel kural seçilir:

| Site kuralı | Davranış |
|---|---|
| **Genel ayarı kullan** | auto/ask moduna uyar; siteye özel kuralı kaldırır |
| **Her işlemde sor** | auto modda da işlem öncesinde onay ister |
| **Ajan erişimini engelle** | Sayfa okuma, ekran görüntüsü, işlem ve ajanın gezinmesini engeller |

Kurallar alt alan adlarını kapsar. Engelleme onay istemekten önceliklidir; alt alan adı
üst alan adının kuralını gevşetemez. Menü miras alınan kısıtlamayı gösterir. Hazır site
listesi yoktur. Engelli bir iframe içeren sayfaya da erişilemez; ekran görüntüsü de buna
dahildir. Engelli sekme yine kapatılabilir veya kullanıcıya geri verilebilir.

İşlemler: tıklama, sürükleme, yazma, tuşa basma, form doldurma, dosya yükleme, JavaScript
çalıştırma ve diyalog cevaplama. Genel onaylı modda gezinme de izin ister. Siteye özel
“Her işlemde sor” eski hassas site davranışını korur: gezinme ve okumada onay istemez.
Erişim engellenmediyse okuma, ekran görüntüsü, kaydırma ve bekleme onay gerektirmez.
Aynı sayfadaki toplu işlemler tek onayı paylaşır. Gezinme, yönlendirme, yenileme ve kural
değişiklikleri onayı geçersiz kılar; izin reddedilirse kalan adımlar çalışmaz.

Genel modu adadan veya sekme sağ tık menüsünden değiştirebilirsin. CLI karşılıkları:

```sh
npx zen-mcp config mode ask
npx zen-mcp config site ask accounts.google.com
npx zen-mcp config site block bankam.com
npx zen-mcp config site default accounts.google.com
npx zen-mcp config site list
```

Ayarlar `~/.config/zen-mcp/config.json` dosyasında durur ve hemen geçerli olur:

```json
{"mode":"auto","sites":{"accounts.google.com":"ask","bankam.com":"block"}}
```

Eski `sensitive` kayıtları onay kuralı olarak okunur, ilk ayar yazımında yeni yapıya taşınır.
`config sensitive add|remove` komutları uyumluluk için çalışır. Bu kurallar Zen MCP erişimini
yönetir; kullanıcının gezinmesini veya sistemin bütün ağını filtrelemez. Ajan çağrısı
sırasında engelli alan adlarına HTTP istekleri ve yönlendirmeler iptal edilir; tarayıcının
bağımsız arka plan etkinliği genel olarak filtrelenmez.

Her tool çağrısı `~/.local/state/zen-mcp/activity.jsonl` dosyasına yazılır (zaman, site, ne
yapıldığı). Claude'a *"dün tarayıcıda ne yaptın?"* diye sorabilirsin.

## Tool'lar

Adlar ve parametreler Claude in Chrome ile aynı; yazdığın komutlar aynen çalışır.

| Tool | |
|---|---|
| `tab_work` | ortak görev durumu, FIFO devir istekleri ve bağlam |
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
