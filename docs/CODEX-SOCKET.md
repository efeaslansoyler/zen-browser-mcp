# Codex terminalindeki EPERM teşhisi

2026-10-20 incelemesi, Codex CLI 0.163.0:

- Zen soketi `/run/user/1000/zen-mcp.sock`, sahibi efe/efe, modu 0600;
  üst klasör efe/efe 0700. Komut sürecinin UID'si de 1000.
- Sandboxed komutta bu sokete connect errno 1 (EPERM) veriyor.
- Zen'den bağımsız olarak `/tmp/zen-socket-probe-<UUID>.sock` üzerinde yeni Unix
  soketi bind işlemi de EPERM veriyor. Probe kendi geçici dosyasını temizler.
- `/proc/self/status`: NoNewPrivs=1, Seccomp=2. Etkin oturum politikası ağ erişimini
  kısıtlıyor; sandbox yükseltme onayları kapalı. Kullanıcı config.toml dosyasında
  sandbox_mode/default_permissions/approval_policy override'ı bulunmadı.
- **Aynı sohbetin standart Zen MCP aracı çalıştı:** tabs_context_mcp mevcut
  oturumun sekme listesini okuyabildi. Bu nedenle sorun tüm MCP erişimi değil,
  komut aracı içinden doğrudan soket açma sınırıdır.

Bu kanıtlar sandbox kısıtına işaret eder; chmod/sudo/socket yerini değiştirme
önerilmez. Claude'un komutları aynı sandbox altında yürümüyor olabilir; Claude'un
etkin izin politikasını ayrıca ölçmeden onun neden farklı davrandığı kesinlenmez.

## Kullanıcı tarafındaki ayar

Resmî [Codex izin profilleri](https://learn.chatgpt.com/docs/permissions), aktif
profilde tam Unix soket yolu için allowlist tanımlar. Mevcut profilin adı gerçekten
`mevcut-profil` ise eklenecek dar kapsamlı tablo örneği:

```toml
[permissions.mevcut-profil.network.unix_sockets]
"/run/user/1000/zen-mcp.sock" = "allow"
```

Bu tek başına yeni/aktif bir profil tanımı değildir. Gerçek aktif profil adı ve
CLI/masaüstü/IDE tarafından uygulanan ağ/proxy/managed kısıtları kontrol edilmelidir.
Ağ kapalıysa veya üst politika izin vermiyorsa bu satır tek başına çözüm vaat etmez.
Kullanıcıya oturumu nereden açtığı soruldu; cevaba göre etkin ayarın yeri netleştirilecek.
Ayarlar bu sohbetten değiştirilmedi. Bu süreç mevcut kısıtını kendisi kaldıramaz.

[Codex güvenlik belgesi](https://learn.chatgpt.com/docs/agent-approvals-security)
Linux'ta bwrap/seccomp kullanımını açıklar. Tüm Unix soketlerine izin verme veya
sandbox'ı tamamen kapatma gerekmeksizin önce yerel entegrasyonun dar izni ele alınır.

Normal tarayıcı işlerinde standart MCP kullanılabilir. Geliştirme reload/chrome_eval
komutları güvenlik amacıyla standart MCP'ye açılmadığından, soket izni açılana kadar
canlı geliştirme betiklerini kullanıcı kendi terminalinde çalıştırır. Bunları standart
MCP'ye ekleyerek kısıtı aşmaya çalışmayız. Relay testleri de ayrıca /tmp üzerinde bind
izni gerektirir; Zen connect allowlist'i tüm testlerin serbest olduğu anlamına gelmez.
