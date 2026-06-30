import type { Server as HttpServer } from 'node:http';
import {
  Server,
  type DefaultEventsMap,
  type ExtendedError,
  type Socket,
} from 'socket.io';
import { Role } from '@prisma/client';
import { CONSTANTS } from '@config/constants';
import { AuthenticationError } from '@errors/errors';
import { tokenService } from '@modules/auth/token.service';
import { logger } from '@infrastructure/logger';
import type { JwtPayload } from '@app-types/index';
import type {
  IOtpNotifier,
  OtpNotification,
  OtpRevokedNotification,
} from '@modules/otp/otp.interfaces';

const BEARER_PREFIX = 'Bearer ';

/**
 * Sunucu → client event haritası. Anahtarlar literal olmak zorunda olduğundan
 * sabit değerler yazılır; runtime'da CONSTANTS.SOCKET.EVENT_* ile emit edilir (aynı değerler).
 * - `otp:received` → yeni OTP (hedef developer'lara).
 * - `otp:revoked`  → paylaşımı durdurulan OTP'nin kartını kaldırma sinyali.
 */
interface ServerToClientEvents {
  'otp:received': (payload: OtpNotification) => void;
  'otp:revoked': (payload: OtpRevokedNotification) => void;
}

/** Bağlantı başına saklanan kimlik (auth middleware doldurur). */
interface SocketData {
  user: JwtPayload;
}

/** Uygulamanın tip-güvenli Socket.IO sunucu tipi (emit eventleri + socket.data). */
export type AppIOServer = Server<
  DefaultEventsMap,
  ServerToClientEvents,
  DefaultEventsMap,
  SocketData
>;

type AppSocket = Socket<
  DefaultEventsMap,
  ServerToClientEvents,
  DefaultEventsMap,
  SocketData
>;

/** initSocket sonrası set edilen singleton referans (emit için). */
let ioRef: AppIOServer | undefined;

/**
 * Handshake'ten access token çıkarır: önce `auth.token`, yoksa Authorization başlığı.
 */
function extractToken(socket: AppSocket): string | null {
  const authToken: unknown = socket.handshake.auth.token;
  if (typeof authToken === 'string' && authToken.length > 0) {
    return authToken;
  }
  const header = socket.handshake.headers.authorization;
  if (header && header.startsWith(BEARER_PREFIX)) {
    return header.slice(BEARER_PREFIX.length).trim();
  }
  return null;
}

/**
 * Socket bağlantısı için JWT doğrulama middleware'i.
 * Token yoksa/geçersizse `next(error)` ile bağlantı reddedilir.
 * Başarılıysa `socket.data.user` doldurulur.
 *
 * @remarks export edilir ki birim testi gerçek bağlantı kurmadan doğrulayabilsin.
 */
export function authenticateSocket(
  socket: AppSocket,
  next: (err?: ExtendedError) => void,
): void {
  try {
    const token = extractToken(socket);
    if (!token) {
      next(new AuthenticationError('Socket bağlantısı için token gerekli'));
      return;
    }
    socket.data.user = tokenService.verifyAccessToken(token);
    next();
  } catch (error) {
    // verifyAccessToken AuthenticationError fırlatır; beklenmeyenleri de güvenle reddet.
    next(error instanceof Error ? error : new AuthenticationError());
  }
}

/**
 * Doğrulanmış bağlantı için oda yönetimi.
 * DEVELOPER → `user:${userId}` odasına katılır (FAZ 7 hedefli dağıtım). RECEIVER hiçbir
 * odaya katılmaz (yalnızca OTP gönderir, almaz).
 *
 * Tek oda stratejisi: developer SADECE kendi `user:` odasına katılır, `project:` odasına
 * AYRICA katılmaz — böylece aynı event'i iki kez alma riski doğmaz (CLAUDE.md "Sharing Durdurma").
 *
 * @remarks export edilir (birim testi).
 */
