import { supabase } from '../../../lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const property = searchParams.get('property');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Build date filters helper
    const addDateFilters = (query, dateField) => {
      if (startDate) query = query.gte(dateField, startDate);
      if (endDate) query = query.lte(dateField, endDate + 'T23:59:59');
      return query;
    };

    // Get inquiry status breakdown
    let inquiriesQuery = supabase.from('leasing_reports').select('status');
    if (property && property !== 'all') inquiriesQuery = inquiriesQuery.eq('property', property);
    inquiriesQuery = addDateFilters(inquiriesQuery, 'inquiry_received');
    const { data: inquiriesData, error: inquiriesError } = await inquiriesQuery;
    if (inquiriesError) throw inquiriesError;

    const inquiryStatusCounts = {};
    inquiriesData?.forEach(row => {
      const status = row.status || 'Unknown';
      inquiryStatusCounts[status] = (inquiryStatusCounts[status] || 0) + 1;
    });

    // Get showings with status breakdown
    let showingsQuery = supabase.from('showings').select('status');
    if (property && property !== 'all') showingsQuery = showingsQuery.eq('property', property);
    showingsQuery = addDateFilters(showingsQuery, 'showing_time');
    const { data: showingsData, error: showingsError } = await showingsQuery;
    if (showingsError) throw showingsError;

    const showingStatusCounts = {};
    showingsData?.forEach(row => {
      const status = row.status || 'Unknown';
      showingStatusCounts[status] = (showingStatusCounts[status] || 0) + 1;
    });

    // Get applications with status breakdown
    let applicationsQuery = supabase.from('rental_applications').select('status, application_status');
    applicationsQuery = addDateFilters(applicationsQuery, 'received');
    const { data: applicationsData, error: applicationsError } = await applicationsQuery;
    if (applicationsError) throw applicationsError;

    const applicationStatusCounts = {};
    applicationsData?.forEach(row => {
      const status = row.application_status || row.status || 'Unknown';
      applicationStatusCounts[status] = (applicationStatusCounts[status] || 0) + 1;
    });

    // Calculate counts
    const inquiries = inquiriesData?.length || 0;
    const totalShowings = showingsData?.length || 0;
    const showingsScheduled = (showingStatusCounts['Scheduled'] || 0);
    const showingsCompleted = (showingStatusCounts['Completed'] || 0);
    const showingsNoShow = (showingStatusCounts['No Show'] || 0);
    const showingsCanceled = (showingStatusCounts['Canceled'] || 0) + (showingStatusCounts['Prospect Canceled'] || 0);
    
    const applications = applicationsData?.length || 0;
    const applicationsApproved = (applicationStatusCounts['Approved'] || 0);
    const applicationsDenied = (applicationStatusCounts['Denied'] || 0);
    
    const tenants = applicationsApproved;

    // Calculate fallout at each stage
    const inquiriesNoShowing = inquiries - totalShowings;
    const inquiriesInactive = inquiryStatusCounts['Inactive'] || 0;
    const inquiriesCold = inquiryStatusCounts['Cold'] || 0;

    const funnel = {
      stages: [
        {
          name: 'Inquiries',
          count: inquiries,
          percentage: 100,
          conversionFromPrevious: null,
          color: '#667eea',
          breakdown: {
            active: inquiryStatusCounts['Active'] || 0,
            inactive: inquiriesInactive,
            applicationCompleted: inquiryStatusCounts['Application Completed'] || 0,
            cold: inquiriesCold
          }
        },
        {
          name: 'Showings Scheduled',
          count: totalShowings,
          percentage: inquiries > 0 ? Math.round((totalShowings / inquiries) * 100) : 0,
          conversionFromPrevious: inquiries > 0 ? Math.round((totalShowings / inquiries) * 100) : 0,
          color: '#8b5cf6',
          fallout: {
            count: inquiriesNoShowing,
            percentage: inquiries > 0 ? Math.round((inquiriesNoShowing / inquiries) * 100) : 0,
            reasons: [
              { label: 'No Showing Scheduled', count: inquiriesNoShowing, color: '#94a3b8' }
            ]
          }
        },
        {
          name: 'Showings Completed',
          count: showingsCompleted,
          percentage: inquiries > 0 ? Math.round((showingsCompleted / inquiries) * 100) : 0,
          conversionFromPrevious: totalShowings > 0 ? Math.round((showingsCompleted / totalShowings) * 100) : 0,
          color: '#764ba2',
          fallout: {
            count: totalShowings - showingsCompleted,
            percentage: totalShowings > 0 ? Math.round(((totalShowings - showingsCompleted) / totalShowings) * 100) : 0,
            reasons: [
              { label: 'No Show', count: showingsNoShow, color: '#ef4444' },
              { label: 'Canceled', count: showingsCanceled, color: '#f97316' },
              { label: 'Still Scheduled', count: showingsScheduled, color: '#3b82f6' }
            ]
          }
        },
        {
          name: 'Applications',
          count: applications,
          percentage: inquiries > 0 ? Math.round((applications / inquiries) * 100) : 0,
          conversionFromPrevious: showingsCompleted > 0 ? Math.round((applications / showingsCompleted) * 100) : 0,
          color: '#f093fb',
          fallout: {
            count: showingsCompleted - applications,
            percentage: showingsCompleted > 0 ? Math.round(((showingsCompleted - applications) / showingsCompleted) * 100) : 0,
            reasons: [
              { label: 'Did Not Apply', count: showingsCompleted - applications, color: '#94a3b8' }
            ]
          }
        },
        {
          name: 'Tenants',
          count: tenants,
          percentage: inquiries > 0 ? Math.round((tenants / inquiries) * 100) : 0,
          conversionFromPrevious: applications > 0 ? Math.round((tenants / applications) * 100) : 0,
          color: '#43e97b',
          fallout: {
            count: applicationsDenied,
            percentage: applications > 0 ? Math.round((applicationsDenied / applications) * 100) : 0,
            reasons: [
              { label: 'Denied', count: applicationsDenied, color: '#ef4444' }
            ]
          }
        }
      ],
      summary: {
        totalInquiries: inquiries,
        totalTenants: tenants,
        overallConversion: inquiries > 0 ? ((tenants / inquiries) * 100).toFixed(1) : '0.0',
        showingCompletionRate: totalShowings > 0 ? ((showingsCompleted / totalShowings) * 100).toFixed(1) : '0.0',
        applicationApprovalRate: applications > 0 ? ((tenants / applications) * 100).toFixed(1) : '0.0'
      },
      statusBreakdown: {
        inquiries: inquiryStatusCounts,
        showings: showingStatusCounts,
        applications: applicationStatusCounts
      }
    };

    return NextResponse.json(funnel);
  } catch (error) {
    console.error('Error fetching funnel data:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
