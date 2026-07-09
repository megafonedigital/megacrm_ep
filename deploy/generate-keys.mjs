#!/usr/bin/env node
/**
 * Gera os segredos do stack self-hosted e preenche o .env na raiz.
 *
 * Uso:
 *   cp deploy/.env.example .env
 *   node deploy/generate-keys.mjs
 *
 * Só preenche valores VAZIOS — nunca sobrescreve um segredo existente
 * (rodar de novo é seguro). ANON_KEY e SERVICE_ROLE_KEY são JWTs HS256
 * assinados com o JWT_SECRET, no mesmo formato do Supabase.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (!fs.existsSync(envPath)) {
  console.error("Arquivo .env não encontrado. Rode antes: cp deploy/.env.example .env");
  process.exit(1);
}

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

const alnum = (n) => crypto.randomBytes(n * 2).toString("base64url").replace(/[-_]/g, "").slice(0, n);

let env = fs.readFileSync(envPath, "utf8");

const current = {};
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) current[m[1]] = m[2];
}

function setIfEmpty(key, valueFn) {
  if (current[key]) return false;
  const value = valueFn();
  current[key] = value;
  const re = new RegExp(`^${key}=.*$`, "m");
  env = re.test(env) ? env.replace(re, `${key}=${value}`) : env + `\n${key}=${value}`;
  console.log(`  ${key} ✔`);
  return true;
}

console.log("Gerando segredos que estiverem vazios em .env:");
setIfEmpty("POSTGRES_PASSWORD", () => alnum(32));
setIfEmpty("JWT_SECRET", () => alnum(48));
setIfEmpty("SECRET_KEY_BASE", () => alnum(64));
setIfEmpty("PG_META_CRYPTO_KEY", () => alnum(32));
setIfEmpty("DASHBOARD_PASSWORD", () => alnum(20));

// JWTs dependem do JWT_SECRET final (o já existente ou o recém-gerado)
const jwtSecret = current.JWT_SECRET;
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 20 * 365 * 24 * 3600; // ~20 anos, igual ao Supabase
setIfEmpty("ANON_KEY", () => signJwt({ role: "anon", iss: "supabase", iat, exp }, jwtSecret));
setIfEmpty("SERVICE_ROLE_KEY", () =>
  signJwt({ role: "service_role", iss: "supabase", iat, exp }, jwtSecret),
);

fs.writeFileSync(envPath, env);
console.log(`\nPronto — segredos gravados em ${envPath}`);
console.log("Lembre de preencher também: SITE_URL, API_EXTERNAL_URL, SUPABASE_PUBLIC_URL (e SMTP_* se usar convites por e-mail).");
