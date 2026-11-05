# scripts/set_integration_test_passwords.ps1
# ==============================================================================
# ACIACAM - Configuracion e Inicio de Sesion de Usuarios de Prueba en Integration
# ==============================================================================
# Este script permite al operador humano configurar de manera segura y enmascarada
# la contrasena temporal para los tres perfiles de prueba sinteticos en Supabase Integration.
#
# Principios de Seguridad Estrictos:
# 1. Cero contrasenas en Git, scripts, logs o pantalla (entrada enmascarada con asteriscos).
# 2. Exclusivamente Supabase Integration (uqwuhjxzazsexuvqxmfm).
# 3. Guardas infranqueables contra Produccion (wfzbkcdmlcrjyrtauccu).
# 4. Modifica unicamente los 3 UIDs sinteticos autorizados; no toca cuentas reales ni roles.
# 5. La clave administrativa no se exporta a variables de entorno del proceso (no fuga a subprocesos).
# 6. Modo -DryRun para validacion y simulacion sin modificar contrasenas.
# 7. Modo -VerifyOnly para verificar logins existentes sin re-modificar contrasenas.
# 8. Verificacion automatizada de login en memoria sin persistir secretos.
# 9. Compatibilidad 100% con Windows PowerShell 5.1 (formato ASCII estricto).
# ==============================================================================

[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  ACIACAM - Configuracion Segura de Contrasenas de Prueba (E2E)" -ForegroundColor Cyan
Write-Host "  Entorno: Supabase Integration (uqwuhjxzazsexuvqxmfm)" -ForegroundColor Cyan
if ($DryRun) {
    Write-Host "  MODO: SIMULACION / DRY-RUN (CERO MODIFICACIONES)" -ForegroundColor Yellow
}
elseif ($VerifyOnly) {
    Write-Host "  MODO: SOLO VERIFICACION (SIN MODIFICACION DE CONTRASENAS)" -ForegroundColor Yellow
}
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Cargar variables de entorno exclusivas de Integration en variables locales (sin contaminar Process Env)
$envFile = Join-Path $PSScriptRoot "..\.env.integration.local"
if (-not (Test-Path $envFile)) {
    Write-Error "No se encontro el archivo .env.integration.local. Abortando."
    exit 1
}

$supabaseUrl = $null
$serviceKey = $null
$anonKey = $null

Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#")) {
        $parts = $line.Split("=", 2)
        if ($parts.Length -eq 2) {
            $k = $parts[0].Trim()
            $v = $parts[1].Trim().Trim('"').Trim("'")
            if ($k -eq "NEXT_PUBLIC_SUPABASE_URL" -or $k -eq "SUPABASE_URL") { $supabaseUrl = $v }
            if ($k -eq "SUPABASE_SERVICE_ROLE_KEY") { $serviceKey = $v }
            if ($k -eq "NEXT_PUBLIC_SUPABASE_ANON_KEY") { $anonKey = $v }
        }
    }
}

# 2. Guardas estrictas de aislamiento de entorno
if (-not $supabaseUrl -or -not $serviceKey -or -not $anonKey) {
    Write-Error "Variables de entorno de Integration incompletas en .env.integration.local."
    exit 1
}

if ($supabaseUrl -like "*wfzbkcdmlcrjyrtauccu*") {
    Write-Error "CRITICAL: Intento de conexion a PRODUCCION detectado. Operacion cancelada inmediatamente."
    exit 1
}

if ($supabaseUrl -notlike "*uqwuhjxzazsexuvqxmfm*") {
    Write-Error "CRITICAL: La URL no pertenece al proyecto Integration (uqwuhjxzazsexuvqxmfm). Operacion cancelada."
    exit 1
}

Write-Host "[OK] Guardas de entorno superadas: Supabase Integration activo." -ForegroundColor Green

# 3. Definicion de perfiles de prueba sinteticos autorizados
$TARGET_USERS = @(
    @{
        Label        = "Administrador"
        Email        = "e2e-admin-sprint5@aciacam-test.invalid"
        AuthUserId   = "30000000-0000-4000-8000-000000000001"
        ExpectedRole = "admin"
    },
    @{
        Label        = "Socio"
        Email        = "e2e-socio-sprint5@aciacam-test.invalid"
        AuthUserId   = "30000000-0000-4000-8000-000000000002"
        ExpectedRole = "socio"
    },
    @{
        Label        = "Staff"
        Email        = "e2e-staff-b-sprint5@aciacam-test.invalid"
        AuthUserId   = "59b609a6-81b7-41cb-9f80-e0436049795b"
        ExpectedRole = "staff"
    }
)

$adminHeaders = @{
    "apikey"        = $serviceKey
    "Authorization" = "Bearer $serviceKey"
    "Content-Type"  = "application/json"
}

# 4. Verificacion previa de UIDs y vinculaciones de solo lectura
Write-Host ""
Write-Host "Verificando UIDs y vinculaciones de solo lectura antes de operar..." -ForegroundColor Yellow

