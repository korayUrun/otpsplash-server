import { Source, type OTPLog, type ServiceRegistry } from '@prisma/client';
import { OtpService } from '@modules/otp/otp.service';
import {
  AuthorizationError,
  NotFoundError,
  OtpEncryptionError,
} from '@errors/errors';
import type { ILogger } from '@infrastructure/logger';
import type { IRoutingResolver } from '@modules/routing/routing.interfaces';
import type {
  IServiceResolver,
  IUnmatchedRecorder,
} from '@modules/service-registry/registry.interfaces';
import type {
  CreateOtpLogData,
  IOtpEncryptor,
  IOtpNotifier,
  IOtpRepository,
  OtpLogWithService,
  OtpNotification,
} from '@modules/otp/otp.interfaces';
import type { PaginatedResult, PaginationOptions } from '@app-types/index';

/**
 * OtpService birim testi — bağımlılıklar mock'lanır (DIP).
 * DB I/O yok: servis çözümleme → kayıt → routing → emit sırası, kova fire-and-forget,
 * hata yolları ve sharing/revoked davranışı izole doğrulanır.
 */

const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const OTP_ID = '44444444-4444-4444-4444-444444444444';
const DEVICE_ID = '55555555-5555-5555-5555-555555555555';
const RECEIVER_ID = '66666666-6666-6666-6666-666666666666';
const SERVICE_ID = '77777777-7777-7777-7777-777777777777';
const DEV_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** Resolver artık id+name döner (canlı kart etiketi için) — testlerde ortak sonuç. */
const RESOLVED = { id: SERVICE_ID, name: 'Binance' };

const baseDto = {
  code: '123456',
  source: Source.ANDROID,
  senderRaw: 'BINANCE',
  projectId: PROJECT_ID,
  deviceId: DEVICE_ID,
  receiverId: RECEIVER_ID,
};

/** Sabit bir OTPLog döndüren save mock'u için yardımcı. */
function savedLog(overrides: Partial<OTPLog> = {}): OTPLog {
  return {
    id: OTP_ID,
    encryptedCode: 'iv:tag:ct',
    source: Source.ANDROID,
    projectId: PROJECT_ID,
    deviceId: DEVICE_ID,
    receiverId: RECEIVER_ID,
    serviceId: SERVICE_ID,
    senderRaw: 'BINANCE',
    sharingActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-08T00:00:00.000Z'),
    ...overrides,
  };
}

