import type { Capture, EventData } from './engagement';

declare global {
  interface Window { umami?: { track: (name: string, data: EventData) => Promise<unknown> | void } }
}

export function loadAnalytics(): Capture {
  const website = import.meta.env.VITE_UMAMI_WEBSITE_ID, source = import.meta.env.VITE_UMAMI_SCRIPT_URL;
  const allowed = ['longjump.ing', 'www.longjump.ing'];
  if (!import.meta.env.PROD || !allowed.includes(location.hostname) || !website || !source ||
    navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return () => {};
  let url: URL;
  try { url = new URL(source); if (url.protocol !== 'https:') return () => {}; } catch { return () => {}; }
  let pending: { name: string; data: EventData }[] = [], failed = false;
  const send: Capture = (name, data) => {
    try { void Promise.resolve(window.umami?.track(name, data)).catch(() => {}); } catch { /* Tracker unavailable. */ }
  };
  const script = document.createElement('script');
  script.src = url.href; script.async = true;
  script.dataset.websiteId = website; script.dataset.domains = allowed.join(',');
  script.dataset.excludeSearch = 'true'; script.dataset.excludeHash = 'true'; script.dataset.doNotTrack = 'true';
  script.onload = () => { const queued = pending; pending = []; queued.forEach(event => send(event.name, event.data)); };
  script.onerror = () => { failed = true; pending = []; };
  document.head.append(script);
  return (name, data) => {
    if (failed) return;
    if (window.umami) send(name, data);
    else if (pending.length < 100) pending.push({ name, data });
  };
}
