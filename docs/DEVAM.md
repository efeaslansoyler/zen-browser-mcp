# zen-mcp: kaldığımız yer

Yeni oturumda önce bunu oku. Kararlar ve fazlar için ayrıca [`PLAN.md`](PLAN.md).

## Güncel devir özeti — 2026-10-20

### Güncel çalışma — örtülü öğe / tıklama kontrolü (2026-10-20)

**Güncel sonuç: canlı hit-test doğrulaması GEÇTİ.** Efe düzeltilen
`node scripts/check-hit-test.ts` betiğini terminalinde çalıştırdı (v3 → reload).
Dört ref click türünde örtünün engellenmesi, kısmi batch çıktısı ve kalan yazmanın
kesilmesi, span/shadow çocuklar, pointer-events:none, mousemove sırasında açılan
örtü, gerçek screenshot oranıyla koordinat, çoklu tıklamada hedef değişimi,
devre dışı kontrol, çapraz origin ve iç içe iframe üstündeki modal sınamaları geçti.
Test sekmesi kapatıldı; izin ayarları değişmedi. Aşağıdaki ilk başarısız deneme ve
EPERM/bekleyen kayıtları bu başarılı sonucun öncesindedir. Kod henüz commit değil.


İlk kullanıcı canlı denemesinde dört click türünün örtüyle engellenmesi, batch'in
kalan yazmayı durdurması, span/pointer-events:none ve hover katmanı kontrolleri geçti.
Ölçekli koordinat adımında sayaç `2 !== 3` oldu. Test betiği istenen screenshot
scale=0.5'i gerçek oran sanıyordu; MAX_EDGE/MAX_PIXELS sınırları gerçek oranı daha
küçük yapabilir. Betik artık o screenshot için kaydedilmiş gerçek `state.scale`
oranını kullanır. Büyük viewport + otomatik boyut sınırı regresyon testi eklendi;
15 hit-test testi geçti. Bu düzeltme test sürücüsündedir, üretim koordinat dönüşümü
aynı kaldı. Düzeltilen canlı testin ardından yapılan tekrarı yukarıdaki gibi geçti.
Önceki test sekmesi kapandı, ayarlar değişmedi.


`computer` içindeki left/right/double/triple
click yollarında hit-test eklendi. Ref hedefi locate aşamasında ve içerik actor'ında
fare düğmesine basılmadan önce doğrulanır. Örtülüyse hata engelleyen öğenin kısa
etiketini ve ref'ini verir; katman gizlenmez, zorla tıklama yapılmaz.

- Ref'in çocuğu (ikon/span), shadow/slotted alt öğesi kabul edilir. Tarayıcı hit testi
  pointer-events:none katmanları doğal olarak atlar. Devre dışı, kopmuş ve viewport
  dışındaki hedefler reddedilir. Büyük hedeflerde görünür kesişimin merkezi kullanılır.
- İmleç hareketi ve gerçek mousemove sonrasında, her mouse-down öncesinde yeniden
  kontrol vardır. İlk tıklama hedefi değiştirirse double/triple kalan tıklamaları
  göndermez; ilk tıklamanın yapılmış etkisi geri alınmaz. Hata halinde press görünümü
  temizlenir. İptal davranışı korunur.
- Ref iframe içindeyse her üst iframe kutusu hit-test edilir; en içteki hit çerçevesi
  ref'in çerçevesiyle eşleşmiyorsa input gönderilmez. Çapraz süreç kontrolleri atomik
  değildir; üst sayfanın son kontrolden sonra değişmesi için dar bir yarış aralığı kalır.
- Salt koordinat ilk anda vurulan öğeyi sabitler ve hareket sırasında değişirse keser;
  çağrıdan önce örtülmüş, ajanın amaçladığı gizli hedefi koordinattan çıkaramaz.
  Kontrollerde ref tercih edilir. Merkez örtülüyse açık kenarı kendiliğinden seçmez.
- Hover/scroll_to örtülü öğeye konumlanabilir. Bu katman `computer` tıklamalarını
  kapsar; javascript_tool ve programatik form_input davranışına görünürlük şartı eklemez.
- 14 yeni hit-test testiyle **87 soketsiz test geçti** (hook test dosyası hariç),
  build/syntax/diff kontrolleri geçti. Gerçek actor ve ana süreç fonksiyonları platform
  sınırlarında sahte DOM ile çalıştırıldı; bu canlı tarayıcı sonucu değildir.
- Canlı sürücü: `node scripts/check-hit-test.ts`. Mevcut auto modu ister; ayarları
  değiştirmez. Köprüyü reload eder, yalnız bir disposable sekmede gerçek tıklamalarla
  dört click türü/örtü, kısmi batch hatası, span/shadow çocuklar, pointer-events:none,
  hover katmanı, ölçekli koordinat, çoklu tıklamada hedef değişimi, disabled kontrol,
  cross-origin ve iç içe iframe'de üst modalı sınar. Sonunda yalnız test sekmesini kapatır.
- Bu ortamda canlı betik ilk soket bağlantısında `/run/user/1000/zen-mcp.sock` EPERM
  hatasına takıldı; bu ortamda reload ve canlı deneme gerçekleşmedi. Sonrasında
  Efe terminalindeki düzeltilmiş testin tamamı yukarıdaki gibi geçti.
- Yeni araç eklenmedi; computer açıklaması güncellendi (istemci reconnect ile alır).
  Tarayıcı kodu reload gerektirir; Zen restart gerekmez. Kod commit edilmedi. Önceki
  koordinasyon testinin canlı başarısı bu yeni özelliğin doğrulaması sayılmaz.
- Kalıcı hafıza dosyası önceki denemede salt okunurdu; güncel kaynak bu bölümdür.


### Güncel çalışma — görev durumu ve bağlamlı devir kuyruğu (2026-10-20)

**Güncel sonuç: canlı koordinasyon doğrulaması GEÇTİ.** Efe terminalinde
`node scripts/check-coordination.ts` çalıştırdı (v1 → reload). Gerçek MCP
istemcileriyle Codex/Codex, Claude/Claude ve Codex/Claude çiftlerinde canlı durum,
kuyrukta bekleme, erken devir yapılmaması, otomatik devir ve bağlam aktarımı geçti.
İzinli modda görev bitince kendiliğinden devir olmadı; gerçek Verme düğmesi sahibi
korudu, Ver düğmesi bağlamla devretti. Betik başarıyla tamamlandı; özgün izin
ayarları geri yüklendi ve geçici test sekmeleri kapatıldı. Aşağıdaki EPERM kaydı
bu başarılı kullanıcı denemesinden öncedir.

`tab_work` aracı eklendi:
`list/status/start/update/finish/request/cancel`. Paylaşılan bilgiler yalnız ajanların
bilerek yazdığı görev/ilerleme/devir notları, sahip oturum ve FIFO kuyruğudur;
başka oturumun sayfası, URL'si veya sohbet geçmişi okunmaz.

- Her yeni sahiplik meşgul başlar. Tek araç çağrısı bitince görev bitmiş sayılmaz;
  sahip açıkça `finish` gönderir. `start/update` görev özetini günceller. Normal tarayıcı
  işlemleri görevi meşgul tutar; bekleyen varsa araç yanıtına kuyruk hatırlatması eklenir.
- `status/list/request/cancel`, çalışan tarayıcı aracı kuyruğunun arkasında beklemez ve
  etkin işlemin ajan/oturum kimliğini değiştirmez. Meşgul yabancı sekmeye `request_tab`
  çağrısı da hemen FIFO isteği olarak döner; devam eden işi kesmez.