/** Adı verilen aktif servis satırı (findByProject include: { service } için). */
function serviceRow(name: string): ServiceRegistry {
  return {
    id: SERVICE_ID,
    name,
    isActive: true,
    senderPattern: null,
    keywordPattern: null,
    iconUrl: null,
    projectId: PROJECT_ID,
    lastSeenSender: null,
    unmatchedCount: 0,
    lastSeenAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

/** service ilişkisi eklenmiş OTPLog (findByProject dönüşü) — developer history serviceName testi. */
function savedLogWithService(
  service: ServiceRegistry | null,
  overrides: Partial<OTPLog> = {},
): OtpLogWithService {
  return { ...savedLog(overrides), service };
}

interface Mocks {
  encryptor: jest.Mocked<IOtpEncryptor>;
  repository: jest.Mocked<IOtpRepository>;
  notifier: jest.Mocked<IOtpNotifier>;
  routing: jest.Mocked<IRoutingResolver>;
  serviceResolver: jest.Mocked<IServiceResolver>;
  recorder: jest.Mocked<IUnmatchedRecorder>;
  logger: jest.Mocked<ILogger>;
}

function buildMocks(): Mocks {
  return {
    encryptor: { encrypt: jest.fn(), decrypt: jest.fn() },
    repository: {
      save: jest.fn(),
      findById: jest.fn(),
      findByProject: jest.fn(),
      findByReceiver: jest.fn(),
      updateSharingActive: jest.fn(),
      deleteExpired: jest.fn(),
    },
    notifier: { notify: jest.fn(), notifyRevoked: jest.fn() },
    routing: { resolveTargets: jest.fn(), resolveTargetDetails: jest.fn() },
    serviceResolver: { resolve: jest.fn() },
    recorder: { recordUnmatched: jest.fn() },
    logger: {
      fatal: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
      child: jest.fn(),
    },
  };
}

function buildService(m: Mocks): OtpService {
  return new OtpService(
    m.encryptor,
    m.repository,
    m.notifier,
    m.routing,
    m.serviceResolver,
    m.recorder,
    m.logger,
  );
}

describe('OtpService.processAndDeliver', () => {
  it('tanınan senderRaw → serviceId çözülür, kaydedilir, hedeflere emit (Result.ok)', async () => {
    const m = buildMocks();
    m.serviceResolver.resolve.mockResolvedValue(RESOLVED);
    m.encryptor.encrypt.mockReturnValue('iv:tag:ct');
    m.repository.save.mockResolvedValue(savedLog());
    m.routing.resolveTargets.mockResolvedValue([DEV_A]);
    m.notifier.notify.mockReturnValue(1);

    const result = await buildService(m).processAndDeliver({ ...baseDto });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deliveredTo).toBe(1);
    }
    // Servis senderRaw/serviceHint'ten çözülür.
    expect(m.serviceResolver.resolve).toHaveBeenCalledWith(
      PROJECT_ID,
      'BINANCE',
      undefined,
    );
    // DB'ye şifreli kod + sahiplik + çözülen serviceId yazılır.
    const saveArg = m.repository.save.mock.calls[0]?.[0] as CreateOtpLogData;
    expect(saveArg.encryptedCode).toBe('iv:tag:ct');
    expect(saveArg.receiverId).toBe(RECEIVER_ID);
    expect(saveArg.serviceId).toBe(SERVICE_ID);
    // senderRaw fallback etiketi olarak kalıcılaştırılır.
    expect(saveArg.senderRaw).toBe('BINANCE');
    // Çözülemeyince kova'ya yazılmaz (çözüldü).
    expect(m.recorder.recordUnmatched).not.toHaveBeenCalled();
    // Routing çözülen serviceId ile çalışır, emit düz kod + etiket sinyalleriyle.
    expect(m.routing.resolveTargets).toHaveBeenCalledWith(RECEIVER_ID, SERVICE_ID);
    const notifyArg = m.notifier.notify.mock.calls[0]?.[1] as OtpNotification;
    expect(notifyArg.code).toBe('123456');
    // Canlı kart anında etiketlensin: serviceName çözülen addan, senderRaw fallback olarak.
    expect(notifyArg.serviceName).toBe('Binance');
    expect(notifyArg.senderRaw).toBe('BINANCE');
  });

  it('serviceHint birincil sinyale eklenir (resolve\'a iletilir)', async () => {
    const m = buildMocks();
    m.serviceResolver.resolve.mockResolvedValue(RESOLVED);
    m.encryptor.encrypt.mockReturnValue('iv:tag:ct');
    m.repository.save.mockResolvedValue(savedLog());
    m.routing.resolveTargets.mockResolvedValue([]);
    m.notifier.notify.mockReturnValue(0);

    await buildService(m).processAndDeliver({ ...baseDto, serviceHint: 'garanti' });

    expect(m.serviceResolver.resolve).toHaveBeenCalledWith(
      PROJECT_ID,
      'BINANCE',
      'garanti',
    );
  });

  it('tanınmayan senderRaw → kova\'ya kaydeder, serviceId null, kimseye gitmez', async () => {
    const m = buildMocks();
    m.serviceResolver.resolve.mockResolvedValue(null);
    m.recorder.recordUnmatched.mockResolvedValue(undefined);
    m.encryptor.encrypt.mockReturnValue('iv:tag:ct');
    m.repository.save.mockResolvedValue(savedLog({ serviceId: null }));
    m.routing.resolveTargets.mockResolvedValue([]);
    m.notifier.notify.mockReturnValue(0);

    const result = await buildService(m).processAndDeliver({ ...baseDto });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deliveredTo).toBe(0);
    }
    // Kova'ya eşleşmeyen sinyal yazılır.
    expect(m.recorder.recordUnmatched).toHaveBeenCalledWith(PROJECT_ID, 'BINANCE');
    // serviceId yok → save'e undefined, routing'e null geçer; senderRaw yine kalıcılaştırılır.
    const saveArg = m.repository.save.mock.calls[0]?.[0] as CreateOtpLogData;
    expect(saveArg.serviceId).toBeUndefined();
    expect(saveArg.senderRaw).toBe('BINANCE');
    expect(m.routing.resolveTargets).toHaveBeenCalledWith(RECEIVER_ID, null);
    // Çözülemedi → payload serviceName null, developer kartı senderRaw'a düşer.
    const notifyArg = m.notifier.notify.mock.calls[0]?.[1] as OtpNotification;
    expect(notifyArg.serviceName).toBeNull();
    expect(notifyArg.senderRaw).toBe('BINANCE');
  });

  it('kova kaydı fire-and-forget — recordUnmatched askıda kalsa bile OTP işlenir', async () => {
    const m = buildMocks();
    m.serviceResolver.resolve.mockResolvedValue(null);
    // Hiç çözülmeyen promise: await edilseydi test asılı kalırdı → await EDİLMEDİĞİNİ kanıtlar.
    m.recorder.recordUnmatched.mockReturnValue(new Promise<void>(() => {}));
    m.encryptor.encrypt.mockReturnValue('iv:tag:ct');
    m.repository.save.mockResolvedValue(savedLog({ serviceId: null }));
    m.routing.resolveTargets.mockResolvedValue([]);
    m.notifier.notify.mockReturnValue(0);

    const result = await buildService(m).processAndDeliver({ ...baseDto });

    expect(result.success).toBe(true);
    expect(m.repository.save).toHaveBeenCalled();
  });

  it('beklenen AppError (encrypt başarısız) → Result.fail, kayıt/emit yok', async () => {
    const m = buildMocks();
    m.serviceResolver.resolve.mockResolvedValue(RESOLVED);
    m.encryptor.encrypt.mockImplementation(() => {
      throw new OtpEncryptionError();
    });

    const result = await buildService(m).processAndDeliver({ ...baseDto });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(OtpEncryptionError);
    }
    expect(m.repository.save).not.toHaveBeenCalled();
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it('beklenmeyen DB hatası → yeniden fırlatılır (errorHandler yakalar), emit yok', async () => {
    const m = buildMocks();
    m.serviceResolver.resolve.mockResolvedValue(RESOLVED);
    m.encryptor.encrypt.mockReturnValue('iv:tag:ct');
    m.repository.save.mockRejectedValue(new Error('DB down'));

    await expect(
      buildService(m).processAndDeliver({ ...baseDto }),
    ).rejects.toThrow('DB down');
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });
});

