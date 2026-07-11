import { ref, watch } from "vue";

import { api } from "./api/client";

/**
 * Build-completion notifications (issue #77): a local chime played when a
 * build finishes, and Web Push subscription helpers. Both preferences are
 * per-browser; the sound flag lives in localStorage, the push state in the
 * browser's PushManager.
 */

const SOUND_KEY = "notifySound";

/** Whether to play a chime when a build finishes (persisted per browser). */
export const soundEnabled = ref(localStorage.getItem(SOUND_KEY) === "1");
watch(soundEnabled, (value) => {
  localStorage.setItem(SOUND_KEY, value ? "1" : "0");
});

let audioContext: AudioContext | null = null;

function playTone(ctx: AudioContext, frequency: number, start: number, duration: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  // クリックノイズを避けるため短いフェードイン/アウトを付ける。
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.2, start + 0.02);
  gain.gain.setValueAtTime(0.2, start + duration - 0.05);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

/**
 * Play a two-tone chime via the Web Audio API (no audio asset needed):
 * ascending for success, descending for failure. Silently does nothing when
 * the browser blocks audio (e.g. no prior interaction).
 */
export function playChime(kind: "success" | "failed"): void {
  try {
    audioContext ??= new AudioContext();
    void audioContext.resume();
    const now = audioContext.currentTime;
    const [first, second] = kind === "success" ? [740, 988] : [494, 330];
    playTone(audioContext, first, now, 0.18);
    playTone(audioContext, second, now + 0.2, 0.28);
  } catch {
    // 自動再生制限などで鳴らせなくても機能に影響はない。
  }
}

/** Play the build-finished chime, honoring the per-browser sound preference. */
export function playBuildSound(kind: "success" | "failed"): void {
  if (!soundEnabled.value) return;
  playChime(kind);
}

/** Why push is unavailable in this browser, or null when it can be used. */
export function pushUnsupportedReason(): string | null {
  if (!window.isSecureContext) {
    return "プッシュ通知はHTTPSまたはlocalhostでのみ利用できます。";
  }
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "このブラウザはプッシュ通知に対応していません。";
  }
  return null;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  return registration;
}

/** Whether this browser currently has an active push subscription. */
export async function getPushSubscribed(): Promise<boolean> {
  if (pushUnsupportedReason()) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return false;
  return (await registration.pushManager.getSubscription()) != null;
}

// PushManager.subscribe() の applicationServerKey はBase64URL文字列を受け付けない
// ブラウザがあるため、Uint8Arrayへ変換する。
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

/**
 * Enable push notifications: register the service worker, ask for permission,
 * subscribe with the server's (auto-generated) VAPID public key, and register
 * the subscription on the server. Throws with a user-facing message on failure.
 */
export async function enablePush(): Promise<void> {
  const reason = pushUnsupportedReason();
  if (reason) throw new Error(reason);
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("通知がブラウザで許可されませんでした。");
  }
  const registration = await getRegistration();
  const { publicKey } = await api.getPushPublicKey();
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));
  await api.subscribePush(subscription.toJSON());
}

/** Disable push notifications: unsubscribe locally and deregister on the server. */
export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await api.unsubscribePush(endpoint);
}
