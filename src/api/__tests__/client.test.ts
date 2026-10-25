/**
 * apiFetch contract tests: Bearer injection, {detail} unwrapping,
 * safe-parse ordering, and the 401 → unauthorized-handler chain.
 */
import * as SecureStore from 'expo-secure-store';

import { ApiError, apiFetch, setUnauthorizedHandler } from '../client';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const getItem = SecureStore.getItemAsync as jest.Mock;
const fetchMock = jest.fn();
globalThis.fetch = fetchMock;

function respond(status: number, body: string | null = '') {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body ?? ''),
  } as Response);
}

beforeEach(() => {
  jest.clearAllMocks();
  getItem.mockResolvedValue('tok123');
});

describe('apiFetch', () => {
  it('sends the stored token as a Bearer header', async () => {
    fetchMock.mockReturnValue(respond(200, '[]'));
    await apiFetch('/x');
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer tok123');
  });

  it('omits the Bearer header for auth:false requests', async () => {
    fetchMock.mockReturnValue(respond(200, '{}'));
    await apiFetch('/x', { auth: false });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it('unwraps a string {detail} into ApiError.message', async () => {
    fetchMock.mockReturnValue(respond(422, '{"detail":"title too long"}'));
    await expect(apiFetch('/x')).rejects.toMatchObject({
      status: 422,
      message: 'title too long',
    });
  });

  it('surfaces the first msg of a FastAPI validation {detail} array', async () => {
    const body = JSON.stringify({
      detail: [{ msg: 'field required' }, { msg: 'bad email' }],
    });
    fetchMock.mockReturnValue(respond(422, body));
    await expect(apiFetch('/x')).rejects.toMatchObject({
      message: 'field required',
    });
  });

  it('returns ApiError (not SyntaxError) on a non-JSON error body', async () => {
    fetchMock.mockReturnValue(respond(502, '<html>Bad Gateway</html>'));
    await expect(apiFetch('/x')).rejects.toBeInstanceOf(ApiError);
    await expect(apiFetch('/x')).rejects.not.toBeInstanceOf(SyntaxError);
  });

  it('maps network failures to ApiError(0)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(apiFetch('/x')).rejects.toMatchObject({ status: 0 });
  });

  it('returns undefined for 204 without parsing a body', async () => {
    fetchMock.mockReturnValue(respond(204, null));
    await expect(apiFetch('/x')).resolves.toBeUndefined();
  });
});

describe('401 handling', () => {
  it('fires the unauthorized handler on authed 401s', async () => {
    const onUnauthorized = jest.fn();
    setUnauthorizedHandler(onUnauthorized);
    fetchMock.mockReturnValue(respond(401, '{"detail":"expired"}'));
    await expect(apiFetch('/x')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not fire the handler for auth:false 401s', async () => {
    const onUnauthorized = jest.fn();
    setUnauthorizedHandler(onUnauthorized);
    fetchMock.mockReturnValue(respond(401, '{"detail":"bad creds"}'));
    await expect(apiFetch('/x', { auth: false })).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
