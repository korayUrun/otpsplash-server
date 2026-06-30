import { Source, type OTPLog } from '@prisma/client';
import { OtpService } from '@modules/otp/otp.service';
import {
  AuthorizationError,
  NotFoundError,
  OtpParseError,
  OtpEncryptionError,
} from '@errors/errors';
import type { ILogger } from '@infrastructure/logger';
import type { IRoutingResolver } from '@modules/routing/routing.interfaces';
import type {
  CreateOtpLogData,
  IOtpEncryptor,
  IOtpNotifier,
  IOtpParser,
  IOtpRepository,
  OtpNotification,
} from '@modules/otp/otp.interfaces';
import type { PaginatedResult, PaginationOptions } from '@app-types/index';

/**
 * OtpService birim testi — bağımlılıklar mock'lanır (DIP).
 * DB I/O yok: kayıt→routing→emit sırası, hata yolları, resolveCode dalları ve
 * sharing/revoked davranışı izole doğrulanır.
 */

const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const OTP_ID = '44444444-4444-4444-4444-444444444444';
const DEVICE_ID = '55555555-5555-5555-5555-555555555555';
const RECEIVER_ID = '66666666-6666-6666-6666-666666666666';
const SERVICE_ID = '77777777-7777-7777-7777-777777777777';
const DEV_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

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
    sharingActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-08T00:00:00.000Z'),
    ...overrides,
  };
}

interface Mocks {
  parser: jest.Mocked<IOtpParser>;
  encryptor: jest.Mocked<IOtpEncryptor>;
  repository: jest.Mocked<IOtpRepository>;
  notifier: jest.Mocked<IOtpNotifier>;
  resolver: jest.Mocked<IRoutingResolver>;
  logger: jest.Mocked<ILogger>;
}

function buildMocks(): Mocks {
  return {
    parser: { extract: jest.fn(), validate: jest.fn() },
    encryptor: { encrypt: jest.fn(), decrypt: jest.fn() },
    repository: {
      save: jest.fn(),
      findById: jest.fn(),
      findByProject: jest.fn(),
      updateSharingActive: jest.fn(),
      deleteExpired: jest.fn(),
    },
    notifier: { notify: jest.fn(), notifyRevoked: jest.fn() },
    resolver: { resolveTargets: jest.fn(), resolveTargetDetails: jest.fn() },
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
    m.parser,
    m.encryptor,
    m.repository,
    m.notifier,
    m.resolver,
    m.logger,
  );
}