describe('OtpService.toggleSharing', () => {
  it('sharingActive=false → güncelle ve hedeflere otp:revoked emit', async () => {
    const m = buildMocks();
    m.repository.findById.mockResolvedValue(savedLog());
    m.repository.updateSharingActive.mockResolvedValue(
      savedLog({ sharingActive: false }),
    );
    m.routing.resolveTargets.mockResolvedValue([DEV_A]);

    const result = await buildService(m).toggleSharing(OTP_ID, RECEIVER_ID, false);

    expect(result.success).toBe(true);
    expect(m.repository.updateSharingActive).toHaveBeenCalledWith(OTP_ID, false);
    expect(m.routing.resolveTargets).toHaveBeenCalledWith(RECEIVER_ID, SERVICE_ID);
    expect(m.notifier.notifyRevoked).toHaveBeenCalledWith(OTP_ID, [DEV_A]);
  });

  it('sharingActive=true → güncelle ama revoked emit YOK', async () => {
    const m = buildMocks();
    m.repository.findById.mockResolvedValue(savedLog({ sharingActive: false }));
    m.repository.updateSharingActive.mockResolvedValue(savedLog());

    const result = await buildService(m).toggleSharing(OTP_ID, RECEIVER_ID, true);

    expect(result.success).toBe(true);
    expect(m.notifier.notifyRevoked).not.toHaveBeenCalled();
  });

  it('sahibi değil → AuthorizationError, güncelleme yok', async () => {
    const m = buildMocks();
    m.repository.findById.mockResolvedValue(savedLog({ receiverId: 'someone-else' }));

    const result = await buildService(m).toggleSharing(OTP_ID, RECEIVER_ID, false);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(AuthorizationError);
    }
    expect(m.repository.updateSharingActive).not.toHaveBeenCalled();
  });

  it('OTP yok → NotFoundError', async () => {
    const m = buildMocks();
    m.repository.findById.mockResolvedValue(null);

    const result = await buildService(m).toggleSharing(OTP_ID, RECEIVER_ID, false);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(NotFoundError);
    }
  });
});

