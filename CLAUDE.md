# OTPsplash Server — Claude Code Specification

> Her oturumda bu dosyayı önce oku. Faz tamamlanma kriterlerini geçmeden sonraki faza geçme.

---

## Rol

Kıdemli backend mühendisi. Stripe/Google kalitesinde kod yaz.

---

## Proje

**OTPsplash** — Test hesaplarına gelen SMS OTP'lerini ilgili developer'lara sıfır müdahaleyle,
admin tarafından tanımlanmış kurallara göre dağıtan bir orkestrasyon platformudur.

```
SMS gelir (Android: otomatik | iOS: Shortcuts) → CİHAZDA parse edilir (code + senderRaw)
  → POST /api/otp (X-Device-Secret header ile) { code, source, senderRaw }
    → Device doğrula
      → AES-256-GCM şifrele → DB kaydet (receiverId doğrudan yazılır, deviceId'ye bağımlı değil)
        → RoutingRule'a göre hedef belirle (receiver → developer veya grup)
          → Socket.IO emit → ilgili developer(lar)ın ekranı
```

**Servis kavramı yoktur (kaldırıldı):** Dağıtım hedefi artık gönderilen SMS'in hangi servise
(Binance, Garanti vb.) ait olduğuna değil, YALNIZCA kodu üreten receiver'a bağlıdır. `senderRaw`
sadece developer'a "kim gönderdi" etiketi olarak gösterilir; backend bunu bir servise çözmez,
bir kurala bağlamaz. Bir receiver'ın tüm kodları, o receiver'a atanmış developer(lar)a gider.

**Parse yeri kararı:** OTP kodu cihazda parse edilir, backend'e asla ham SMS metni (`smsText`)
gönderilmez. Sadece parse edilen `code` ve gönderici etiketi `senderRaw` gönderilir. Bu hem mobil
tarafta zaten var olan regex mantığını tekrar kullanır hem de "SMS gövdesi asla cihazdan çıkmaz"
güvenlik prensibini gerçek anlamda korur — eğer backend parse etseydi, ham metnin backend'e gitmesi
şart olurdu ve bu prensip kağıt üzerinde kalırdı.

**Kullanıcı rolleri:** RECEIVER (OTP üretir) | DEVELOPER (OTP alır) | ADMIN (kuralları yönetir)
Üç rol de ayrı mobil arayüze sahiptir — bir kullanıcı aynı anda iki rolü birden taşımaz.
Admin için ayrıca web dashboard da vardır (mobil admin paneli + web dashboard birlikte var olur).

**Otomasyonun iki katmanı:**
```
Katman 1 — SMS yakalama (cihazda otomatik)
  Receiver hiçbir şey seçmez, SMS geldiği an cihaz backend'e gönderir.

Katman 2 — Dağıtım (backend'de, admin kuralına göre otomatik)
  Hangi developer'ın hangi receiver'ın kodlarını göreceğini admin önceden tanımlar
  (RoutingRule: receiver → developer/grup). Receiver paylaşımı elle seçmez, sadece
  admin'in kurduğu kuralı salt-okunur görür ve dilerse o OTP özelinde paylaşımı durdurabilir.
```

---

## Tech Stack

