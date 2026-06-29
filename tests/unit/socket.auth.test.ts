import { Role } from '@prisma/client';
import {
  authenticateSocket,
  handleConnection,
} from '@infrastructure/socket';
import { AuthenticationError } from '@errors/errors';
import { ErrorCode } from '@errors/ErrorCode';
import { CONSTANTS } from '@config/constants';
import { tokenService } from '@modules/auth/token.service';
import type { JwtPayload } from '@app-types/index';

type AuthSocket = Parameters<typeof authenticateSocket>[0];
type ConnSocket = Parameters<typeof handleConnection>[0];

const samplePayload: JwtPayload = {
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'dev@test.com',
  role: Role.DEVELOPER,
  projectId: '22222222-2222-2222-2222-222222222222',
};

/** Auth middleware için minimal sahte socket. */
function fakeAuthSocket(handshake: {
  auth?: Record<string, unknown>;
  headers?: Record<string, string>;
}): AuthSocket {
  return {
    id: 'sock_test',
    handshake: { auth: handshake.auth ?? {}, headers: handshake.headers ?? {} },
    data: {},
  } as unknown as AuthSocket;
}

describe('authenticateSocket', () => {
  it('handshake.auth.token ile geçerli token → next() hatasız, data.user dolu', () => {
    const token = tokenService.generateAccessToken(samplePayload);
    const socket = fakeAuthSocket({ auth: { token } });
    const next = jest.fn();

    authenticateSocket(socket, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(socket.data.user.sub).toBe(samplePayload.sub);
  });

  it('Authorization: Bearer başlığı ile geçerli token → kabul', () => {
    const token = tokenService.generateAccessToken(samplePayload);
    const socket = fakeAuthSocket({ headers: { authorization: `Bearer ${token}` } });
    const next = jest.fn();

    authenticateSocket(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data.user.email).toBe(samplePayload.email);
  });

  it('token yok → AuthenticationError ile reddedilir', () => {
    const socket = fakeAuthSocket({});
    const next = jest.fn();

    authenticateSocket(socket, next);

    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(AuthenticationError);
  });

  it('geçersiz token → AuthenticationError (TOKEN_INVALID)', () => {
    const socket = fakeAuthSocket({ auth: { token: 'garbage.token.value' } });
    const next = jest.fn();

    authenticateSocket(socket, next);

    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as AuthenticationError).errorCode).toBe(ErrorCode.TOKEN_INVALID);
  });
});

describe('handleConnection', () => {
  /** Bağlantı handler için sahte socket (join/on spy'lı). */
  function fakeConnSocket(user: JwtPayload): {
    socket: ConnSocket;
    join: jest.Mock;
  } {
    const join = jest.fn();
    const socket = {
      id: 'sock_conn',
      data: { user },
      join,
      on: jest.fn(),
    } as unknown as ConnSocket;
    return { socket, join };
  }

  it('DEVELOPER → proje odasına katılır', () => {
    const { socket, join } = fakeConnSocket(samplePayload);
    handleConnection(socket);
    expect(join).toHaveBeenCalledWith(
      CONSTANTS.SOCKET.projectRoom(samplePayload.projectId),
    );
  });

  it('RECEIVER → hiçbir odaya katılmaz', () => {
    const { socket, join } = fakeConnSocket({
      ...samplePayload,
      role: Role.RECEIVER,
    });
    handleConnection(socket);
    expect(join).not.toHaveBeenCalled();
  });
});
