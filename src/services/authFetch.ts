import { getAuth } from 'firebase/auth';
import { auth } from '../firebase/firebaseConfig';

/**
 * Installs a fetch wrapper that attaches the signed-in user's Firebase ID token to every
 * same-origin /api request. Every protected server route requires it.
 */
export function installAuthFetch() {
  if (typeof window === 'undefined' || (window as any).__authFetchInstalled) return;
  (window as any).__authFetchInstalled = true;
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.pathname : (input as Request).url;
    const isApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
    if (!isApi) return original(input, init);

    const user = (auth || getAuth()).currentUser;
    if (!user) return original(input, init);

    const token = await user.getIdToken();
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('Authorization', `Bearer ${token}`);
    return original(input, { ...init, headers });
  };
}
