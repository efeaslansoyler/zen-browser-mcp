# zen-mcp: kaldığımız yer

Yeni oturumda önce bunu oku; kararlar ve fikirler [`PLAN.md`](PLAN.md)'de.

**Bu bölüm tek güncel özettir.** İş bitince yeni "güncel" bölüm ekleme; ilgili maddeyi
güncelle, eskiyen bilgiyi sil. Ayrıntılı geliştirme günlüğü git geçmişinde: commit
mesajları ve `git log -p docs/DEVAM.md` (2026-10-20 öncesi uzun devir kayıtları orada).

## Durum — 2026-10-21

Faz 1–5 ve öğe seçimi 2026-10-19'da bitti. 2026-10-20'de (Codex ile) proje Claude'a özel
olmaktan çıkıp birden çok ajanın aynı Zen'i paylaşmasına hazırlandı. Hepsi main'de
commit'li, `npm test` geçiyor; her özelliğin canlı betiği Efe'nin terminalinde geçti.
Push edilmemiş commit'ler olabilir (`git status -sb`); push Efe isteyince.

- **Çoklu ajan kimliği** (`f024be4`): MCP initialize'daki istemci adına göre Claude turuncu,
  Codex mint (bulut SVG `browser/assets/codex.svg`), diğerleri mavi. Kimlik yetki vermez.
  Codex'e öğe gönderimi `codex queue` ile; otomatik alıcı SessionStart/UserPromptSubmit/
  SessionEnd hook'larıyla (`src/codex-hooks.ts`, `src/codex-relay.ts`, `~/.codex/hooks.json`).
  `connect_session` elle yedek. Ada hedefi compose açılırken sabitlenir, receipt gelmeden
  "gönderildi" denmez.
- **Gerçek Durdur/Devam** (`f101d33`, `browser/Cancellation.sys.mjs`): süren bekleme, yazma,
  sürükleme, gezinme kesilir; Durdur öncesi kuyruk nesil kontrolüyle reddedilir. Yapılmış
  tıklama/ağ isteği geri alınmaz, sayfanın kendi JS'i durdurulmaz.
- **İzinler her batch adımında** (`8010ae7`): güncel belge/origin/ayarla yeniden kontrol;
  yönlendirme, yeni belge ya da ayar değişimi eski onayı geçersiz kılar.
- **Oturuma özel sekme sahipliği** (`5ea5e74`, `browser/Ownership.sys.mjs`): her oturum yalnız
  kendi sekmelerini görür; sağ tık menüsünde hedef oturum açıkça seçilir. Devir/geri alma
  çalışan işi iptal eder. MCP kopunca 5 sn pay, sonra sekme açık kalarak kullanıcıya döner.
  **Sınır:** MCP süreç UUID'si ≠ sohbet UUID'si; aynı MCP sürecini paylaşan sohbetler ayrılmaz.
- **`tab_work` ve devir kuyruğu** (`9d13f3c`): list/status/start/update/finish/request/cancel.
  Sahip açıkça `finish` der; auto modda ilk bekleyene devir notuyla geçer, ask modunda adada
  Ver/Verme. Bekleyen ajan polling yapar (~5 sn), push yok. 15 dk güncellenmeyen görev `stale`.
- **Örtülü öğe kontrolü** (`9d13f3c`): `computer` tıklamalarında, her mouse-down öncesi hit-test;
  örtülüyse örten öğenin etiketi/ref'iyle hata, zorla tıklama yok. Çapraz süreç iframe'lerde
  dar bir yarış aralığı kalır; salt koordinat amaçlanan gizli hedefi bilemez (ref tercih et).
- **Okumada diff** (`f252db4`, `browser/ReadSnapshots.sys.mjs`): `read_page`/`get_page_text`
  `diff: true` + `since: <snapshot>`; değişmediyse `unchanged`, değiştiyse unified hunk.
  Kapsam oturum+sekme+seçeneklere özel, yanlış/eski ID tam metne düşer, reload hepsini siler.
  Deneme sayfasında 26.176 → 250 karakter.
