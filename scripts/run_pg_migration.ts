
import { Client } from 'pg';
import dotenv from 'dotenv';
import { resolve } from 'path';
import fs from 'fs';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

// Construct connection string if not present?
// Supabase usually provides DATABASE_URL in the dashboard, but maybe it's in env?
// If not, we might be stuck unless we have the password.
// Let's assume DATABASE_URL is present or construct it.
// If missing, we will have to ask the user.

const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!dbUrl) {
    console.error("❌ DATABASE_URL or POSTGRES_URL not found in .env.local");
    console.error("   Cannot run migration without direct DB connection.");
    process.exit(1);
}

const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false } // Supabase requires SSL, usually self-signed trusted
});

const migrationFile = process.argv[2];
if (!migrationFile) {
    console.error("Usage: npx tsx scripts/run_pg_migration.ts <path/to/sql>");
    process.exit(1);
}

async function run() {
    try {
        await client.connect();
        console.log("Connected to Postgres.");

        const sql = fs.readFileSync(migrationFile, 'utf-8');
        console.log(`Running migration: ${migrationFile}`);

        await client.query(sql);
        console.log("✅ Migration successful.");
    } catch (e) {
        console.error("❌ Migration failed:", e);
    } finally {
        await client.end();
    }
}

run();
