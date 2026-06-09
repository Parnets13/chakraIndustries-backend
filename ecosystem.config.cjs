/**
 * PM2 Ecosystem Config — Sri Chakra Industries ERP Backend
 *
 * SETUP (run once on the server):
 *   npm install -g pm2
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup          ← follow the printed command to auto-start on reboot
 *
 * USEFUL COMMANDS:
 *   pm2 list             — see all processes
 *   pm2 logs chakra-erp  — live logs
 *   pm2 restart chakra-erp
 *   pm2 reload chakra-erp   — zero-downtime reload
 *   pm2 stop chakra-erp
 *   pm2 monit            — live CPU/memory dashboard
 */
module.exports = {
  apps: [
    {
      name        : 'chakra-erp',
      script      : 'server.js',

      // Use Node's native ESM (package.json has "type":"module")
      interpreter : 'node',
      interpreter_args: '--experimental-specifier-resolution=node',

      // Keep 2 instances on multi-core servers, 1 on single-core
      instances   : 1,
      exec_mode   : 'fork',        // use 'cluster' only if you remove shared in-memory lock

      // Auto-restart on crash
      autorestart : true,
      watch       : false,         // don't watch files in production
      max_memory_restart: '512M',  // restart if memory exceeds 512 MB

      // Restart delay — prevents tight crash loops
      restart_delay : 5000,
      max_restarts  : 10,

      // Environment — production
      env_production: {
        NODE_ENV : 'production',
        PORT     : 5001,
      },

      // Environment — development (used with: pm2 start --env development)
      env_development: {
        NODE_ENV : 'development',
        PORT     : 5001,
      },

      // Log files
      out_file    : './logs/pm2-out.log',
      error_file  : './logs/pm2-error.log',
      merge_logs  : true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // Graceful shutdown — wait up to 10s for requests to drain
      kill_timeout : 10000,
      listen_timeout: 10000,
    },
  ],
};