- **Çoklu öğe seçimi** (`5e013b0`): seçicide Shift+tık ekle/çıkar, Enter bitir, Backspace geri
  al, Esc iptal; aynı üst sayfada en fazla 8 öğe, tek not, öğe başına bağlam ve PNG.

- **Site kuralları** (2026-10-20): tek `sites` haritası; varsayılan genel moda uyar,
  `ask` işlem öncesi onay, `block` okuma/ekran görüntüsü/işlem/gezinmeyi reddeder.
  Sekme sağ tık → Ajan izinleri (Genel mod / Bu site) veya `config site ask|block|default <domain>` / `list`.
  Alt alanlar kapsanır, block önceliklidir, alt alan üst kuralı gevşetemez (menü mirası
  gösterir). Eski sensitive kayıtları okunur ve ilk yazımda taşınır; eski CLI uyumlu.
  Engelli iframe varsa üst sayfa erişimi de reddedilir. Ajan çağrısı sırasında engelli
  HTTP istekleri/yönlendirmeler iptal edilir; kullanıcı gezinmesine genel ağ filtresi yok.
  Engelli sekme listesinde yalnız ID + blocked döner, kapatma/geri verme serbest.
  Ortak politika `browser/SiteRules.sys.mjs`; `npm test`: 126/126 başarılı.
  `check-permissions.ts` canlı testleri (eski onaylar, block, yönlendirme, iframe, menü) geçti;
  mevcut auto ayarı geri yüklendi.

- **Genel eklenti arayüzü** (2026-10-20): `extensions` aracı list/open/read/text/find/
  computer/form_input/close. Kurulu eklentiler `tabs_context_mcp` cevabında da gelir.
  Firefox'un gerçek toolbar action/popup'ı kullanılır; eklentiye özel API/kural yok.
  Kaynak sekme seçili değilse auto modda da island üzerinden açık sekme geçiş onayı
  gerekir; ret/zaman aşımında sekme değişmez ve eklenti çalıştırılmaz. Zaten seçiliyse
  ek geçiş sorusu yok; site/işlem izinleri geçerli. Mevcut pencere kullanılır.
  `browser/ExtensionPanels.sys.mjs` oturum+sekme+belge+sahiplik sürümüne göre doğrular.
  `panel_<bc>_<innerWindow>:ref_N` ref'leri sayfa ve eski panellerle karışmaz.
  Sayfa kuralları/izinler korunur; panel eylemleri mevcut actor ile gerçek girdi üretir.
  Durdur, devir, oturum sonu, reload paneli kapatır. Geçici ayarları geri almak ajanın
  talimatıdır; otomatik rollback yok. Sidebar veya keyfi background API erişimi yok.
  Eklentinin açtığı yeni sekmeler otomatik sahiplenilmez; pano/indirme çıktıları host
  araçlarıyla alınır. Yeni tool/agent talimatları için MCP reconnect gerekir.
  `check-extensions.ts`: geçici yerel eklentiyle gerçek MCP → popup → trusted click /
  activeTab / Markdown çıktısı / form / klavye / screenshot; mevcut uBlock paneli
  ayarı değiştirilmeden okundu. Test eklentisi kaldırılır, önceki seçili sekme geri gelir.
  `npm test`: 138/138; canlı extensions ve permissions kontrolleri geçti.

- **Sistem panosu** (2026-10-20): yeni `clipboard` aracı read/write/copy/paste;
  bir ajana ait tabId gerekir, copy/paste açık eklenti panelini extensionId ile hedefler.
  Her çağrı auto modda ve batch içinde de ayrı island onayı ister; izin saklanmaz.
  Ctrl/Cmd+C/V/X, Ctrl+Insert, Shift+Insert/Delete de aynı izin yoluna bağlandı.
  Metin okuma sınırlı ve untrusted; yazma içeriği cevaba/günlüğe konmaz. Native copy/paste
  trusted olay üretir; onayda hedef/odak/seçim değişmişse çalışmaz, sekme değiştirilmez.
  Eklenti paneli onay sırasında noautohide ile korunur ve eski öznitelik geri yüklenir.
  Site block kuralları geçerlidir; web/eklentinin bağımsız clipboard API yazımı için
  genel filtre yok. Ortak izin akışı `browser/Clipboard.sys.mjs`, native komut actor'da.
  `check-clipboard.ts` gerçek MCP + sayfa/panel + ret/batch/hedef değişimi testlerini
  geçti; geçici eklenti kaldırıldı, önceki seçili sekme ve sistem panosu geri yüklendi.
  Yeni araç için MCP reconnect gerekir. `npm test`: 143/143 başarılı.

