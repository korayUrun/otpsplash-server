import express, {
  type Application,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import helmet from 'helmet';
import cors from 'cors';
import { env } from '@config/env';
import { NotFoundError } from '@errors/errors';
import { initSocket, type AppIOServer } from '@infrastructure/socket';
import { requestId } from '@middleware/requestId';
import { requestLogger } from '@middleware/requestLogger';
import { errorHandler } from '@middleware/errorHandler';
import { apiRouter } from './routes';

export interface AppContext {
  app: Application;
  httpServer: HttpServer;
  io: AppIOServer;
}

/**
 * Express + Socket.IO uygulamasını kurar.
 * Singleton bağımlılıkları (prisma, logger) modül seviyesinde import edilir;
 * bu factory yalnızca HTTP/WS katmanını birleştirir.
 */
export function createApp(): AppContext {
  const app = express();

  // requestId ilk: sonraki tüm loglar ve hata yanıtları aynı id'yi taşır.
  app.use(requestId);

  // Güvenlik başlıkları (CLAUDE.md güvenlik kuralı 5).
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '10kb' }));
  app.use(requestLogger);

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api', apiRouter);

  // Eşleşmeyen route → standart 404 zarfı.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError(`Yol bulunamadı: ${req.method} ${req.originalUrl}`));
  });

  // Global hata yöneticisi en sonda.
  app.use(errorHandler);

  const httpServer = createServer(app);
  // Socket.IO: JWT auth + proje odaları socket.ts içinde kurulur (SRP).
  const io = initSocket(httpServer, env.corsOrigins);

  return { app, httpServer, io };
}
