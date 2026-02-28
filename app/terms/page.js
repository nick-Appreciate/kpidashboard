'use client';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-100 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm p-8">
        <h1 className="text-3xl font-bold text-slate-800 mb-6">Terms of Service</h1>
        <p className="text-sm text-slate-500 mb-8">Last updated: February 2026</p>
        
        <div className="prose prose-slate max-w-none">
          <h2 className="text-xl font-semibold mt-6 mb-3">1. Acceptance of Terms</h2>
          <p className="text-slate-600 mb-4">
            By accessing and using the Appreciate Dashboard ("Service"), you agree to be bound by these Terms of Service. 
            If you do not agree to these terms, please do not use the Service.
          </p>
          
          <h2 className="text-xl font-semibold mt-6 mb-3">2. Description of Service</h2>
          <p className="text-slate-600 mb-4">
            Appreciate Dashboard is a property management analytics platform that integrates with third-party services 
            to provide reporting and data visualization tools.
          </p>
          
          <h2 className="text-xl font-semibold mt-6 mb-3">3. User Responsibilities</h2>
          <p className="text-slate-600 mb-4">
            You are responsible for maintaining the confidentiality of your account credentials and for all activities 
            that occur under your account. You agree to use the Service only for lawful purposes.
          </p>
          
          <h2 className="text-xl font-semibold mt-6 mb-3">4. Data and Privacy</h2>
          <p className="text-slate-600 mb-4">
            Your use of the Service is also governed by our Privacy Policy. By using the Service, you consent to the 
            collection and use of information as described in our Privacy Policy.
          </p>
          
          <h2 className="text-xl font-semibold mt-6 mb-3">5. Third-Party Integrations</h2>
          <p className="text-slate-600 mb-4">
            The Service may integrate with third-party services such as QuickBooks, AppFolio, and others. Your use of 
            these integrations is subject to the respective third-party terms of service.
          </p>
          
          <h2 className="text-xl font-semibold mt-6 mb-3">6. Limitation of Liability</h2>
          <p className="text-slate-600 mb-4">
            The Service is provided "as is" without warranties of any kind. We shall not be liable for any indirect, 
            incidental, special, or consequential damages arising from your use of the Service.
          </p>
          
          <h2 className="text-xl font-semibold mt-6 mb-3">7. Changes to Terms</h2>
          <p className="text-slate-600 mb-4">
            We reserve the right to modify these terms at any time. Continued use of the Service after changes 
            constitutes acceptance of the modified terms.
          </p>
          
          <h2 className="text-xl font-semibold mt-6 mb-3">8. Contact</h2>
          <p className="text-slate-600 mb-4">
            For questions about these Terms of Service, please contact us at support@appreciate.io.
          </p>
        </div>
      </div>
    </div>
  );
}
