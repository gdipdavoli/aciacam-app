// A branch deployment is not a separate data environment. Fail closed until
// Preview explicitly points to its own Supabase project; never print secrets.
function verifyPreviewEnvironment(env) {
  if (env.VERCEL_ENV !== 'preview') return;
  const productionRef = 'wfzbkcdmlcrjyrtauccu';
  const ref = env.ACIACAM_PREVIEW_SUPABASE_REF;
  if (!ref || ref === productionRef || !/^[a-z0-9]+$/.test(ref)) {
    throw new Error('Preview necesita ACIACAM_PREVIEW_SUPABASE_REF de un proyecto separado.');
  }
  const expected = `https://${ref}.supabase.co`;
  if (env.NEXT_PUBLIC_SUPABASE_URL !== expected || (env.SUPABASE_URL && env.SUPABASE_URL !== expected)) {
    throw new Error('Las URLs de Supabase de Preview deben apuntar al proyecto separado.');
  }
}
module.exports = { verifyPreviewEnvironment };
if (require.main === module) verifyPreviewEnvironment(process.env);