| Katman | Teknoloji | Karar Notu |
|--------|-----------|------------|
| Runtime | Node.js 20 LTS | — |
| Dil | TypeScript 5+ strict | `any` yasak |
| Framework | Express.js | — |
| Gerçek zamanlı | Socket.IO 4 | In-memory, adapter-ready |
| ORM | Prisma 5 | — |
| Veritabanı | PostgreSQL 15 | — |
| Auth (kullanıcı) | jsonwebtoken | access 15dk (stateless) / refresh 30gün (rotasyonlu, DB'de izlenir) |
| Auth (cihaz) | Device Secret | 256-bit random, argon2id hash'li, süresiz |
| Parola | **argon2id** | bcryptjs değil — OWASP 2024, C++ binding, 3-5x hızlı |
| Validation | Zod | Her endpointte zorunlu |
| Şifreleme | Node.js crypto | AES-256-GCM, native |
| Logging | pino | JSON structured, redact zorunlu |
| Rate limiting | express-rate-limit | In-memory yeterli |
| Cron | — | (OTP süresiz — cleanup job kaldırıldı) |
| Test | Jest + Supertest | Unit + integration |
| Güvenlik | helmet + cors | — |

---

## Mimari Kurallar

### SOLID
- **SRP:** Controller sadece HTTP katmanı. İş mantığı service'te, DB işlemi repository'de.
- **OCP:** Yeni OTP kaynağı (kayıt tipi) eklemek = yeni veri/enum, mevcut koda dokunma.
- **LSP:** Tüm interface implementasyonları birbirinin yerine geçebilmeli.
- **ISP:** `IOtpEncryptor`, `IOtpRepository`, `IOtpNotifier`, `IRoutingResolver`, `IRoutingRepository` — tek büyük interface yok.
- **DIP:** Service'ler concrete class'a değil interface'e bağımlı. Constructor injection zorunlu.

### Temiz Kod
- Magic string/number yok — her şey `CONSTANTS` veya enum.
- Public fonksiyonlara JSDoc yaz.
- `try/catch` boş bırakılmaz.
- `console.log` ile hata yönetimi yapma — pino kullan.

### Asenkron / Senkron Kuralları
```
SYNC olmalı:
  ✓ AES-256-GCM encrypt/decrypt  (crypto sync API)
  ✓ JWT sign/verify              (hızlı, QA iç aracı için yeterli)
  ✓ Device Secret üretimi        (crypto.randomBytes, sync)
  ✓ Routing hedeflerini flatten + dedupe (bellekte, DB'den çekilen kurallar üzerinde — I/O değil)
  ✓ Config/env okuma             (startup)

ASYNC olmalı:
  ✓ Her Prisma işlemi            (I/O)
  ✓ argon2 hash/verify           (CPU-intensive, event loop'u bloklar)
  ✓ Socket.IO emit               (I/O)
  ✓ Routing kurallarını DB'den çekme (I/O — sonra senkron flatten yapılır)

YASAK:
  ❌ argon2.hashSync() / bcrypt.hashSync()
  ❌ crypto.pbkdf2Sync()
  ❌ fs.readFileSync() (startup dışında)
```

### Hata Mimarisi
- `AppError` abstract base → tüm hatalar buradan türer.
- Her hata: `statusCode`, `errorCode` (enum), `isOperational` (true=beklenen, false=bug).
- Controller'da `next(error)` ile global handler'a ilet — exception sızdırma.
- `Result<T>` pattern: `{ success: true, data }` | `{ success: false, error }`.
- Stack trace asla client'a sızdırılmaz.

### Logging
- pino redact: `['body.password', 'body.code', 'body.refreshToken', 'body.senderRaw', 'headers.authorization', 'headers.x-device-secret']`
  (`smsText` artık listede yok — çünkü hiçbir zaman backend'e gelmiyor, redact etmeye gerek kalmadı)
- Her request'e UUID (`req.id`) ekle, her response'da dön.
- Log seviyesi production'da `info`.

### Socket.IO Scaling Notu
Şu an in-memory — 5-10 kullanıcı için yeterli. Yatay büyüme gerekirse:
`io.adapter(createAdapter(pubClient, subClient))` — 1 satır, geri kalan kod değişmez.

### Socket Handshake Auth — Makine-Okunur Red Kodu
Handshake auth reddi (`authenticateSocket`) client'a hata METNİNİN yanı sıra makine-okunur bir
`data.code` (`ErrorCode`) taşır — Socket.IO `next(err)`'deki `err.data`'yı `connect_error`
event'ine iletir. Client "sessiz refresh mi / login'e mi" kararını kırılgan string eşleştirmesi
(`/expired|token|jwt/i`) yerine bu koda göre verir:
```
TOKEN_EXPIRED              → client access token'ı sessizce yeniler (refresh)
TOKEN_INVALID / diğerleri  → client doğrudan login'e yönlendirir
```
Red edilen hata sunucu tarafında yine `AuthenticationError` örneğidir (errorCode korunur,
`token.service` TOKEN_EXPIRED/TOKEN_INVALID ayrımını yapar); üstüne yalnızca client'ın okuduğu
`data: { code }` eklenir (bkz. `SocketAuthErrorData`). Access token'lar stateless olduğundan
backend `TOKEN_REVOKED` ÜRETMEZ — iptal sayılacak her durum TOKEN_INVALID altında toplanır.

### Device Auth Mimari Kararı (FAZ 6)
JWT bir **kullanıcı oturumunu** temsil eder ve kısa ömürlüdür (15dk). Android BroadcastReceiver
ve iOS Shortcut ise **kullanıcı oturumu olmayan, arka planda aylarca sessizce çalışan otomasyonlardır.**
Bu ikisini aynı auth mekanizmasıyla yönetmek mimari hata olur — kısa ömürlü bilet, uzun ömürlü
otomasyona gömülmüş olur.

Çözüm: Device Secret — süresiz, sadece `POST /api/otp` için yetkili, kullanıcı oturumundan bağımsız.

```
JWT          → "Ben Y'yim, oturumum açık"        → mobil uygulamanın kendisi kullanır
Device Secret → "Ben Y'nin şu cihazıyım"          → BroadcastReceiver ve Shortcut kullanır
```

Bu ayrım hem iOS hem Android için geçerlidir — ikisi de "sürekli arka planda çalışan otomasyon"
kategorisine girer, ikisi de aynı `deviceAuth` middleware'ini kullanır.

### Refresh Token Rotasyonu — Oturum Aileleri + Reuse Tespiti
Access token'lar **stateless kalır** (15dk, DB'de izlenmez). Refresh token'lar ise **stateful**tir:
her biri `refresh_tokens` tablosunda bir satırla temsil edilir ve **rotate** edilir. JWT üç claim
taşır: `sub` (kullanıcı), `jti` (token kimliği = satır id'si), `fam` (oturum ailesi).

```
login/register → yeni aile (familyId) + ACTIVE refresh token
POST /refresh  → eski token ACTIVE→ROTATED, aynı ailede yeni ACTIVE token; yanıt { accessToken, refreshToken }
```

**Sözleşme değişikliği:** `POST /api/auth/refresh` artık `{ accessToken }` değil
`{ accessToken, refreshToken }` döner (rotasyon gereği). Mobil bu alanı bekler; gelmezse eskisini korur.

**Aile bazında scope — kullanıcı bazında DEĞİL.** Bir aile tek bir login oturumunun rotasyon
zinciridir. Aynı kullanıcı telefon+tablette iki ayrı aile taşır; birinin iptali diğerini etkilemez
(aksi halde cihazlar birbirini atardı).

**Reuse tespiti + grace penceresi.** Rotate edilmiş (ROTATED) bir token tekrar gelirse:
```
now - rotatedAt ≤ REFRESH_REUSE_GRACE_MS (30sn) → meşru ağ tekrarı/yarış: aynı ailede taze token üret
now - rotatedAt >  grace                          → token hırsızlığı: TÜM aile REVOKED, TOKEN_INVALID
```
Grace penceresi, meşru istemcinin çok yakın zamanlı çift-isteğinin (ağ tekrarı) yanlış alarm
üretmesini önler. Eşzamanlılık: ACTIVE→ROTATED geçişi koşullu `updateMany` ile atomiktir
(`markRotated` yarışta yalnızca bir isteğe `true` döner) — kaybeden istek grace dalına düşer.

**Red kodu.** İptal/geçersiz/reuse refresh token → `TOKEN_INVALID` (HTTP + socket). Süresi dolmuş
→ `TOKEN_EXPIRED`. Access token'lar stateless olduğundan backend `TOKEN_REVOKED` ÜRETMEZ — iptal
sayılacak her durum TOKEN_INVALID altında toplanır (socket handshake kararıyla hizalı).

**Logout — oturum-bazlı iptal.** `POST /api/auth/logout` access token'la kimliği kanıtlar; gövdede
opsiyonel `refreshToken` verilirse SADECE o oturumun ailesi REVOKED edilir (best-effort — bozuk/
başkasına ait token sessizce geçilir, 200 döner). Kullanıcı bazında toplu iptal YAPILMAZ.

**Şifre değişimi.** `IRefreshTokenStore.revokeAllForUser` kullanıcının tüm ailelerini iptal eder;
şifre-değiştir endpoint'i eklendiğinde bu çağrılmalıdır (kapasite hazır, henüz çağıran yok).

**Temizlik.** OTP gibi refresh token'lar için de cron YOK; süresi geçmiş kayıtlar login'de
fırsatçı olarak silinir (`deleteExpired`). Kullanıcı silinince FK cascade ile aileler de gider.

### Dağıtım Mimari Kararı (FAZ 7 — servissiz sadeleştirilmiş hali)
Receiver paylaşımı elle yapmaz. Hedef kitle admin tarafından `RoutingRule` ile önceden
tanımlanır. Bir kural **ikiliye** bağlıdır: hangi receiver, kime gidecek. Servis kavramı
YOKTUR — bir receiver'ın ürettiği tüm kodlar aynı hedefe akar (`senderRaw` yalnızca
developer'a gösterilen bir etikettir, dağıtımı etkilemez). "Kime gidecek" kısmı esnek tutulur —
başlangıçta tek tek developer seçmek yeterlidir, admin isterse sonradan developer'ları bir grup
altında toplayıp kuralı gruba bağlayabilir. Grup zorunlu bir kavram değil, bir kısayoldur.

```
RoutingRule.targetType = 'DEVELOPER' → developerId bir User.id'ye işaret eder
RoutingRule.targetType = 'GROUP'     → groupId bir Group.id'ye işaret eder
                                        (grup içindeki tüm developer'lara gider)
```

`resolveTargets(receiverId)` o receiver'ın aktif kurallarını çözer (doğrudan developer +
grup üyeleri, `Set` ile dedupe); OTP yalnızca bu hedeflere emit edilir. Kural yoksa kimseye
gitmez. Developer geçmişi (`GET /api/otp/history`) de aynı çözümün tersine göre süzülür:
developer yalnızca kendisine (doğrudan veya grup üyeliğiyle) atanan receiver'ların kodlarını
görür — canlı emit ile hizalı.

Receiver OTP detayında bu kuralın sonucunu salt-okunur görür ("şu an kimlerle
paylaşıyorum") ve o OTP'ye özel `sharingActive` toggle'ı ile görünürlüğü durdurabilir.
Durdurma geçmişe etkimez — developer zaten görmüşse geri alınmaz, sadece bundan
sonraki canlı görünürlük ve liste varlığı kesilir.

> **Not — FAZ 8 (Servis Tespiti) kaldırıldı.** Eskiden `RoutingRule` bir `serviceId`'ye de
> bağlıydı ve gelen `senderRaw`/`serviceHint` sinyalleri `ServiceRegistry` üzerinden bir servise
> (Binance, Garanti vb.) çözülüyordu; eşleşmeyenler bir "kova"da birikiyordu. Bu katman tamamen
> kaldırıldı — `ServiceRegistry` modeli/tablosu, `serviceHint`, kova mantığı ve
> `/api/service-registry*` uçları gitti. Dağıtım artık yalnızca receiver bazlıdır (bkz. yukarı).
> `senderRaw` DB'de kalır ama sadece developer'a "kimden geldi" etiketi olarak gösterilir.

### OTP Sahiplik Kararı — receiverId Doğrudan Yazılır
`OTPLog.deviceId` nullable'dır (`onDelete: SetNull`) — cihaz silinirse bu alan null'a düşer.
Eğer sahiplik sadece `deviceId → Device.userId` zincirinden türetilseydi, cihazı silinen bir
receiver kendi geçmiş OTP'lerinin paylaşımını artık durduramaz hale gelirdi (sahiplik kanıtlanamaz).

Bunu önlemek için `OTPLog` doğrudan bir `receiverId` alanı taşır. OTP kaydedilirken bu değer
zaten elde olan `req.device.userId`'den yazılır — ekstra bir sorgu gerektirmez. `deviceId` hâlâ
izleme/analiz amacıyla ayrıca tutulur ama sahiplik kontrolü artık ona bağımlı değildir.

**Kabul edilen kademeli bozulma (graceful degradation):** `receiverId` sayesinde sahiplik
(sharing toggle yetkisi) her zaman korunur — ama cihaz adı bilgisi `deviceId` üzerinden geliyor.
Cihaz silinirse (`deviceId` null'a düşerse) payload'daki `device` alanı `null` olur; developer'ın
gördüğü satırda `receiver` (ad/email/telefon) kalır ama cihaz adı kaybolur. Bu bilinçli kabul
edilen bir davranıştır — sahiplik (kritik) her koşulda korunurken, görüntüleme bilgisi (kozmetik)
cihazla birlikte kaybolabilir. Mobil tarafta bu durum zaten "Belirtilmemiş" yazısıyla ele alınıyor
(bkz. mobil CLAUDE.md, Developer OtpDetailScreen).

### RoutingRule Unique Constraint — Partial Index Zorunluluğu
PostgreSQL'de unique constraint'lerde NULL değerler "birbirinden farklı" sayılır. Eğer
`@@unique([receiverId, targetType, developerId, groupId])` düz bir constraint olarak
tanımlanırsa, `targetType=DEVELOPER` olan kayıtlarda `groupId` hep NULL olacağından aynı
`(receiver, developer)` ikilisi teknik olarak birden fazla kez eklenebilir — DB bunu
yakalamaz. Bu yüzden **iki ayrı partial unique index** kullanılır (bkz. şema):
`(receiverId, developerId) WHERE targetType='DEVELOPER'` ve
`(receiverId, groupId) WHERE targetType='GROUP'`. Ayrıca servis katmanında da `createRule`
öncesi açık bir "zaten var mı" kontrolü yapılır — sadece DB constraint'ine güvenilmez,
çift katmanlı korunur.

### Sharing Durdurma — Developer Ekranına Anlık Bildirim
Receiver `sharingActive: false` yaptığında, sadece `GET /api/otp/history`'den o OTP düşmekle
kalmaz, zaten Socket.IO ile gönderilmiş ve developer'ın ekranında duran canlı kart için de
bir `otp:revoked` event'i yayınlanır.

**Tek oda stratejisi — çift emit önlenir:** Bu event SADECE `user:${userId}` odalarına gider
(`otp:received` ile aynı hedefleme mantığı — bkz. FAZ 7'deki `resolveTargets` çıktısı), asla
`project:${projectId}` odasına da AYRICA gönderilmez. Eğer hem proje odasına hem kullanıcı
odasına gönderilseydi, aynı developer'ın her iki odada da bulunması durumunda event'i iki kez
alması riski doğardı. `emitRevoked(otpId, targetUserIds)` imzası zaten user-bazlı tek hedef
listesi alır — bu fonksiyonun davranışı budur, `project:${projectId}` odasına broadcast YAPMAZ.
Bu, "durdurdum" diyen receiver'ın gerçek davranışla tutarlı bir deneyim yaşaması için gereklidir
— aksi halde developer'ın ekranındaki kart, receiver durdurduktan sonra da görünmeye devam eder
ve güven kaybına yol açar. Event sadece görünürlüğü kapatır, developer'ın daha önce kodu
görmüş/kullanmış olmasını geri almaz — bu zaten teknik olarak mümkün değildir, sadece UI
senkronizasyonu sağlanır.

**Mobil tarafa not:** Tek oda stratejisi uygulansa bile, mobil taraftaki `removeLog(otpId)`
action'ı idempotent olmalıdır (zaten kaldırılmış veya hiç var olmayan bir `otpId` ile çağrılması
no-op olmalı, hata fırlatmamalı). Bu, ileride oda stratejisi değişirse veya ağ katmanında
event tekrarı olursa savunma sağlar — tek katmanlı korumaya güvenilmez.

### Self-Register Mimari Kararı (Fiziksel Cihaz Testi Sonrası)
`POST /api/auth/register` kullanıcıdan `projectId` ALMAZ. Bir kullanıcı proje seçmek/id
girmek zorunda kalmamalı (küçük iç QA aracında kötü UX), ama `User.projectId` non-null bir
FK'dir ve tüm izolasyon buna dayanır — yani "proje yok" bir seçenek değil. Çözüm: backend
yeni kullanıcıyı **`Project.isDefault: true` olan tek varsayılan projeye** bağlar. Aynı anda
en fazla bir varsayılan proje olması migration'daki partial unique index (`projects_isDefault_key`)
ile DB seviyesinde garanti edilir; seed demo projeyi varsayılan işaretler. Rol yalnızca
RECEIVER/DEVELOPER olabilir — **ADMIN self-register edemez** (Zod refine + service guard, çift
katman). Varsayılan proje tanımlı değilse kayıt 404 PROJECT_NOT_FOUND döner (kurulum hatası).

### OTP Süresiz — Otomatik Silme Yok, Developer Kendi Kaldırır
OTP kodlarının **geçerlilik süresi yoktur** (`OTPLog.expiresAt` sütunu kaldırıldı) ve **süre
dolunca otomatik silme yoktur** (node-cron cleanup job kaldırıldı). Kodlar geldikleri sırayla
(en yeni önce) feed'de birikir; developer'a satırda `createdAt` (ne zaman/saat kaçta geldiği)
gösterilir. `TTL_SECONDS` sabiti ve `OTP_TTL_DAYS` env'i kod tabanında yoktur.

Bir developer feed'i temizlemek istediğinde ilgili OTP'leri seçip `POST /api/otp/dismiss` ile
kaldırır. Bu **per-developer yumuşak gizlemedir** (`OtpDismissal` tablosu), kalıcı silme değildir:
OTP tabloda kalır — receiver kendi geçmişinde, admin özet ekranında görmeye devam eder; aynı OTP
grup üzerinden başka developer'lara gittiyse onları etkilemez. `findForDeveloper` sorgusu bu
developer için dismissal bulunan kayıtları hariç tutar (`dismissals: { none: { userId } }`).

### Receiver Rol Kapsamı — Kendi OTP'sini Canlı Görür
Receiver uygulaması kendi cihazının ürettiği kodları bir geçmiş listesinde gösterir ve bu liste
**canlı güncellenir**: receiver kendi `user:${receiverId}` odasına katılır (`handleConnection`),
ve her yeni OTP işlendiğinde `notifyReceiver` ile bu odaya `otp:received` yayınlanır — receiver
kodu refresh'siz, geldiği anda listenin en üstünde görür.

Bu emit **routing'den bağımsızdır**: hiç kural olmasa bile receiver kendi
kodunu görür (`findByReceiver` filtresiz olduğundan geçmişle tutarlı). `deliveredTo` sayımına
DAHİL DEĞİLDİR — o yalnızca routing hedefi developer sayısıdır. Developer hedefleme (`notify`)
ve sahibi receiver hedefleme (`notifyReceiver`) ayrık odalara gider; bir kullanıcı tek rol
taşıdığından çift emit riski yoktur (FAZ 7 developer davranışı korunur). ADMIN hiçbir odaya
katılmaz (OTP feed'i yoktur).

`otp:revoked` hâlâ yalnızca developer'lara gider (paylaşımı durduran zaten receiver'ın kendisidir,
kendi UI'ı optimistic günceller) — receiver odasına revoked yayınlanmaz.

---

## Klasör Yapısı

```
src/
├── index.ts                  → Entry, process handlers, graceful shutdown
├── app.ts                    → Express + Socket.IO factory
├── config/
│   ├── env.ts                → Zod env parse — fail-fast
│   ├── constants.ts          → CONSTANTS (OTP, ARGON2, AUTH, SOCKET, PAGINATION, RATE_LIMIT, DEVICE, ROUTING)
│   └── prisma.ts             → Singleton
├── errors/
│   ├── AppError.ts           → Abstract base
│   ├── errors.ts             → ValidationError, AuthenticationError, AuthorizationError,
│   │                           NotFoundError, ConflictError,
│   │                           OtpParseError (parse cihaza taşındı — backend artık bu hatayı hiç
│   │                           fırlatmaz, bkz. otp.parser.ts notu),
│   │                           OtpEncryptionError, DeviceAuthError, RoutingError, InternalError
│   └── ErrorCode.ts          → Enum (VALIDATION_ERROR, AUTHENTICATION_FAILED,
│                               TOKEN_EXPIRED, TOKEN_INVALID, FORBIDDEN, NOT_FOUND,
│                               CONFLICT, USER_NOT_FOUND, PROJECT_NOT_FOUND,
│                               OTP_NOT_FOUND (parse cihazda — backend fırlatmaz),
│                               OTP_DELIVERY_FAILED,
│                               OTP_ENCRYPTION_FAILED, INTERNAL_ERROR,
│                               DATABASE_ERROR, RATE_LIMIT_EXCEEDED,
│                               DEVICE_NOT_FOUND, DEVICE_REVOKED, DEVICE_SECRET_INVALID,
│                               GROUP_NOT_FOUND, ROUTING_RULE_NOT_FOUND, ROUTING_RULE_CONFLICT)
├── types/
│   ├── Result.ts             → Result<T>, ok(), fail()
│   ├── express.d.ts          → Request augmentation: id, user, device
│   └── index.ts              → JwtPayload, DevicePayload, PaginationOptions, PaginatedResult
├── infrastructure/
│   ├── logger.ts             → pino singleton, ILogger interface
│   └── socket.ts             → Socket.IO singleton, initSocket(), emitOtp() (hedef listesi alır),
│                                emitRevoked() (otp:revoked event'i, FAZ 7)
├── middleware/
│   ├── requestId.ts          → UUID per request
│   ├── authenticate.ts       → JWT doğrulama (kullanıcı oturumu — login/dashboard/history)
│   ├── deviceAuth.ts         → Device Secret doğrulama (POST /api/otp)
│   ├── authorize.ts          → Rol kontrolü: authorize(...roles)
│   ├── validate.ts           → Generic Zod middleware
│   ├── rateLimiter.ts        → otpRateLimit, loginRateLimit, registerRateLimit
│   ├── requestLogger.ts      → method, path, status, responseTime, requestId
│   └── errorHandler.ts       → Global error handler
├── modules/
│   ├── auth/
│   │   ├── auth.interfaces.ts    → IPasswordService, ITokenService, IRefreshTokenStore, IAuthService, DTO'lar
│   │   ├── password.service.ts   → argon2id hash/verify (async)
│   │   ├── token.service.ts      → JWT sign/verify (sync); refresh token jti+fam claim'li üretilir/doğrulanır
│   │   ├── refreshToken.repository.ts → Prisma refresh token deposu (rotasyon + reuse tespiti) — ASYNC
│   │   ├── auth.service.ts       → register, login, refresh (rotasyon/reuse), logout (oturum-bazlı)
│   │   ├── auth.controller.ts    → HTTP katmanı
│   │   ├── auth.routes.ts        → Route tanımları
│   │   └── auth.schemas.ts       → Zod şemaları (login/register/refresh/logout)
│   ├── device/
│   │   ├── device.interfaces.ts  → IDeviceService, IDeviceRepository, ISecretService, DTO'lar
│   │   ├── secret.service.ts     → Device Secret üret (sync) + hash/verify (async, argon2id)
│   │   ├── device.repository.ts  → Prisma CRUD — ASYNC
│   │   ├── device.service.ts     → register, verify, revoke
│   │   ├── device.controller.ts  → HTTP katmanı
│   │   ├── device.routes.ts      → Route tanımları
│   │   └── device.schemas.ts     → Zod şemaları
│   ├── otp/
│   │   ├── otp.interfaces.ts     → IOtpParser, IOtpEncryptor, IOtpRepository,
│   │   │                           IOtpNotifier, IOtpService, DTO'lar
│   │   ├── otp.parser.ts         → (FAZ 3'te yazıldı, sonradan KULLANIM DIŞI BIRAKILDI —
│   │   │                            parse artık cihazda yapılıyor)
│   │   ├── otp.encryptor.ts      → AES-256-GCM encrypt/decrypt — SYNC
│   │   ├── otp.repository.ts     → Prisma CRUD — ASYNC (findForDeveloper/findAllForProject/findByReceiver, dismissForDeveloper)
│   │   ├── otp.service.ts        → processAndDeliver, getHistory (developer), getAllForProject (admin), dismissForDeveloper
│   │   ├── otp.controller.ts     → HTTP katmanı (history rol'e göre dallanır: DEVELOPER/RECEIVER/ADMIN)
│   │   ├── otp.routes.ts         → Route tanımları (+ POST /dismiss)
│   │   └── otp.schemas.ts        → Zod şemaları (code + source + senderRaw; dismissOtpsSchema)
│   ├── project/
│   │   ├── project.interfaces.ts → IProjectService, IProjectRepository, DTO'lar
│   │   ├── project.repository.ts → Prisma CRUD — ASYNC
│   │   ├── project.service.ts    → create, getById, addUser, removeUser
│   │   ├── project.controller.ts → HTTP katmanı
│   │   ├── project.routes.ts     → Route tanımları
│   │   └── project.schemas.ts    → Zod şemaları
│   ├── group/
│   │   ├── group.interfaces.ts   → IGroupService, IGroupRepository, DTO'lar
│   │   ├── group.repository.ts   → Prisma CRUD — ASYNC
│   │   ├── group.service.ts      → create, addMember, removeMember, listForProject
│   │   ├── group.controller.ts   → HTTP katmanı
│   │   ├── group.routes.ts       → Route tanımları
│   │   └── group.schemas.ts      → Zod şemaları
│   └── routing/
│       ├── routing.interfaces.ts → IRoutingService, IRoutingRepository, IRoutingResolver, DTO'lar
│       ├── routing.repository.ts → Prisma CRUD — ASYNC
│       ├── routing.resolver.ts   → resolveTargets(receiverId): string[] — ASYNC (DB) sonra SYNC (flatten);
│       │                            resolveVisibleReceiverIds(developerId): string[] (history süzme)
│       ├── routing.service.ts    → createRule, toggleRule, deleteRule, listForReceiver
│       ├── routing.controller.ts → HTTP katmanı
│       ├── routing.routes.ts     → Route tanımları
│       └── routing.schemas.ts    → Zod şemaları
└── routes/
    └── index.ts              → Tüm modül route'larını birleştir

(jobs/ kaldırıldı — OTP süresiz olduğundan cleanup cron yok.)
```

---

## Veritabanı Şeması

```prisma
model User {
  id            String         @id @default(uuid()) @db.Uuid
  email         String         @unique @db.VarChar(255)
  name          String?        @db.VarChar(100)   // görünen ad; opsiyonel — admin panelinde email yerine gösterilir, mobil name ?? email fallback yapar
  phoneNumber   String?        @db.VarChar(32)    // hesap iletişim numarası; self-register'da beyan edilir, opsiyonel
  password      String         @db.VarChar(512)
  role          Role
  projectId     String         @db.Uuid
  project       Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  devices       Device[]
  groupMembers  GroupMember[]
  routingRules  RoutingRule[]  @relation("ReceiverRules")
  receivedOtps  OTPLog[]       @relation("ReceiverOtps")  // sahiplik kanıtı — deviceId'den bağımsız
  dismissals    OtpDismissal[] @relation("DeveloperDismissals")  // developer'ın feed'inden kaldırdığı OTP'ler
  refreshTokens RefreshToken[] @relation("UserRefreshTokens")   // aktif/rotate/iptal oturum aileleri
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  @@index([email])
  @@index([projectId])
  @@map("users")
}

// Refresh token rotasyonu (bkz. "Refresh Token Rotasyonu" mimari kararı).
// id = JWT jti (@default YOK — servis üretir); familyId = oturum ailesi (rotasyon zinciri).
// Rotate edilmiş token grace dışında tekrar gelirse (reuse) aynı ailenin tüm kayıtları REVOKED.
model RefreshToken {
  id        String             @id @db.Uuid          // JWT jti — servis üretir
  familyId  String             @db.Uuid              // oturum ailesi; reuse'da tüm aile iptal
  userId    String             @db.Uuid
  user      User               @relation("UserRefreshTokens", fields: [userId], references: [id], onDelete: Cascade)
  status    RefreshTokenStatus @default(ACTIVE)      // ACTIVE | ROTATED | REVOKED
  rotatedAt DateTime?                                 // ACTIVE→ROTATED anı; grace penceresi buna göre
  expiresAt DateTime                                  // JWT exp ile hizalı; login'de süresi geçenler silinir
  createdAt DateTime           @default(now())
  @@index([familyId])
  @@index([userId])
  @@index([expiresAt])
  @@map("refresh_tokens")
}

model Project {
  id        String          @id @default(uuid()) @db.Uuid
  name      String          @db.VarChar(100)
  apiKey    String          @unique @default(uuid()) @db.Uuid
  isDefault Boolean         @default(false)   // self-register bu projeye bağlanır; en fazla BİR tane (migration'da partial unique index: projects_isDefault_key)
  users     User[]
  otpLogs   OTPLog[]
  devices   Device[]
  groups    Group[]
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt
  @@map("projects")
}

model Device {
  id           String    @id @default(uuid()) @db.Uuid
  secretHash   String    @db.VarChar(512)   // argon2id hash — plain secret asla saklanmaz
  platform     Platform
  deviceName   String?   @db.VarChar(100)   // receiver kayıt sırasında girer, opsiyonel ("İş Telefonum")
  phoneNumber  String?   @db.VarChar(32)    // receiver kayıt sırasında girer, opsiyonel —
                                             // SMS'ten OTOMATİK türetilmez, sadece kullanıcının
                                             // kendi beyanıdır. Developer'a "cihaz bilgisi" olarak gösterilir.
  userId       String    @db.Uuid
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  projectId    String    @db.Uuid
  project      Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  isRevoked    Boolean   @default(false)
  lastUsedAt   DateTime?
  createdAt    DateTime  @default(now())
  otpLogs      OTPLog[]
  @@index([userId])
  @@index([projectId])
  @@map("devices")
}

model Group {
  id          String         @id @default(uuid()) @db.Uuid
  name        String         @db.VarChar(100)   // admin tarafından konur, receiver'a görünür
  projectId   String         @db.Uuid
  project     Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  members     GroupMember[]
  routingRules RoutingRule[] @relation("GroupRules")
  createdAt   DateTime       @default(now())
  @@index([projectId])
  @@map("groups")
}

model GroupMember {
  id        String   @id @default(uuid()) @db.Uuid
  groupId   String   @db.Uuid
  group     Group    @relation(fields: [groupId], references: [id], onDelete: Cascade)
  userId    String   @db.Uuid          // DEVELOPER rolünde bir User
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  @@unique([groupId, userId])
  @@index([userId])
  @@map("group_members")
}

// Hangi receiver'ın kodu kime (developer veya grup) gidecek. Servis kavramı yoktur.
model RoutingRule {
  id          String        @id @default(uuid()) @db.Uuid
  receiverId  String        @db.Uuid
  receiver    User          @relation("ReceiverRules", fields: [receiverId], references: [id], onDelete: Cascade)
  targetType  RoutingTarget // DEVELOPER | GROUP
  developerId String?       @db.Uuid        // targetType=DEVELOPER ise dolu
  groupId     String?       @db.Uuid        // targetType=GROUP ise dolu
  group       Group?        @relation("GroupRules", fields: [groupId], references: [id], onDelete: Cascade)
  isActive    Boolean       @default(true)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  @@index([receiverId])
  @@map("routing_rules")
}

// NOT: PostgreSQL'de düz @@unique([...]) NULL'ları "farklı" sayar — targetType=DEVELOPER
// kayıtlarında groupId hep NULL olduğundan aynı (receiver, developer) tekrar eklenebilirdi.
// Bu yüzden migration'da @@unique yerine İKİ AYRI partial unique index raw SQL ile eklenir
// (Prisma migration dosyasına elle eklenir, schema.prisma'da ifade edilemez):
//
//   CREATE UNIQUE INDEX routing_rule_developer_unique
//     ON routing_rules (receiver_id, developer_id)
//     WHERE target_type = 'DEVELOPER';
//
//   CREATE UNIQUE INDEX routing_rule_group_unique
//     ON routing_rules (receiver_id, group_id)
//     WHERE target_type = 'GROUP';
//
// Bu DB seviyesi koruma, routing.service.ts'teki createRule'da yapılan açık "zaten var mı"
// kontrolünün YERİNE değil, ONUN YANINDA çalışır — çift katmanlı korunur.

// OTP kodları SÜRESİZDİR — expiresAt yoktur, otomatik silme (cron) yoktur.
model OTPLog {
  id            String         @id @default(uuid()) @db.Uuid
  encryptedCode String         @db.VarChar(512)  // iv:authTag:ciphertext (base64)
  source        Source
  projectId     String         @db.Uuid
  project       Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  deviceId      String?        @db.Uuid          // izleme/analiz amaçlı — onDelete: SetNull
  device        Device?        @relation(fields: [deviceId], references: [id], onDelete: SetNull)
  receiverId    String         @db.Uuid          // SAHİPLİK KAYNAĞI — deviceId silinse bile kalıcı
  receiver      User           @relation("ReceiverOtps", fields: [receiverId], references: [id], onDelete: Cascade)
  senderRaw     String?        @db.VarChar(255)  // ham gönderici kimliği — developer'a "kimden geldi" etiketi. SMS gövdesi DEĞİL.
  sharingActive Boolean        @default(true)    // receiver bu OTP'nin paylaşımını durdurabilir
  dismissals    OtpDismissal[]                   // developer'ların kendi feed'inden kaldırdığı işaretler
  createdAt     DateTime       @default(now())
  @@index([projectId])
  @@index([deviceId])
  @@index([receiverId])
  @@map("otp_logs")
}

// Developer bir OTP'yi KENDİ feed'inden kaldırınca oluşur (per-developer yumuşak gizleme).
// Kalıcı silme DEĞİL: OTP tabloda kalır — receiver/admin görmeye devam eder.
model OtpDismissal {
  id        String   @id @default(uuid()) @db.Uuid
  otpId     String   @db.Uuid
  otp       OTPLog   @relation(fields: [otpId], references: [id], onDelete: Cascade)
  userId    String   @db.Uuid          // kaldıran DEVELOPER
  user      User     @relation("DeveloperDismissals", fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  @@unique([otpId, userId])
  @@index([userId])
  @@map("otp_dismissals")
}

enum Role               { RECEIVER DEVELOPER ADMIN }
enum Source             { ANDROID IOS_SHORTCUT }
enum Platform           { ANDROID IOS }
enum RoutingTarget      { DEVELOPER GROUP }
enum RefreshTokenStatus { ACTIVE ROTATED REVOKED }
```

---

## API Kontratı

### Yanıt Formatı
```
Başarılı:  { success: true,  data: T,                        requestId: string }
Hata:      { success: false, error: { code, message },       requestId: string }
Paginated: { success: true,  data: T[], pagination: {...},   requestId: string }
```

### Endpointler
```
POST /api/auth/register       → Body: { email, password, name, phoneNumber?, role }
                                  role: RECEIVER | DEVELOPER — ADMIN reddedilir (400 VALIDATION_ERROR, backend zorlar)
                                  projectId YOK — backend kullanıcıyı varsayılan projeye (Project.isDefault) bağlar
                                  (self-register proje seçmez/id girmez; varsayılan proje yoksa 404 PROJECT_NOT_FOUND)
                                → 201 { accessToken, refreshToken, user }
                                  user: { id, email, name, phoneNumber, role, projectId, createdAt } — parola yok;
                                  name/phoneNumber verilmezse null (mobil `name ?? email` fallback yapar; name kayıtta zorunlu)
POST /api/auth/login          → 200 { accessToken, refreshToken, user }
POST /api/auth/refresh        → 200 { accessToken, refreshToken }   (ROTASYON: eski refresh token geçersizleşir;
                                reuse/iptal → 401 TOKEN_INVALID, süresi dolmuş → 401 TOKEN_EXPIRED)
POST /api/auth/logout         → 200 { message }   Body: { refreshToken? }  [JWT]
                                refreshToken verilirse o oturumun ailesi sunucuda iptal edilir (oturum-bazlı çıkış)

POST   /api/devices/register  → Body: { deviceName?, phoneNumber? } (ikisi de opsiyonel)
                                 → 201 { deviceId, deviceSecret }   [JWT — RECEIVER]
DELETE /api/devices/:id       → 200 { message }                  [JWT — RECEIVER, sahibi]
GET    /api/devices           → 200 Device[] (secretHash hariç, deviceName/phoneNumber dahil) [JWT — RECEIVER]

POST /api/otp                 → 200 { message, deliveredTo }   [Device Secret — X-Device-Secret header]
                                Body: { code, source, senderRaw, context? }  (serviceHint YOK)
                                context: opsiyonel serbest metin (≤120), gelmezse null — saklanır + history/otp:received'e eklenir
GET  /api/otp/history         → 200 paginated (rol-duyarlı):
                                  DEVELOPER → kendisine yönlendirilen, dismiss'lemediği feed
                                  RECEIVER  → kendi geçmişi (sharingActive dahil)
                                  ADMIN     → projedeki TÜM receiver'lardan gelen tüm OTP'ler (özet)
                                item: { id, code, source, senderRaw, context, createdAt,  (OTP süresiz — expiresAt YOK)
                                        receiver:{ name, email, phoneNumber }, device:{ name }|null,
                                        (RECEIVER'da ayrıca sharingActive) }  [JWT — DEVELOPER|RECEIVER|ADMIN]
POST /api/otp/dismiss         → 200 { dismissed: number }      [JWT — DEVELOPER]
                                Body: { otpIds: string[] }  — seçilen OTP'leri KENDİ feed'inden kaldırır
                                (per-developer yumuşak gizleme; receiver/admin görmeye devam eder, kalıcı silme değil)
PATCH /api/otp/:id/sharing    → 200 { sharingActive }          [JWT — RECEIVER, OTP'nin sahibi]
GET  /api/otp/:id/sharing     → 200 { targets: [...] }         [JWT — RECEIVER, salt-okunur, kimlerle paylaşılıyor]
GET  /api/otp/sender-patterns → 200 [{ name, pattern }]        [PUBLIC — auth yok]
                                Statik konfig (v1, src/config/senderPatterns.ts). BARE dizi döner (standart zarf DEĞİL —
                                iOS Shortcut sözleşmesi). Cihaz SMS gövdesini bu kalıplarla eşleştirip senderRaw=name ile
                                POST /api/otp'ye gönderir; gövde backend'e gelmez. Yalnızca isActive kayıtlar, order'a göre sıralı.

POST   /api/projects               → 201 Project               [JWT — ADMIN]
GET    /api/projects/:id           → 200 Project + users       [JWT — üye]
POST   /api/projects/:id/users     → 200                       [JWT — ADMIN]
DELETE /api/projects/:id/users/:uid→ 200                       [JWT — ADMIN]

POST   /api/groups                 → 201 Group                 [JWT — ADMIN]
GET    /api/groups                 → 200 Group[] (proje bazlı) [JWT — herkes, sadece görüntüleme]
DELETE /api/groups/:id             → 200 { message }           [JWT — ADMIN, sahibi proje]
                                     (FK cascade: üyelikler + o grubu hedefleyen routing kuralları da silinir — dangling kalmaz)
POST   /api/groups/:id/members     → 200                       [JWT — ADMIN]
DELETE /api/groups/:id/members/:uid→ 200                       [JWT — ADMIN]

POST   /api/routing-rules          → 201 RoutingRule           [JWT — ADMIN]
                                     Body: { receiverId, targetType, developerId? | groupId? }  (serviceId YOK)
GET    /api/routing-rules          → 200 RoutingRule[]         [JWT — ADMIN]
PATCH  /api/routing-rules/:id      → 200 { isActive }          [JWT — ADMIN]
DELETE /api/routing-rules/:id      → 200 { message }           [JWT — ADMIN]

GET /health                   → 200 { status: 'ok', timestamp }
```

### POST /api/otp — Body
```
{ code: string (6 haneli), source: 'ANDROID'|'IOS_SHORTCUT', senderRaw: string, context?: string|null }
```
`smsText` body'de YOKTUR — parse cihazda yapılır (bkz. "Proje" bölümündeki "Parse yeri kararı" notu).
`code` ve `senderRaw` zorunludur. `senderRaw` developer'a gösterilen gönderici etiketidir; servise
çözülmez, dağıtımı etkilemez. (`serviceHint` kaldırıldı — servis kavramı yok.)
`context` opsiyoneldir (serbest metin, ≤120 karakter): gelmezse/null gelirse `null` olarak saklanır;
dağıtımı/routing'i etkilemez. Kalıcılaştırılır ve `GET /api/otp/history` item'ına + `otp:received`
socket payload'ına eklenir (developer + sahibi receiver görür).

---

## Güvenlik Kuralları

1. **JWT** — access: 15dk, refresh: 30gün. İki secret FARKLI olmalı. Sadece kullanıcı oturumu (login/dashboard/history/admin işlemleri) için.
2. **Device Secret** — `crypto.randomBytes(32)` ile üret (256-bit), hex string olarak döndür. DB'de argon2id ile hash'lenir, plain text asla saklanmaz. Süresiz — sadece manuel revoke ile geçersiz olur. Sadece `POST /api/otp` yetkisi var, başka hiçbir endpointe erişemez.
3. **Parola** — argon2id: `{ memoryCost: 65536, timeCost: 3, parallelism: 4 }`. Plain text asla loglama. Aynı parametreler Device Secret hash'leme için de kullanılır.
4. **AES-256-GCM** — Her encrypt için `crypto.randomBytes(16)` IV. Format: `base64(iv):base64(authTag):base64(ciphertext)`. Decrypt'te her bileşeni parse et, boyut doğrula (IV=16 byte, authTag=16 byte), `decipher.final()` try/catch zorunlu — hata → OtpEncryptionError.
5. **SMS gövdesi asla saklanmaz** — sadece parse edilen 6 haneli kod (şifreli) ve gönderici etiketi (`senderRaw`) işlenir, ham SMS metni DB'ye hiçbir zaman yazılmaz.
6. **Rate limiting** — `/api/otp`: 60/dk | `/api/auth/login`: 10/dk | `/api/auth/register`: 5/dk | `/api/devices/register`: 5/dk.
7. **Yetkilendirme** — RoutingRule ve Group yönetimi sadece ADMIN rolüne açık. Receiver kendi OTP'sinin paylaşım hedefini görebilir ama değiştiremez, sadece `sharingActive` toggle'ına dokunabilir.
8. **HTTP** — `helmet()`, `express.json({ limit: '10kb' })`, CORS whitelist.
9. **Loglama** — Parola, OTP kodu, JWT token, Device Secret, senderRaw asla loglanmaz (pino redact).

---

## Environment Variables

```env
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
DATABASE_URL=postgresql://user:pass@localhost:5432/otpsplash
JWT_ACCESS_SECRET=          # min 32 karakter
JWT_REFRESH_SECRET=         # min 32 karakter, ACCESS'ten FARKLI
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=30d
OTP_ENCRYPTION_KEY=         # 64 hex karakter (32 byte)
# OTP geçerlilik süresi YOKTUR (kodlar süresiz, otomatik silme yok). OTP_TTL_DAYS / TTL sabiti kaldırıldı.
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60
DEVICE_SECRET_BYTES=32      # 256-bit
CORS_ORIGIN=*                # Yerel ağ testi için. Production'da gerçek origin'lerle değiştirilecek.
```

---

## Yerel Ağ Üzerinden Mobil Test

Production'a deploy edilmeden önce, geliştirme aşamasında fiziksel telefonla (Android/iOS)
test etmek için backend'in **yerel ağda erişilebilir** olması gerekir. İki teknik önkoşul:

1. **`app.listen()` host parametresi `0.0.0.0` olmalı, `localhost` değil.**
   ```typescript
   httpServer.listen(env.PORT, '0.0.0.0', () => { ... })
   ```
   `localhost` (veya host belirtilmeden bırakılırsa varsayılan) sadece makinenin kendi
   loopback arayüzünden gelen isteklere cevap verir — telefon ağ üzerinden bağlanamaz.
   `0.0.0.0` tüm ağ arayüzlerinden gelen bağlantıları dinler.

2. **CORS origin yerel test sırasında `*` (wildcard) olarak bırakılabilir.**
   Native mobil HTTP istekleri (Android/iOS) tarayıcı CORS kısıtına tabi değildir — CORS bir
   tarayıcı güvenlik mekanizmasıdır, native uygulamalar bundan etkilenmez. Bu yüzden mobil
   `POST /api/otp`, login vb. istekleri için CORS hiç gündeme gelmez. Asıl önemli olduğu yer
   Socket.IO bağlantısı ve ileride eklenecek Admin web dashboard'udur — onlar tarayıcı tabanlı
   çalıştığı için CORS kısıtına tabidir. Yerel geliştirme aşamasında `CORS_ORIGIN=*` sorun
   çıkarmaz; production'a geçerken gerçek origin'lerle (örn. dashboard domain'i) değiştirilir.

**Mac'in yerel ağ IP'sini bulma:**
```bash
ipconfig getifaddr en0   # Wi-Fi bağlıysa
```
Bu IP'yi mobil tarafın `.env` dosyasındaki `BACKEND_URL`'e yazarsın (örn. `http://192.168.1.42:3000`).
Telefon ve Mac **aynı Wi-Fi ağında** olmalı.

---


---

## Faz Detayları

Faz faz görev listeleri, tamamlanma kriterleri ve test kapsamları **PHASES.md** dosyasındadır.
Bu dosya (CLAUDE.md) sabit mimari kararları taşır — her oturumda oku. PHASES.md'yi şu an
üzerinde çalıştığın faz için oku, geçmiş fazları referans amacıyla kullan.