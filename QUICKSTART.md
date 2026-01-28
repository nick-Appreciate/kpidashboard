# Quick Start Guide - Supabase + Vercel

## Step-by-Step Setup (15 minutes)

### 1. Supabase Setup (5 minutes)

1. **Create Supabase Account**
   - Go to https://supabase.com
   - Sign up (free tier is perfect)
   - Create a new project
   - Wait for database to initialize (~2 minutes)

2. **Run Database Schema**
   - In Supabase dashboard, go to SQL Editor
   - Copy the entire contents of `supabase/schema.sql`
   - Paste and click "Run"
   - You should see "Success. No rows returned"

3. **Get API Keys**
   - Go to Project Settings > API
   - Copy these values (you'll need them soon):
     - `Project URL`
     - `anon public` key
     - `service_role` key (keep this secret!)

### 2. Vercel Deployment (5 minutes)

#### Option A: Deploy via GitHub (Recommended)

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/inquiry-dashboard.git
   git push -u origin main
   ```

2. **Connect to Vercel**
   - Go to https://vercel.com
   - Click "Add New Project"
   - Import your GitHub repository
   - Vercel will auto-detect Next.js

3. **Add Environment Variables**
   In Vercel project settings, add:
   ```
   NEXT_PUBLIC_SUPABASE_URL = your-project-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY = your-anon-key
   SUPABASE_SERVICE_KEY = your-service-role-key
   ```

4. **Deploy**
   - Click "Deploy"
   - Wait ~2 minutes
   - Your dashboard is live! 🎉

#### Option B: Deploy via Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy
vercel

# Add environment variables
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_KEY

# Deploy to production
vercel --prod
```

### 3. Email Parser Setup (5 minutes)

The parser runs separately and can be set up in multiple ways:

#### Option A: Run Locally (Easiest for Testing)

```bash
cd email-parser

# Install dependencies
pip install -r requirements.txt

# Configure
cp .env.example .env
nano .env  # Edit with your settings:
  # EMAIL_USER = your-email@gmail.com
  # EMAIL_PASSWORD = your-app-password
  # API_URL = https://your-app.vercel.app/api

# Run
python parser.py
```

**Gmail App Password Setup:**
1. Enable 2FA in Google Account
2. Go to https://myaccount.google.com/apppasswords
3. Generate app password for "Mail"
4. Use this password in EMAIL_PASSWORD

#### Option B: Deploy to Heroku (Always Running)

```bash
cd email-parser

# Create Procfile
echo "worker: python parser.py" > Procfile

# Deploy
heroku create inquiry-parser
heroku config:set EMAIL_HOST=imap.gmail.com
heroku config:set EMAIL_USER=your-email@gmail.com
heroku config:set EMAIL_PASSWORD=your-app-password
heroku config:set API_URL=https://your-app.vercel.app/api

git init
git add .
git commit -m "Email parser"
heroku git:remote -a inquiry-parser
git push heroku main

# Scale worker
heroku ps:scale worker=1
```

#### Option C: GitHub Actions (Scheduled, Free)

Create `.github/workflows/parser.yml`:
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

Add secrets in GitHub repo Settings > Secrets and variables > Actions.

---

## Testing Your Setup

1. **Test the Dashboard**
   - Visit your Vercel URL
   - Dashboard should load (might be empty)

2. **Test the API**
   ```bash
   curl https://your-app.vercel.app/api/inquiries
   # Should return: {"inquiries":[],"count":0}
   ```

3. **Test Email Parser**
   - Send a test email with Excel attachment
   - Wait for parser to check (or run manually)
   - Refresh dashboard - data should appear!

---

## Troubleshooting

### Dashboard shows "Failed to load data"
- Check Vercel deployment logs
- Verify environment variables are set correctly
- Test API endpoint directly in browser

### Email parser not finding emails
- Verify IMAP settings for your email provider
- Check EMAIL_PASSWORD is correct (use app password)
- Look at `parser.log` for errors

### Data not appearing in dashboard
- Check parser.log for successful sends
- Verify API_URL points to your Vercel deployment
- Check Supabase logs in dashboard

---

## Next Steps

- **Custom Domain**: Add your domain in Vercel settings
- **Authentication**: Add Row Level Security policies in Supabase
- **Monitoring**: Enable Vercel Analytics
- **Backups**: Set up Supabase database backups

---

## Cost Summary

✅ **Supabase Free Tier:**
- 500MB database
- 2GB bandwidth
- Unlimited API requests

✅ **Vercel Free Tier:**
- Unlimited deployments
- 100GB bandwidth
- Serverless functions included

✅ **GitHub Actions Free Tier:**
- 2,000 minutes/month

**Total Cost: $0/month** 🎉

Upgrade only if you exceed these limits (unlikely for most use cases).

---

## Support

If you run into issues:
1. Check Vercel deployment logs
2. Check Supabase database logs  
3. Check parser.log file
4. Make sure all environment variables are set correctly