foreach ($u in $TARGET_USERS) {
    # 4.1 Verificar en auth.users
    try {
        $userUri = $supabaseUrl + "/auth/v1/admin/users/" + $u.AuthUserId
        $authRes = Invoke-RestMethod -Uri $userUri -Method Get -Headers $adminHeaders
        if ($authRes.email.ToLower() -ne $u.Email.ToLower()) {
            Write-Error "Discrepancia en email para $($u.Label): esperado $($u.Email), encontrado $($authRes.email)"
            exit 1
        }
        if (-not $authRes.email_confirmed_at) {
            Write-Error "El usuario $($u.Label) no tiene email confirmado en auth.users."
            exit 1
        }
    }
    catch {
        Write-Error "No se pudo recuperar $($u.Label) ($($u.AuthUserId)) de auth.users: $_"
        exit 1
    }

    # 4.2 Verificar en public.socios
    try {
        $socioUrl = $supabaseUrl + "/rest/v1/socios?auth_user_id=eq." + $u.AuthUserId + "&select=id,rol,status,bloqueado"
        $socioRes = Invoke-RestMethod -Uri $socioUrl -Method Get -Headers $adminHeaders
        $items = @($socioRes)
        if ($items.Count -eq 0) {
            Write-Error "Socio no vinculado en public.socios para $($u.Label) ($($u.Email))."
            exit 1
        }
        $s = $items[0]
        if ($s.rol -ne $u.ExpectedRole -or $s.status -ne "active" -or $s.bloqueado -eq $true) {
            Write-Error "Estado o rol inconsistente en public.socios para $($u.Label): rol=$($s.rol), status=$($s.status), bloqueado=$($s.bloqueado)"
            exit 1
        }
        Write-Host "  -> [OK] $($u.Label): Auth UID ($($u.AuthUserId)) y Socio ($($s.rol), activo, no bloqueado) verificados." -ForegroundColor Gray
    }
    catch {
        Write-Error "Error consultando public.socios para $($u.Label): $_"
        exit 1
    }
}

Write-Host "[OK] Todos los perfiles pre-verificados correctamente." -ForegroundColor Green
Write-Host ""

# 5. Modo Dry-Run: Si fue invocado con -DryRun, finalizar aqui sin solicitar contrasenas
if ($DryRun) {
    Write-Host "==================================================================" -ForegroundColor Yellow
    Write-Host "  RESULTADO DE LA SIMULACION DRY-RUN: EXITOSO" -ForegroundColor Yellow
    Write-Host "==================================================================" -ForegroundColor Yellow
    Write-Host "- Entorno verificado: Exclusivamente Supabase Integration (uqwuhjxzazsexuvqxmfm)." -ForegroundColor Gray
    Write-Host "- Conexion a Produccion bloqueada: Si (wfzbkcdmlcrjyrtauccu no es el destino)." -ForegroundColor Gray
    Write-Host "- UIDs autorizados verificados en auth.users: 3/3." -ForegroundColor Gray
    Write-Host "- Perfiles autorizados verificados en public.socios: 3/3." -ForegroundColor Gray
    Write-Host "- Roles en DB respetados: admin, socio, staff (activos, no bloqueados)." -ForegroundColor Gray
    Write-Host "- Clave administrativa no propagada a subprocesos: Si." -ForegroundColor Gray
    Write-Host "- Cero modificaciones ejecutadas en usuarios o contrasenas." -ForegroundColor Gray
    Write-Host ""
    Write-Host "El script esta validado y listo para ejecucion interactiva." -ForegroundColor Green
    exit 0
}

# 6. Entrada segura y enmascarada de la contrasena
if ($VerifyOnly) {
    Write-Host "==================================================================" -ForegroundColor Cyan
    Write-Host "  INGRESO DE CONTRASENA PARA VERIFICACION (Entrada Enmascarada)" -ForegroundColor Cyan
    Write-Host "  La contrasena se valida contra Supabase Auth sin guardarse." -ForegroundColor Gray
    Write-Host "==================================================================" -ForegroundColor Cyan
    Write-Host ""

    $secPass = Read-Host -Prompt "Ingrese la contrasena temporal configurada para verificar el login" -AsSecureString
}
else {
    Write-Host "==================================================================" -ForegroundColor Cyan
    Write-Host "  INGRESO DE CONTRASENA TEMPORAL COMUN (Entrada Enmascarada)" -ForegroundColor Cyan
    Write-Host "  La contrasena se ingresa una sola vez, en memoria local y nunca se muestra." -ForegroundColor Gray
    Write-Host "==================================================================" -ForegroundColor Cyan
    Write-Host ""

    $secPass = Read-Host -Prompt "Ingrese la nueva contrasena temporal (minimo 8 caracteres)" -AsSecureString
    $secPassConfirm = Read-Host -Prompt "Confirme la contrasena temporal" -AsSecureString

    $bstr1 = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPass)
    $plain1 = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr1)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr1)

    $bstr2 = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPassConfirm)
    $plain2 = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr2)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr2)

    if ($plain1 -ne $plain2) {
        $plain1 = $null
        $plain2 = $null
        Write-Error "Las contrasenas no coinciden. Operacion abortada sin cambios."
        exit 1
    }

    if ($plain1.Length -lt 8) {
        $plain1 = $null
        $plain2 = $null
        Write-Error "La contrasena debe tener al menos 8 caracteres. Operacion abortada sin cambios."
        exit 1
    }

    # 7. Actualizacion controlada mediante Supabase Auth Admin API
    Write-Host ""
    Write-Host "Aplicando contrasena a los 3 perfiles sinteticos en Supabase Integration..." -ForegroundColor Yellow

    foreach ($u in $TARGET_USERS) {
        $updatePayload = @{
            "password" = $plain1
        } | ConvertTo-Json

        try {
            $updateUri = $supabaseUrl + "/auth/v1/admin/users/" + $u.AuthUserId
            $updateRes = Invoke-RestMethod -Uri $updateUri -Method Put -Headers $adminHeaders -Body $updatePayload
            Write-Host "  -> [OK] Contrasena actualizada para $($u.Label) ($($u.Email))" -ForegroundColor Green
        }
        catch {
            $plain1 = $null
            $plain2 = $null
            Write-Error "Falla actualizando contrasena para $($u.Label): $_"
            exit 1
        }
    }

    # 8. Limpieza inmediata de memoria de la contrasena
    $plain1 = $null
    $plain2 = $null
    [System.GC]::Collect()

    Write-Host ""
    Write-Host "Memoria de credencial saneada." -ForegroundColor Gray
    Write-Host ""
}

