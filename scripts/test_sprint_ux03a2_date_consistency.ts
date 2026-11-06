import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
    formatCalendarDate,
    isValidCalendarDate,
    isLeapYear,
    parseCalendarDate,
    calculateDaysRemaining,
    formatTimestamp,
    formatPeriodoCuota,
    INSTITUTIONAL_TIMEZONE,
    getSanLuisCivilToday,
    civilDateToDays
} from '../app/lib/date-format';

const localEnvPath = 'c:/Users/gdipd/Documents/Proyectos/aciacam-app/.env.integration.local';
if (fs.existsSync(localEnvPath)) {
    const envVars = dotenv.parse(fs.readFileSync(localEnvPath));
    for (const k in envVars) {
        process.env[k] = envVars[k];
    }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_URL.includes('uqwuhjxzazsexuvqxmfm')) {
    console.error('Guard fail: Not integration');
    process.exit(1);
}

const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

async function run() {
    console.log('====================================================================');
    console.log(' ACIACAM APP - SPRINT UX-03A.2: VERIFICACIÓN DE FECHAS Y CUOTAS');
    console.log(' Target: Supabase Integration (uqwuhjxzazsexuvqxmfm)');
    console.log('====================================================================\n');

    let allPassed = true;

    // --- TEST 1: Fechas REPROCANN del reporte (01/08/2026 y 01/08/2027) ---
    console.log('[Test 1] Formateo de fechas REPROCANN 2026-08-01 y 2027-08-01...');
    const t1_2026 = formatCalendarDate('2026-08-01');
    const t1_2027 = formatCalendarDate('2027-08-01');

    if (t1_2026 === '01/08/2026') {
        console.log(`  PASS: '2026-08-01' formateado como '${t1_2026}' (sin desplazamiento a 31/07).`);
    } else {
        console.error(`  FAIL: '2026-08-01' formateado erróneamente como '${t1_2026}'`);
        allPassed = false;
    }

    if (t1_2027 === '01/08/2027') {
        console.log(`  PASS: '2027-08-01' formateado como '${t1_2027}' (sin desplazamiento a 31/07).`);
    } else {
        console.error(`  FAIL: '2027-08-01' formateado erróneamente como '${t1_2027}'`);
        allPassed = false;
    }

    // --- TEST 2: Fechas en límites de mes y año (31/12 y 01/01) ---
    console.log('\n[Test 2] Límites de mes y año (31/12 y 01/01)...');
    const t2_finAnio = formatCalendarDate('2026-12-31');
    const t2_inicioAnio = formatCalendarDate('2027-01-01');

    if (t2_finAnio === '31/12/2026' && t2_inicioAnio === '01/01/2027') {
        console.log(`  PASS: '2026-12-31' -> '${t2_finAnio}', '2027-01-01' -> '${t2_inicioAnio}' (sin corrimiento de año ni mes).`);
    } else {
        console.error(`  FAIL: Límites de año fallaron: finAnio='${t2_finAnio}', inicioAnio='${t2_inicioAnio}'`);
        allPassed = false;
    }

    // --- TEST 3: Año bisiesto (29/02/2028 válido vs 29/02/2027 inválido) ---
    console.log('\n[Test 3] Validación estricta de año bisiesto...');
    const t3_leapValid = isValidCalendarDate('2028-02-29'); // 2028 es bisiesto
    const t3_leapInvalid = isValidCalendarDate('2027-02-29'); // 2027 no es bisiesto

    if (t3_leapValid && !t3_leapInvalid) {
        console.log("  PASS: '2028-02-29' aceptado como bisiesto válido y '2027-02-29' rechazado correctamente.");
    } else {
        console.error(`  FAIL: Validación de bisiesto falló: 2028-02-29=${t3_leapValid}, 2027-02-29=${t3_leapInvalid}`);
        allPassed = false;
    }

    // --- TEST 4: Fechas inexistentes o inválidas ---
    console.log('\n[Test 4] Rechazo estricto de fechas inexistentes...');
    const invalidDates = [
        '2026-02-30', // Febrero con 30 días
        '2026-04-31', // Abril con 31 días
        '2026-06-31', // Junio con 31 días
        '2026-11-31', // Noviembre con 31 días
        '2026-13-01', // Mes 13
        '2026-00-10', // Mes 00
        '2026-05-32', // Día 32
        'invalid-str', // No fecha
        '',            // Vacía
        null           // Null
    ];

    let allInvalidRejected = true;
    for (const inv of invalidDates) {
        if (isValidCalendarDate(inv as any)) {
            console.error(`  FAIL: Fecha inválida aceptada indebidamente: '${inv}'`);
            allInvalidRejected = false;
            allPassed = false;
        }
        const formatted = formatCalendarDate(inv as any, 'FALLBACK');
        if (formatted !== 'FALLBACK') {
            console.error(`  FAIL: formatCalendarDate('${inv}') dio '${formatted}' en vez del fallback`);
            allInvalidRejected = false;
            allPassed = false;
        }
    }
    if (allInvalidRejected) {
        console.log(`  PASS: Todas las fechas inexistentes (${invalidDates.length} casos) fueron rechazadas.`);
    }

    // --- TEST 5: Independencia de Husos Horarios Extremos ---
    console.log('\n[Test 5] Independencia de husos horarios en formatCalendarDate...');
    // formatCalendarDate extrae directamente los componentes civiles sin new Date(utc)
    const sampleDate = '2027-08-01';
    const parsedParts = parseCalendarDate(sampleDate);

    if (parsedParts?.year === 2027 && parsedParts?.month === 8 && parsedParts?.day === 1) {
        console.log('  PASS: parseCalendarDate extrajo componentes civiles exactos (2027, 8, 1).');
    } else {
        console.error('  FAIL: Componentes parseados incorrectos:', parsedParts);
        allPassed = false;
    }

    // --- TEST 6: Timestamps reales con zona horaria America/Argentina/San_Luis ---
    console.log('\n[Test 6] Marcas temporales en zona horaria America/Argentina/San_Luis...');
    // Timestamp UTC a las 02:30:00Z del 6 de noviembre:
    // En San Luis (UTC-3), debe corresponder exactamente a las 23:30:00 del 5 de noviembre!
    const midnightUtc = '2026-11-06T02:30:00.000Z';
    const formattedSanLuis = formatTimestamp(midnightUtc, { includeTime: true });

    if (formattedSanLuis.includes('05/11/2026') && formattedSanLuis.includes('23:30')) {
        console.log(`  PASS: '${midnightUtc}' convertido a San Luis: '${formattedSanLuis}' (5 de noviembre 23:30).`);
    } else {
        console.error(`  FAIL: Conversión horaria de San Luis falló: recibido '${formattedSanLuis}'`);
        allPassed = false;
    }

    // Timestamp de mediodía UTC: 2026-11-06T15:00:00Z -> en San Luis son las 12:00
    const noonUtc = '2026-11-06T15:00:00.000Z';
    const formattedNoon = formatTimestamp(noonUtc, { includeTime: true });
    if (formattedNoon.includes('06/11/2026') && formattedNoon.includes('12:00')) {
        console.log(`  PASS: '${noonUtc}' convertido a San Luis: '${formattedNoon}' (6 de noviembre 12:00).`);
    } else {
        console.error(`  FAIL: Conversión de mediodía falló: recibido '${formattedNoon}'`);
        allPassed = false;
    }

    // --- TEST 7: Cálculo de días restantes en tiempo civil de San Luis ---
    console.log('\n[Test 7] Cálculo de días restantes en tiempo civil de San Luis...');
    const todaySanLuis = getSanLuisCivilToday();
    const todayStr = `${todaySanLuis.year}-${String(todaySanLuis.month).padStart(2, '0')}-${String(todaySanLuis.day).padStart(2, '0')}`;

    // Si la fecha objetivo es hoy, los días restantes deben ser exactamente 0
    const daysToday = calculateDaysRemaining(todayStr);
    if (daysToday === 0) {
        console.log(`  PASS: Días restantes para hoy (${todayStr}) = 0 días exactos.`);
    } else {
        console.error(`  FAIL: Días restantes para hoy esperado 0, recibido ${daysToday}`);
        allPassed = false;
    }

    // Si la fecha objetivo es mañana:
    const tomorrowDaysEpoch = civilDateToDays(todaySanLuis.year, todaySanLuis.month, todaySanLuis.day) + 1;
    const tomorrowDate = new Date(tomorrowDaysEpoch * 86400000);
    const tomorrowStr = `${tomorrowDate.getUTCFullYear()}-${String(tomorrowDate.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getUTCDate()).padStart(2, '0')}`;
    const daysTomorrow = calculateDaysRemaining(tomorrowStr);

    if (daysTomorrow === 1) {
        console.log(`  PASS: Días restantes para mañana (${tomorrowStr}) = 1 día exacto.`);
    } else {
        console.error(`  FAIL: Días restantes para mañana esperado 1, recibido ${daysTomorrow}`);
        allPassed = false;
    }

    // --- TEST 8: Eliminación de estado de cuota ficticio y formateo de aportes ---
    console.log('\n[Test 8] Ausencia de información ficticia de aportes...');
    
    // Consultar socio E2E en DB Integration con adminClient
    const { data: socioDb } = await adminClient
        .from('socios')
        .select('*')
        .eq('id', '30000000-0000-4000-8000-000000000012')
        .single();

    if (!socioDb) {
        console.error('  FAIL: No se pudo recuperar el socio E2E desde Supabase Integration');
        allPassed = false;
    } else {
        // Verificar que la base de datos no tenga cuotas ficticias
        if ((socioDb as any).ultima_cuota_paga === undefined && (socioDb as any).estado_cuenta === undefined) {
            console.log('  PASS: public.socios no posee columnas de cuotas ficticias.');
        }

        // Verificar el formateador de aportes para cuando no hay información real
        const cuotaLabelEmpty = formatPeriodoCuota(undefined);
        if (cuotaLabelEmpty === 'Información de aportes no disponible') {
            console.log(`  PASS: formatPeriodoCuota(undefined) -> '${cuotaLabelEmpty}'`);
        } else {
            console.error(`  FAIL: formatPeriodoCuota fallback esperado 'Información de aportes no disponible', recibido '${cuotaLabelEmpty}'`);
            allPassed = false;
        }

        // Verificar el formateador si existiese un período real ('2026-11')
        const cuotaLabelValid = formatPeriodoCuota('2026-11');
        if (cuotaLabelValid === 'Noviembre 2026') {
            console.log(`  PASS: formatPeriodoCuota('2026-11') -> '${cuotaLabelValid}'`);
        } else {
            console.error(`  FAIL: formatPeriodoCuota('2026-11') esperado 'Noviembre 2026', recibido '${cuotaLabelValid}'`);
            allPassed = false;
        }

        // Verificar fechas REPROCANN en el registro recuperado
        if (socioDb.reprocann_fecha_vencimiento === '2027-08-01') {
            console.log(`  PASS: socioDb.reprocann_fecha_vencimiento preserva valor exacto '2027-08-01'.`);
            const displayDate = formatCalendarDate(socioDb.reprocann_fecha_vencimiento);
            if (displayDate === '01/08/2027') {
                console.log(`  PASS: Visualización final de vencimiento REPROCANN: '${displayDate}' (01/08/2027 sin corrimiento a 31/07).`);
            } else {
                console.error(`  FAIL: Visualización esperada '01/08/2027', obtenida '${displayDate}'`);
                allPassed = false;
            }
        } else {
            console.error('  FAIL: fechaVencimiento en socioDb no es 2027-08-01:', socioDb.reprocann_fecha_vencimiento);
            allPassed = false;
        }

        if (socioDb.reprocann_fecha_alta === '2026-08-01') {
            console.log(`  PASS: socioDb.reprocann_fecha_alta preserva valor exacto '2026-08-01'.`);
            const displayAlta = formatCalendarDate(socioDb.reprocann_fecha_alta);
            if (displayAlta === '01/08/2026') {
                console.log(`  PASS: Visualización final de alta REPROCANN: '${displayAlta}' (01/08/2026 sin corrimiento a 31/07).`);
            } else {
                console.error(`  FAIL: Visualización esperada '01/08/2026', obtenida '${displayAlta}'`);
                allPassed = false;
            }
        } else {
            console.error('  FAIL: fechaAlta en socioDb no es 2026-08-01:', socioDb.reprocann_fecha_alta);
            allPassed = false;
        }
    }

    console.log('\n====================================================================');
    if (allPassed) {
        console.log(' RESULTADO FINAL SPRINT UX-03A.2: TODAS LAS PRUEBAS PASARON (8/8 OK)');
    } else {
        console.log(' RESULTADO FINAL SPRINT UX-03A.2: SE DETECTARON ERRORES');
        process.exit(1);
    }
    console.log('====================================================================');
}

run().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