- Auto modda `finish`, ilk bağlı bekleyene sahipliği ve devir notunu aktarır; eski
  sahibin kuyruktaki işleri nesil kontrolüyle reddedilir. Sonradan gelen istek de hazır
  sekmeyi devralır. Yeni sahibin görevi istek açıklamasıyla meşgul başlar.
- İzinli modda görev hazır kalır; ilk bekleyen `request_tab` ile gerçek ada Ver/Verme
  onayını ister. Red sahibi değiştirmez. Onay beklerken sekme/kuyruk değişirse eski
  onayla devir yapılmaz. Kullanıcıya ait sekmeler auto modda da açık onay ister.
- `ownedByCaller: true` görülmeden sayfa araçları kullanılamaz. Bekleyen ajan durum
  sorgulayarak takip eder (sunucu yönergesi yaklaşık 5 saniye aralık önerir); otomatik
  sohbet uyandırma/push yok. İstekler 10 dakikalık, yenilenebilir ve tekil FIFO kaydıdır.
- 15 dakikadır güncellenmeyen görev `stale` görünür, otomatik bitirilmez. Kopan/takılan
  iş başarıyla bitmiş sayılmaz. Var olan kapanış/geri alma/elle devir temizliği korunur;
  kullanıcı sağ tık menüsünden müdahale edebilir. Durum bridge reload boyunca korunur.
- 18 yeni koordinasyon testi dahil **73 soketsiz test geçti** (hook test dosyası hariç),
  derleme, JS/TS sözdizimi ve diff kontrolü geçti. Codex/Codex, Claude/Claude ve karma
  kimlikler gerçek dispatcher üzerinde sınandı; bunlar canlı tarayıcı testi değildir.
- Tam `npm test` denemesinde eski relay yaşam döngüsü testi Unix soketi açarken
  `listen EPERM` ile engellendi; aynı dosyanın iki soketsiz testi geçti. Sonradan eklenen
  dört test ayrıca ve 73 testlik soketsiz kümede doğrulandı.
- Canlı betik: `node scripts/check-coordination.ts`. Gerçek stdio MCP istemcileriyle
  Codex/Codex, Claude/Claude ve Codex/Claude; çalışan araç sırasında durum/istek,
  araç arası sahipliği koruma, auto devir, devir notu ve eski sahibin engellenmesini
  dener. Ardından izinli modu geçici açar, fixture'a ait gerçek ada Verme/Ver
  düğmelerini tıklar. Özgün config yedeği /tmp'ye alınır ve finally'de aynen geri
  yüklenir; dışarıdan değiştirilmişse üzerine yazılmaz. Yalnız test sekmeleri kapatılır.
  Betik başlangıçta mevcut auto modu ister; kullanıcının ask modunu düşürmez.
- Bu ortamda betik ilk tarayıcı soketi bağlantısında `/run/user/1000/zen-mcp.sock`
  `EPERM` hatasına takıldı; reload veya canlı test gerçekleşmedi, ayarlar değişmedi.
  Efe'nin ardından kendi terminalinde yaptığı canlı doğrulama yukarıdaki gibi geçti.
- Yeni tool/schema/yönergeler için mevcut normal MCP istemcilerine reconnect gerekir;
  tarayıcıyı kapatmak gerekmez. Canlı betik reload ve kendi yeni MCP süreçlerini açar.
- Kalıcı hafıza dosyası bu ortamda salt okunur olduğu için güncellenemedi; güncel
  kaynak bu bölümdür.
- Bu değişiklikler commit edilmedi. Yeni koordinasyon katmanının canlı testi de geçti.
  MCP süreç UUID'si / sohbet UUID'si sınırı sürer.


Bu bölüm güncel durumdur; aşağıdaki tarihli bölümler geliştirme geçmişidir.

### Güncel çalışma — MCP oturumuna özel sekme sahipliği (2026-10-20)

**Güncel sonuç: canlı sahiplik doğrulaması GEÇTİ.** Efe terminalinde düzeltilen
`node scripts/check-ownership.ts` betiğini çalıştırdı (v14 → yeni sürüm).
İki gerçek Codex MCP istemcisinin ayrı listeleri ve yabancı okuma/yazma/kapatma
engeli doğrulandı. Gerçek devir menüsü çalışan işi iptal etti; sekme eski sahibine
dönünce eski kuyruk istekleri reddedildi. Yeni sahibi işlem yapabildi, eski sahibi
engellendi. Geri alma işi iptal etti ve sekmeyi açık bıraktı. Gerçek MCP kapanışında
yeniden bağlantı payı sonunda sahiplik temizlendi, sekme açık kaldı.
Test sekmeleri kapatıldı; izin ayarları değişmedi. 55 soketsiz otomatik test geçti.
Aşağıdaki bekleyen canlı test ve başarısız ilk deneme kayıtları bu sonuçtan öncedir.
Değişiklikler henüz commit edilmedi. MCP süreci/sohbet UUID'si sınırı hâlâ geçerli.


- İlk kullanıcı canlı denemesinde iki gerçek Codex istemcisinin ayrı listeleri ve
  yabancı okuma/yazma/kapatma engeli geçti. Devir menüsü adımında test başarısız oldu.
  Yerel Zen kaynaklarında `TabContextMenu.updateContextMenu`'nün yapay popup olayı
  sonrasında contextTab'i seçili sekmeye çevirdiği görüldü. Test artık native popup
  başlangıcını taklit etmez; geliştirme yardımcısı `h.prepareTabMenu(win,[testTab])`
  gerçek menüyü yalnız açıkça verilen fixture için kurar ve XUL `doCommand()` çağırır.
  Menüde geri alma da hazırlanırken sabitlenen sekmelere bağlıdır. Bu bağlam kayması
  için regresyon testi geçti; düzeltilen canlı denemenin tekrarı BEKLİYOR.


- Önceki izin işi `8010ae7` ile commit edildi; push kullanıcıda. Sahiplik değişiklikleri
  henüz commit değil.
- `browser/Ownership.sys.mjs`: sekme → MCP sunucu oturumu, devir nesilleri ve kuyruk
  biletleri. Ajan adı/rengi yetki vermez. `browserFor`, ortak `runTool` ve actor sorguları
  sahipliği kontrol eder. `tabs_context_mcp` yalnız çağıran oturumun sekmelerini listeler.
- Sağ tık menüsünde `Oturuma ver…` / `Oturuma devret…` hedefi açıkça seçilir; listede
  ajan/proje/MCP kimliğinin son altı karakteri bulunur. Ada ve etkinlik günlüğü de oturumu
  belirtir. Eski, son kullanılan ajanı sessizce seçen verme davranışı kaldırıldı.
- Devir/geri alma/TabClose çalışan işi hemen iptal eder. Sekme eski sahibine dönse bile
  eski kuyruk istekleri ve batch'in gelecekteki adımları nesil kontrolüyle reddedilir.
  Aynı batch'teki açık request_tab onayı yalnız verilen sekmenin biletini yeniler.
- MCP server initialize sonrasında `toolsOnly` yaşam döngüsü aboneliği açar; araç çağrıları
  ile aynı süreç UUID'sini taşır. Bunlar öğe gönderim hedef listesine EKLENMEZ.
  Son bağlantı kopunca aktif iş kesilir; aynı süreç için 5 saniye yeniden bağlantı payı
  verilir. Geri dönmezse sekmeler açık kalarak kullanıcıya iade edilir. Bridge reload
  sahiplik durumunu korur, yaşam döngüsü bağlantılarını kapatıp yeniden bağlatır.
