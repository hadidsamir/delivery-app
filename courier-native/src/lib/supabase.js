import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ujuirbwkmwyjgafddcdk.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqdWlyYndrbXd5amdhZmRkY2RrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NjMzOTgsImV4cCI6MjA4OTUzOTM5OH0.Af8FPnMIXMM6PHKQlcnzVz1pKWX-OcBOuANtMyKsoBA'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
