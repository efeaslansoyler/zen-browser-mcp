# zen-browser-mcp

[English](README.md) · [Türkçe](README.tr.md) · [MIT Lisansı](LICENSE)

Claude Code, Codex veya başka bir MCP client ile Zen ya da Firefox tabanlı
tarayıcını kullan. Ajan kendi sekmelerinde ve ona verdiğin sekmelerde sayfa
okuyabilir, tıklayabilir ve yazabilir. Tarayıcının üstündeki ada, ajanın ne
yaptığını gösterir. İzin vermek, bir adımı devralmak veya işi durdurmak için adayı
kullanabilirsin.

[![Zen’de sayfa öğesi paylaşma ve görev kaydetme demosu](docs/media/demo.tr.gif)](docs/media/demo.tr.mp4)

> [!IMPORTANT]
> Bridge, tarayıcı yetkileriyle çalışır ve açık hesap oturumlarını kullanabilir.
> Güvendiğin client’ları kullan ve ajanın istediği işlemleri kontrol et. Projenin
> testleri var ancak güvenlik denetiminden geçmedi.
> Ayrıntılar için [izinler ve güvenlik](docs/permissions.md) sayfasına bak.

## Kaynak koddan kurulum

Node.js 22 veya üstü, bir MCP client ve installer’ın yazabildiği bir klasöre
kurulmuş masaüstü tarayıcısı gerekir. Installer Linux ve macOS’u hedefler.
[Uyumluluk tablosunda](docs/browser-compatibility.md) Zen, Firefox, LibreWolf,
Floorp ve Waterfox’un test edilen Linux build’lerini görebilirsin. Flatpak ve Snap
kurulumları desteklenmiyor.

```sh
git clone https://github.com/efeaslansoyler/zen-browser-mcp.git
cd zen-browser-mcp
npm ci
npm run build
node dist/cli.js install
```

Installer, tarayıcının kurulum klasörüne bir autoconfig loader ekler. Bu adımda
`sudo` isteyebilir. Tarayıcıyı yeniden başlat, ardından checkout klasöründen
client’ına uygun komutu çalıştır:

```sh
# Claude Code
claude mcp add --scope user zen -- node "$PWD/dist/cli.js"

# Codex
codex mcp add zen -- node "$PWD/dist/cli.js"
```

Başka bir MCP client’ta local stdio server ekle. Komut olarak `node`, tek argüman
olarak `dist/cli.js` dosyasının tam yolunu ver. Kurulumu `node dist/cli.js doctor`
ile kontrol edebilirsin. Installer tarayıcıyı bulamazsa `--browser /kurulum/yolu`
ile `application.ini` dosyasının bulunduğu klasörü belirt.

[Browser and profile selection](docs/permissions.md#browser-and-profile-selection)

Default `together` mode'unda yeni MCP session en son focus alan kullanıcı
profile'ını kullanır. Bir MCP client için seçimi `--browser <name|dir>` ve
`--profile <name|dir>` server argümanlarıyla değiştirebilirsin.
Linux ve macOS'ta seçili browser kapalıysa bir tool çağrısı onu açabilir.
Seçim otomatikse ve eşleşen browser yoksa bulunan ilk browser (önce Zen)
açılır. `together` mode'unda kendi default profile'ı kullanılır. Auto mode açılışa izin verir. Ask mode, form
elicitation destekleyen MCP client'ta onay ister.

```sh
node dist/cli.js config browser Zen --profile Default
node dist/cli.js config launch allow|ask|deny
node dist/cli.js config launch default
node dist/cli.js doctor
```

[Browser startup and permissions](docs/permissions.md#on-demand-browser-startup)

## Browser mode seçenekleri

| Mode | Profile | Pencere |
|---|---|---|
| `together` (default) | Kendi profile'ın | Görünür |
| `agent` | Login'leri saklayan ortak agent profile'ı | Görünür |
| `scratch` | Bu MCP process'ine ait geçici profile | Görünür |
| `autonomous` | Bu MCP process'ine ait geçici profile | Headless |
| `autonomous-agent` | `agent` ile aynı kalıcı profile | Headless |

Default mode'u `npx zen-browser-mcp config browser-mode agent` ile ayarla. Tek bir
client için MCP server argümanlarına `--browser-mode <mode>` ekle veya server
environment'ında `ZEN_MCP_BROWSER_MODE` kullan. Değişiklikten sonra client'ı yeniden
bağla. Browser seçimi her mode'da, profile seçimi `together` mode'unda geçerli.

Kalıcı profile zaten açıksa iki mode da çalışan instance'ı mevcut mode'uyla kullanır.
`agent` ile login olduktan sonra o browser'ı kapatıp `autonomous-agent` ile devam
edebilirsin. Autonomous mode'lar island'da onay gerektiren işlemlere izin verir,
sistem clipboard erişimini reddeder ve custom `deny` kurallarıyla site kurallarını
uygular. [Autonomous mode permissions](docs/permissions.md#autonomous-browser-modes)

`npx zen-browser-mcp doctor` agent profile'ın konumunu gösterir. Login ve site
verilerini silmek için agent browser'ını kapatıp
`npx zen-browser-mcp reset-agent-profile --browser <name|dir>` çalıştır.

## Kullanım

- **Ajandan bir sayfa açmasını iste.** “example.com’u aç ve sayfada ne yazdığını
  söyle” diye deneyebilirsin. Ajan kendi sekmesini açar, ada da işlemi gösterir.
- **Açık bir sekmede çalış.** Sekmeye sağ tıklayıp **Oturuma ver…** seçeneğini
  kullan veya ajanın sekme erişim isteğini onayla. Erişimi kaldırmak için
  **Ajandan geri al** seçeneğini kullan.
- **İzin ver veya durdur.** Onay isteklerini adadan yanıtla. Hesaba giriş gibi
  adımları devralabilir veya **Durdur** ile ajanın çalışmasını kesebilirsin.
- **Ne istediğini göster.** Sayfaya sağ tıklayıp **Ajana göster…** ile bir öğeyi
  notla gönder. Tekrarlanan bir işi tarif olarak saklamak için
  **Ajan için adımları kaydet…** seçeneğini kullan. Gönderim kurulumu
  [tarayıcı iş akışları](docs/browser-workflows.md) sayfasında.

Ajan sayfa yapısını ve erişilebilirliği inceleyebilir, ekran görüntülerini
karşılaştırabilir, ağ ve performans verisi toplayabilir. Tool ayrıntıları
[tarayıcı tanılama kılavuzunda](docs/browser-diagnostics-plan.md).

## Daha fazla bilgi

- [Tarayıcı araçları karşılaştırması](docs/feature-comparison.md) ve aynı Zen build’inde
  Kitsune ve ZenPilot ile yapılan [Codex token benchmark’ı](docs/browser-benchmark.md)
- Ayarlar, iş akışları ve mimari için [docs](docs/README.md)
- Geliştirme ve live check’ler için [CONTRIBUTING.md](CONTRIBUTING.md)
- Checkout’u güncelledikten sonra `npm ci`, `npm run build` ve
  `node dist/cli.js install` komutlarını tekrar çalıştır. Tarayıcıyı yeniden
  başlatıp MCP client’ı yeniden bağla.
- Browser bridge’i kaldırmak için `node dist/cli.js uninstall` çalıştır.
  Tarayıcıyı yeniden başlatıp MCP client’taki server kaydını kaldır.
