/**
 * Service worker for build-completion push notifications (issue #77).
 * Payload shape: { title, body, url } (see server/src/push/service.ts).
 */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // 不正なペイロードでも通知自体は出す。
  }
  const title = data.title || "PR Preview Orchestrator";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/favicon.svg",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
      // 既に開いているタブがあればそれを前面に出して遷移する(SPAなのでnavigateで足りる)。
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url);
          return;
        }
      }
      await clients.openWindow(url);
    })(),
  );
});
