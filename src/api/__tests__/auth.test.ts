/**
 * Auth flow tests: token persistence, hydration, the register →
 * confirm-email contract (token must NOT be stored), and logout
 * clearing local state even when the server call fails.
 */
import * as SecureStore from 'expo-secure-store';

import { clearToken, hydrateAuth, login, logout, register, setToken } from '../auth';
import { TOKEN_STORAGE_KEY } from '../client';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const getItem = SecureStore.getItemAsync as jest.Mock;
const setItem = SecureStore.setItemAsync as jest.Mock;
const deleteItem = SecureStore.deleteItemAsync as jest.Mock;
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
});

describe('token storage', () => {
  it('hydrateAuth loads the persisted token', async () => {
    getItem.mockResolvedValue('stored-tok');
    await hydrateAuth();
    expect(getItem).toHaveBeenCalledWith(TOKEN_STORAGE_KEY);
  });

  it('setToken persists to SecureStore', async () => {
    await setToken('abc');
    expect(setItem).toHaveBeenCalledWith(TOKEN_STORAGE_KEY, 'abc');
  });

  it('clearToken deletes from SecureStore', async () => {
    await clearToken();
    expect(deleteItem).toHaveBeenCalledWith(TOKEN_STORAGE_KEY);
  });
});

describe('endpoints', () => {
  it('login stores the returned token', async () => {
    fetchMock.mockReturnValue(
      respond(
        200,
        '{"access_token":"jwt1","token_type":"bearer","user":{"id":1,"username":"u","email":"e"}}',
      ),
    );
    await login('e@x.com', 'password123');
    expect(setItem).toHaveBeenCalledWith(TOKEN_STORAGE_KEY, 'jwt1');
  });

  it('login sends the email as the OAuth2 username field', async () => {
    fetchMock.mockReturnValue(
      respond(
        200,
        '{"access_token":"jwt1","token_type":"bearer","user":{"id":1,"username":"u","email":"e"}}',
      ),
    );
    await login('  E@X.com ', 'password123');
    const body = fetchMock.mock.calls[0][1].body as string;
    expect(body).toContain('username=e%40x.com');
    expect(body).toContain('password=password123');
  });

  it('register does NOT store the token (email must be confirmed first)', async () => {
    fetchMock.mockReturnValue(
      respond(
        200,
        '{"detail":"registered","access_token":"jwt9","user":{"id":2,"username":"u","email":"e@x.com"}}',
      ),
    );
    await register('u', 'e@x.com', 'password123');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('logout clears the local token even when the server call fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await logout();
    expect(deleteItem).toHaveBeenCalledWith(TOKEN_STORAGE_KEY);
  });

  it('logout clears the local token when the server call succeeds', async () => {
    fetchMock.mockReturnValue(respond(204, null));
    await logout();
    expect(deleteItem).toHaveBeenCalledWith(TOKEN_STORAGE_KEY);
  });
});