# 9. Verificacion automatizada de login (signInWithPassword) contra Supabase Auth
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  VERIFICACION DE LOGIN Y PERMISOS EN SUPABASE INTEGRATION" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

$previewUrl = "https://aciacam-member-itrf9cxxo-german-dips-projects.vercel.app/login"
$results = @()
$allPassed = $true

$bstrCheck = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPass)
$plainCheck = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstrCheck)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstrCheck)

foreach ($u in $TARGET_USERS) {
    $loginBody = @{
        "email"    = $u.Email
        "password" = $plainCheck
    } | ConvertTo-Json

    $loginHeaders = @{
        "apikey"       = $anonKey
        "Content-Type" = "application/json"
    }

    $loginOk = $false
    $dbRole = "desconocido"
    $isActive = $false

    # 9.1 Autenticacion GoTrue (signInWithPassword)
    try {
        $tokenUri = $supabaseUrl + "/auth/v1/token?grant_type=password"
        $loginRes = Invoke-RestMethod -Uri $tokenUri -Method Post -Headers $loginHeaders -Body $loginBody
        if ($loginRes.access_token) {
            $loginOk = $true
        }
    }
    catch {
        $loginOk = $false
    }

    # 9.2 Verificacion de ficha de socio con credencial administrativa
    try {
        $socioCheckUri = $supabaseUrl + "/rest/v1/socios?auth_user_id=eq." + $u.AuthUserId + "&select=rol,status,bloqueado"
        $socioCheck = Invoke-RestMethod -Uri $socioCheckUri -Method Get -Headers $adminHeaders
        $checkItems = @($socioCheck)
        if ($checkItems.Count -gt 0) {
            $dbRole = $checkItems[0].rol
            $isActive = ($checkItems[0].status -eq "active" -and -not $checkItems[0].bloqueado)
        }
    }
    catch {
        # Ignorado si falla lectura admin
    }

    $statusLabel = "NO"
    if ($isActive) { $statusLabel = "SI" }

    $loginLabel = "FAIL"
    if ($loginOk) { $loginLabel = "PASS (200 OK)" }

    if (-not $loginOk -or $dbRole -ne $u.ExpectedRole -or -not $isActive) {
        $allPassed = $false
    }

    $results += [PSCustomObject]@{
        Perfil          = $u.Label
        Email           = $u.Email
        RolEsperado     = $u.ExpectedRole
        RolEnDB         = $dbRole
        Activo          = $statusLabel
        LoginVerificado = $loginLabel
    }
}

$plainCheck = $null
[System.GC]::Collect()

Write-Host ""
$results | Format-Table -AutoSize Perfil, Email, RolEsperado, RolEnDB, Activo, LoginVerificado

if (-not $allPassed) {
    Write-Host ""
    Write-Error "Uno o mas perfiles no superaron la verificacion de login y permisos."
    exit 1
}

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  CONFIGURACION Y VERIFICACION COMPLETADAS CON EXITO" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "Ya podes ingresar en Vercel Preview para realizar tus pruebas:" -ForegroundColor White
Write-Host "  URL de Preview: $previewUrl" -ForegroundColor Cyan
Write-Host "  Usuarios:" -ForegroundColor White
Write-Host "    - Admin: e2e-admin-sprint5@aciacam-test.invalid" -ForegroundColor Gray
Write-Host "    - Socio: e2e-socio-sprint5@aciacam-test.invalid" -ForegroundColor Gray
Write-Host "    - Staff: e2e-staff-b-sprint5@aciacam-test.invalid" -ForegroundColor Gray
Write-Host "==================================================================" -ForegroundColor Green
Write-Host ""