- Bu güncelleme Node MCP kodunu da değiştirir: normal istemcide yaşam döngüsü takibi için
  MCP reconnect gerekir; Zen restart gerekmez. Önceden açık eski sunucu süreçleri araç
  çağrılarıyla kaydolur, yaşam döngüsü izlenemiyorsa 24 saat etkinliksizlikte temizlenir.
- Browser restart sonrası yalnız SessionStore görsel işareti erişimi geri vermez;
  oturumu olmayan eski işaretler silinir, kullanıcı sekmeyi yeniden açıkça verir.
- ÖNEMLİ SINIR: MCP süreç UUID'si ile Codex hook/queue sohbet UUID'si aynı şey değildir.
  Cwd/ajan adından eşleme tahmin edilmez. Aynı MCP sürecini paylaşan sohbetler tek erişim
  oturumudur; bunlar arasında sohbet düzeyinde yalıtım sağlandığı iddia edilmez.
  Gönderim hedefi sekme sahibi olarak doğrulanamıyorsa seçim `source_tab` taşır ve canlı
  erişim `request_tab` onayı ister. Claude/Codex gönderim yolları korunur.
- Doğrulama: 19 yeni sahiplik testi + yeni wire yaşam döngüsü testi ile soketsiz 55 test
  geçti. Derleme, JS/TS sözdizimi ve diff kontrolleri geçti. Relay Unix soketi testleri
  bu ortamda daha önce EPERM nedeniyle çalışmamıştı; bu sonuç onları kapsamaz.
- Canlı betik: `node scripts/check-ownership.ts`. Aynı türde iki GERÇEK stdio MCP süreci
  açar, ayrı listeler/erişim engeli, gerçek sağ tık menüsüyle devir/geri alma, kuyruk
  geçersizliği ve gerçek MCP kapanışında sahiplik temizliğini test eder. Yalnız kendi
  geçici sekmelerini kapatır, kullanıcı ayarlarını değiştirmez. Mevcut auto modu gerektirir.
- Canlı deneme burada tarayıcı soketi EPERM engelinde kaldı. Kullanıcı terminalindeki
  canlı doğrulama BEKLİYOR; yapılmış gibi raporlama. Önceki canlı betiklerin ayrıcalıklı
  fixture erişimleri h.findTab(...).linkedBrowser olarak güncellendi.

### Güncel çalışma — batch/site değişiminde izinler (2026-10-20)

**Güncel sonuç: canlı izin doğrulaması GEÇTİ.** Efe terminalinde
`node scripts/check-permissions.ts` çalıştırdı. Doğrudan hassas siteye gezinme ve
HTTP yönlendirmesi sonrasında izin istendi; red kalan yazmaları engelledi.
Onay aynı değişmeyen hedef belgede toplu yazmalara izin verdi. Betik başarılı
bitti ve özgün izin yapılandırmasını geri yükledi. Aşağıdaki EPERM/bekleyen
canlı test kayıtları bu başarılı denemeden öncedir. Değişiklikler henüz commit değil.


- Önceki gerçek iptal işi `f101d33` ile commit edildi; push kullanıcıda.
- Batch'in baştan aldığı koşulsuz `approved: true` kaldırıldı. İzin her adımda güncel
  belge, origin ve izin ayarlarıyla karşılaştırılır. Toplu onay yalnız aynı batch'teki
  listelenmiş adımlar için geçerlidir; otomatik modda izinsiz geçiş onay olarak saklanmaz.
- Gezinme adımının ötesindeki işlemler başlangıç sayfasında onaylatılmaz. Yönlendirme,
  aynı origin'de yeni belge, origin değişimi ve ayar değişimi önceki onayı geçersiz kılar.
  İzin sorusu hazırlanırken veya cevap beklerken sayfa değişirse istek yeniden kurulur.
- Red/timeout kalan batch'i durdurur ve tamamlanan adımların çıktısı korunur.
- Yeni 10 izin testi ve önceki 25 soketsiz test geçti; derleme/sözdizimi/diff kontrolleri geçti.
- Canlı test sürücüsü: `node scripts/check-permissions.ts`. Yeni kodu reload eder,
  yalnız localhost/127.0.0.1 test sunucusunu kullanır. 127.0.0.1 geçici hassas site yapılır;
  test sonunda ayar dosyası eski içeriğine döner ve yalnız test sekmesi kapatılır.
  Kullanıcının mevcut modu auto olmalı; ask modunu düşürmez. Test kendi benzersiz
  işaretini taşıyan izin kutularında gerçek ada düğmelerini kullanarak onay/red dener.
- Canlı çalışma bu ortamda yine soket EPERM hatasında kaldı; kullanıcı terminalinde
  doğrudan gezinme, HTTP yönlendirmesi, red ve aynı belgede toplu onay doğrulaması bekliyor.
- Değişiklikler henüz commit edilmedi. Bir sonraki özellik çoklu oturum sekme sahipliği.

### Son çalışma — gerçek Durdur / Devam (2026-10-20)

**Güncel sonuç: canlı doğrulama GEÇTİ.** Efe kendi terminalinde
`node scripts/check-cancellation.ts` çalıştırdı: yeni köprü Zen yeniden başlatılmadan
yüklendi; aktif bekleme/batch iptali ve durdurulmuşken yeni işlerin reddi geçti;
hızlı Durdur/Devam eski işi canlandırmadı. Gerçek yazma 240/50000 karakterde kesildi,
gecikmiş girdi gelmedi ve yeni yazma çalıştı. Test sekmesi kapatıldı.
Güvenilir modül yolu regresyonu dahil soket gerektirmeyen 25 otomatik test geçti.
Aşağıdaki EPERM ve ilk reload hatası kayıtları bu sonucun öncesindeki denemelerdir.


- Kullanıcının ilk canlı testinde reload başarısız oldu: günlükte "System modules must
  be loaded from a trusted scheme". Ana süreç Cancellation import'u file:// yerine
  resource://zenmcp/ olarak düzeltildi; güvenilir şema regresyon testi eklendi.
  Bu düzeltmeden sonra kullanıcı terminalinde canlı testi tekrar çalıştırmak gerekiyor.


- Önceki çoklu ajan/Codex değişiklikleri `f024be4` ile commit edildi. Push bu ortamda
  GitHub DNS çözümlemesi engellendiği için tamamlanmadı; commit yerelde.
- Yeni `browser/Cancellation.sys.mjs` ana süreç ve actor için iptal kapsamı sağlar.
  Durdur aktif kapsamı iptal eder; bekleme zamanlayıcıları temizlenir, gezinme yüklemesi
  durur ve dinleyicisi kaldırılır. Actor sorgularına istek kimliğiyle iptal iletilir.
- Yazma küçük Unicode parçaları arasında, tuş dizileri ve sürükleme adımları arasında
  olay döngüsüne döner. İptal kalan girdiyi keser; sürükleme fareyi bırakır; kaydırmanın
  gecikmeli fallback'i çalışmaz. İmleç hareketinde iptal edilen tıklama gönderilmez.
- Durdur öncesi kuyruk istekleri nesil kontrolüyle reddedilir; hızlı Devam eski işleri
  canlandırmaz. Batch tamamlanan adımları ve iptal hatasını korur. Yeni istekler çalışır.