- **Girdi + görünüm paketi** (2026-10-20): computer key_down/key_up, mouse_move/down/up;
  oturum/çerçeveye özel held-state, native trusted olaylar. Hata/Durdur/gezinme/devir/
  disconnect/reload ve 30 sn watchdog bırakır. Actor'daki ikinci didDestroy tanımı
  kaldırıldı; gerçek cancellation/held cleanup artık gölgelenmiyor. Human typing ve
  smooth/human gerçek fare yolları opsiyonel; varsayılan hızlı kalır, seed destekli.
  Basılı Control + c/v gibi kombinasyonlarda da clipboard onayı korunur.
  Screenshot if_changed (tam veri eşitliği, 8 MB/32 giriş) ve annotate (üst çerçeve,
  en fazla 80 ref etiketi) eklendi. Native `browser_settings`: get/devices/viewport/
  device/media/reset. Her mutation/reset auto'da da island onayı; gerekirse hedef
  sekmeye geçiş soruda belirtilir. Global pref/pencere boyutu/RemoteAgent yok.
  Viewport CSS + native BC DPR/touch/UA/renk override'ları; devir/geri alma/kopma/reload
  eski ayarları geri getirir. Generic Gecko preset'leri; requested ve etkin ölçüler
  ayrı döner, DPR/ölçüler native mahremiyet/ölçekle farklı olabilir, maxTouchPoints spoof yok.
  Ortak modüller InputMotion/BrowserSettings/ScreenshotCache.sys.mjs.
  `npm test`: 153/153; check-input, check-clipboard ve check-permissions canlı geçti.
  Test sekmeleri kapandı, eski seçili sekme/pano/auto ayarı geri yüklendi.
  [Güncel özellik karşılaştırması](FEATURE-COMPARISON.md). Yeni şema/tool için MCP reconnect.

- **React + axe incelemesi** (2026-10-20): `react` tree/inspect, DOM'a bağlı committed
  bileşen ağacı/üst bileşen zinciri, isteğe bağlı sınırlı props (varsayılan kapalı).
  Getter/bileşen çağrısı ve DevTools hook kurulumu yok; Fiber özel API olduğundan uyum
  best-effort, production adları küçültülebilir, server-only bileşen/render geçmişi yok.
  `browser/ReactInspect.sys.mjs`; committed alternate seçimi, döngü/derinlik/öğe sınırları.
  `accessibility`: paketlenmiş axe-core 4.14.0, yerel content-principal sandbox;
  violations/incomplete/sayılar/öğe ref'leri, tags ve ref ile alt ağaç filtresi.
  Sayfanın window.axe nesnesine dokunmaz; bitiş/iptal/20 sn zaman aşımında sandbox yok edilir.
  Toplam tarama iş bütçesi 45 sn. Her çerçeve ayrı incelenir; çapraz çerçeve ilişkileri yok,
  ref kapsamı iç iframe'leri içermez; başarısız çerçeveler açıkça raporlanır.
  İki araç sahiplik/site kurallarına uyar; ask mod/site onayı, block ret; belge/iframe
  değişirse sonuç geçersiz. Otomatik tarama erişilebilirlik uyumluluğu kanıtı değildir.
  `npm test`: 167/167; `check-inspection.ts` gerçek React 18.3.1 development/production,
  yeniden render sonrası güncel props, axe bulgu/ref, çapraz origin iframe ve alt ağaç
  taraması geçti. `check-permissions.ts` canlı izin/site kontrolleri de geçti.
  Test sekmeleri kapandı; önceki seçili sekme ve izin config'i geri yüklendi.
  Yeni `react`/`accessibility` araçları için MCP reconnect gerekir.