describe('OtpService.getSharingTargets', () => {
  it('sahibi → çözümlenmiş hedef listesini döner', async () => {
    const m = buildMocks();
    m.repository.findById.mockResolvedValue(savedLog());
    m.routing.resolveTargetDetails.mockResolvedValue([
      { id: DEV_A, email: 'dev@test.com', name: 'Dev A' },
    ]);

    const result = await buildService(m).getSharingTargets(OTP_ID, RECEIVER_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targets).toEqual([
        { id: DEV_A, email: 'dev@test.com', name: 'Dev A' },
      ]);
    }
    expect(m.routing.resolveTargetDetails).toHaveBeenCalledWith(RECEIVER_ID, SERVICE_ID);
  });

  it('sahibi değil → AuthorizationError', async () => {
    const m = buildMocks();
    m.repository.findById.mockResolvedValue(savedLog({ receiverId: 'someone-else' }));

    const result = await buildService(m).getSharingTargets(OTP_ID, RECEIVER_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(AuthorizationError);
    }
  });
});

describe('OtpService.getHistory', () => {
  const options: PaginationOptions = { page: 1, limit: 20 };

  it('kayıtların şifresini çözüp serviceName + senderRaw ile sayfalı döner', async () => {
    const m = buildMocks();
    const page: PaginatedResult<OtpLogWithService> = {
      items: [
        savedLogWithService(serviceRow('Binance'), {
          id: OTP_ID,
          encryptedCode: 'enc-1',
          senderRaw: 'BINANCE',
        }),
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    m.repository.findByProject.mockResolvedValue(page);
    m.encryptor.decrypt.mockReturnValue('123456');

    const result = await buildService(m).getHistory({
      projectId: PROJECT_ID,
      ...options,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0]?.code).toBe('123456');
      // Çözülen servis adı satıra taşınır; senderRaw fallback olarak yanında döner.
      expect(result.data.items[0]?.serviceName).toBe('Binance');
      expect(result.data.items[0]?.senderRaw).toBe('BINANCE');
      expect(result.data.pagination.total).toBe(1);
    }
    expect(m.encryptor.decrypt).toHaveBeenCalledWith('enc-1');
  });

  it('servis çözülemeyen kayıt → serviceName null, senderRaw fallback döner', async () => {
    const m = buildMocks();
    const page: PaginatedResult<OtpLogWithService> = {
      items: [
        savedLogWithService(null, {
          id: OTP_ID,
          encryptedCode: 'enc-1',
          serviceId: null,
          senderRaw: '+905551112233',
        }),
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    m.repository.findByProject.mockResolvedValue(page);
    m.encryptor.decrypt.mockReturnValue('123456');

    const result = await buildService(m).getHistory({
      projectId: PROJECT_ID,
      ...options,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0]?.serviceName).toBeNull();
      expect(result.data.items[0]?.senderRaw).toBe('+905551112233');
    }
  });

  it('beklenmeyen DB hatası → yeniden fırlatılır', async () => {
    const m = buildMocks();
    m.repository.findByProject.mockRejectedValue(new Error('DB down'));

    await expect(
      buildService(m).getHistory({ projectId: PROJECT_ID, ...options }),
    ).rejects.toThrow('DB down');
  });
});
