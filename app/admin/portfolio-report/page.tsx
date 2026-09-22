import AdminOnly from '../../../components/AdminOnly';
import PortfolioReport from '../../../components/PortfolioReport';

export const metadata = {
  title: 'Portfolio Report - Appreciate Dashboard',
  description: 'On-demand portfolio status snapshot with month-over-month, quarter-over-quarter, and year-over-year comparisons.',
};

export default function PortfolioReportPage() {
  return (
    <AdminOnly page="portfolio_report">
      <PortfolioReport />
    </AdminOnly>
  );
}
