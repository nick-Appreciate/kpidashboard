/**
 * PM2 Ecosystem Config — Bot Process Supervision
 *
 * Deploy on VPS:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup
 *
 * Manage:
 *   pm2 status
 *   pm2 restart bpu-bot
 *   pm2 restart simmons-bot
 *   pm2 logs bpu-bot --lines 50
 */
module.exports = {
  apps: [
    {
      name: 'bpu-bot',
      script: 'dist/server.js',
      cwd: '/opt/bpu-bot',
      autorestart: true,
      max_memory_restart: '1G',
      restart_delay: 5000,
      max_restarts: 10,
      exp_backoff_restart_delay: 1000,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3101,
      },
      error_file: '/var/log/pm2/bpu-bot-error.log',
      out_file: '/var/log/pm2/bpu-bot-out.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'simmons-bot',
      script: 'dist/server.js',
      cwd: '/opt/simmons-bot',
      autorestart: true,
      max_memory_restart: '1G',
      restart_delay: 5000,
      max_restarts: 10,
      exp_backoff_restart_delay: 1000,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3102,
      },
      error_file: '/var/log/pm2/simmons-bot-error.log',
      out_file: '/var/log/pm2/simmons-bot-out.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'vps-supervisor',
      script: 'dist/server.js',
      cwd: '/opt/vps-supervisor',
      autorestart: true,
      max_memory_restart: '256M',
      restart_delay: 2000,
      max_restarts: 20,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3199,
      },
      error_file: '/var/log/pm2/vps-supervisor-error.log',
      out_file: '/var/log/pm2/vps-supervisor-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
