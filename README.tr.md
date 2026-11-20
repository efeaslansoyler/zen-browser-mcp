# zen-browser-mcp

Claude Code, Codex ve diğer MCP ajanları hâlihazırda kullandığınız tarayıcıda çalışsın: açık sekmelerinizle, oturum açtığınız hesaplarla ve gerçek kullanıcı etkileşimleriyle. Tarayıcı penceresinin üst kısmındaki küçük bir panel (island), ajanların neler yaptığını gösterir.

[![CI](https://github.com/efeaslansoyler/zen-browser-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/efeaslansoyler/zen-browser-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/zen-browser-mcp)](https://www.npmjs.com/package/zen-browser-mcp)
[![Lisans: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[English](README.md) · [Türkçe](README.tr.md)

[![Zen'de sayfa öğelerini bir ajanla paylaşma ve bir görevi kaydetme](docs/media/demo.tr.gif)](docs/media/demo.tr.mp4)

## Neden?

- **Kendi tarayıcınızda çalışır.** Ajanlar, sizin sekmelerinizin yanında kendi arka plan sekmelerini açabilir veya paylaştığınız bir sekmede çalışabilir. Ayrı bir otomasyon tarayıcısına ya da uzaktan hata ayıklama portuna gerek yoktur.
- **Kontrol sizde kalır.** Pencerenin üst kısmındaki panel, her ajanın ne yaptığını gösterir. Varsayılan olarak form gönderimleri, parola alanları, dosya yüklemeleri ve sayfa içinde JavaScript çalıştırılması sizin onayınızı bekler. Paneldeki durdurma düğmesiyle veya sekme menüsündeki **Ajandan geri al** ile ajanın çalışmasını anında durdurabilirsiniz.
- **Yalnızca sizin yapmanız gereken işlemler sizde kalır.** Ajanlar giriş yapma, iki faktörlü kimlik doğrulama (2FA) ve ödeme işlemlerini size bırakır. Siz **Bitti** düğmesine bastığınızda kaldıkları yerden devam ederler. Böylece kimlik bilgileriniz ajanlara aktarılmaz.
- **Anlatmak yerine gösterin.** Herhangi bir sayfadaki öğeleri seçip bir notla birlikte ajanın oturumuna gönderebilirsiniz. Desteklenen bir framework'ün yerel geliştirme sunucusunda çalışıyorsanız seçilen öğenin kaynak dosyası da belirlenir.
- **Bir kez gösterin, tekrar kullansınlar.** Tarayıcıda bir görevi kaydedin; ajanlar bu kaydı sonraki işlemlerinde bir tarif gibi kullanabilsin.
- **Birden çok ajan, birden çok tarayıcı.** Oturumlar sekmeleri paylaşabilir ve sırayla çalışabilir. Zen, Firefox, LibreWolf, Floorp ve Waterfox desteklenir.

## Hızlı başlangıç

Node.js 22 veya üzeri, Linux ya da macOS ve yazma izninizin olduğu bir klasöre kurulmuş Zen veya Firefox tabanlı bir tarayıcı gerekir.

```sh
npm install -g zen-browser-mcp
zen-browser-mcp install
```

Tarayıcıyı yeniden başlatın. Ardından kullandığınız MCP istemcisini bağlayın:

```sh
claude mcp add --scope user zen -- zen-browser-mcp   # Claude Code
codex mcp add zen -- zen-browser-mcp                 # Codex
```

Ajanınıza şunu söyleyin: *"example.com adresini aç ve sayfada ne yazdığını anlat."* Ajan için yeni bir sekme açılır ve üstteki panel yapılan işlemleri gösterir. Ajanın hâlihazırda açık olan bir sekmenizi kullanmasını istiyorsanız sekmeye sağ tıklayıp **Oturuma ver…** seçeneğini seçin veya ajanın erişim isteğini onaylayın.

Diğer istemciler, `doctor` komutu, güncelleme, kaldırma ve kaynak koddan çalıştırma hakkında bilgi için [Kurulum](docs/installation.md) rehberine bakın.

## Nasıl çalışır?

```
MCP istemcisi ──stdio──▶ zen-browser-mcp ──yerel soket──▶ tarayıcı içindeki köprü ──▶ web sayfaları
```

`install` komutu, tarayıcıya küçük bir otomatik yapılandırma yükleyicisi ekler. Bu yükleyici, tarayıcı içinde özel bir Unix soketi üzerinden bağlantıları dinleyen bir köprü başlatır. Kullandığınız MCP istemcisinin çalıştırdığı sunucu da bu köprüyle iletişim kurar. Etkileşimler, sayfanın kendi işleminden gelen güvenilir olaylar olarak sayfaya iletilir. Böylece siz tarayıcıyı kullanmaya devam ederken ajanlar arka plan sekmelerinde çalışabilir.

## Güvenlik

Köprü, tarayıcı yetkileriyle çalışır ve oturum açtığınız hesaplar üzerinden işlem yapabilir. Bu nedenle yalnızca güvendiğiniz istemcilerle kullanın ve bir ajanın onayınızı istediği işlemleri dikkatlice inceleyin. Projede otomatik testler bulunmaktadır ancak bağımsız bir güvenlik denetimi yapılmamıştır.

[İzinler ve güvenlik](docs/permissions.md) rehberinde çalışma modları, site kuralları ve güven sınırları açıklanır. Güvenlik açıklarını [SECURITY.md](SECURITY.md) dosyasında anlatıldığı şekilde özel olarak bildirin.

## Dokümantasyon

| Rehber | İçerik |
|---|---|
| [Kurulum](docs/installation.md) | Gereksinimler, istemciler, hook'lar ve skill, güncelleme, kaldırma |
| [Tarayıcı iş akışları](docs/browser-workflows.md) | Sekmeler ve üst panel, sayfa öğelerini gönderme, görev tarifleri, pano, eklentiler, indirmeler |
| [İzinler ve güvenlik](docs/permissions.md) | Onay modları, özel kurallar, site listeleri |
| [Tarayıcılar, profiller ve modlar](docs/browsers.md) | Tarayıcı seçimi, ajan ve headless profilleri, tarayıcıyı gerektiğinde başlatma |
| [Tarayıcı tanılama araçları](docs/browser-diagnostics.md) | Değişiklikleri karşılaştırma, ekran görüntüsü referansları, ağ ve HAR, Web Vitals, PDF ve video |
| [Tüm dokümantasyon](docs/README.md) | Codex entegrasyonu, uyumluluk, mimari, karşılaştırmalar |

## Katkıda bulunma

Hata bildirimlerine, fikirlere ve pull request'lere açığız. Başlamak için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına göz atın. Yapılan değişiklikleri [değişiklik günlüğünde](CHANGELOG.md) bulabilirsiniz.

## Lisans

[MIT](LICENSE) lisansı altında sunulur. Zen Browser ekibi veya Mozilla ile bağlantısı olmayan, bu kuruluşlar tarafından desteklenmeyen bağımsız bir projedir.