**CLI + skill deneyi arşivlendi** (main'e alınmadı). Kalıcı broker'lı CLI
(`src/browser-cli.ts`), repo skill'i ve iki ölçüm (`docs/benchmarks/`). Taşıma testi: 16
çağrıda MCP 322 ms, CLI 785 ms, metin aynı. Gerçek ajan pilotu (Codex + Claude, 3 görev ×
2 yol, her biri tek deneme): hepsi başarılı; CLI %10–15 fazla token (gürültü sınırında),
süre olarak belirgin yavaş. **Karar: MCP ana yol.** `cli-prototype` dalı 2026-10-20'de silindi; tam geçmişi doğrulanmış
`/home/efe/Archives/zen-mcp-cli-prototype.bundle` arşivinde (uç commit: `1693ff4`).

- **Sekme keşfi + ada notu** (2026-10-21, 2026-10-26): `tabs_context_mcp` artık `userTabs` içinde
  kullanıcı sekmelerinin ID/başlık/URL metadatasını döndürür (block yalnız ID + blocked).
  `request_tab` bu sekmeleri öğe seçimi olmadan da isteyebilir; auto dahil açık ada onayı
  gerekir, onaydan önce içerik/işlem erişimi yok. Başka ajanın sekmeleri mevcut FIFO yolunda.
  Tüm ada sorularında tek satırlık isteğe bağlı "Ajana not" (2000 karakter), iki düğmeyle de
  gider: ret → araç hatasında, onay → sonuca eklenen `userMessage`, ask_user → yanıtta.
  Hepsi untrusted kullanıcı metni. (İlk hâlinde yalnız retle gidiyordu; Efe yazıp OK'e
  basınca not kayboldu, kafa karıştırıcıydı.) Not her soruda sıfırlanır. Zen'de doğrulandı (2026-10-26).

- **browser_settings düzeltmeleri** (2026-10-26, canlı denemede bulundu): ölçüm sayfa
  sandbox'ında (chrome çağıran DPR/UA geçersiz kılmalarını görmüyordu, DPR "uygulanmıyor"
  sanılıyordu); reset sonrası düzen beklenir; geçersiz kılmalar güncel `source.browsingContext`
  üzerinden geri alınır (siteler arası gezinme BC'yi değiştirir, UA yenisine taşınıp kalıyordu);
  mobil/tablet hazır ayarı Android Firefox UA'sı gönderir.

## Açık işler

1. Codex hook güveni ve otomatik alıcı uçtan uca doğrulandı; kalan doğrulama yok.
   Gerçek seçim → otomatik alıcı → queue → bu sohbete öğe bağlamı ulaştı. Eksik Codex
   `default_permissions` ayarı yedeklenip `:workspace` ile düzeltildi. Tekrar kontrol:
   `node scripts/check-pick-delivery.ts --automatic` (gerçek sohbete mesaj gönderir).
2. Eklenti ve clipboard özellikleri uygulandı. Yeni `extensions`/`clipboard`/`browser_settings`/`react`/`accessibility` araçları ve computer seçenekleri
   için MCP reconnect ve günlük kullanım geri bildirimi bekleniyor. Diğer adaylar Quickshell göstergesi,
   isim + npm; ayrı izinli alan adları yerine site kuralları seçildi.
3. Refactor (2026-10-26): main.js 2.992 → 1.950 satır. Taşınanlar: NetworkLog, TabMenu,
   Channels, Picks, araç grupları (Read/Input/BrowserTools; `ctx` ile). main.js'te çekirdek kaldı:
   sahiplik/oturumlar, `query`/çerçeve/girdi yardımcıları, izinler, sekme araçları, soket.
   Sıradaki aday: izin bölümü (describeWrite/requirePermission, ~200 satır).
   Testlerde öğrenilenler: araçları kullanan testler artık modül fabrikasını sahte ctx ile çağırır;
   main.js'i işaretçi yorumlardan dilimleyen testler hâlâ var (sahiplik/izin/iptal), kırılgan.
4. Araç: `zenctl reload` yeni sürüm başlamazsa da başarılı görünür ("staying on vN" yalnız
   $XDG_RUNTIME_DIR/zen-mcp.log'da). Reload sonrası log'a bak; zenctl hata bildirmeli.
   main.js'i bütün olarak yükleyen bir duman testi de TDZ gibi kurulum hatalarını yakalar.

## Çalışma yöntemi

- `npm test` (build + soketsiz/soketli birim testleri; sahte DOM ile gerçek actor/ana süreç kodu).
- Canlı: `node scripts/check-<özellik>.ts` (compat, cancellation, permissions, ownership,
  coordination, hit-test, read-diff, multi-pick, extensions, clipboard). Köprüyü reload eder, yalnız kendi test
  sekmelerini kapatır, mevcut `mode: auto` ister; config'i geçici değiştirenler geri yükler.
  Sonrasında `~/.config/zen-mcp/config.json`'un `mode: auto` kaldığını kontrol et.
  `check-pick-delivery.ts` GERÇEK sohbete mesaj yollar, rastgele çalıştırma.
- Codex'in komut sandbox'ı Unix soketine EPERM verebilir; Full Access oturumunda sorun yok.
  Ayrıntı: [`CODEX-SOCKET.md`](CODEX-SOCKET.md).
- `node scripts/zenctl.ts reload` tarayıcı kodunu Zen'i kapatmadan yeniler; Node MCP sürecini
  yenilemez. Node/şema değişince MCP istemcisi reconnect; Zen restart gerekmez.
- Dosyalar: `src/server.ts` (şemalar, kimlik), `src/zen.ts`/`paths.ts` (soket, receipt),
  `src/delivery.ts` (Codex queue), `browser/main.js` (köprü, araçlar), `Island.sys.mjs` (ada),
  `Agent.sys.mjs` (kimlik/tema), `NetworkLog.sys.mjs` (ağ kaydı), `TabMenu.sys.mjs` (sekme sağ tık menüsü), `Channels.sys.mjs` (oturumlara olay itme), `Picks.sys.mjs` (öğe seçimi), `ReadTools`/`InputTools`/`BrowserTools.sys.mjs` (araç grupları; main.js `ctx` ile ortak yardımcıları verir), `Ownership`/`Cancellation`/`ReadSnapshots.sys.mjs`, `actors/`.

## Amaç ve kararlar

- Günlük Zen penceresinde, Efe'nin oturumlarıyla, farklı AI ajanlarıyla birlikte çalışma.
  Gerçek test istemcileri Claude Code ve Codex. Ayrı pencere ya da container yok.
- Repo private; yayın, npm/MCP Registry ve isim sonra.
- agent-browser referans; onu kopyalamak yerine güvenilirlik ve kullanıcıyla birlikte çalışma.

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
  Her istek `session` kimliği taşır; olay adada seçilen hedef oturuma gider (Codex'e
  `codex queue` ile). Abone yoksa metin panoya kopyalanır. Bayraksız oturumlar abone olmaz.

## Tool'lar (Claude in Chrome adlarıyla uyumlu)

`tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp`, `navigate`, `computer` (screenshot, tıklamalar, hover,
drag, scroll, scroll_to, type, key, wait; koordinat ya da ref), `read_page`, `find`,
`form_input`, `get_page_text`, `javascript_tool`, `read_console_messages`,
`read_network_requests`, `handle_dialog`, `ask_user`, `file_upload`, `request_tab`, `browser_batch`,
`wait_for`, `tab_work`, `connect_session` (Codex için elle yedek).

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
- **Modlar ve site kuralları:** `~/.config/zen-mcp/config.json`:
  `{"mode":"auto"|"ask","sites":{"alan.adı":"ask"|"block"}}`. Ayrıntı yukarıdaki güncel
  Site kuralları maddesinde ve README.tr.md'de. Genel ask modunda navigate da sorulur;
  site ask kuralında gezinme serbest, yazma işlemleri onaylıdır. Okuma, kaydırma, hover,
  bekleme block yoksa serbest. Batch onayı belge/origin/politika değişince geçersiz olur.
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
