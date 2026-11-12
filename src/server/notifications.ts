import { getMessaging } from "firebase-admin/messaging";
import { adminApp, adminDb } from "./admin";

export interface NotificationInput {
  workspaceId: string;
  uid?: string;
  email: string;
  kind: "waitlist_offer";
  title: string;
  body: string;
  url: string;
}

/**
 * In-app notification plus opt-in browser push. Anything that could not be delivered is
 * flagged so the organiser can follow up (e.g. by WhatsApp).
 */
export async function notify(n: NotificationInput) {
  const db = adminDb();
  const ref = db.collection("notifications").doc();
  let status: "delivered" | "in_app_only" | "undelivered" = n.uid
    ? "in_app_only"
    : "undelivered";
  if (n.uid) {
    const tokens = ((await db.doc(`pushTokens/${n.uid}`).get()).data()
      ?.tokens ?? []) as string[];
    if (tokens.length) {
      try {
        const res = await getMessaging(adminApp()).sendEachForMulticast({
          tokens,
          notification: { title: n.title, body: n.body },
          webpush: { fcmOptions: { link: n.url } },
        });
        if (res.successCount > 0) status = "delivered";
      } catch (err) {
        console.warn("push failed", err);
      }
    }
  }
  await ref.set({
    ...n,
    id: ref.id,
    status,
    read: false,
    createdAt: new Date().toISOString(),
  });
  return { id: ref.id, status };
}
