'use client';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-100 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm p-8">
        <h1 className="text-3xl font-bold text-slate-800 mb-6">Privacy Policy</h1>
        <p className="text-sm text-slate-500 mb-8">Last updated: February 2026</p>
        
        <div className="prose prose-slate max-w-none">
          <h2 className="text-xl font-semibold mt-6 mb-3">1. Information We Collect</h2>
          <p className="text-slate-600 mb-4">
            We collect information you provide directly to us, including account information (name, email), 
            and data from integrated third-party services (AppFolio, QuickBooks) that you authorize us to access.
          </p>
          
          <h2 className="text-xl font-semibold mt-6 mb-3">2. How We Use Your Information</h2>
          <p className="text-slate-600 mb-4">
            We use the information we collect to provide, maintain, and improve our services, including 
            generating reports, analytics, and dashboards for property management purposes.
          </p>
          
          <h2 className="text-xl font-semibold mt-6 mb-3">3. Data from Third-Party Services</h2>
          <p className="text-slate-600 mb-4">
            When you connect third-party services like QuickBooks or AppFolio, we access only the data 
            necessary to provide our services. We do not sell or share this data with unrelated third parties.
          </p>
          
          <h2 className="text-xl font-semibold mt-6 mb-3">4. Data Security</h2>
          <p className="text-slate-600 mb-4">
            We implement appropriate security measures to protect your personal information against unauthorized 
            access, alteration, disclosure, or destruction. Data is encrypted in transit and at rest.
          </p>
          
          <h2 className="text-xl font-semibold mt-6 mb-3">5. Data Retention</h2>
          <p className="text-slate-600 mb-4">
            We retain your information for as long as your account is active or as needed to provide services. 
            You may request deletion of your data at any time by contacting us.
          </p>
          
          <h2 className="text-xl font-semibold mt-6 mb-3">6. Your Rights</h2>
          <p className="text-slate-600 mb-4">
            You have the right to access, correct, or delete your personal information. You may also disconnect 
            third-party integrations at any time, which will stop further data collection from those services.
          </p>
          
          <h2 className="text-xl font-semibold mt-6 mb-3">7. Cookies and Tracking</h2>
          <p className="text-slate-600 mb-4">
            We use cookies and similar technologies to maintain your session and improve user experience. 
            You can control cookie settings through your browser preferences.
          </p>
          
          <h2 className="text-xl font-semibold mt-6 mb-3">8. Changes to This Policy</h2>
          <p className="text-slate-600 mb-4">
            We may update this Privacy Policy from time to time. We will notify you of any changes by posting 
            the new policy on this page with an updated revision date.
          </p>
          
          <h2 className="text-xl font-semibold mt-6 mb-3">9. Contact Us</h2>
          <p className="text-slate-600 mb-4">
            If you have questions about this Privacy Policy, please contact us at support@appreciate.io.
          </p>
        </div>
      </div>
    </div>
  );
}