- Doğrulama: derleme, sözdizimi ve diff kontrolü geçti. Yeni 9 iptal testi dahil soket
  gerektirmeyen 24 test geçti. Testler gerçek actor sınıfını ve ana süreçteki batch,
  kuyruk, Durdur/Devam, gezinme kodunu sahte platform sınırlarıyla çalıştırır.
- `scripts/check-cancellation.ts` canlı test sürücüsü eklendi. Yerel terminalde
  `node scripts/check-cancellation.ts` yeni kodu reload eder; gerçek batch/bekleme,
  hızlı Durdur/Devam, gerçek yazma iptali ve yeni girdi kabulünü test eder; yalnız
  kendi geçici sekmesini kapatır. Sözdizimi kontrolü geçti, canlı çalışma EPERM'de kaldı.
- Standart Zen MCP erişimi çalışıyor; fakat `reload` ve `chrome_eval` geliştirme
  komutları MCP'ye açık değil. Dolayısıyla MCP bağlantısını doğrulamak bu yeni kodun
  yüklendiğini veya iptal testinin canlı geçtiğini kanıtlamaz.
- Canlı Zen doğrulaması ve reload YAPILAMADI: bu ortam tarayıcı soketine bağlantıyı
  `EPERM` ile engelliyor. Hook relay yaşam döngüsü testi de Unix soketi açamadığından
  çalışmıyor. Soket erişimli ortamda reload + gerçek Durdur/Devam denemesi bekliyor.
- İptal yapılmış tıklama/ağ isteğini geri almaz; sayfanın kendi başlattığı JS/timer işleri
  ve senkron çalışan JavaScript zorla sonlandırılmaz. Yeni değişiklikler henüz commit değil.
- Bu sohbette kullanıcının seaskablo.com üzerinden öğe gönderimi başarıyla ulaştı.
  Bu, hook güven onayının veya temiz oturum otomatik kaydının ayrıca doğrulandığı anlamına gelmez.

### Amaç ve kararlar

- Zen MCP artık yalnız Claude'a özel değil: günlük Zen/Firefox penceresinde farklı AI
  ajanlarıyla birlikte çalışma. Efe'de gerçek test istemcileri Claude Code ve Codex.
- Aynı pencere/oturumlar, arka plan sekmeleri, gerçek girdi, ada, global Durdur/Devam ve
  sekme verme/geri alma korunur. Ayrı pencere veya gerçek container istenmiyor.
- Repo private kalacak; yayın, npm/MCP Registry ve isim değişikliği henüz yapılmayacak.
- agent-browser referans; onun tüm özelliklerini kopyalamak yerine güvenilirlik ve
  kullanıcıyla birlikte çalışma akışı geliştirilecek. CLI+MCP birlikte değerlendirilebilir.

### Tamamlananlar

- Codex bağlantısı: XDG_RUNTIME_DIR aktarılmadığında Linux kullanıcı runtime klasörü
  bulunuyor; hata mesajları soket yolu/gerçek hata kodunu gösteriyor.
- computer koordinat şeması standart iki sayılık dizi oldu; Codex'te doğrudan tool artık
  görünür. Gerçek Codex MCP üzerinden açma/okuma/form/tıklama/klavye/screenshot/kapatma geçti.
- Yeni sekmenin about:blank STOP olayının navigate'i erken bitirmesi düzeltildi.
- MCP initialize istemci adıyla tema: Claude turuncu, Codex mint, diğer ajanlar mavi.
  Ada, sekme çizgisi, cursor/ripple/ask çerçevesi birlikte değişir; kimlik yetki vermez.
- Efe'nin gönderdiği Codex görselinden esinlenen net SVG: browser/assets/codex.svg.
  Mor-mavi bulut simgesi Codex menü/adasında, eski >_ genel ajanlarda. Menüler her açılışta
  güncellenir; Zen yeniden başlatılmaz. Sekme menüsü sekmenin mevcut ajanını izler.
- Claude channels korunuyor. Codex seçimleri execFile(codex queue) ile tam UUID'ye gider;
  shell yok. Kullanıcı notu, güvenilmeyen sayfa içeriğinden ayrılır; görüntü yolu ve
  tab_id/source_tab korunur. Gerçek seçim mesajı bu sohbete geldi, kullanıcı girdisi olarak
  alındığı doğrulandı. Çalışan turda queue girdisi tur bittikten sonra geldi.
- Ada hedef listesi ajan/proje/oturum son ekini gösterir. Hedef compose açılırken sabitlenir;
  başka oturuma sessiz geçiş yok. Çift gönderim engellenir; kopma/hata panoya düşer.
  İki yönlü receipt ile queue kabul edilmeden başarı yazılmaz.
- Otomatik Codex alıcısı: SessionStart/UserPromptSubmit/SessionEnd hook'ları gerçek host
  session_id ve cwd ile bir yerel relay yönetir. MCP sürecinde CODEX_THREAD_ID yok;
  kimliği tahmin etme. connect_session artık elle yedektir, normal yol hook'lardır.
  Aynı UUID tek receiver; resume/compact/eşzamanlı başlatma/ölü soket toparlanması testli.
  Normal kapanışta temizlenir; anormal kapanışta 24 saat etkinlik yoksa kapanır.
- Codex hook tanımları ~/.codex/hooks.json'a kuruldu. Mevcut sohbet relay'i doğrudan
  başlatıldı ve Zen'de tek codex:<UUID> kaydı görüldü. Güven onayı bypass edilmedi.

### Yeni sohbette ilk iş / açık kalan doğrulama

1. Efe'nin Codex'te /hooks ekranından üç Zen MCP hook'una bir kez güvenip güvenmediğini
   doğrula. Henüz onayladığına dair kullanıcı mesajı yok. Onay yoksa otomatik tetikleme
   beklenmez; kod/kurulum hazır olmakla bu onay ayrı şeylerdir.
2. Güven sonrası gerçekten yeni/açılıp-devam eden sohbetin, connect_session çağırmadan ve
   ilk browser aracını beklemeden hedef listesine düştüğünü uçtan uca doğrula.
3. Eski sohbet UUID'sini kopyalama. Gerektiğinde yeni komut ortamındaki CODEX_THREAD_ID
   okunur veya güvenilir hook input'u kullanılır. Sahiplik/izin ile görsel kimliği karıştırma.
4. Sonra Efe ile geliştirme planına dön: batch içinde site değişince yeniden izin kontrolü,
   gerçek işlem iptali, çoklu oturum sekme sahipliği/çakışmalar, örtülü öğe kontrolü,
   çıktı/diff verimliliği, CLI+skill ölçümü. Bunlar bu oturumda çözülmedi.

### Testler ve çalışma ağacı

- Son npm test: build + 18 test geçti. Bellek içi MCP matrisi, ada, wire/receipt,
  hook kurulumunu koruma/tekilleştirme ve gerçek alt süreçlerle relay yaşam döngüsü dahil.
- Canlı check-compat üç ajan kimliğiyle geçti. check-pick-delivery gerçek seçim + görüntü
  bağlamını Codex queue'ya taşıdı ve mesajın sohbete ulaşması ayrıca gözlendi.
- Kullanıcı tarayıcısındaki test sekmeleri kapatıldı; mode/sensitive ayarları değiştirilmedi.
- Çok sayıda tracked/untracked değişiklik var; henüz commit/push yapılmadı. Bunlar bu
  çalışmanın ürünüdür; silme/resetleme veya istenmeden yayınlama.
- Sadece belge güncellemesi için testleri tekrar çalıştırmak gerekmez.

