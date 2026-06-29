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
} from '@modules/otp/otp.interfaces';

const BEARER_PREFIX = 'Bearer ';

/**
 * Sunucu → client event haritası. Anahtar literal olmak zorunda olduğundan
 * 'otp' yazılır; runtime'da CONSTANTS.SOCKET.EVENT_OTP ile emit edilir (aynı değer).
 */
interface ServerToClientEvents {
  otp: (payload: OtpNotification) => void;
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
 * DEVELOPER → `project:${projectId}` odasına katılır. RECEIVER hiçbir odaya katılmaz
 * (yalnızca OTP gönderir, almaz).
 *
 * @remarks export edilir (birim testi).
 */
export function handleConnection(socket: AppSocket): void {
  const { user } = socket.data;

  if (user.role === Role.DEVELOPER) {
    const room = CONSTANTS.SOCKET.projectRoom(user.projectId);
    void socket.join(room);
    logger.info(
      { socketId: socket.id, userId: user.sub, room },
      'developer socket bağlandı ve proje odasına katıldı',
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
 * OTP'yi projenin odasına yayınlar (fire-and-forget, SYNC).
 * @returns O an odadaki bağlı socket sayısı (best-effort alıcı sayısı).
 */
function emitOtp(projectId: string, payload: OtpNotification): number {
  if (!ioRef) {
    logger.warn({ projectId }, 'socket başlatılmadı — OTP emit atlandı');
    return 0;
  }
  const room = CONSTANTS.SOCKET.projectRoom(projectId);
  ioRef.to(room).emit(CONSTANTS.SOCKET.EVENT_OTP, payload);
  return ioRef.sockets.adapter.rooms.get(room)?.size ?? 0;
}

/**
 * IOtpNotifier port'unun Socket.IO adapter'ı.
 * OTP modülü bu somut nesneyi değil interface'i bilir (DIP) — kompozisyon kökünde enjekte edilir.
 */
export const socketNotifier: IOtpNotifier = {
  notify: (projectId, payload) => emitOtp(projectId, payload),
};
