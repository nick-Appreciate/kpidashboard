# Guest Card Inquiries Dashboard - Supabase + Vercel

A production-ready dashboard that automatically processes emailed Excel reports and displays analytics.

## 🚀 Architecture

- **Database**: Supabase (PostgreSQL)
- **Backend**: Vercel Serverless Functions
- **Frontend**: Next.js on Vercel
- **Email Parser**: Python script (runs locally or on a server)

## ✨ Features

- 📧 Automatic email parsing and data import
- 📊 Interactive charts and analytics
- 🔄 Real-time data updates
- 🎨 Beautiful, responsive UI
- 🔒 Secure authentication ready
- ☁️ Fully serverless deployment

## 📦 Project Structure

```
inquiry-dashboard-supabase/
├── app/                    # Next.js 14 App Router
│   ├── page.js            # Dashboard page
│   ├── layout.js          # Root layout
│   └── api/               # API routes (Vercel Functions)
│       ├── inquiries/
│       └── stats/
├── components/            # React components
│   └── Dashboard.js
├── lib/                   # Utilities
│   └── supabase.js       # Supabase client
├── email-parser/         # Email parsing script
│   └── parser.py
├── supabase/            # Database schema
│   └── schema.sql
├── package.json
└── vercel.json
```

## 🛠️ Setup Instructions

### 1. Supabase Setup

1. **Create a Supabase project**
   - Go to https://supabase.com
   - Create a new project
   - Wait for database to be ready

2. **Run the database schema**
   - Go to SQL Editor in Supabase dashboard
   - Copy contents of `supabase/schema.sql`
   - Run the SQL

3. **Get your credentials**
   - Go to Project Settings > API
   - Copy `Project URL` and `anon/public` key

### 2. Vercel Deployment

#### Option A: Deploy with GitHub (Recommended)

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/inquiry-dashboard.git
   git push -u origin main
   ```

2. **Deploy to Vercel**
   - Go to https://vercel.com
   - Import your GitHub repository
   - Add environment variables:
     - `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase anon key
     - `SUPABASE_SERVICE_KEY`: Your Supabase service key (for API routes)
   - Deploy!

#### Option B: Deploy with Vercel CLI

```bash
npm install -g vercel
vercel login
vercel

# Add environment variables
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_KEY

# Deploy to production
vercel --prod
```

### 3. Email Parser Setup

The email parser needs to run somewhere to monitor your inbox. Options:

#### Option A: Run Locally

```bash
cd email-parser
pip install -r requirements.txt

# Configure
cp .env.example .env
nano .env  # Add your email credentials and Vercel API URL

# Run
python parser.py
```

#### Option B: Run on a Server

Deploy the parser to:
- **Heroku** (free tier with worker dyno)
- **Railway.app** (free tier)
- **DigitalOcean Droplet** ($4/month)
- **AWS Lambda** (scheduled function)

#### Option C: GitHub Actions (Scheduled)

Create `.github/workflows/email-parser.yml`:
```yaml
name: Email Parser
on:
  schedule:
    - cron: '*/30 * * * *'  # Every 30 minutes
  workflow_dispatch:

jobs:
  parse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.9'
      - run: |
          cd email-parser
          pip install -r requirements.txt
          python parser.py
        env:
          EMAIL_HOST: ${{ secrets.EMAIL_HOST }}
          EMAIL_USER: ${{ secrets.EMAIL_USER }}
          EMAIL_PASSWORD: ${{ secrets.EMAIL_PASSWORD }}
          API_URL: ${{ secrets.API_URL }}
```

## 🔧 Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Open http://localhost:3000
```

## 🌍 Environment Variables

### Frontend (.env.local)
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Backend/API Routes
```
SUPABASE_SERVICE_KEY=your-service-role-key
```

### Email Parser
```
EMAIL_HOST=imap.gmail.com
EMAIL_PORT=993
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
API_URL=https://your-app.vercel.app/api
CHECK_INTERVAL=300
```

## 📊 API Endpoints

All endpoints are serverless functions on Vercel:

- `GET /api/inquiries` - Get all inquiries with filters
- `GET /api/inquiries/properties` - Get unique properties
- `GET /api/inquiries/statuses` - Get unique statuses
- `POST /api/inquiries/batch` - Import batch of inquiries
- `GET /api/stats` - Get dashboard statistics

## 🔒 Security

### Row Level Security (RLS)

Enable RLS in Supabase for additional security:

```sql
-- Enable RLS
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

-- Allow read access to all
CREATE POLICY "Allow read access to all" ON inquiries
  FOR SELECT USING (true);

-- Allow insert only with service key (API routes)
CREATE POLICY "Allow insert from service" ON inquiries
  FOR INSERT WITH CHECK (true);
```

### API Authentication (Optional)

Add API key authentication:

```javascript
// middleware.js
export function middleware(request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }
}
```

## 💰 Cost Estimate

- **Supabase**: Free tier (500MB database, 2GB bandwidth)
- **Vercel**: Free tier (100GB bandwidth, unlimited deployments)
- **Email Parser**: Free (if using GitHub Actions or local)

**Total: $0/month** (within free tiers)

Upgrade if needed:
- Supabase Pro: $25/month (8GB database)
- Vercel Pro: $20/month (1TB bandwidth)

## 🚀 Performance

- **Page Load**: < 1 second (static generation)
- **API Response**: < 500ms (serverless functions)
- **Database Queries**: < 100ms (Supabase connection pooling)

## 📈 Monitoring

- **Vercel Analytics**: Built-in analytics dashboard
- **Supabase Logs**: View database logs and API requests
- **Error Tracking**: Add Sentry for error monitoring

## 🔄 Updates

```bash
# Pull latest changes
git pull

# Deploy to Vercel (automatic with GitHub)
# Or manually:
vercel --prod
```

## 🐛 Troubleshooting

### Dashboard not loading data
- Check Supabase credentials in Vercel environment variables
- Verify database schema is created
- Check browser console for errors

### Email parser not working
- Verify email credentials
- Check API_URL is correct (should be your Vercel URL)
- Look at parser.log file

### API errors
- Check Vercel function logs
- Verify SUPABASE_SERVICE_KEY is set
- Test endpoints directly in browser

## 📚 Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Vercel Documentation](https://vercel.com/docs)

## 🤝 Support

For issues or questions, check the logs:
- Vercel Dashboard: Runtime Logs
- Supabase Dashboard: Database Logs
- Email Parser: `email-parser/parser.log`
