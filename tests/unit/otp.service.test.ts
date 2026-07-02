import { Role, Source, type Device, type OTPLog, type User } from '@prisma/client';
import { OtpService } from '@modules/otp/otp.service';
import {
  AuthorizationError,
  NotFoundError,
  OtpEncryptionError,
} from '@errors/errors';
import type { ILogger } from '@infrastructure/logger';
import type { IRoutingResolver } from '@modules/routing/routing.interfaces';
import type {
  CreateOtpLogData,
  IOtpEncryptor,
  IOtpNotifier,
  IOtpRepository,
  OtpLogWithRelations,
  OtpNotification,
} from '@modules/otp/otp.interfaces';
import type { PaginatedResult, PaginationOptions } from '@app-types/index';

/**
 * OtpService birim testi — bağımlılıklar mock'lanır (DIP).
 * DB I/O yok: kayıt → routing → emit sırası, hata yolları ve sharing/revoked davranışı
 * izole doğrulanır. Servis çözümleme YOKTUR — dağıtım receiver bazlıdır.
 */

const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const OTP_ID = '44444444-4444-4444-4444-444444444444';
const DEVICE_ID = '55555555-5555-5555-5555-555555555555';
const RECEIVER_ID = '66666666-6666-6666-6666-666666666666';
const DEV_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const RECEIVER: User = {
  id: RECEIVER_ID,
  email: 'receiver@test.com',
  name: 'Alice',
  phoneNumber: '+905551112233',
  password: 'x',
  role: Role.RECEIVER,
  projectId: PROJECT_ID,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const DEVICE: Device = {
  id: DEVICE_ID,
  secretHash: 'hash',
  platform: 'ANDROID',
  deviceName: 'İş Telefonum',
  phoneNumber: '+905551112233',
  userId: RECEIVER_ID,
  projectId: PROJECT_ID,
  isRevoked: false,
  lastUsedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

const baseDto = {
  code: '123456',
  source: Source.ANDROID,
  senderRaw: 'BINANCE',
  projectId: PROJECT_ID,
  deviceId: DEVICE_ID,
  receiverId: RECEIVER_ID,
};

/** Sabit bir OTPLog döndüren yardımcı (id/alanlar override edilebilir). */
function otpLog(overrides: Partial<OTPLog> = {}): OTPLog {
  return {
    id: OTP_ID,
    encryptedCode: 'iv:tag:ct',
    source: Source.ANDROID,
    projectId: PROJECT_ID,
    deviceId: DEVICE_ID,
    receiverId: RECEIVER_ID,
    senderRaw: 'BINANCE',
    sharingActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-08T00:00:00.000Z'),
    ...overrides,
  };
}

/** receiver + device ilişkileriyle OTPLog (save/history dönüşü). */
function savedLog(
  overrides: Partial<OTPLog> = {},
  device: Device | null = DEVICE,
): OtpLogWithRelations {
  return { ...otpLog(overrides), receiver: RECEIVER, device };
}

interface Mocks {
  encryptor: jest.Mocked<IOtpEncryptor>;
  repository: jest.Mocked<IOtpRepository>;
  notifier: jest.Mocked<IOtpNotifier>;
  routing: jest.Mocked<IRoutingResolver>;
  logger: jest.Mocked<ILogger>;
}

function buildMocks(): Mocks {
  return {
    encryptor: { encrypt: jest.fn(), decrypt: jest.fn() },
    repository: {
      save: jest.fn(),
      findById: jest.fn(),
      findForDeveloper: jest.fn(),
      findByReceiver: jest.fn(),
      updateSharingActive: jest.fn(),
      deleteExpired: jest.fn(),
    },
    notifier: {
      notify: jest.fn(),
      notifyReceiver: jest.fn(),
      notifyRevoked: jest.fn(),
    },
    routing: {
      resolveTargets: jest.fn(),
      resolveTargetDetails: jest.fn(),
      resolveVisibleReceiverIds: jest.fn(),
    },
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
    m.logger,
  );
}

describe('OtpService.processAndDeliver', () => {
  it('kaydeder, receiver bazlı hedeflere emit eder (Result.ok)', async () => {
    const m = buildMocks();
    m.encryptor.encrypt.mockReturnValue('iv:tag:ct');
    m.repository.save.mockResolvedValue(savedLog());
    m.routing.resolveTargets.mockResolvedValue([DEV_A]);
    m.notifier.notify.mockReturnValue(1);

    const result = await buildService(m).processAndDeliver({ ...baseDto });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deliveredTo).toBe(1);
    }
    // DB'ye şifreli kod + sahiplik + senderRaw etiketi yazılır (serviceId YOK).
    const saveArg = m.repository.save.mock.calls[0]?.[0] as CreateOtpLogData;
    expect(saveArg.encryptedCode).toBe('iv:tag:ct');
    expect(saveArg.receiverId).toBe(RECEIVER_ID);
    expect(saveArg.senderRaw).toBe('BINANCE');
    // Routing yalnızca receiverId ile çözülür.
    expect(m.routing.resolveTargets).toHaveBeenCalledWith(RECEIVER_ID);
    // Emit payload: düz kod + senderRaw + receiver/device kimliği + geri sayım/toggle.
    const notifyArg = m.notifier.notify.mock.calls[0]?.[1] as OtpNotification;
    expect(notifyArg.code).toBe('123456');
    expect(notifyArg.senderRaw).toBe('BINANCE');
    expect(notifyArg.receiver).toEqual({
      name: 'Alice',
      email: 'receiver@test.com',
      phoneNumber: '+905551112233',
    });
    expect(notifyArg.device).toEqual({ name: 'İş Telefonum' });
    expect(notifyArg.expiresAt).toEqual(savedLog().expiresAt);
    expect(notifyArg.sharingActive).toBe(true);
    // Sahibi receiver kendi odasına AYNI payload'ı alır (deliveredTo'ya sayılmaz).
    expect(m.notifier.notifyReceiver).toHaveBeenCalledWith(RECEIVER_ID, notifyArg);
  });

  it('kural yok → kimseye gitmez ama OTP yine kaydedilir (deliveredTo 0)', async () => {
    const m = buildMocks();
    m.encryptor.encrypt.mockReturnValue('iv:tag:ct');
    m.repository.save.mockResolvedValue(savedLog());
    m.routing.resolveTargets.mockResolvedValue([]);
    m.notifier.notify.mockReturnValue(0);

    const result = await buildService(m).processAndDeliver({ ...baseDto });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deliveredTo).toBe(0);
    }
    expect(m.repository.save).toHaveBeenCalled();
    // Kural olmasa da sahibi receiver kendi kodunu görür.
    expect(m.notifier.notifyReceiver).toHaveBeenCalled();
  });

  it('cihaz silinmişse (device null) → payload.device null olur', async () => {
    const m = buildMocks();
    m.encryptor.encrypt.mockReturnValue('iv:tag:ct');
    m.repository.save.mockResolvedValue(savedLog({}, null));
    m.routing.resolveTargets.mockResolvedValue([DEV_A]);
    m.notifier.notify.mockReturnValue(1);

    await buildService(m).processAndDeliver({ ...baseDto });

    const notifyArg = m.notifier.notify.mock.calls[0]?.[1] as OtpNotification;
    expect(notifyArg.device).toBeNull();
    // Sahiplik (receiver) her koşulda korunur.
    expect(notifyArg.receiver.email).toBe('receiver@test.com');
  });

  it('beklenen AppError (encrypt başarısız) → Result.fail, kayıt/emit yok', async () => {
    const m = buildMocks();
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
    m.repository.findById.mockResolvedValue(otpLog());
    m.repository.updateSharingActive.mockResolvedValue(
      otpLog({ sharingActive: false }),
    );
    m.routing.resolveTargets.mockResolvedValue([DEV_A]);

    const result = await buildService(m).toggleSharing(OTP_ID, RECEIVER_ID, false);

    expect(result.success).toBe(true);
    expect(m.repository.updateSharingActive).toHaveBeenCalledWith(OTP_ID, false);
    expect(m.routing.resolveTargets).toHaveBeenCalledWith(RECEIVER_ID);
    expect(m.notifier.notifyRevoked).toHaveBeenCalledWith(OTP_ID, [DEV_A]);
  });

  it('sharingActive=true → güncelle ama revoked emit YOK', async () => {
    const m = buildMocks();
    m.repository.findById.mockResolvedValue(otpLog({ sharingActive: false }));
    m.repository.updateSharingActive.mockResolvedValue(otpLog());

    const result = await buildService(m).toggleSharing(OTP_ID, RECEIVER_ID, true);

    expect(result.success).toBe(true);
    expect(m.notifier.notifyRevoked).not.toHaveBeenCalled();
  });

  it('sahibi değil → AuthorizationError, güncelleme yok', async () => {
    const m = buildMocks();
    m.repository.findById.mockResolvedValue(otpLog({ receiverId: 'someone-else' }));

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
    m.repository.findById.mockResolvedValue(otpLog());
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
    expect(m.routing.resolveTargetDetails).toHaveBeenCalledWith(RECEIVER_ID);
  });

  it('sahibi değil → AuthorizationError', async () => {
    const m = buildMocks();
    m.repository.findById.mockResolvedValue(otpLog({ receiverId: 'someone-else' }));

    const result = await buildService(m).getSharingTargets(OTP_ID, RECEIVER_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(AuthorizationError);
    }
  });
});

