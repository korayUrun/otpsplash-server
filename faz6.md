CLAUDE.md dosyasını yeniden oku — FAZ 6 (Device Authentication) eklendi.

Mevcut FAZ 1-5 tamamlanmış ve commit edilmiş durumda. Şimdi FAZ 6'yı uygulayacaksın.

Özet: `POST /api/otp` endpoint'i şu ana kadar JWT (Authorization: Bearer) ile korunuyordu.
Bunu değiştiriyoruz. Artık bu endpoint `X-Device-Secret` header'ı ile korunacak. Sebebi
CLAUDE.md'nin "Device Auth Mimari Kararı" bölümünde açıklandı — JWT kısa ömürlü bir kullanıcı
oturumu temsil ediyor, ama Android'in arka plan servisi ve iOS Shortcut'ı aylarca kullanıcı
müdahalesi olmadan çalışması gereken otomasyonlar. Bu ikisini ayırıyoruz.

Yapman gerekenler CLAUDE.md → FAZ 6 bölümünde adım adım yazılı. Özetle:

1. Prisma şemasına Device modeli ve Platform enum'unu ekle, migration oluştur
2. src/modules/device/ klasörünü CLAUDE.md'deki spec'e göre oluştur
   (interfaces, secret.service, device.repository, device.service, controller, routes, schemas)
3. src/middleware/deviceAuth.ts middleware'ini yaz
4. Mevcut otp.routes.ts, otp.controller.ts, otp.service.ts dosyalarını güncelle —
   JWT middleware'leri kaldır, deviceAuth middleware'ini ekle
5. errors.ts'e DeviceAuthError ekle, ErrorCode enum'una yeni kodları ekle
6. express.d.ts'e req.device tipini ekle
7. Mevcut otp.test.ts dosyasındaki JWT tabanlı testleri kaldır/güncelle,
   yeni Device Secret tabanlı testleri ekle
8. Yeni device.test.ts dosyasını yaz

Önemli: Bu bir breaking change. Mevcut POST /api/otp testleri artık geçersiz olacak,
bunları FAZ 6'daki yeni test kapsamına göre güncellemen gerekiyor.

FAZ 6 tamamlanma kriterlerinin hepsini karşılamadan bitirme. Bitirince
`npm run test:integration` ve `npm run typecheck` çalıştırıp sonucu göster.

Başlamadan önce mevcut otp modülünü ve Prisma şemasını incele, sonra plana göre ilerle.