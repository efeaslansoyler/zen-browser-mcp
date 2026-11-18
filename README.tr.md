# zen-browser-mcp

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![Türkçe](https://img.shields.io/badge/dil-Türkçe-red)](README.tr.md)
[![Lisans: MIT](https://img.shields.io/badge/lisans-MIT-green)](LICENSE)

> [!WARNING]
> **Vibe-coded: kullanım riski sana ait.** Bu projenin neredeyse tamamını AI kodlama ajanları
> yazdı. Testleri var ama bir güvenlik denetiminden geçmedi.
>
> Ayrıca çoğu tarayıcı aracından farklı çalışır: ayrı bir tarayıcıyı yönetmez, **kendi
> tarayıcının içinde** tam tarayıcı yetkileriyle (autoconfig üzerinden) çalışır ve ajanlar
> **senin oturumlarınla** işlem yapar. Yani:
>
> - Bir hata sandbox'ı değil, gerçek tarayıcını, sekmelerini ve hesaplarını etkiler.
> - Kötü niyetli bir sayfa ajanı hesaplarınla bir şey yapmaya ikna etmeye çalışabilir (prompt
>   injection).
> - Loader tarayıcının kurulum klasörüne yazılır (bazen `sudo` ile).
> - Senin kullanıcınla çalışan her program bridge'in socket'ine bağlanabilir.
>
> Otomatik ya da onaylı modu koru, ajanların hiç girmemesi gereken siteleri engelle, adayı
> takip et ve kaybetmeyi göze alamayacağın hesapların olduğu bir tarayıcı profilinde kullanma.
> Bkz. [Güvenlik](#güvenlik).

AI ajanları **kendi Zen tarayıcını** kullansın: senin sekmelerin, senin oturumların, gerçek fare
ve klavye girdisi ve pencerenin üstünde Claude'un ne yaptığını gösteren küçük bir ada.
Claude Code, Codex ve diğer MCP istemcileriyle çalışır. Firefox ve diğer Firefox tabanlı
tarayıcılarda da çalışır.

[![zen-browser-mcp demosu: Claude arka plandaki sekmede alışveriş yapıyor, işlemden önce izin istiyor, ödemeyi sana bırakıyor ve gösterdiğin öğeyi alıyor](docs/media/demo.gif)](docs/media/demo.mp4)

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
npx zen-browser-mcp install
```

Tarayıcını bulur, kurulum klasörüne küçük bir yükleyici ekler (klasör root'unsa `sudo`
ister) ve tarayıcı tarafı dosyalarını `~/.local/share/zen-mcp` klasörüne kopyalar.
Tarayıcında zaten bir autoconfig dosyası varsa (ör. Sine ya da fx-autoconfig) yükleyici ona
işaretli bir blok olarak eklenir; başka hiçbir şey değişmez.

Sonra tarayıcıyı yeniden başlat ve sunucuyu Claude Code'a ekle:

```sh
claude mcp add --scope user zen -- npx -y zen-browser-mcp
```

İstersen ajan skill'ini de ekle. Ajana hangi durumda hangi tool'u kullanacağını öğretir: yeni
sekme yerine açık olan sekmen, girişi ve 2FA'yı sana bırakmak, beklerken bloklamamak. Kurulu
olan client'ların skill klasörlerine gider (`~/.claude/skills`, Codex için `~/.agents/skills`):

```sh
npx zen-browser-mcp skill install
```

Her şeyi `npx zen-browser-mcp doctor` ile kontrol edebilirsin. Yeni sürümler, Claude Code sunucuyu
başlattığında tarayıcı tarafını kendiliğinden günceller; sudo ya da tarayıcıyı yeniden
başlatmak gerekmez.

> Bazı tarayıcı güncellemeleri kurulum klasörünü değiştirir (macOS uygulama güncellemeleri,
> tarball kurulumları). `doctor` yükleyicinin gittiğini söylerse `npx zen-browser-mcp install`'ı
> yeniden çalıştır.

## Codex ve diğer MCP istemcileri

Standart tarayıcı araçları stdio MCP üzerinden çalışır. Yerel geliştirme kurulumu:

```sh
codex mcp add zen -- node /tam/yol/zen-browser-mcp/src/server.ts
```

Diğer MCP istemcileri de aynı komutu veya derlenmiş `dist/cli.js` dosyasını başlatabilir.
Fare koordinatları istemci uyumluluğu için iki sayılık standart dizilerdir (`[x, y]`).

MCP bağlantısındaki istemci adı görünümü otomatik seçer: **Claude turuncu**, **Codex mint**,
**Antigravity mavi**, **OpenCode gri**, her biri kendi simgesiyle; diğer ajanlar kendi
istemci adıyla açık mavi. Oturum seçtiren menüler, bağlı oturumların hepsi aynı ajansa onun
simgesini, farklı ajanlar varsa ortak bir simge gösterir. Ada, sekme şeridi, imleç, tıklama halkası ve kullanıcıya
bırakılan adımın çerçevesi işlemi yapan ajanı izler. Sekme rengi sahibi olan oturumu gösterir.
Tarayıcı yeniden açılınca geri yüklenen sekmeler yeniden açıkça verilmelidir; kayıtlı renk
erişim yetkisini geri getirmez. Aracı yazılım istemci adını gizliyorsa sunucunun
ortamına `ZEN_MCP_AGENT=codex` veya `ZEN_MCP_AGENT=claude` eklenebilir.

Ajan kimliği görünüm içindir. Sekme erişimi belirli bir MCP sunucu oturumuna aittir:
iki Codex istemcisinin sekme listeleri ayrıdır; birbirlerinin sekmelerini okuyamaz,
değiştiremez veya kapatamazlar. İşlemler ortak kuyrukta yürür; Durdur/Devam ve
otomatik/onaylı mod bütün ajanlar için ortaktır. Seçimlerin ve tariflerin sohbete
nasıl ulaştığı istemciye göre değişir; bkz. [Ajana bir öğe göstermek](#ajana-bir-öğe-göstermek).
Pano her istemcide kullanılabilir.

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
  öğeyi çerçeveler; tarayıcı odakta değilse masaüstü bildirimi gelir.
  Giriş bilgilerini ve 2FA kodlarını sen yazarsın: Claude adımı sana bırakır ve **Bitti**'yi
  bekler, yani bilgilerin ondan hiç geçmez
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

Hedef listesi her oturumun nasıl alacağını yazar: **hemen**, **yazınca** ya da **sonraki
işleminde**.

- **Hemen**, istemcinin bir yolu varsa:
  - **Claude Code**, [channels](https://code.claude.com/docs/en/channels) ile:
    `claude --dangerously-load-development-channels server:zen`. Claude Code bu flag'i `-p`
    modunda ve onu Agent SDK ile çalıştıran uygulamalarda (örneğin T3 Code) yok sayar.
  - **Codex**, `codex queue` ile (ayrıntılar aşağıda).
  - **T3 Code** thread'leri, `t3 thread send` ile. Mesaj thread'de `[zen]` işaretli bir
    kullanıcı mesajı olarak görünür.
  - **OpenCode**, zen plugin'i ile (`hooks install`, aşağıda): en son yazdığın oturuma, o
    oturumun ajanı ve modeliyle yeni bir mesaj olarak gider.
- **Yoksa bekler** ve bir kez gider: oturumun bir sonraki tarayıcı aracı sonucuyla, ya da
  prompt hook'ları kuruluysa o oturuma yazdığın bir sonraki mesajla:

  ```sh
  npx zen-browser-mcp hooks install
  ```

  Kurulu olan istemciler için Claude Code'a bir `UserPromptSubmit` hook'u, Codex'e yaşam
  döngüsü hook'larını, Antigravity CLI'a bir `PreInvocation` hook'u ve OpenCode'a bir plugin
  ekler. Diğer hook'lar ve ayarlar korunur, değişen dosyaların önce yedeği alınır. Kurulu
  olup olmadıklarını `doctor` gösterir; `hooks uninstall` ile kaldırılır. Codex yeni hook'lar
  için bir kez `/hooks` ekranında onay ister.
- **Pano:** adada **Pano**'yu seç ve istediğin ajana yapıştır.

Codex ayrıntıları: SessionStart, Codex'in verdiği gerçek sohbet UUID'siyle alıcıyı başlatır;
UserPromptSubmit bağlantıyı yeniler; SessionEnd kapatır. Sohbet açılınca/devam ettirilince
ilk tarayıcı aracı çağrısından önce otomatik bağlanır. Aynı sohbet için ikinci alıcı açılmaz;
MCP yeniden bağlansa da alıcı sürer, Zen kapanıp açılınca yeniden bağlanır.
`connect_session` elle bağlantı için yedek kalır; `codex-hooks install|uninstall` hâlâ
yalnızca Codex hook'larını yönetir. Ada ancak queue komutu kabul edilince **kuyruğa alındı**
der; bu, ajanın okuması veya tamamlaması değildir. Denediğimiz aktif sohbette mesaj mevcut tur
bitince geldi.

Listede ajan, proje ve kısa oturum kimliği görünür. Yazma kutusu açılınca hedefler sabitlenir;
başka bir oturum etkinleşse de gönderim seçtiğin hedefe gider. Oturum gönderdiğini almadan
kapanırsa veya gönderim başarısız olursa bağlam panoya kopyalanır; başka sohbete sessizce yönlendirilmez.
Gönder'e iki kez basmak aynı seçimi iki kez göndermez.

Öğe seçmek sekmeyi ajana vermez. Canlı erişim gerekirse ajan `request_tab` ile sorar;
adadan onaylar veya reddedersin.

### Bir kez göster

Bazı işleri anlatmaktansa göstermek daha hızlı. Ajan bir işi sana bir kez göstermeni isteyebilir
(`show_me`): sen işi sekmede yaparken ada tek satırlık bir kayıt göstergesine döner
("Kaydediliyor · 3 adım") ve kaydedilen her öğe kısa bir an yanıp söner. Kaydı kendin de
başlatabilirsin: herhangi bir sayfada sağ tık → **Ajan için adımları kaydet…**.

**Bitir**'e basınca ada adımları gözden geçirmen için gösterir:

- Tarife bir ad ver. Var olan bir adla kaydetmek o tarifin üzerine yazar (buton bunu söyler).
- Yanlış adımları sil (✕), her seferinde değişen değerleri işaretle (**↻ Değişir**): ajan
  kaydedilen değeri tekrarlamak yerine onu isteğinden alır ya da sana sorar.
- Adımları ekran görüntüleriyle, her öğeye yakınlaşarak **Oynat** (← → ile adım adım, Esc ile
  listeye dönüş).
- Bir not ekle, istersen **Agent hemen denesin**'i işaretle. Kaydı sen başlattıysan, bir öğe
  seçimi gibi göndereceğin oturumu seç.

Tıklamalar, yazılanlar, seçimler, onay kutuları, dosya yüklemeleri ve özel tuşlar iframe'ler
dahil kaydedilir; kaydırma ve fare hareketi kaydedilmez. Şifre, kart ve tek kullanımlık kod
alanlarına yazılanlar hiç kaydedilmez: o adımlar "gizli" görünür ve ajan onları sana bırakır.

Tarifler `~/.local/state/zen-mcp/recipes/` altında saklanır (adımlar ve ekran görüntüleri;
bilgisayarından çıkmaz). `tabs_context_mcp` ajanlara açık sitelerin tariflerini söyler; `recipes`
aracı onları listeler ve kendi araçlarıyla tekrarlanacak adımlar olarak verir; silmeden önce
sana sorar. Terminalden: `npx zen-browser-mcp recipes [list] | show <id> | rm <id>`.

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

[Özellik karşılaştırması ve sınırlar](docs/feature-comparison.md).

## React ve erişilebilirlik incelemesi

`react`, DOM'a bağlı React bileşen ağacını (`action: "tree"`) veya bir öğenin üst
bileşen zincirini (`action: "inspect", ref: "ref_4"`) okur. `include_props: true`
sınırlı props önizlemesi ekler; varsayılan kapalıdır. Getter veya bileşen çağrılmaz.
`max_depth` varsayılan 12/en fazla 30; `max_nodes` varsayılan 100/en fazla 300.
Özel Fiber verisi kullanıldığı için React sürüm uyumu best-effort'tur; küçültülmüş
adlar ve yalnız sunucuda bulunan bileşenler geri getirilemez. DevTools hook'u
kurulmaz ve render geçmişi kaydedilmez.

`accessibility`, paketlenmiş **axe-core 4.14.0** ile yerel tarama yapar: `violations`,
elle incelenmesi gereken `incomplete` bulgular, sayılar ve etkilenen öğelerin ref'leri.
`tags` ile kural etiketleri (ör. `["wcag2a", "wcag2aa"]`), `ref` ile alt ağaç seçilir.
`max_nodes` kural başına öğe sayısını (varsayılan 10/en fazla 50), `max_rules` sonuç
grubu/çerçeve başına ayrıntılı kural sayısını (varsayılan 100/en fazla 200) sınırlar.
Çerçeve başına 20 saniye, toplam iş için 45 saniye sınırı vardır. Dış servis veya
sayfanın `window.axe` nesnesi kullanılmaz; bitiş/iptal/zaman aşımında sandbox yok edilir.

İki araç da sekme sahipliğine ve izinlere uyar: onaylı modda sorar, engelli sitede
reddedilir. Ref verilmezse erişilebilen çerçeveler ayrı ayrı incelenir; başarısız
çerçeveler açıkça raporlanır. Çerçeveler arası erişilebilirlik ilişkileri değerlendirilmez.
Ref verilirse yalnız ilgili çerçeve/alt ağaç incelenir, iç iframe'ler taranmaz.
İnceleme sırasında belge değişirse sonuç geçersiz olur. Props ve bulgular güvenilmeyen
sayfa verisidir; props hassas değerler içerebilir. Otomatik test, erişilebilirlik
uyumluluğunu tek başına kanıtlamaz.

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

## Zen çalışma alanları

Ajan sekmeleri bulunduğun çalışma alanında açılır. Önüne çıkmasınlar istersen sekme sağ tık
menüsü → **Ajan ayarları** → **Yeni ajan sekmeleri şurada açılır** ile bir alan seç (ya da
`npx zen-browser-mcp config workspace <ad>`, geri almak için `current`). Alan yoksa sana geçiş
yapılmadan oluşturulur. Ajanlar gizli alanda da her zamanki gibi çalışır: okuma, girdi ve
ekran görüntüsü için sekmenin görünmesi gerekmez; adadaki sekmeye git düğmesi seni oraya götürür.

## Temiz sekmeler

Ajan sekmeleri varsayılan olarak senin girişlerini kullanır; ajan senin hesaplarında iş
yapacaksa istediğin de budur. Araştırma ya da güvenmediğin siteler için ajan **temiz sekme**
açabilir (`tabs_create_mcp`, `clean: true`): sekme aynı pencerede ama ayrı bir **Agent**
container'ında, kendi cookie'leri, girişleri ve site verisiyle çalışır. Bütün yeni ajan
sekmelerinin temiz olması için `npx zen-browser-mcp config container Agent` (geri almak için
`off`). Geçmiş ve eklentiler yine ortaktır; ajana verdiğin kendi sekmelerin kendi container'larında kalır.

## İzin modları ve siteler

Ajanların ne yapabileceğine iki ayar karar verir: **izin modu** hangi işlemlerin onayını
isteyeceğini, **site listesi** de ajanların hangi sitelere hiç girebileceğini belirler.

### İzin modları

| Mod | Neyden önce sorar |
|---|---|
| **ask / onaylı** | Her eylemden önce: tıklama, yazma, tuş, form, gezinme, diyalog, inceleme. Sayfa okuma, ekran görüntüsü, kaydırma ve seninle konuşma serbesttir. |
| **auto / otomatik** (varsayılan) | Yalnızca riskli işlemlerden önce: form gönderme; şifre, kart ya da tek kullanımlık kod alanlarına yazma; JavaScript çalıştırma; dosya yükleme; sayfa diyaloglarını kabul etme; eklenti panellerinde işlem; panona, kendi sekmelerine ya da tarayıcı ayarlarına dokunan her şey. |
| **custom / özel** | Kendi `permissions.jsonc` dosyanda ne yazıyorsa. |

"Form gönderme", bir formun gönder butonuna tıklamak ya da formu gönderen bir yerde Enter
veya Boşluk'a basmaktır. Mesaj gönderen ya da satın alan ama form kullanmayan, düz JavaScript
butonlu siteler algılanmaz; onlar için **ask** modunu kullan ya da siteyi engelle.

Modu adadaki mod düğmesinden, sekme sağ tık menüsü → **Ajan ayarları**'ndan ya da
`npx zen-browser-mcp config mode ask|auto|custom` ile değiştirebilirsin. Aynı sayfadaki toplu
işlemler tek onayı paylaşır; gezinme, yönlendirme, yenileme ya da ayar değişikliği onayı
geçersiz kılar, reddedersen kalan adımlar çalışmaz.

### Kendi şablonun (custom)

```sh
npx zen-browser-mcp config permissions init      # ya da: init ask, ask şablonundan başlamak için
$EDITOR ~/.config/zen-mcp/permissions.jsonc
npx zen-browser-mcp config mode custom
```

Dosyada her işlem listelenir (her tool, `computer.click` ya da `clipboard.read` gibi büyük
tool'ların her eylemi, ayrıca `submit` ve `secret_field`); yanındaki yorum ne yaptığını ve
hazır şablonlardaki kuralını söyler. Her birini `"allow"`, `"ask"` ya da `"deny"` yap; sildiğin
satırlar temel şablonun kuralını kullanır:

```jsonc
{
  "base": "auto",
  "rules": {
    "navigate": "ask",           // (ask / allow) Go to an address, back or forward.
    "javascript_tool": "deny",   // (ask / ask) Run any JavaScript in the page…
    "submit": "allow"            // (ask / ask) Submit a form…
  }
}
```

> [!CAUTION]
> Özel şablonda her şeye sen karar verirsin; hazır şablonların her zaman sorduğu şeylere de
> izin verebilirsin: panon, kendi sekmelerin, form gönderme, gizli alanlar. Oradaki bir
> `"allow"`, bir ajanın ya da onu kandıran bir sayfanın bunu senin oturumlarınla sormadan
> yapabileceği anlamına gelir.

`npx zen-browser-mcp config permissions`, dosyanın temel şablondan neleri değiştirdiğini
gösterir. Yanlış yazılmış bir işlem adı ya da bozuk bir dosya hatadır (tool'lar hata verir,
`doctor` bildirir); asla daha gevşek kurallara düşmez.

### Siteler

Site listesi ya bir **blocklist**tir (varsayılan: ajanlar listedekiler dışında her siteyi
kullanabilir) ya da bir **allowlist** (ajanlar yalnızca listedekileri kullanabilir). İki liste
de saklanır, geçiş yapınca hiçbiri kaybolmaz; yalnızca etkin olan geçerlidir. Bir alan adı alt
alan adlarını da kapsar. Mevcut siteyi sekme sağ tık menüsü → **Ajan ayarları**'ndan aç/kapat
ya da:

```sh
npx zen-browser-mcp config site block bankam.com
npx zen-browser-mcp config site unblock bankam.com
npx zen-browser-mcp config site allow localhost github.com
npx zen-browser-mcp config site mode allowlist
npx zen-browser-mcp config site list
```

Ajanların kullanamadığı bir site onlara tamamen kapalıdır: okuma, ekran görüntüsü, işlem ve
gezinme yok; sekme listesinde yalnızca kimliği görünür. Sayfanın içindeki engelli bir iframe
sayfayı da engeller. Ajanlar engelli bir sekmeyi yine kapatabilir ya da sana geri verebilir.
Ajan çağrısı sırasında engelli bir host'a giden istekler iptal edilir; allowlist'te yalnızca
sayfa ve iframe yüklemeleri iptal edilir, çünkü izinli siteler başka host'lardan (CDN'ler)
kaynak yükler. Host'u olmayan sayfalar (`about:blank`, yerel dosyalar) site sayılmaz ve
kısıtlanmaz. Liste ajanları yönetir, senin gezinmeni değil; bir ağ firewall'u da değildir.

Ayarlar `~/.config/zen-mcp/config.json` dosyasında durur ve hemen geçerli olur:

```json
{"mode": "auto", "sites": {"mode": "blocklist", "blocklist": ["bankam.com"], "allowlist": []}}
```

Her tool çağrısı `~/.local/state/zen-mcp/activity.jsonl` dosyasına yazılır (zaman, site, ne
yapıldığı). Sekmeye sağ tık → **Ajan geçmişi** o sekmede ajanların son işlemlerini, **Tüm
geçmiş…** oturumlara göre gruplu bütün kaydı gösterir. Claude'a *"dün tarayıcıda ne yaptın?"*
diye de sorabilirsin.

## Tool'lar

Adlar ve parametreler Claude in Chrome ile aynı; yazdığın komutlar aynen çalışır.

| Tool | |
|---|---|
| `tab_work` | ortak görev durumu, FIFO devir istekleri ve bağlam |
| `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp` | Claude'un sekmeleri |
| `navigate` | adrese gitme, geri, ileri |
| `computer` | ekran görüntüsü (`scale` ile), tıklamalar, hover, sürükleme, kaydırma, yazma, tuşlar, bekleme; koordinat ya da öğe ref'iyle |
| `react`, `accessibility` | React bileşen ağacı/üst bileşen props ve yerel axe-core denetimi; çerçeve bazlı rapor |
| `read_page`, `find`, `get_page_text` | ref'li erişilebilirlik ağacı, kelimeyle arama, okunabilir metin. iframe'ler dahil, farklı sitedekiler de |
| `form_input`, `file_upload` | form değerleri; dosya seçme penceresi açmadan dosya yükleme |
| `wait_for` | metin ya da öğe görünene ya da kaybolana, ağ durulana kadar bekleme |
| `browser_batch` | yukarıdakilerden birkaçı tek çağrıda |
| `read_console_messages`, `read_network_requests` | konsol çıktısı; başlık ve gövdeleriyle istekler (çerez ve yetki bilgisi gizli) |
| `downloads` | sekmeden indirilen dosyalar: durum, yol, boyut/ilerleme; `wait` dosya bitene kadar bekler ve sha256'sını verir; `cancel` indirmeyi durdurup yarım dosyayı siler |
| `javascript_tool`, `handle_dialog` | sayfada JS çalıştırma; `alert`/`confirm`/`prompt` cevaplama |
| `connect_session` | Codex sohbetini tarayıcıdan seçim alacak şekilde bağlama |
| `highlight` | öğeleri kısa etiketli çerçevelerle sana gösterme (aynı anda birden çok, iframe'ler dahil) |
| `show_me`, `recipes` | bir işi bir kez göstermeni isteyip tarif olarak kaydetme; tarifleri listeleme, okuma ve (sen onaylayınca) silme |
| `ask_user`, `hand_to_user`, `request_tab` | sana soru sorma (cevap butonlarıyla, sekmeli ya da sekmesiz); yalnız senin yapman gereken bir adımı sana bırakma (giriş, 2FA, captcha, ödeme) ve **Bitti**'ye basınca devam etme; sekmene erişim isteme |

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
  oturumlarınla işlem yapar. Önemli işler için varsayılan otomatik modu koru ya da onaylı
  modu kullan, ajanların hiç girmemesi gereken siteleri engelle, adayı takip et.
- **Ağ ayrıntılarında çerez ve yetkilendirme başlıkları gizlenir.**
- Her şeyi `npx zen-browser-mcp uninstall` ile kaldırırsın.

## Nasıl çalışır

```
Claude Code ──stdio MCP──▶ npx zen-browser-mcp ──Unix soket──▶ tarayıcı köprüsü (yetkili, tarayıcının içinde)
                                                        ├─ tarayıcı penceresinde ada ve menüler
                                                        └─ her çerçevede sayfa actor'ı: girdi, sayfa ağacı, seçici
```

Yükleyici birkaç satırlık bir [autoconfig](https://support.mozilla.org/kb/customizing-firefox-using-autoconfig).
Girdi, sayfanın sürecinde tarayıcının kendi `EventUtils`'iyle üretilir: Firefox'un WebDriver'ı
da böyle yapar, ama uzaktan kontrol açılmaz.

## Sorun giderme

- `npx zen-browser-mcp doctor` her parçayı kontrol eder ve ne yapacağını söyler.
- Köprünün hataları `$XDG_RUNTIME_DIR/zen-mcp.log` dosyasına gider (macOS'ta `$TMPDIR`).
- Kurduktan sonra tarayıcıyı bir kez yeniden başlat; yükleyici yalnız açılışta çalışır.

## Geliştirme

```sh
git clone https://github.com/efeaslansoyler/zen-browser-mcp && cd zen-browser-mcp
npm install && npm run build
ln -s "$PWD/browser" ~/.local/share/zen-mcp   # tarayıcı tarafı doğrudan repodan
node dist/cli.js install                         # yükleyiciyi tarayıcına ekler
claude mcp add --scope user zen -- node "$PWD/src/server.ts"
node scripts/zenctl.ts reload                    # değişiklikten sonra köprüyü yeniden yükle
```

Testler ve canlı kontroller [CONTRIBUTING.md](CONTRIBUTING.md)'de; mimari notlar ve karşılaştığımız Gecko tuzakları [docs/](docs/README.md) altında (İngilizce).

## Lisans

[MIT](LICENSE)