export function handleConnection(socket: AppSocket): void {
  const { user } = socket.data;

  if (user.role === Role.DEVELOPER) {
    const room = CONSTANTS.SOCKET.userRoom(user.sub);
    void socket.join(room);
    logger.info(
      { socketId: socket.id, userId: user.sub, room },
      'developer socket bağlandı ve kullanıcı odasına katıldı',
    );
  } else {
    logger.info(
      { socketId: socket.id, userId: user.sub, role: user.role },
      'socket bağlandı (oda yok)',
    );
  }

  socket.on('disconnect', (reason) => {
    logger.info(
      { socketId: socket.id, userId: user.sub, reason },
      'socket ayrıldı',
    );
  });
}

/**
 * Socket.IO sunucusunu kurar: JWT auth middleware + bağlantı/oda yönetimi.
 * Yatay büyümede tek satırlık adapter geçişi yeterli (CLAUDE.md scaling notu):
 * `io.adapter(createAdapter(pub, sub))` — geri kalan kod değişmez.
 *
 * @returns Tip-güvenli, başlatılmış sunucu (app factory'ye döner).
 */
export function initSocket(
  httpServer: HttpServer,
  corsOrigins: string[],
): AppIOServer {
  const io: AppIOServer = new Server<
    DefaultEventsMap,
    ServerToClientEvents,
    DefaultEventsMap,
    SocketData
  >(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
  });

  io.use(authenticateSocket);
  io.on('connection', handleConnection);

  ioRef = io;
  return io;
}

/**
 * OTP'yi hedef developer'ların bireysel `user:` odalarına yayınlar (fire-and-forget, SYNC).
 * FAZ 7: proje odasına broadcast YAPILMAZ — yalnızca routing'in belirlediği hedeflere gider.
 * @param targetUserIds Routing resolver'ın döndürdüğü benzersiz hedef developer id'leri.
 * @returns Emit edilen hedef developer sayısı (routing sonucu — "deliveredTo").
 */
function emitOtp(targetUserIds: string[], payload: OtpNotification): number {
  if (!ioRef) {
    logger.warn('socket başlatılmadı — OTP emit atlandı');
    return 0;
  }
  if (targetUserIds.length === 0) {
    return 0;
  }
  const rooms = targetUserIds.map((id) => CONSTANTS.SOCKET.userRoom(id));
  ioRef.to(rooms).emit(CONSTANTS.SOCKET.EVENT_OTP, payload);
  return targetUserIds.length;
}

/**
 * Paylaşımı durdurulan OTP için `otp:revoked` event'ini hedef developer'lara yayınlar.
 * SADECE `user:` odalarına gider (`otp:received` ile aynı hedefleme) — çift emit önlenir.
 * Event yalnızca UI senkronizasyonu içindir; developer'ın kodu daha önce görmüş olmasını geri almaz.
 * @param targetUserIds OTP'nin (receiver+servis) yeniden çözümlenmiş hedef developer'ları.
 */
function emitRevoked(otpId: string, targetUserIds: string[]): void {
  if (!ioRef) {
    logger.warn({ otpId }, 'socket başlatılmadı — revoked emit atlandı');
    return;
  }
  if (targetUserIds.length === 0) {
    return;
  }
  const rooms = targetUserIds.map((id) => CONSTANTS.SOCKET.userRoom(id));
  ioRef.to(rooms).emit(CONSTANTS.SOCKET.EVENT_OTP_REVOKED, { otpId });
}

/**
 * IOtpNotifier port'unun Socket.IO adapter'ı.
 * OTP modülü bu somut nesneyi değil interface'i bilir (DIP) — kompozisyon kökünde enjekte edilir.
 */
export const socketNotifier: IOtpNotifier = {
  notify: (targetUserIds, payload) => emitOtp(targetUserIds, payload),
  notifyRevoked: (otpId, targetUserIds) => emitRevoked(otpId, targetUserIds),
};