### İlgili dosyalar ve komutlar

- src/server.ts, src/zen.ts, src/paths.ts: MCP şema, kimlik, soket, receipt.
- src/delivery.ts: Codex queue gönderimi.
- src/codex-hooks.ts, src/codex-relay.ts: kurulum ve otomatik alıcı.
- browser/Agent.sys.mjs, browser/assets/codex.svg, Island.sys.mjs, main.js, actors/: UI/köprü.
- npm test
- node scripts/zenctl.ts reload (Zen'i kapatmadan browser kodu yenileme)
- node scripts/check-compat.ts --reload (yalnız test sekmeleri)
- node scripts/check-pick-delivery.ts (GERÇEKTEN mevcut sohbete test mesajı yollar)
- node dist/cli.js codex-hooks install|uninstall
- node scripts/zenctl.ts eval '[...h.subscribers.values()].map(s=>({name:s.name,relay:s.relay}))'

Browser reload Node MCP sürecindeki modülleri yenilemez; Node/schema değişince MCP
istemcisini yeniden bağlamak gerekir. Sadece browser UI değişikliğinde Zen'i kapatma.

## Ne bu

Claude Code'un Efe'nin günlük tarayıcısı Zen'i (Firefox tabanlı, Gecko 157) kullanmasını
sağlayan MCP. Claude in Chrome'un Zen karşılığı, ama ondan farklı:

- **Gerçek girdi:** tıklama, yazma ve tekerlek sayfaya `isTrusted: true` olarak ulaşır. Remote
  agent/WebDriver açılmaz, `navigator.webdriver` false kalır. Bu projenin varlık sebebi bu:
  bakılan alternatifler ya sahte DOM olayı kullanıyor (beto621/open-claude-in-firefox,
  sh6drack/zen-mcp) ya da webdriver modunda çalışıyor.
- **Efe'nin oturumlarıyla, Efe'nin penceresinde:** sekmeler arka planda açılır. **Ayrı pencere
  kesinlikle olmaz** (Efe: "iki pencere olacaksa Helium kullanırım").
- **Container yok:** Claude sekmeleri container çizgisini taklit eden turuncu bir çizgiyle
  işaretlenir. Gerçek container çerezleri ayırır, Efe'nin oturumları görünmez olurdu.

Repo private: github.com/efeaslansoyler/zen-mcp. Açık kaynak yapılırsa isim değişmeli
(npm'de `zen-mcp` başkasının).

## Mimari

```
Claude Code ──stdio MCP──▶ src/server.ts ──Unix soket──▶ browser/main.js (Zen parent süreci)
                           (tool şemaları)  $XDG_RUNTIME_DIR/      │
                                            zen-mcp.sock (0600)    ├─ browser/Island.sys.mjs (ada)
                                                                   └─ actor ──▶ browser/actors/
                                                                      ZenMcpChild.sys.mjs (sayfa süreci)
```

- **Yükleme:** dotfiles'taki `system/zen/zen.cfg` (autoconfig, sandbox kapalı) şunları yapar:
  `~/.local/share/zen-mcp` (repo'daki `browser/` klasörüne sembolik bağ) varsa
  `resource://zenmcp/` eşlemesini kurar ve `main.js`'i `loadSubScript` ile yükler. `zen.cfg`
  değişirse kurulumu sudo ile yapılır:
  `sudo install -Dm644 -t /usr/local/share/zen-autoconfig ~/dotfiles/system/zen/zen.cfg && sudo /usr/local/share/zen-autoconfig/install.sh`
- **Protokol:** bağlantı başına tek satır JSON istek (`{tool, args}`), tek satır cevap
  (`{ok, content}` ya da `{ok:false, error}`). JSON iki uçta da saf ASCII'ye çevriliyor.
- **`main.js`:** sekme takibi, işaret, ağ kaydı, diyalog tespiti, durdurma, tool'lar ve soket.
- **Actor (sayfa süreci):** sanal imleç ve girdi (Zen'in kendi
  `chrome://remote/content/external/EventUtils.js` dosyası sayfanın windowUtils'iyle; sekme
  seçili olmasa da çalışır), `read_page`/`find` ağacı ve ref'ler, `form_input`, konsol,
  `ask_user` çerçevesi, tıklama halkası, `file_upload`.
- **Ada (`Island.sys.mjs`):** Zen penceresinin üst ortasında Dynamic Island gibi bir hap.
  Canlı durum, Durdur/Devam (Ctrl+Shift+Esc), `ask_user` mesajı ve düğmeleri, diyalog
  bildirimi, üzerine gelince canlı önizleme, öğe seçiminde "Ne yapılsın?" kutusu.
- **Zen → Claude (channels):** `claude --dangerously-load-development-channels server:zen` ile
  açılan oturumda `server.ts` bunu `/proc` üzerinden komut satırından anlar
  (`ZEN_MCP_CHANNEL=1/0` geçersiz kılar), `claude/channel` yeteneğini bildirir ve köprüye
  kalıcı bir `subscribe` bağlantısı açar (köprü reload'da kapatır, 3 sn'de yeniden bağlanır).
  Her istek `session` kimliği taşır; olay Zen'i en son kullanan ya da en son bağlanan oturuma
  gider. Abone yoksa metin panoya kopyalanır. Bayraksız oturumlar abone olmaz.

## Tool'lar (Claude in Chrome adlarıyla uyumlu)

`tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp`, `navigate`, `computer` (screenshot, tıklamalar, hover,
drag, scroll, scroll_to, type, key, wait; koordinat ya da ref), `read_page`, `find`,
`form_input`, `get_page_text`, `javascript_tool`, `read_console_messages`,
`read_network_requests`, `handle_dialog`, `ask_user`, `file_upload`, `request_tab`, `browser_batch`.

Davranış notları:

- Token: cevaplar kısa ve tek satır JSON; Claude in Chrome gibi her cevaba sekme listesi
  eklenmez. Aynı form görevinde (2026-10-19) Zen ~4.250, Chrome ~5.650 token. `browser_batch`
  adımları sırayla çalıştırır, ilk hatada durur, metinleri tek blokta birleştirir.
  Ekran görüntüsünde `scale` (0,1–1); koordinatlar dönen görüntünün pikselleri.
- `tabs_close_mcp`: Claude'un açtığı sekmeyi kapatır, kullanıcının verdiğini kapatmaz, geri verir.
- **iframe'ler (Faz 4):** actor `allFrames: true` ile her çerçevede. Alt çerçevedeki ref'e actor
  browsingContext kimliğini ekler (`ref_3_f150323855361`), köprü Claude'a kısa numarayla
  (`ref_3_f2`) gösterir ve geri çevirir (`shortRefs`/`longRef`). `read_page` iframe yerine
  `{{frame:<id>}}` koyar, köprü o çerçevenin ağacını `[iframe url]` altına yerleştirir; `find`
  bütün çerçevelerde arayıp puana göre birleştirir; `get_page_text` iframe metinlerini ekler.
  Fare olayları noktanın altındaki en içteki çerçevenin actor'ından o çerçevenin koordinatıyla
  gider (`deepest`): üst sayfadan gönderilen olay site dışı (ayrı süreçteki) iframe'e ulaşmıyor.
  Tuşlar odaktaki çerçeveye (`focusedFrame`). Ref koordinatı iframe kutuları toplanarak üst
  sayfaya çevrilir (`toTop`). Konsol ve `javascript_tool` yalnız üst çerçevede.
- **Modlar ve izin (Faz 5, Efe'nin kararı):** `~/.config/zen-mcp/config.json`
  `{"mode": "auto" | "ask", "sensitive": ["alan.adı", …]}`; hazır hassas site listesi yok.
  `auto`: sormadan işlem; `ask`: her işlemde adada "İzin ver / Verme". Hassas sitede (alt alan
  adları dahil) mod ne olursa olsun işlemlerde sorulur, gezinme serbest. İşlem: tıklamalar,
  sürükleme, yazma, tuş, form_input, file_upload, javascript_tool, handle_dialog; `ask`
  modunda navigate da. Okuma, kaydırma, hover, bekleme serbest. Soru öğeyi tarif eder
  (`describe`: 'button "Gönder": tıklamak'). `browser_batch` sekme başına tek soruda listeler.
  Mod adadaki "otomatik/onaylı" düğmesinden (yalnız çalışırken görünür) ya da sekme sağ tık
  menüsündeki "Claude her işlemde izin istesin" ile değişir; dosya değişince kendiliğinden okunur.
- **Etkinlik günlüğü:** `~/.local/state/zen-mcp/activity.jsonl` (5 MB'ta `.1`'e taşınır); her
  tool çağrısı: zaman, tool, sekme, site, işlemlerde tarif, gezinmede varılan adres, hata.
  "Claude dün ne yaptı" sorusunda bu dosyayı oku.
- **Ağ ayrıntıları:** `read_network_requests` listesi `#id` verir; `id` ile istek/cevap
  başlıkları (cookie, set-cookie, authorization gizli), küçük POST gövdesi ve fetch/XHR/belge
  cevap gövdesi (istek başına 256 KB, sekme başına 8 MB). Gövde sıkıştırmanın önünde
  kaydediliyor (`nsITraceableChannel`), gösterirken `DecompressionStream` ile açılıyor
  (gzip, deflate, br → "brotli", zstd).
- `wait_for`: metin / seçici (+metin) görünene, `gone` ile kaybolana, `network_idle` ile 0,5 sn
  istek olmayana kadar (10 sn'den uzun istekler sayılmaz). Köprüde yoklamayla, bütün çerçevelerde;
  gezinme boyunca sürer. Zaman aşımı hata (toplu çağrıyı durdurur).

- Claude yalnız kendisindeki sekmelere dokunabilir: kendi açtıkları ve Efe'nin sağ tık
  menüsünden "Claude'a ver" ile verdikleri (`givenByUser: true`). "Claude'dan geri al" süren
  işlemi keser.
- `ask_user` sekmeyi öne getirmez. Mesaj ve düğmeler adada gösterilir, sayfada yalnız öğenin
  turuncu çerçevesi çizilir. Zen odakta değilse masaüstü bildirimi gider. Yalnız gerçek
  (isTrusted) tıklamalar sayılır.
- Açık bir alert/confirm/prompt sayfanın JS'ini durdurur. Tool'lar bu durumda takılmaz, diyalog
  bilgisini döner; cevaplamak için `handle_dialog`.
- Durdurulunca ("Devam et"e basılana kadar) bütün tool'lar "kullanıcı durdurdu" döner. Durum
  `reload`'da korunur.
- Arka plandaki sekmede tıklama odağı taşımıyor (elle `focus()` veriliyor), tekerlek de sayfayı
  kaydırmıyor (`scrollBy` ile kaydırılıyor). Zen tekerlek deltasını
  `mousewheel.default.delta_multiplier_*` (200) ile çarpıyor, bölünerek gönderiliyor.
- Sanal imleç animasyonu yalnız sekme görünürken yapılır (~0,3–0,45 sn), arka planda gecikme
  yok. Claude'un kendi ekran görüntüsünde imleç ve halkalar gizlenir.
- Fareyi gezdirdikten (hover) sonra açılır menü çıkabilir: tıklamadan önce yeniden ekran
  görüntüsü al.

## Öğe seçip Claude'a iş verme

- Ctrl+Shift+F (yeniden basmak vazgeçer) ya da sayfanın sağ tık menüsünde "Claude'a göster…"
  (yalnız http/https/file, yalnız üst çerçeve). Herhangi bir sekmede çalışır, sekme Claude'a
  verilmez.
- Seçerken tıklama ve tuşlar sayfaya gitmez, fare hareketi gider (hover menüleri açık kalır).
  ↑/↓ üst/alt öğe, Enter ya da tıklama seçer, Esc ya da sağ tık vazgeçer. Sekme değişirse
  seçici kapanır.
- Ada "Ne yapılsın?" der: Enter gönderir, Shift+Enter yeni satır, Esc vazgeçer. Hedef oturumun
  adı (cwd'nin son klasörü) ya da "pano" yazar.
- Giden bağlam: not, URL, CSS seçici, rol/ad, React/Vue bileşen zinciri (Next.js iç
  bileşenleri ayıklanır), kutu, önemli hesaplanmış stiller, metin, kısaltılmış outerHTML ve
  öğenin PNG görüntüsü (`$XDG_RUNTIME_DIR/zen-mcp-picks`, son 20). Meta: `url`, `screenshot`,
  sekme Claude'daysa `tab_id`, değilse `source_tab`. Production build'in küçültülmüş bileşen
  adları (≤2 harf) ve saydam gölge katmanları ayıklanır.
- `request_tab`: Claude yalnız kullanıcının seçim gönderdiği sekmeyi (`state.pickedTabs`)
  isteyebilir. Ada `ask` durumunda "Ver / Verme" gösterir, Ver denirse sekme "Claude'a ver"
  ile verilmiş gibi işaretlenir. Yeni istek adadaki "gönderildi" yazısını hemen kaldırır.

## Paket ve kurulum (açık kaynak hazırlığı, 2026-10-19)

- `src/cli.ts` giriş: argümansız MCP sunucusu; `install [--browser <klasör>|--all]`,
  `uninstall`, `doctor`, `config [mode auto|ask | sensitive add|remove …]`. `npm run build`
  → `dist/` (Node npm paketindeki .ts'yi çalıştırmıyor). İsim ve yollar yalnız `src/paths.ts`te
  (+ yükleyicinin verdiği `zenMcpName`). CLI mesajları `L(en, tr)`: sistem dili Türkçeyse Türkçe.
- `install`: tarayıcıyı bulur (`application.ini`), autoconfig varsa .cfg'ye `// BEGIN zen-mcp`
  … `// END zen-mcp` bloğu ekler, yoksa `<ad>-prefs.js` + `<ad>.cfg` oluşturur; şifreli ya da
  sandbox'lı autoconfig'i reddeder; yazılamazsa sudo. `browser/`'ı `~/.local/share/<ad>`'a
  kopyalar, `.version` yazar. Orası bağsa geliştirme kurulumu: dokunulmaz (Efe'nin kurulumu
  böyle, dotfiles zen.cfg'deki işaretsiz blok "legacy" sayılır).
- Sunucu açılınca `syncBrowserFiles`: kurulu dosyalar paketten eskiyse kopyalar ve köprüyü
  `reload` eder (sudo ve tarayıcıyı yeniden başlatmak gerekmez). Köprüde `ping` komutu sürümü
  verir. Flatpak/Snap desteklenemez (salt okunur), Windows henüz yok (Unix soket).
- Test: `cp -r /opt/zen-browser-bin` kopyasına `install --browser`, `XDG_DATA_HOME`/
  `XDG_RUNTIME_DIR` geçici; `npm pack` + `npx -y ./zen-mcp-<sürüm>.tgz` gerçek npx denemesi.

## Geliştirme ve test

- **Zen'i kapatmadan güncelleme:** `node scripts/zenctl.ts reload`. Yeni sürüm başlamazsa eski
  sürüm devam eder, köprü ölü kalmaz.
- **Tarayıcı tarafında ifade çalıştırma:** `node scripts/zenctl.ts eval 'h.version'`
  (`h.browserFor`, `h.query`, `h.state`, `h.tools` …). Tool doğrudan:
  `node scripts/zenctl.ts find '{"tabId":13,"query":"x"}'`.
- **Hatalar:** `$XDG_RUNTIME_DIR/zen-mcp.log`. Zen'in stderr'i /dev/null'a gidiyor.
- **Efe'nin tarayıcısına dokunmadan test:** önce burada test et, sonra Efe'nin Zen'inde `reload`.
  1. `/opt/zen-browser-bin`'i scratchpad'e kopyala.
  2. `XDG_RUNTIME_DIR=<ayrı klasör> <kopya>/zen-bin --headless --no-remote --profile <geçici profil>` ile başlat.
  3. `ZEN_MCP_SOCKET=<ayrı klasör>/zen-mcp.sock` ile zenctl kullan.
  4. Test sayfalarını `python3 -m http.server 8765` ile sun.
  5. Konsol hataları için `--marionette --remote-allow-system-access` ekle ve
     `Services.console.getMessageArray()` oku.
- **Tarayıcı arayüzünün ekran görüntüsü:** pencerenin
  `browsingContext.currentWindowGlobal.drawSnapshot(DOMRect, scale, renk)` sonucu.
- **Seçimi test etme:** `h.startPick(win)` / `h.pickFromContextMenu(win, browser)` /
  `h.sendPick(not)`, abone için `subscribe` (src/zen.ts) kullanan küçük bir node betiği. Claude'un
  `right_click`'i `contextmenu` olayı üretmiyor; sağ tık menüsünü denemek için EventUtils'i
  tarayıcı penceresine yükleyip `synthesizeMouseAtPoint(x, y, {type: "contextmenu", button: 2}, win)`.
- **Süreç öldürme tuzağı:** `pkill -f "<desen>"` desenin geçtiği kendi kabuğunu da öldürür.
  Sunucuyu portundan bul: `ss -ltnpH 'sport = :8765'`.

## Gecko 157 / Zen tuzakları (hepsi yaşandı)

- `loadSubScript` file:// adresini reddediyor ("untrusted URI") → `resource://` eşlemesi kullan.
- Web süreçlerine giren actor için `safeForUntrustedWebProcess: true` gerekli.
- Sistem bağlamında `eval()` yasak → `Cu.Sandbox` + `Cu.evalInSandbox`.
- İçerik süreci sandbox'ı: `security.sandbox.content.read_path_whitelist` ilk içerik süreci
  açılmadan ayarlanmalı (main.js autoconfig sırasında varsayılan dala yazıyor).
- Tamponlu soket çıkış akışı kapatılınca cevap 32 KB'ta kesiliyordu → `OPEN_UNBUFFERED`.
- Çıplak `nsITimer`'a referans tutulmazsa GC'de toplanıp tetiklenmeyebiliyor → `Timer.sys.mjs`.
- SessionStore: `moz-src:///browser/components/sessionstore/SessionStore.sys.mjs`. Tembel
  sekmelerde değer pencere açıldıktan bir süre sonra okunabiliyor (birkaç kez taranıyor).
- `gBrowser.insertBrowser(tab)` (alt çizgisiz) tembel sekmeye `<browser>` oluşturur.
- Bu kapsamda `el.ownerGlobal` undefined → `ownerDocument.defaultView`.
- XPCOM sabitleri `Object.entries` ile görünmez → `for...in`.
- `addSystemEventListener` yok → `addEventListener(…, { mozSystemGroup: true })`.
- Kapalı shadow DOM'un içi pencere dinleyicisinin `composedPath()`'inde görünmez.
- Autoconfig kapsamında `IOUtils` ve `BrowsingContext` yok → pencerenin `IOUtils`/`BrowsingContext`'i.
- `nsITraceableChannel` dinleyicisi içerik kodlaması çözülmeden önce: gövde gzip/br gelir.
- Autoconfig kapsamında `DecompressionStream`, `TextDecoder`, `Blob`, `Response` de pencereden.
- Üst sayfadan windowUtils ile gönderilen fare/klavye olayı site dışı (Fission, ayrı süreç)
  iframe'e geçmiyor; aynı sitedekine geçiyor. Olay çerçevenin kendi actor'ından gönderilmeli.
- Actor yok olunca bekleyen `sendQuery` reddedilmiyor → `currentWindowGlobal` değişimini izle.
- Container'sız sekmede Firefox `.tab-context-line`'ı `display: none` yapıyor.
- Zen'in ana tema rengi (`--zen-primary-color`) Efe'de açık gri (#bebebe): üstüne beyaz yazı
  okunmuyor, ada bu yüzden koyu.
- Zen'de pencere senkronu açık; senkronsuz pencere `OpenBrowserWindow({ zenSyncedWindow: false })`.
  Bu yol denendi ve bırakıldı.
- `drawSnapshot(rect, …)` rect'i belge koordinatında ister (görünür alan + scrollX/Y).
- `NetUtil.asyncCopy` hedef akışı da kapatır; açık kalacak abone bağlantısına
  `nsIAsyncStreamCopier` ile `closeSink: false` yazılıyor.
- Hyprland görünmeyen workspace'teki pencereyi askıya alıyor (`document.hidden`, odak geçmiyor,
  APZ kaydırmıyor). Pencere seviyesinden girdi göndermekten bu yüzden vazgeçildi.

## Durum (2026-10-19)

- Faz 1: ada, Durdur/Devam ✅
- Faz 2: `ask_user`/diyaloglar adada, tıklama halkası, masaüstü bildirimi ✅
- Faz 3: Claude'a ver / geri al ✅
- Ek: sanal imleç ve adada canlı önizleme ✅ (Efe beğendi)
- Zen'den öğe seçip Claude'a iş verme ✅ headless'ta denendi (seçici, sağ tık, not, abone, pano).
  Gerçek `claude-zen` oturumunda olayın gelmesi henüz denenmedi: otomatik mod, bayrağı
  Claude'un açıp uyarıyı onaylamasını reddetti; Efe deneyecek. Kalıcı ayar yok (research
  preview): dotfiles'ta `alias claude='claude --dangerously-load-development-channels server:zen'`
  (Efe'nin onayıyla), her açılışta uyarı bir kez geçiliyor.
- Sağ tık "Claude'a göster…" seçiciyi sağ tıklanan öğeden başlatır (fareyle değişir).

## Sıradaki

0. Öğe seçimi: Efe'nin `claude-zen` denemesi, sonra isteğe bağlı birden fazla öğe seçme.
1. ~~Faz 4~~ ✅ iframe ve `wait_for` (2026-10-19).
2. ~~Faz 5~~ ✅ modlar/izin, hassas siteler, etkinlik günlüğü, ağ ayrıntıları (2026-10-19).
3. İsteğe bağlı: Quickshell barında Claude göstergesi; açık kaynak için README ve kurulum betiği.

Not: bu oturumdaki MCP sunucusu oturum başında başlar. `src/server.ts` değişince yeni tool'lar
ve açıklamalar için Claude Code'da `/mcp` ile yeniden bağlan ya da yeni oturum aç.

## Çoklu istemci uyumluluğu ve temalar (2026-10-20)

- Standart araç açıklamaları ajan bağımsız; `computer` koordinatları tuple yerine
  iki sayılık dizi. Codex'in şemayı doğrudan alabilmesi için `prefixItems` kullanılmıyor.
- `server.ts`, MCP initialize `clientInfo.name` bilgisini `getClientVersion()` ile okur.
  `ZEN_MCP_AGENT` görünüm için geçersiz kılabilir. `zen.ts` her istekte `{agent: {id, name}}` taşır.
- `browser/Agent.sys.mjs`: Node ve Gecko'nun paylaştığı saf kimlik/tema modülü. Claude turuncu,
  Codex mint (güncel simge: assets/codex.svg), tanınmayan istemci mavi (`>_`). Kimlik yetki sağlamaz. Eski sunucular
  agent göndermiyorsa eski Claude görünümü korunur.
- Ada, sekme şeridi, sanal imleç, tıklama halkası, ask_user çerçevesi işlem kimliğini izler.
  Sekme teması SessionStore'da saklanır; başka istemci kullandığında değişir.
- Ortak ada ve onay arayüzünde kimlik karışmasın diye tool çağrıları köprüde sıraya alınır.
  Sekmeler hâlâ ortak; bu değişiklik oturuma özel sahiplik eklemez. Durdurma global kalır.
- Batch hata sonuçları kısmi çıktıyı koruyarak MCP `isError` taşır. Cevapsız kapatılan
  soket artık sonsuza dek beklemez, hata döner.
- `npm test`: build + MCP istemci matrisi, şema, wire protokolü ve ada durumları.
  Testler gerçek Gecko yerine bellek içi taşıma ve küçük DOM fixture kullanır.
  Sandbox test alt süreçlerini engelliyorsa: `npm run build` ve
  `node --test --test-isolation=none test/*.test.mjs`.
- Canlı etkinleştirme: `node scripts/zenctl.ts reload`, sonra MCP istemcisinde yeniden bağlan.
  Claude channels akışı korunur; Codex queue ve ardından lifecycle hook alıcısı aşağıda eklendi.

Canlı smoke testi (kendi terminalinden): `node scripts/check-compat.ts --reload`.
Yalnız kendi test sekmelerini açar/kapatır; Claude, Codex ve genel ajan kimlikleriyle
okuma/yazma/tıklama/klavye/görüntü, ada-sekme rengi ve batch hata bayrağını doğrular.
İzin ayarlarını değiştirmez; onaylı moddaysa test adımları tarayıcıda izin isteyebilir.

### Canlı doğrulama ve ilk gezinme yarışı (2026-10-20)

`check-compat.ts --reload` gerçek Zen'de Claude, Codex ve genel ajan kimliğiyle geçti.
Yeni sekmenin ilk about:blank STOP olayı navigate beklemesini erken bitiriyordu;
hedef about:blank değilken bu olay artık gezinme tamamlandı sayılmıyor.
Smoke testi navigate dönüşündeki URL'yi de kontrol ediyor. `npm test`: 8/8 geçti.
MCP süreci bu değişikliklerden önce açıldıysa kimlik ve computer şeması için yeniden
bağlanmalı; köprü reload tek başına Node sürecindeki modülleri yenilemez.

## Codex queue ile seçim gönderimi (2026-10-20)

- `connect_session({threadId,label?})` Codex istemcisini kendi gerçek sohbet UUID'sine bağlar.
  MCP sürecinde CODEX_THREAD_ID bulunmadığı canlı kontrolle doğrulandı; otomatik tahmin yok.
  İlk sürüm elle bağlanıyordu; güncel otomatik lifecycle hook düzeni aşağıda.
  connect_session yalnız elle yedek olarak kalır. Yeni tool için MCP süreci yeniden bağlanmalı.
- `src/delivery.ts`: `execFile` ile shell olmadan `codex queue`; not ve güvenilmeyen sayfa
  bağlamı ayrılır; screenshot/source_tab/tab_id meta verileri mesajda korunur.
- `subscribe` iki yönlü: köprü olay kimliği üretir; Node gerçek gönderim tamamlanınca
  `{event:'delivery',id,ok,error?}` döner. Codex'te başarı queue kabulüdür, ajanın okuması değil.
  Eski Claude süreçleri ack olmadan eski yazıldı davranışını korur; yeni Claude süreçleri
  MCP kanal bildiriminin yazılmasını onaylar.
- Adada hedef seçici: ajan + proje + oturum son eki; seçim anındaki liste sabittir.
  Hedef koparsa/başarısız olursa panoya düşer, başka aboneye yönlendirilmez. Çift gönderim
  engellenir. Seçici ve not kutusu seçili ajanın temasına uyar.
- `scripts/check-pick-delivery.ts`: gerçek MCP initialize/bind → Zen pick → görüntü/bağlam
  → queue → mint adada alındı kontrolü geçti. CODEX_THREAD_ID gerektirir ve gerçekten bir
  test mesajı yollar. Test sekmesini ve geçici MCP aboneliğini sonunda kapatır.
- `npm test`: 15 test; bağlama, istemci matrisi, hedef seçimi, tekrar göndermeme,
  Node onayının işlem tamamlanmadan dönmemesi ve hata yolu dahil.

## Otomatik Codex bağlantısı — lifecycle hook'ları (2026-10-20)

Elle connect_session gereksinimini kaldıran sahip yol artık hook'lardır:
- `src/codex-hooks.ts`: SessionStart/UserPromptSubmit/SessionEnd JSON'undan gerçek UUID ve
  cwd alınır; hiçbir sohbet listesi ya da en son transcript tahmini kullanılmaz.
- `src/codex-relay.ts`: her UUID için yerel kontrol soketli tek ayrı süreç. Tekrar başlatma,
  resume, compact ve eşzamanlı başlangıçlar çoğaltmaz. Ölü soket yalnız bağlantı reddiyse
  ve inode değişmediyse temizlenir. Normal kapanışta SessionEnd durdurur; ani istemci
  kapanışında 24 saat etkinlik olmayınca kendini kapatır. Zen yoksa abone yeniden dener.
- Hook'lar modelden bağımsızdır; ilk browser çağrısını veya connect_session aracını beklemez.
  connect_session aynı alıcı yöneticisini kullanan elle yedektir.
- Köprü Codex kayıtlarını `codex:<UUID>` ile tekilleştirir. Eski elle bağlı MCP süreci
  yeniden denese bile otomatik alıcının yerini alamaz; menüde aynı sohbet iki kez görünmez.
- `node dist/cli.js codex-hooks install|uninstall`: ~/.codex/hooks.json'u diğer ayarları
  koruyarak yönetir, değişen eski dosyayı yedekler. Kaldırma açık otomatik alıcıları durdurur.
- Efe'nin kurulumuna hook tanımları eklendi. Mevcut sohbetin alıcısı doğrudan başlatılıp
  Zen'de doğrulandı. Codex'in /hooks ekranındaki kullanıcı güveni özellikle bypass edilmedi;
  gelecek oturumların gerçekten otomatik tetiklenmesi için bir kez güvenmesi gerekiyor.
- `npm test`: 18 test. Hook girdi doğrulama, başka hook'ları koruma, yinelenmeyen kurulum,
  gerçek alt süreç/kontrol soketiyle start/refresh/end ve SIGKILL sonrası toparlanma dahil.
