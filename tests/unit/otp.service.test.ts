import { Source, type OTPLog } from '@prisma/client';
import { OtpService } from '@modules/otp/otp.service';
import { OtpParseError, OtpEncryptionError } from '@errors/errors';
import type { ILogger } from '@infrastructure/logger';
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
 * DB I/O yok: kayıt→emit sırası, hata yolları ve resolveCode dalları izole doğrulanır.
 */

const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const OTP_ID = '44444444-4444-4444-4444-444444444444';

/** Sabit bir OTPLog döndüren save mock'u için yardımcı. */
function savedLog(overrides: Partial<OTPLog> = {}): OTPLog {
  return {
    id: OTP_ID,
    encryptedCode: 'iv:tag:ct',
    source: Source.ANDROID,
    projectId: PROJECT_ID,
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
  logger: jest.Mocked<ILogger>;
}

function buildMocks(): Mocks {
  return {
    parser: { extract: jest.fn(), validate: jest.fn() },
    encryptor: { encrypt: jest.fn(), decrypt: jest.fn() },
    repository: {
      save: jest.fn(),
      findByProject: jest.fn(),
      deleteExpired: jest.fn(),
    },
    notifier: { notify: jest.fn() },
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
  return new OtpService(m.parser, m.encryptor, m.repository, m.notifier, m.logger);
}

describe('OtpService.processAndDeliver', () => {
  it('geçerli `code` → şifrele, kaydet, emit (Result.ok)', async () => {
    const m = buildMocks();
    m.parser.validate.mockReturnValue(true);
    m.encryptor.encrypt.mockReturnValue('iv:tag:ct');
    m.repository.save.mockResolvedValue(savedLog());
    m.notifier.notify.mockReturnValue(2);

    const result = await buildService(m).processAndDeliver({
      code: '123456',
      source: Source.ANDROID,
      projectId: PROJECT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deliveredTo).toBe(2);
    }
    // DB'ye düz kod değil şifreli değer yazılır.
    const saveArg = m.repository.save.mock.calls[0]?.[0] as CreateOtpLogData;
    expect(saveArg.encryptedCode).toBe('iv:tag:ct');
    // Emit yalnızca kayıttan sonra ve düz kodla yapılır.
    const notifyArg = m.notifier.notify.mock.calls[0]?.[1] as OtpNotification;
    expect(notifyArg.code).toBe('123456');
  });

  it('`smsText`ten kod parse edilir (code verilmediğinde)', async () => {
    const m = buildMocks();
    m.parser.extract.mockReturnValue('654321');
    m.encryptor.encrypt.mockReturnValue('iv:tag:ct');
    m.repository.save.mockResolvedValue(savedLog());
    m.notifier.notify.mockReturnValue(0);

    const result = await buildService(m).processAndDeliver({
      smsText: 'Kodunuz: 654321',
      source: Source.IOS_SHORTCUT,
      projectId: PROJECT_ID,
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
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(OtpParseError);
    }
    expect(m.repository.save).not.toHaveBeenCalled();
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it('`smsText`te kod yok (extract=null) → OtpParseError', async () => {
    const m = buildMocks();
    m.parser.extract.mockReturnValue(null);

    const result = await buildService(m).processAndDeliver({
      smsText: 'Merhaba',
      source: Source.ANDROID,
      projectId: PROJECT_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(OtpParseError);
    }
  });

  it('ne code ne smsText → OtpParseError', async () => {
    const m = buildMocks();

    const result = await buildService(m).processAndDeliver({
      source: Source.ANDROID,
      projectId: PROJECT_ID,
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
      }),
    ).rejects.toThrow('DB down');
    expect(m.notifier.notify).not.toHaveBeenCalled();
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
