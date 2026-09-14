import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://bcehtpixbibbpmejsfyn.supabase.co'
const supabaseKey = 'sb_publishable_ukt54W7gCdi70e6bSr7jzw_dPxxaTCa'

export const supabase = createClient(supabaseUrl, supabaseKey)