describe('OtpService.getHistory', () => {
  const options: PaginationOptions = { page: 1, limit: 20 };

  it('developer kapsamını (receiverId listesi) çözer, findForDeveloper\'a iletir, kayıtları döner', async () => {
    const m = buildMocks();
    const page: PaginatedResult<OtpLogWithRelations> = {
      items: [
        savedLog({ id: OTP_ID, encryptedCode: 'enc-1', senderRaw: 'BINANCE' }),
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    m.routing.resolveVisibleReceiverIds.mockResolvedValue([RECEIVER_ID]);
    m.repository.findForDeveloper.mockResolvedValue(page);
    m.encryptor.decrypt.mockReturnValue('123456');

    const result = await buildService(m).getHistory({
      developerId: DEV_A,
      projectId: PROJECT_ID,
      ...options,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0]?.code).toBe('123456');
      expect(result.data.items[0]?.senderRaw).toBe('BINANCE');
      // Developer "kimden geldi"yi görür: receiver + cihaz bilgisi.
      expect(result.data.items[0]?.receiver).toEqual({
        name: 'Alice',
        email: 'receiver@test.com',
        phoneNumber: '+905551112233',
      });
      expect(result.data.items[0]?.device).toEqual({ name: 'İş Telefonum' });
      expect(result.data.pagination.total).toBe(1);
    }
    // Kapsam developer'ın id'siyle çözülür, sorgu bu receiver listesiyle proje içinde koşar.
    expect(m.routing.resolveVisibleReceiverIds).toHaveBeenCalledWith(DEV_A);
    expect(m.repository.findForDeveloper).toHaveBeenCalledWith(
      PROJECT_ID,
      [RECEIVER_ID],
      options,
    );
    expect(m.encryptor.decrypt).toHaveBeenCalledWith('enc-1');
  });

  it('kapsam boş (developer\'a kural yok) → DB\'ye gitmeden boş sayfa', async () => {
    const m = buildMocks();
    m.routing.resolveVisibleReceiverIds.mockResolvedValue([]);

    const result = await buildService(m).getHistory({
      developerId: DEV_A,
      projectId: PROJECT_ID,
      ...options,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toEqual([]);
      expect(result.data.pagination.total).toBe(0);
      expect(result.data.pagination.totalPages).toBe(0);
    }
    // Kural yoksa geçmiş sorgusu hiç açılmaz (canlı feed ile hizalı boş sonuç).
    expect(m.repository.findForDeveloper).not.toHaveBeenCalled();
  });

  it('beklenmeyen DB hatası → yeniden fırlatılır', async () => {
    const m = buildMocks();
    m.routing.resolveVisibleReceiverIds.mockResolvedValue([RECEIVER_ID]);
    m.repository.findForDeveloper.mockRejectedValue(new Error('DB down'));

    await expect(
      buildService(m).getHistory({
        developerId: DEV_A,
        projectId: PROJECT_ID,
        ...options,
      }),
    ).rejects.toThrow('DB down');
  });
});
