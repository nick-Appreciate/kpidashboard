import { supabaseAdmin } from '../../../../lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const { email, name } = await request.json();
    
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    
    // Check if user exists in app_users and is active
    const { data: appUser, error: appUserError } = await supabaseAdmin
      .from('app_users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .eq('is_active', true)
      .single();
    
    if (appUserError || !appUser) {
      return NextResponse.json({ error: 'User not authorized. Contact an administrator.' }, { status: 403 });
    }
    
    // Invite user via Supabase Auth
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        name: name || appUser.name,
        role: appUser.role
      },
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback`
    });
    
    if (error) {
      console.error('Invite error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Update app_users with the auth user id
    if (data?.user?.id) {
      await supabaseAdmin
        .from('app_users')
        .update({ auth_user_id: data.user.id })
        .eq('email', email.toLowerCase().trim());
    }
    
    return NextResponse.json({ 
      success: true, 
      message: `Invitation sent to ${email}` 
    });
    
  } catch (error) {
    console.error('Invite error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
