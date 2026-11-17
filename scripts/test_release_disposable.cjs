const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const container = 'aciacam-rc-20261117';
const database = 'rc_trial_' + Date.now();
function docker(args, input) {
    const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000 });
    if (result.status !== 0) throw new Error(result.stderr || String(result.error));
    return result.stdout;
}
const endpoint = docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']).trim();
assert.match(endpoint, /^(npipe|unix):/);
assert.ok(!process.env.DOCKER_HOST || /^(npipe|unix):/.test(process.env.DOCKER_HOST));
const info = JSON.parse(docker(['inspect','--format','{{json .}}',container]));
assert.equal(info.Config.Labels['aciacam.disposable'], 'sec01-rc');
assert.equal(info.HostConfig.NetworkMode, 'none');
assert.equal(info.Mounts.length, 0);
assert.ok(info.HostConfig.Tmpfs['/var/lib/postgresql/data']);
assert.ok(!info.HostConfig.PortBindings || Object.keys(info.HostConfig.PortBindings).length === 0);
docker(['exec',container,'createdb','-U','postgres',database]);
function sql(input) { return docker(['exec','-i',container,'psql','-X','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'], input); }
const results = { database, fixture: 'production-metadata.fixture.sql', steps: [] };
try {
    sql(fs.readFileSync(path.join(root,'tests/release/production-metadata.fixture.sql'),'utf8'));
    console.log('PASS baseline metadata');
    for (const file of JSON.parse(fs.readFileSync(path.join(root,'release/sec01/sequence.json'),'utf8'))) {
        sql(fs.readFileSync(path.join(root,file),'utf8'));
        results.steps.push(file);
        console.log('PASS '+file);
    }
    if (fs.existsSync(path.join(root,'tests/release/behavior.sql'))) {
        console.log(sql(fs.readFileSync(path.join(root,'tests/release/behavior.sql'),'utf8')));
    }
    results.success = true;
} catch (error) {
    results.success = false;
    results.error = error.message;
    console.error(error.message);
    process.exitCode = 1;
} finally {
    fs.mkdirSync(path.join(root,'release/evidence'),{recursive:true});
    fs.writeFileSync(path.join(root,'release/evidence/last-trial.json'),JSON.stringify(results,null,2));
    console.log('Base desechable: '+database);
}
