// Einkaufi - Ausgebi – Philips Hue (Licht-Fernbedienung über die Hue-Cloud, „Remote API“)
// Die App läuft über https und kann die Bridge im WLAN nicht direkt ansprechen – deshalb der Weg über die Hue-Cloud.
// Zugangsdaten und Tokens liegen in app_secrets (nur Service-Role):
//   hue_client_id, hue_client_secret   – aus developers.meethue.com (Remote Hue API App)
//   hue_access, hue_refresh, hue_expires, hue_appkey, hue_state – setzt diese Funktion selbst
// Callback-URL der Hue-App: https://ckytrjxyplgqpphgmzvu.supabase.co/functions/v1/hue
//
// GET  ?code=…&state=…        → Rückkehr vom Hue-Login, verbindet und springt zurück in die App (#licht)
// POST {action:"status"}      → { configured, connected }
// POST {action:"login"}       → { url } zum Hue-Login
// POST {action:"rooms"}       → Räume/Zonen mit Zustand und Szenen
// POST {action:"set", id, on?, brightness?, mirek?, xy?} → grouped_light schalten
// POST {action:"scene", id}   → Szene aktivieren
// POST {action:"disconnect"}  → Verbindung trennen
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const APP_URL = "https://bandlayout.github.io/haushaltskasse/";
const HUE = "https://api.meethue.com";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...cors, "Content-Type": "application/json" } });
const back = (msg: string) => Response.redirect(APP_URL + "#licht" + (msg ? "?hue=" + encodeURIComponent(msg) : ""), 302);

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

async function secrets(): Promise<Record<string, string>> {
  const { data } = await admin.from("app_secrets").select("name,value").like("name", "hue_%");
  return Object.fromEntries((data ?? []).map((r) => [r.name, r.value]));
}
async function save(values: Record<string, string>) {
  await admin.from("app_secrets").upsert(Object.entries(values).map(([name, value]) => ({ name, value })), { onConflict: "name" });
}
async function forget(names: string[]) {
  await admin.from("app_secrets").delete().in("name", names);
}

// Token holen (Code) oder erneuern (Refresh)
async function token(s: Record<string, string>, body: Record<string, string>) {
  const r = await fetch(HUE + "/v2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(s.hue_client_id + ":" + s.hue_client_secret),
    },
    body: new URLSearchParams(body),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) throw new Error("Hue-Anmeldung fehlgeschlagen (" + r.status + ")");
  const values = {
    hue_access: t.access_token,
    hue_refresh: t.refresh_token ?? s.hue_refresh ?? "",
    hue_expires: String(Date.now() + (Number(t.expires_in) || 3600) * 1000),
  };
  await save(values);
  return { ...s, ...values };
}

async function access() {
  let s = await secrets();
  if (!s.hue_access || !s.hue_appkey) throw new Error("not_connected");
  if (Date.now() > Number(s.hue_expires || 0) - 5 * 60 * 1000) s = await token(s, { grant_type: "refresh_token", refresh_token: s.hue_refresh });
  return s;
}

async function clip(method: string, path: string, body?: unknown) {
  const s = await access();
  const r = await fetch(HUE + "/route/clip/v2/resource/" + path, {
    method,
    headers: { Authorization: "Bearer " + s.hue_access, "hue-application-key": s.hue_appkey, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.errors?.[0]?.description || "Hue antwortet mit " + r.status);
  return d.data ?? [];
}

async function rooms() {
  const [rs, zs, gl, sc] = await Promise.all([clip("GET", "room"), clip("GET", "zone"), clip("GET", "grouped_light"), clip("GET", "scene")]);
  const glById = new Map(gl.map((g: any) => [g.id, g]));
  const group = (x: any, kind: string) => {
    const lightRef = (x.services || []).find((v: any) => v.rtype === "grouped_light");
    const g: any = lightRef && glById.get(lightRef.rid);
    return {
      id: x.id,
      kind,
      name: x.metadata?.name || "Ohne Namen",
      archetype: x.metadata?.archetype || null,
      light: g ? { id: g.id, on: !!g.on?.on, brightness: g.dimming?.brightness ?? null } : null,
      scenes: sc
        .filter((s: any) => s.group?.rid === x.id)
        .map((s: any) => ({ id: s.id, name: s.metadata?.name || "Szene", active: s.status?.active && s.status.active !== "inactive" }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name, "de")),
    };
  };
  return [...rs.map((x: any) => group(x, "room")), ...zs.map((x: any) => group(x, "zone"))]
    .filter((x) => x.light)
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, "de") : a.kind === "room" ? -1 : 1));
}

