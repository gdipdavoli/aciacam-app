const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const container = process.env.ACIACAM_PG_CONTAINER || 'aciacam-rc-20261117';
const database = `rc_trial_${Date.now()}_${process.pid}`;

function docker(args, input) {
    const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000 });
    if (result.status !== 0) throw new Error(result.stderr || String(result.error));
    return result.stdout;
}

const endpoint = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).trim();
assert.match(endpoint, /^(npipe|unix):/);
assert.ok(!process.env.DOCKER_HOST || /^(npipe|unix):/.test(process.env.DOCKER_HOST));

const info = JSON.parse(docker(['inspect', '--format', '{{json .}}', container]));
assert.equal(info.Config.Labels['aciacam.disposable'], 'sec01-rc');
assert.equal(info.HostConfig.NetworkMode, 'none');
assert.equal(info.Mounts.length, 0);
assert.ok(Object.prototype.hasOwnProperty.call(info.HostConfig.Tmpfs || {}, '/var/lib/postgresql/data'));
assert.ok(!info.HostConfig.PortBindings || Object.keys(info.HostConfig.PortBindings).length === 0);

docker(['exec', container, 'createdb', '-U', 'postgres', database]);

function sql(input, db = database) {
    return docker(['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], input);
}

const results = {
    database,
    container,
    fixture: 'production-metadata.fixture.sql',
    steps: [],
    m1RollbackReapplyVerified: false,
    cleanedUp: false
};

try {
    sql(fs.readFileSync(path.join(root, 'tests/release/production-metadata.fixture.sql'), 'utf8'));
    console.log('PASS baseline metadata');

    for (const file of JSON.parse(fs.readFileSync(path.join(root, 'release/sec01/sequence.json'), 'utf8'))) {
        sql(fs.readFileSync(path.join(root, file), 'utf8'));
        results.steps.push(file);
        console.log('PASS ' + file);
    }

    if (fs.existsSync(path.join(root, 'tests/release/behavior.sql'))) {
        const out = sql(fs.readFileSync(path.join(root, 'tests/release/behavior.sql'), 'utf8'));
        if (out) console.log(out.trim());
        console.log('PASS tests/release/behavior.sql');
    }

    // Rollback selectivo de M1 y verificación negativa con postflight
    sql(`
      DROP TRIGGER IF EXISTS tr_a_order_state_machine ON public.pedidos;
      DROP TRIGGER IF EXISTS tr_pedidos_audit_notes_and_archive ON public.pedidos;
    `);
    let rollbackDetected = false;
    try {
        sql(fs.readFileSync(path.join(root, 'release/sec01/postflight.sql'), 'utf8'));
    } catch (e) {
        if (String(e.message).includes('M1_MISSING')) {
            rollbackDetected = true;
        } else {
            throw e;
        }
    }
    assert.ok(rollbackDetected, 'El rollback selectivo de M1 debe ser detectado como M1_MISSING por postflight.sql');
    console.log('PASS selective M1 rollback verified (M1_MISSING detected)');

    // Reaplicación idempotente de M1 y postflight final
    sql(fs.readFileSync(path.join(root, 'supabase/migrations/20261117090100_sec01_m1_order_state_machine_and_stock_guard.sql'), 'utf8'));
    sql(fs.readFileSync(path.join(root, 'release/sec01/postflight.sql'), 'utf8'));
    results.m1RollbackReapplyVerified = true;
    console.log('PASS M1 reapplication + postflight.sql');

    results.success = true;
} catch (error) {
    results.success = false;
    results.error = error.message;
    console.error(error.message);
    process.exitCode = 1;
} finally {
    try {
        sql(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE);`, 'postgres');
        results.cleanedUp = true;
        console.log('PASS cleanup disposable database: ' + database);
    } catch (cleanupErr) {
        results.cleanupError = cleanupErr.message;
        console.error('WARN cleanup failed: ' + cleanupErr.message);
        process.exitCode = 1;
    }
    fs.mkdirSync(path.join(root, 'release/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'release/evidence/last-trial.json'), JSON.stringify(results, null, 2));
}
