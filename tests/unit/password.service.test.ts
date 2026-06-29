import { Argon2PasswordService } from '@modules/auth/password.service';
import { AuthenticationError } from '@errors/errors';

const service = new Argon2PasswordService();

describe('Argon2PasswordService', () => {
  it('argon2id formatında hash üretir', async () => {
    const hash = await service.hash('Password123');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('Password123');
  });

  it('doğru parola için true döner', async () => {
    const hash = await service.hash('Password123');
    await expect(service.verify(hash, 'Password123')).resolves.toBe(true);
  });

  it('yanlış parola için false döner', async () => {
    const hash = await service.hash('Password123');
    await expect(service.verify(hash, 'WrongPassword1')).resolves.toBe(false);
  });

  it('bozuk hash → AuthenticationError', async () => {
    await expect(service.verify('not-a-valid-hash', 'Password123')).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });
});
