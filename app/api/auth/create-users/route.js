import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    // Create client with anon key for signUp
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    // Get all active users from app_users
    const { data: appUsers, error: fetchError } = await supabase
      .from('app_users')
      .select('*')
      .eq('is_active', true);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const results = [];
    const tempPassword = 'TempPass123!@#'; // Temporary password - users will reset

    for (const appUser of appUsers) {
      try {
        // Check if user already exists
        const { data: existingCheck } = await supabase.auth.signInWithPassword({
          email: appUser.email,
          password: 'check-if-exists'
        });
        
        // If no error about invalid credentials, user might exist
        // Create user with signUp
        const { data, error } = await supabase.auth.signUp({
          email: appUser.email,
          password: tempPassword,
          options: {
            data: {
              name: appUser.name,
              role: appUser.role
            }
          }
        });

        if (error) {
          results.push({
            email: appUser.email,
            status: 'error',
            message: error.message
          });
        } else if (data?.user) {
          results.push({
            email: appUser.email,
            status: 'created',
            userId: data.user.id,
            message: 'User created - use password reset to set your own password'
          });
        } else {
          results.push({
            email: appUser.email,
            status: 'exists',
            message: 'User may already exist'
          });
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err) {
        results.push({
          email: appUser.email,
          status: 'error',
          message: err.message
        });
      }
    }

    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: results.length,
        created: results.filter(r => r.status === 'created').length,
        exists: results.filter(r => r.status === 'exists').length,
        errors: results.filter(r => r.status === 'error').length
      },
      note: 'Users created with temporary password. Each user should use "Forgot Password" to set their own password.'
    });

  } catch (error) {
    console.error('Create users error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
