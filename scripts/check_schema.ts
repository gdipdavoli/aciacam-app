import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkSchema() {
  const { data, error } = await supabase.rpc('get_column_info', { table_name: 'pedidos' });
  
  if (error) {
    // Si la función RPC no existe (común), intentamos una consulta directa a information_schema
    const { data: info, error: infoError } = await supabase
      .from('_information_schema_columns') // Esto a veces falla por permisos, pero probamos
      .select('column_name, data_type')
      .eq('table_name', 'pedidos');
      
    if (infoError) {
        console.log("No se pudo obtener el schema vía RPC. Intentando consulta simple de un registro.");
        const { data: sample } = await supabase.from('pedidos').select('*').limit(1);
        console.log("Muestra de un pedido:", sample);
    } else {
        console.log("Info Schema:", info);
    }
  } else {
    console.log("Column Info:", data);
  }
}

checkSchema();
