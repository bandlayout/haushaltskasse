// Haushaltskasse – Push-Benachrichtigungen
// GET  ?action=vapid            → öffentlicher VAPID-Schlüssel für die App
// GET  ?t=<token>               → Kurzbefehl „In der Nähe eines Ladens“: schickt die offene Einkaufsliste per Push an den Besitzer des Tokens
// POST {action:"notify",title,body,tag}  (mit Login) → Push an die andere Person
// POST {action:"test"}                   (mit Login) → Test-Push an sich selbst
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const APP_URL = "https://bandlayout.github.io/haushaltskasse/";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...cors, "Content-Type": "application/json" } });
const text = (t: string, status = 200) =>
  new Response(t, { status, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

let vapid: { publicKey: string; privateKey: string } | null = null;
async function getVapid() {
  if (vapid) return vapid;
  const { data } = await admin.from("app_secrets").select("name,value").in("name", ["vapid_public", "vapid_private"]);
  const m = Object.fromEntries((data ?? []).map((r) => [r.name, r.value]));
  if (m.vapid_public && m.vapid_private) {
    vapid = { publicKey: m.vapid_public, privateKey: m.vapid_private };
  } else {
    const k = webpush.generateVAPIDKeys();
    await admin.from("app_secrets").upsert([
      { name: "vapid_public", value: k.publicKey },
      { name: "vapid_private", value: k.privateKey },
    ], { onConflict: "name", ignoreDuplicates: true });
    const { data: again } = await admin.from("app_secrets").select("name,value").in("name", ["vapid_public", "vapid_private"]);
    const m2 = Object.fromEntries((again ?? []).map((r) => [r.name, r.value]));
    vapid = { publicKey: m2.vapid_public, privateKey: m2.vapid_private };
  }
  webpush.setVapidDetails("mailto:plust11@web.de", vapid.publicKey, vapid.privateKey);
  return vapid;
}

async function sendTo(person: string, payload: Record<string, unknown>) {
  await getVapid();
  const { data: subs } = await admin.from("push_subscriptions").select("*").eq("person", person);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 12, urgency: "normal" },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("push failed", code, (e as Error).message);
    }
  }
  return { sent, devices: subs?.length ?? 0 };
}

async function shoppingText() {
  const { data } = await admin.from("shopping").select("text").eq("done", false).order("created_at");
  return (data ?? []).map((r) => r.text);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);

  try {
    if (url.searchParams.get("action") === "vapid") {
      return json({ publicKey: (await getVapid()).publicKey });
    }

    const token = url.searchParams.get("t");
    if (token) {
      const { data: tok } = await admin.from("member_tokens").select("email").eq("token", token).maybeSingle();
      if (!tok) return text("Unbekannter Schlüssel.", 403);
      const { data: mem } = await admin.from("members").select("person").eq("email", tok.email).maybeSingle();
      if (!mem) return text("Kein Mitglied.", 403);
      const items = await shoppingText();
      if (!items.length) return text("Die Einkaufsliste ist leer.");
      const body = items.join(", ");
      const shop = url.searchParams.get("laden");
      const res = await sendTo(mem.person, {
        title: shop ? `Du bist bei ${shop.slice(0, 40)}` : "Einkaufsliste",
        body: `Was noch zu besorgen wäre: ${body}`,
        tag: "einkauf-hinweis",
        url: APP_URL + "#einkauf",
      });
      return text(`Was noch zu besorgen wäre: ${body}` + (res.sent ? "" : "\n(Kein Gerät für Push angemeldet.)"));
    }

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(jwt);
    const email = u?.user?.email?.toLowerCase();
    if (!email) return json({ error: "nicht angemeldet" }, 401);
    const { data: me } = await admin.from("members").select("person").eq("email", email).maybeSingle();
    if (!me) return json({ error: "kein Mitglied" }, 403);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

    if (body.action === "test") {
      return json(await sendTo(me.person, {
        title: "Haushaltskasse",
        body: "Push funktioniert auf diesem Gerät.",
        tag: "test",
        url: APP_URL,
      }));
    }
    if (body.action === "notify") {
      const other = me.person === "a" ? "b" : "a";
      return json(await sendTo(other, {
        title: clip(body.title, 80) || "Haushaltskasse",
        body: clip(body.body, 300),
        tag: clip(body.tag, 40) || undefined,
        url: APP_URL + (/^#[a-z]+$/.test(String(body.hash ?? "")) ? body.hash : ""),
      }));
    }
    return json({ error: "unbekannte Aktion" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Serverfehler" }, 500);
  }
});
