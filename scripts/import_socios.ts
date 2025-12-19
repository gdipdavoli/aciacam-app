import path from "node:path";
import dotenv from "dotenv";

dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
});

import fs from "node:fs";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";


type ReprocannEstado = "activo" | "pendiente";
type ReprocannTipo = "autocultivo" | "vinculado_ong" | "solidario";

function normalizeText(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function normalizeDni(v: any): string | null {
  const s = normalizeText(v);
  if (!s) return null;
  return s.replace(/[^\d]/g, "");
}

function normalizePhone(v: any): string | null {
  const s = normalizeText(v);
  if (!s) return null;
  return s.replace(/[^\d+]/g, "");
}

function parseDateFlexible(v: any): string | null {
  const s = normalizeText(v);
  if (!s) return null;

  const mmYY = s.match(/^(\d{1,2})\/(\d{2})$/);
  if (mmYY) {
    const mm = String(mmYY[1]).padStart(2, "0");
    const yy = Number(mmYY[2]);
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
    return `${yyyy}-${mm}-01`;
  }

  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const dd = String(dmy[1]).padStart(2, "0");
    const mm = String(dmy[2]).padStart(2, "0");
    const yyyy = dmy[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const iso = s.match(/^\d{4}-\d{2}-\d{2}$/);
  if (iso) return s;

  return null;
}

function normalizeReprocannEstado(v: any): ReprocannEstado | null {
  const s = (normalizeText(v) || "").toLowerCase();
  if (!s) return null;
  if (["ok", "activo", "vigente"].includes(s)) return "activo";
  if (["pendiente", "falta", "falta tramite", "falta trámite", "tramite", "trámite"].includes(s))
    return "pendiente";
  return null;
}

function normalizeReprocannTipo(v: any): ReprocannTipo | null {
  const s = (normalizeText(v) || "").toLowerCase();
  if (!s) return null;
  if (s.includes("autoc")) return "autocultivo";
  if (s.includes("ong")) return "vinculado_ong";
  if (s.includes("solid")) return "solidario";
  return null;
}

function toInt(v: any): number | null {
  const s = normalizeText(v);
  if (!s) return null;
  const n = Number(String(s).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const file = process.argv[2] || "socios_drive.csv";
  const full = path.resolve(process.cwd(), file);
  if (!fs.existsSync(full)) throw new Error(`CSV not found: ${full}`);

  const content = fs.readFileSync(full, "utf8");
  const delimiter = content.includes("\t") ? "\t" : ",";

  const records: any[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    delimiter,
    relax_quotes: true,
    trim: true,
  });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let ok = 0;
  let fail = 0;

  for (const [idx, r] of records.entries()) {
    const dni = normalizeDni(r["DNI"]);
    if (!dni) {
      console.error(`[row ${idx + 2}] Missing/invalid DNI, skipping`);
      fail++;
      continue;
    }

    const payload = {
      orden_libro: toInt(r["Orden de libro"]),
      acta_numero: toInt(r["Acta Nº"]),
      debe: normalizeText(r["Debe"]),
      fecha_ingreso_ong: parseDateFlexible(r["Fecha ingreso ONG"]),

      nombre: normalizeText(r["Nombre Completo"]),
      apellido: normalizeText(r["Apellido"]),
      dni,
      telefono: normalizePhone(r["Telefono"]),
      fecha_nacimiento: parseDateFlexible(r["Fecha de Naciemiento"]),
      email: normalizeText(r["Correo electronico"]),

      reprocann_num_tramite: normalizeText(r["Nº Tramite REPRO"]),
      reprocann_fecha_alta: parseDateFlexible(r["Fecha Alta"]),
      reprocann_estado: normalizeReprocannEstado(r["REPROCANN"]),
      reprocann_tipo: normalizeReprocannTipo(r["Vinculacion"]),

      medico_nombre: normalizeText(r["Medico"]),
      medico_matricula: normalizeText(r["Matricula"]),
      diagnostico: normalizeText(r["Diagnostico"]),

      contrato_valor: toInt(r["Contrato"]),
      contrato_estado: normalizeText(r["Estado del CONTRATO"]),

      localidad: normalizeText(r["Localidad/Ciudad"]),
      domicilio: normalizeText(r["Domicilio"]),
    };

    const { error } = await supabase
      .from("socios")
      .upsert(payload, { onConflict: "dni" });

    if (error) {
      console.error(`[row ${idx + 2}] Upsert failed DNI=${dni}`, error);
      fail++;
    } else {
      ok++;
    }
  }

  console.log(`Import finished. OK=${ok} FAIL=${fail} TOTAL=${records.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

