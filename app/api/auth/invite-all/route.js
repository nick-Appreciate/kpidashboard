import { supabaseAdmin } from '../../../../lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    // Get all active users from app_users
    const { data: users, error: usersError } = await supabaseAdmin
      .from('app_users')
      .select('*')
      .eq('is_active', true);
    
    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }
    
    const results = [];
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    
    for (const user of users) {
      try {
        // Check if user already exists in auth
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find(u => u.email === user.email);
        
        if (existingUser) {
          results.push({ 
            email: user.email, 
            status: 'skipped', 
            message: 'User already has auth account' 
          });
          continue;
        }
        
        // Invite user
        const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(user.email, {
          data: {
            name: user.name,
            role: user.role
          },
          redirectTo: `${siteUrl}/auth/callback`
        });
        
        if (error) {
          results.push({ 
            email: user.email, 
            status: 'error', 
            message: error.message 
          });
        } else {
          // Update app_users with auth user id
          if (data?.user?.id) {
            await supabaseAdmin
              .from('app_users')
              .update({ auth_user_id: data.user.id })
              .eq('email', user.email);
          }
          
          results.push({ 
            email: user.email, 
            status: 'invited', 
            message: 'Invitation sent' 
          });
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (err) {
        results.push({ 
          email: user.email, 
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
        invited: results.filter(r => r.status === 'invited').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        errors: results.filter(r => r.status === 'error').length
      }
    });
    
  } catch (error) {
    console.error('Invite all error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
