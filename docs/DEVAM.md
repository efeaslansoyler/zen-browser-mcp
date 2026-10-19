# zen-mcp: kaldığımız yer

Yeni oturumda önce bunu oku. Kararlar ve fazlar için ayrıca [`PLAN.md`](PLAN.md).

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
  bildirimi, üzerine gelince canlı önizleme.

## Tool'lar (Claude in Chrome adlarıyla uyumlu)

`tabs_context_mcp`, `tabs_create_mcp`, `navigate`, `computer` (screenshot, tıklamalar, hover,
drag, scroll, scroll_to, type, key, wait; koordinat ya da ref), `read_page`, `find`,
`form_input`, `get_page_text`, `javascript_tool`, `read_console_messages`,
`read_network_requests`, `handle_dialog`, `ask_user`, `file_upload`.

Davranış notları:

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
- Autoconfig kapsamında `IOUtils` yok → pencerenin `IOUtils`'i.
- Actor yok olunca bekleyen `sendQuery` reddedilmiyor → `currentWindowGlobal` değişimini izle.
- Container'sız sekmede Firefox `.tab-context-line`'ı `display: none` yapıyor.
- Zen'in ana tema rengi (`--zen-primary-color`) Efe'de açık gri (#bebebe): üstüne beyaz yazı
  okunmuyor, ada bu yüzden koyu.
- Zen'de pencere senkronu açık; senkronsuz pencere `OpenBrowserWindow({ zenSyncedWindow: false })`.
  Bu yol denendi ve bırakıldı.
- Hyprland görünmeyen workspace'teki pencereyi askıya alıyor (`document.hidden`, odak geçmiyor,
  APZ kaydırmıyor). Pencere seviyesinden girdi göndermekten bu yüzden vazgeçildi.

## Durum (2026-10-19)

- Faz 1: ada, Durdur/Devam ✅
- Faz 2: `ask_user`/diyaloglar adada, tıklama halkası, masaüstü bildirimi ✅
- Faz 3: Claude'a ver / geri al ✅
- Ek: sanal imleç ve adada canlı önizleme ✅ (Efe beğendi)

## Sıradaki

0. **Zen'den öğe seçip Claude'a iş verme** (Claude Code channels ile; ayrıntılar `PLAN.md`
   sonunda). Efe'nin fikri, bir sonraki oturumda ilk iş.
1. **Faz 4:** iframe desteği (`read_page`/tıklama/yazma alt çerçevelerde; şu an yalnız üst
   çerçeve) ve `wait_for` (metin/öğe görünene, ağ durulana kadar).
2. **Faz 5:** ağ isteği ayrıntıları (başlıklar, cevap gövdesi), etkinlik günlüğü, hassas
   siteler listesi.
3. İsteğe bağlı: Quickshell barında Claude göstergesi; açık kaynak için README ve kurulum betiği.

Not: bu oturumdaki MCP sunucusu oturum başında başlar. `src/server.ts` değişince yeni tool'lar
ve açıklamalar için Claude Code'da `/mcp` ile yeniden bağlan ya da yeni oturum aç.