async function member(req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(jwt);
  const email = u?.user?.email;
  if (!email) return null;
  const { data: me } = await admin.from("members").select("person").eq("email", email).maybeSingle();
  return me ? email : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);

  // Rückkehr vom Hue-Login
  if (req.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code) return back(url.searchParams.get("error") ? "abgebrochen" : "");
    try {
      let s = await secrets();
      const [st, exp] = (s.hue_state || "").split("|");
      if (!st || st !== state || Date.now() > Number(exp)) return back("abgelaufen");
      await forget(["hue_state"]);
      s = await token(s, { grant_type: "authorization_code", code });
      // App-Schlüssel an der Bridge anlegen (per Cloud „Link-Knopf drücken“)
      const h = { Authorization: "Bearer " + s.hue_access, "Content-Type": "application/json" };
      await fetch(HUE + "/route/api/0/config", { method: "PUT", headers: h, body: JSON.stringify({ linkbutton: true }) });
      const r = await fetch(HUE + "/route/api", { method: "POST", headers: h, body: JSON.stringify({ devicetype: "einkaufi#app" }) });
      const d = await r.json().catch(() => null);
      const key = Array.isArray(d) ? d[0]?.success?.username : null;
      if (!key) return back("bridge");
      await save({ hue_appkey: key });
      return back("ok");
    } catch (e) {
      console.error("hue callback", e);
      return back("fehler");
    }
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!(await member(req))) return json({ error: "Nicht angemeldet." }, 401);
  const b = await req.json().catch(() => ({}));
  try {
    const s = await secrets();
    switch (b.action) {
      case "status":
        return json({ configured: !!(s.hue_client_id && s.hue_client_secret), connected: !!(s.hue_access && s.hue_appkey) });
      case "login": {
        if (!s.hue_client_id) return json({ error: "Hue ist noch nicht eingerichtet (Client-ID fehlt)." }, 400);
        const state = crypto.randomUUID();
        await save({ hue_state: state + "|" + (Date.now() + 15 * 60 * 1000) });
        const q = new URLSearchParams({ client_id: s.hue_client_id, response_type: "code", state });
        return json({ url: HUE + "/v2/oauth2/authorize?" + q });
      }
      case "rooms":
        return json({ rooms: await rooms() });
      case "set": {
        const body: Record<string, unknown> = {};
        if (typeof b.on === "boolean") body.on = { on: b.on };
        if (typeof b.brightness === "number") body.dimming = { brightness: Math.max(1, Math.min(100, b.brightness)) };
        if (typeof b.mirek === "number") body.color_temperature = { mirek: Math.max(153, Math.min(500, Math.round(b.mirek))) };
        if (b.xy && typeof b.xy.x === "number") body.color = { xy: { x: b.xy.x, y: b.xy.y } };
        await clip("PUT", "grouped_light/" + encodeURIComponent(b.id), body);
        return json({ ok: true });
      }
      case "scene":
        await clip("PUT", "scene/" + encodeURIComponent(b.id), { recall: { action: "active" } });
        return json({ ok: true });
      case "disconnect":
        await forget(["hue_access", "hue_refresh", "hue_expires", "hue_appkey", "hue_state"]);
        return json({ ok: true });
      default:
        return json({ error: "Unbekannte Aktion." }, 400);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "not_connected") return json({ error: "Hue ist nicht verbunden.", notConnected: true }, 409);
    console.error("hue", e);
    return json({ error: msg }, 502);
  }
});