describe('OtpService.processAndDeliver', () => {
  it('geçerli `code` → şifrele, kaydet, routing çöz, hedeflere emit (Result.ok)', async () => {
    const m = buildMocks();
    m.parser.validate.mockReturnValue(true);
    m.encryptor.encrypt.mockReturnValue('iv:tag:ct');
    m.repository.save.mockResolvedValue(savedLog());
    m.resolver.resolveTargets.mockResolvedValue([DEV_A]);
    m.notifier.notify.mockReturnValue(1);

    const result = await buildService(m).processAndDeliver({
      code: '123456',
      source: Source.ANDROID,
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
      receiverId: RECEIVER_ID,
      serviceId: SERVICE_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deliveredTo).toBe(1);
    }
    // DB'ye düz kod değil şifreli değer + kaynak cihaz + sahiplik (receiverId) yazılır.
    const saveArg = m.repository.save.mock.calls[0]?.[0] as CreateOtpLogData;
    expect(saveArg.encryptedCode).toBe('iv:tag:ct');
    expect(saveArg.deviceId).toBe(DEVICE_ID);
    expect(saveArg.receiverId).toBe(RECEIVER_ID);
    expect(saveArg.serviceId).toBe(SERVICE_ID);
    // Routing receiver+servis ile çözülür, emit yalnızca hedeflere ve düz kodla yapılır.
    expect(m.resolver.resolveTargets).toHaveBeenCalledWith(RECEIVER_ID, SERVICE_ID);
    expect(m.notifier.notify.mock.calls[0]?.[0]).toEqual([DEV_A]);
    const notifyArg = m.notifier.notify.mock.calls[0]?.[1] as OtpNotification;
    expect(notifyArg.code).toBe('123456');
  });

  it('kural yok (serviceId undefined) → resolveTargets boş, kimseye gitmez (deliveredTo 0)', async () => {
    const m = buildMocks();
    m.parser.validate.mockReturnValue(true);
    m.encryptor.encrypt.mockReturnValue('iv:tag:ct');
    m.repository.save.mockResolvedValue(savedLog({ serviceId: null }));
    m.resolver.resolveTargets.mockResolvedValue([]);
    m.notifier.notify.mockReturnValue(0);

    const result = await buildService(m).processAndDeliver({
      code: '123456',
      source: Source.ANDROID,
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
      receiverId: RECEIVER_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deliveredTo).toBe(0);
    }
    // serviceId verilmedi → resolver'a null geçer.
    expect(m.resolver.resolveTargets).toHaveBeenCalledWith(RECEIVER_ID, null);
    expect(m.notifier.notify).toHaveBeenCalledWith([], expect.any(Object));
  });

  it('`smsText`ten kod parse edilir (code verilmediğinde)', async () => {
    const m = buildMocks();
    m.parser.extract.mockReturnValue('654321');
    m.encryptor.encrypt.mockReturnValue('iv:tag:ct');
    m.repository.save.mockResolvedValue(savedLog());
    m.resolver.resolveTargets.mockResolvedValue([]);
    m.notifier.notify.mockReturnValue(0);

    const result = await buildService(m).processAndDeliver({
      smsText: 'Kodunuz: 654321',
      source: Source.IOS_SHORTCUT,
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
      receiverId: RECEIVER_ID,
    });

    expect(result.success).toBe(true);
    expect(m.parser.extract).toHaveBeenCalledWith('Kodunuz: 654321');
    expect(m.encryptor.encrypt).toHaveBeenCalledWith('654321');
  });

  it('geçersiz `code` (validate=false) → OtpParseError, kayıt/emit yok', async () => {
    const m = buildMocks();
    m.parser.validate.mockReturnValue(false);

    const result = await buildService(m).processAndDeliver({
      code: 'abc',
      source: Source.ANDROID,
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
      receiverId: RECEIVER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(OtpParseError);
    }
    expect(m.repository.save).not.toHaveBeenCalled();
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it('ne code ne smsText → OtpParseError', async () => {
    const m = buildMocks();

    const result = await buildService(m).processAndDeliver({
      source: Source.ANDROID,
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
      receiverId: RECEIVER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(OtpParseError);
    }
  });

  it('beklenen AppError (encrypt başarısız) → Result.fail, emit yok', async () => {
    const m = buildMocks();
    m.parser.validate.mockReturnValue(true);
    m.encryptor.encrypt.mockImplementation(() => {
      throw new OtpEncryptionError();
    });

    const result = await buildService(m).processAndDeliver({
      code: '123456',
      source: Source.ANDROID,
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
      receiverId: RECEIVER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(OtpEncryptionError);
    }
    expect(m.repository.save).not.toHaveBeenCalled();
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it('beklenmeyen DB hatası → yeniden fırlatılır (errorHandler yakalar), emit yok', async () => {
    const m = buildMocks();
    m.parser.validate.mockReturnValue(true);
    m.encryptor.encrypt.mockReturnValue('iv:tag:ct');
    m.repository.save.mockRejectedValue(new Error('DB down'));

    await expect(
      buildService(m).processAndDeliver({
        code: '123456',
        source: Source.ANDROID,
        projectId: PROJECT_ID,
        deviceId: DEVICE_ID,
        receiverId: RECEIVER_ID,
      }),
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
    m.resolver.resolveTargets.mockResolvedValue([DEV_A]);

    const result = await buildService(m).toggleSharing(OTP_ID, RECEIVER_ID, false);

    expect(result.success).toBe(true);
    expect(m.repository.updateSharingActive).toHaveBeenCalledWith(OTP_ID, false);
    // Revoked SADECE hedef developer'lara (user-bazlı) gider.
    expect(m.resolver.resolveTargets).toHaveBeenCalledWith(RECEIVER_ID, SERVICE_ID);
    expect(m.notifier.notifyRevoked).toHaveBeenCalledWith(OTP_ID, [DEV_A]);
  });

  it('sharingActive=true → güncelle ama revoked emit YOK', async () => {
    const m = buildMocks();
    m.repository.findById.mockResolvedValue(savedLog({ sharingActive: false }));
    m.repository.updateSharingActive.mockResolvedValue(savedLog());

    const result = await buildService(m).toggleSharing(OTP_ID, RECEIVER_ID, true);

    expect(result.success).toBe(true);
    expect(m.repository.updateSharingActive).toHaveBeenCalledWith(OTP_ID, true);
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
    expect(m.notifier.notifyRevoked).not.toHaveBeenCalled();
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
    m.resolver.resolveTargetDetails.mockResolvedValue([
      { id: DEV_A, email: 'dev@test.com' },
    ]);

    const result = await buildService(m).getSharingTargets(OTP_ID, RECEIVER_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targets).toEqual([{ id: DEV_A, email: 'dev@test.com' }]);
    }
    expect(m.resolver.resolveTargetDetails).toHaveBeenCalledWith(RECEIVER_ID, SERVICE_ID);
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

  it('kayıtların şifresini çözüp sayfalı döner', async () => {
    const m = buildMocks();
    const page: PaginatedResult<OTPLog> = {
      items: [savedLog({ id: OTP_ID, encryptedCode: 'enc-1' })],
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
      expect(result.data.pagination.total).toBe(1);
    }
    expect(m.encryptor.decrypt).toHaveBeenCalledWith('enc-1');
  });

  it('beklenmeyen DB hatası → yeniden fırlatılır', async () => {
    const m = buildMocks();
    m.repository.findByProject.mockRejectedValue(new Error('DB down'));

    await expect(
      buildService(m).getHistory({ projectId: PROJECT_ID, ...options }),
    ).rejects.toThrow('DB down');
  });
});
