const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
    const { data: { user }, error } = await supabase.auth.admin.getUserById('e56d5f7b-5130-4a27-8380-46ae93485a31');
    
    if (error) {
        console.error('Error fetching user:', error);
    } else {
        console.log('German in auth.users by ID:', user);
    }
}

test();
